// Shared by config.ts (what may be scanned) and discovery.ts (what may come
// back from the scan). Shape-only would accept 999.999.999.999: both the
// CIDR reaching a spawned arp-scan process and the IPs it replies with need
// to be actually valid, not just plausibly shaped, so there is exactly one
// definition of "valid octet" for both sides to agree on.
export const IPV4 = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;
