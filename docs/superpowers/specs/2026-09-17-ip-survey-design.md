# Dashboard and IP Survey — design

Date: 2026-09-17
Status: approved in conversation, pending written review

## Goal

Give the signed-in user a **Dashboard**: a separate area of the site for
features that only make sense for the owner. The first feature is an **IP
Survey** that scans the home LAN, lists every connected device in a sortable
table, persists the result, and highlights what changed since the last save.

## Context that shapes the design

- The cluster is a single bare-metal k3s node (`klaus-optiplex-9020`, Intel,
  `linux/amd64`) on the home LAN at `192.168.1.103`; the router is an ASUS
  RT-AX86U at `192.168.1.1`. "The local network" is `192.168.1.0/24`.
- Pods live on the flannel pod network (`10.42.0.0/16`). They reach LAN hosts
  at layer 3 (TCP, HTTP) through the node's NAT, but **not at layer 2**: ARP,
  and therefore MAC addresses, plus mDNS and SSDP multicast, do not cross it.
  A scan from the existing website pod could not see MAC addresses.
- Knative PVC support is already enabled cluster-wide
  (`kubernetes.podspec-persistent-volume-claim` and `-write`, in
  `kube-setup/manifests/02-knative-config-patches.yaml`); `bulbs` uses it.
- A host-network pod cannot be a Knative Service.
- This repo's deploy runner may only manage Knative Services in the
  `www-klaushofrichter` namespace.
- NetworkPolicy is not reliably enforced for host-network pods, so it cannot
  be the control that keeps the scanner private.

## Decisions

| Question | Decision | Why |
|---|---|---|
| How devices are discovered | A dedicated **scanner** on the host network (option A) | Only layer-2 access yields MAC addresses. Router scraping (B) needs the router admin password; an unprivileged in-pod scan (C) cannot see MACs. |
| How the scanner runs | A **Kubernetes Deployment** with `hostNetwork: true` on the node, not a systemd unit | Same network view as the host, but deployed, versioned, restarted and recreatable like every other workload. |
| Where the code lives | **This repo**, as a second image | The page and the scanner are one feature with one API contract; one PR, one test run, one release version. |
| What Save keeps | **Latest survey only, plus comparison** (option c) | Marking devices new or gone is what makes a survey useful; history adds UI that would rarely be read and can be added later. |
| Secondary device data | In a per-device **Details modal** | Keeps the table at seven columns. |

## 1. Components and data flow

### Website (existing Knative Service) — additions

- **Dashboard button**, rendered server-side only for a signed-in session,
  placed left of Logout. Signed-out responses never contain it.
- **Pages**
  - `GET /dashboard` — feature tiles; IP Survey is the first.
  - `GET /dashboard/ip-survey` — the survey page.
  - Both carry navigation back to the cards (see section 3).
- **`requireAuth` middleware** on every `/dashboard*` page and `/api/survey*`
  route. Today authentication only decides what `renderPage` includes; these
  routes must reject a missing or invalid session server-side. Pages redirect
  to `/`; API routes return `401`. A session also counts only while its email
  is still in `ALLOWED_EMAILS` — a signed cookie is otherwise valid for 7 days
  after the address is removed. The homepage uses the same check, so the
  Dashboard button and the gated cards appear under exactly the conditions the
  routes accept.
- **API**
  - `GET /api/survey` — one status object for the page to poll: scan progress
    (idle, running with stage, finished, failed, or scanner unavailable) plus
    the table view (rows already compared against the saved survey, counts,
    and whether the shown result is unsaved).
  - `POST /api/survey/scan` — ask the scanner to start a scan; `202` with the
    status, `409` if one is running, `503` if the scanner is unreachable.
  - `POST /api/survey/save` — persist the scanner's finished result (see
    section 3); `409` if there is none.
- **Storage**: PVC `www-data` mounted at `/app/data/surveys`; the saved
  survey is `latest.json`. Mounted there rather than at `/app/data` so it
  does not shadow the image cache directory the Dockerfile creates.

### Scanner (new Deployment)

- Code in `scanner/`, image `ghcr.io/klaushofrichter/www-klaushofrichter-scanner`,
  Node on `node:26-alpine` with the Alpine `arp-scan` package.
- `hostNetwork: true`, all Linux capabilities dropped except `NET_RAW`.
- **Scan range is configuration only** (`SCAN_CIDR=192.168.1.0/24`). No request
  parameter can change what is scanned, so a stolen session cannot turn it
  into a general-purpose scanner.
- **One scan at a time**; a start request during a scan returns busy (`409`).
- **Two controls replace NetworkPolicy:**
  1. It listens only on the node's `cni0` bridge address (`10.42.0.1`), not on
     the LAN address, so LAN devices cannot connect to it at all. If `cni0` is
     not up yet (early after a node reboot), the bind fails, the process
     exits, and Kubernetes restarts it until the bridge exists.
  2. Every call except `/health` requires a bearer token shared with the
     website via a Kubernetes Secret.
- `GET /health` is unauthenticated and returns only status and version.

### Flow

1. Browser → website (session checked by `requireAuth`).
2. Website → scanner at `SCANNER_URL` (token checked).
3. Scanner runs the stages in section 2; the website relays progress and the
   result.
4. Website compares the finished scan against the saved survey by **MAC
   address** (DHCP can move a device to a new IP) and returns rows marked
   *new*, *unchanged* or *gone*. Comparison runs server-side so it is unit
   tested; the browser only renders and sorts.
5. **Save** → website reads the scanner's finished result and writes it to
   the PVC.

`SCANNER_URL` is `http://10.42.0.1:9450`, addressed directly rather than
through a Service name, because the scanner does not listen on the address a
Service would route to. Port 9450 was picked to avoid the usual host-network
tenants (node-exporter 9100, kubelet 10250, k3s 6443); confirm it is free on
the node before first deploy (`ss -ltn | grep 9450`). The address is stable
on this single-node flannel cluster; a rebuilt cluster with a different pod
CIDR would need the setting changed.

## 2. What the scanner collects

A scan has four stages, reported to the page as they run.

1. **Discovery (~5 s)** — `arp-scan` over `SCAN_CIDR`. Yields IP, MAC,
   manufacturer (from the bundled `/usr/share/arp-scan/ieee-oui.txt`, verified
   present in the Alpine `community` package for x86_64) and response time.
   Every LAN device must answer ARP, so this finds more than ping.
   - The node does not answer its own ARP scan; the scanner adds itself.
   - MACs with the locally-administered bit set are randomized ("Private Wi-Fi
     Address"); their manufacturer is shown as *Private address*.
2. **Names (~5 s, concurrent)**, most specific first:
   - **mDNS/Bonjour**: `.local` hostnames and advertised service types, mapped
     to readable labels (*Chromecast*, *AirPlay*, *Printer*, *HomeKit*).
   - **SSDP/UPnP**: announced friendly name and model.
   - **Reverse DNS** against the router, which knows DHCP hostnames.
   The source of the chosen name is recorded and shown.
3. **Ports (~10 s)** — TCP connect, only to hosts found in stage 1, only these
   ports: 22, 53, 80, 443, 445, 554, 631, 1883, 5000, 5001, 8008, 8009, 8080,
   8123, 8443, 9100. No full port scan.
4. **Web (~10 s)** — for each open web port, fetch `/` with a short timeout and
   read the `<title>`. Self-signed certificates are accepted for this read only.
   A responding device gets a link (e.g. `http://192.168.1.50:8123`).

**Per-device record**: `ip`, `mac`, `vendor`, `privateMac`, `name`,
`nameSource`, `web` (url, title), `services`, `ports`, `rttMs`.

**Deliberately excluded**: NetBIOS names (reverse DNS usually covers them), OS
fingerprinting (needs nmap; heavy and unreliable), Wi-Fi signal and band (only
the router has these — a possible later addition via option B).

**Meaning of *gone***: "did not answer this scan". A sleeping phone can miss a
scan, and a device with a rotating MAC appears as one *new* plus one *gone*.

## 3. The page, the table, and Save/compare

### Navigation

- Header controls unchanged, plus **Dashboard** when signed in.
- `/dashboard`: "← Cards".
- `/dashboard/ip-survey`: breadcrumb **Cards › Dashboard › IP Survey**.

### Toolbar

- **Scan** — disabled while a scan runs; shows the stage, e.g.
  "2 of 4: finding names…".
- **Save** — enabled only when a finished, unsaved scan exists.
- **Status line**, e.g. *Saved survey · 17 Sep 14:02 · 31 devices*, or
  *Unsaved scan · 14:20 · 33 devices · 2 new · 1 gone*.

### Load behavior

- Shows the saved survey, or *"No saved survey yet. Run a scan."*
- If a scan is already running (another tab), the page follows its progress
  rather than offering to start a second one.

### Table

Columns: **Status · IP · Name · Manufacturer · MAC · Web · Details**

- Name carries a small source tag (mDNS / SSDP / DNS).
- Web shows the link and page title.
- Details is a button such as "4 ports", or "—" when there is nothing to show.
- **Sorting**: click a header to sort, again to reverse; an arrow and
  `aria-sort` show the state. IPs sort numerically (`.9` before `.10`). Status
  sorts *new*, unchanged, *gone*. Default: by IP.
- *Gone* devices render greyed out, at the bottom of their sort group.
- Vanilla JavaScript, no framework, matching the existing site.

### Details modal

Native `<dialog>` (Esc closes it; focus handled by the browser). Shows the
device's name, IP and MAC; a table of open ports with their likely use and,
for web ports, link and title; the advertised services; response time.

### Save and compare

- **Save persists the scanner's result, never the request body.** The scanner
  holds its last finished scan until the next one starts; `POST
  /api/survey/save` reads that and writes it, so a crafted request cannot plant
  devices in the saved survey. The website keeps no copy of its own, so a
  website restart loses nothing.
- **With no saved survey there is nothing to compare against**, so no device
  is marked *new*.
- **Atomic write**: write to a temporary file in the same directory, then
  rename over `latest.json`.
- **File contents**: `scannedAt`, `savedAt`, `cidr`, `version` (release),
  `devices`.
- **Gone devices are not saved.** The saved survey is exactly what answered
  that scan.

### Errors

- Scanner unreachable → *"Scanner unavailable"*; the saved survey stays shown.
- Scan already running → the page follows it.
- Save fails → error shown; the unsaved result is kept for a retry.

## 4. Deployment, testing, rollout

### Deploy workflow (`deploy-production.yml`)

1. Build and push **both images** tagged with the same release version.
2. Update both image references in `kube-setup` and commit, as today for the
   site.
3. **Scanner first**: `kubectl set image deployment/www-scanner …`, then
   `kubectl rollout status`. This needs only `patch` on the named Deployment;
   the runner never gets `create` or `apply` rights over a privileged pod spec.
4. **Website second**, unchanged. Scanner-first means a new website never
   talks to an old scanner.
5. **Smoke test** adds a call from the in-cluster runner to the scanner's
   `/health` on `10.42.0.1`, checking the reported version. It never starts
   a scan.

### One-time cluster changes (applied by hand in `kube-setup`)

- PVC `www-data`: `local-path`, `ReadWriteOnce`, 100Mi; mounted into the ksvc
  at `/app/data/surveys`.
- Secret holding the scanner token, consumed by both workloads.
- Deployment `www-scanner`:
  - `hostNetwork: true`, `dnsPolicy: ClusterFirstWithHostNet`.
  - `capabilities: drop [ALL], add [NET_RAW]`, read-only root filesystem.
  - `strategy: Recreate` — a rolling update would start the new pod while the
    old one still holds port 9450 on the host network; the new pod would fail
    to bind and crash-loop until the old one exited.
  - Small resource limits.
- Runner Role: `apps/deployments` with verbs `get`, `watch`, `patch`, limited
  by `resourceNames: [www-scanner]`.

**Resolved during implementation, with a test in the real image**: whether the
scanner runs non-root with `cap_net_raw` set on the `arp-scan` binary (which
requires `allowPrivilegeEscalation: true` for the file capability to take
effect) or as root holding only `NET_RAW`. Whichever is chosen, the test
proves `arp-scan` works and nothing else gains privilege.

### Testing

- **Unit (vitest)**
  - Parsers for `arp-scan`, mDNS and SSDP output, from recorded fixtures.
  - Private-MAC detection.
  - Numeric IP sort.
  - New/gone comparison keyed on MAC.
  - Atomic save.
  - `requireAuth`: missing and invalid sessions rejected on pages and API.
  - Save writes the server-held result and ignores the request body.
  - Scanner: missing token → `401`; scan in progress → `409`; range comes only
    from configuration.
- **e2e (Playwright)**
  - Signed out: no Dashboard button; `/dashboard` redirects; `/api/survey/*`
    returns `401`.
  - Signed in (test session cookie) against a **fake scanner** returning
    fixture data: table renders, sorting, Details modal, Save, comparison.
  - CI never runs a real scan.

### Rollout phases (each shippable on its own)

1. **Dashboard shell** — `requireAuth`, button, both pages, navigation,
   empty state. No cluster change.
2. **Survey page against the fake scanner** — table, sorting, Details,
   Save/compare, PVC. Needs the PVC manifest applied.
3. **Real scanner** — second image, Deployment, Secret, Role change, two-image
   deploy. Needs cluster access. Notify the `kube-setup` session: the deploy
   workflow and runner RBAC change, which its fleet documents track.
4. **First real scan at home**, checked against known devices.

## Limits

- Device links point at `192.168.1.x` and only work from the LAN (or a VPN).
- Discovery sees `192.168.1.0/24` only; an isolated guest Wi-Fi network is not
  covered.
