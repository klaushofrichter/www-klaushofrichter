import { SurveyStatus } from '../survey/types';
import { renderDashboardShell } from './dashboardShell';

// "<" is replaced with its escaped form so no value - a device name, a page
// title - can close the <script> element the JSON sits in. JSON.parse reads
// it back unchanged.
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const IP_SURVEY_CSS = `
  .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 10px; }
  .toolbar button {
    height: 34px; padding: 0 16px; border-radius: 17px;
    border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08);
    color: #eef0fb; font-size: 13px; cursor: pointer;
  }
  .toolbar button:disabled { opacity: 0.4; cursor: default; }
  #scan-progress { font-size: 13px; opacity: 0.85; }
  #survey-status-line { font-size: 13px; opacity: 0.75; margin: 0 0 6px; }
  #survey-message { font-size: 13px; color: #fca5a5; margin: 0 0 12px; min-height: 1em; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); white-space: nowrap; }
  th button { background: none; border: 0; color: inherit; font: inherit; font-weight: 600; cursor: pointer; padding: 0; }
  th[aria-sort="ascending"] button::after { content: ' ▲'; font-size: 10px; }
  th[aria-sort="descending"] button::after { content: ' ▼'; font-size: 10px; }
  tr.gone td { opacity: 0.45; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 9px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-new { background: #065f46; color: #d1fae5; }
  .badge-gone { background: #4b5563; color: #e5e7eb; }
  .status-none { opacity: 0.35; }
  .source { margin-left: 6px; font-size: 10px; opacity: 0.55; text-transform: uppercase; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  td a { color: #93a5fd; text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .note-input {
    width: 100%; min-width: 160px; box-sizing: border-box; white-space: normal;
    height: 26px; padding: 0 8px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08);
    color: #eef0fb; font: inherit; font-size: 12px;
  }
  .note-input:focus { outline: 1px solid #93a5fd; }
  .col-hint {
    display: block; font-size: 10px; font-weight: 400; text-transform: none;
    letter-spacing: normal; opacity: 0.6; white-space: nowrap;
  }
  .note-saved-hint {
    display: inline-block; margin-left: 6px; font-size: 11px; color: #86efac;
    opacity: 0; transition: opacity 0.3s ease;
  }
  .note-saved-hint.visible { opacity: 1; }
  .details-button {
    height: 26px; padding: 0 10px; border-radius: 13px;
    border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08);
    color: #eef0fb; font-size: 12px; cursor: pointer;
  }
  dialog {
    background: #1b1740; color: #eef0fb; border: 1px solid rgba(255,255,255,0.2);
    border-radius: 14px; padding: 20px 24px; width: 90vw; max-width: 560px;
  }
  dialog::backdrop { background: rgba(0,0,0,0.6); }
  dialog h2 { margin: 0 0 4px; font-size: 17px; padding-right: 28px; }
  dialog h3 { font-size: 13px; margin: 16px 0 4px; opacity: 0.8; }
  .dialog-close { position: absolute; top: 10px; right: 12px; margin: 0; }
  .dialog-close button { background: none; border: 0; color: #eef0fb; font-size: 20px; cursor: pointer; opacity: 0.6; }
  .dialog-close button:hover { opacity: 1; }
`;

// Browser code, served inline like the homepage's scripts. Kept free of
// backslashes and backticks: this is a template literal, and escapes inside
// it would be rewritten before the browser ever saw them.
const IP_SURVEY_SCRIPT = `
  (function () {
    var STAGE_LABELS = {
      discovery: 'finding devices',
      names: 'finding names',
      ports: 'checking ports',
      web: 'checking web pages'
    };
    var POLL_MS = 1500;
    var state = JSON.parse(document.getElementById('survey-status').textContent);
    var sortKey = 'ipNum';
    var sortDir = 1;
    var pollTimer = null;

    var scanButton = document.getElementById('scan-button');
    var saveButton = document.getElementById('save-button');
    var progress = document.getElementById('scan-progress');
    var statusLine = document.getElementById('survey-status-line');
    var message = document.getElementById('survey-message');
    var table = document.getElementById('survey-table');
    var tbody = document.getElementById('survey-rows');
    var dialog = document.getElementById('details-dialog');

    // Names, titles and services come from whatever answers on the LAN, so
    // they are untrusted: everything goes in through textContent.
    function el(tag, value, className) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (value !== undefined && value !== null) node.textContent = String(value);
      return node;
    }

    function safeHref(url) {
      if (typeof url !== 'string') return null;
      return url.indexOf('http://') === 0 || url.indexOf('https://') === 0 ? url : null;
    }

    function link(href, label) {
      var a = el('a', label);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    }

    function formatTime(iso) {
      if (!iso) return '';
      return new Date(iso).toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
    }

    function showMessage(text) {
      message.textContent = text;
    }

    // Note feedback has its own element and its own show function so the
    // 1.5s poll (which clears survey-message on every tick) cannot blank a
    // "Note saved." or failure notice before the user has had time to read
    // it -- saves are blur-triggered, so a scan in progress can fire this
    // poll up to 30 times while a failure message is still on screen.
    var noteMessage = document.getElementById('note-message');
    function showNoteMessage(text) {
      noteMessage.textContent = text;
    }

    function sortValue(row, key) {
      if (key === 'name') return (row.name || '').toLowerCase();
      if (key === 'vendor') return (row.privateMac ? 'private address' : (row.vendor || '')).toLowerCase();
      if (key === 'mac') return row.mac.toLowerCase();
      if (key === 'web') return row.web ? (row.web.title || row.web.url).toLowerCase() : '';
      if (key === 'note') return (row.note || '').toLowerCase();
      return row[key];
    }

    function compareRows(a, b) {
      // Devices that did not answer stay below the ones that did, whatever
      // column is sorted.
      var gone = (a.status === 'gone' ? 1 : 0) - (b.status === 'gone' ? 1 : 0);
      if (gone !== 0) return gone;
      var av = sortValue(a, sortKey);
      var bv = sortValue(b, sortKey);
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return a.ipNum - b.ipNum;
    }

    function openDetails(row) {
      document.getElementById('details-title').textContent = row.name || row.ip;
      document.getElementById('details-meta').textContent = row.ip + ' · ' + row.mac;
      var ports = document.getElementById('details-ports');
      ports.textContent = '';
      row.ports.forEach(function (p) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', p.port, 'mono'));
        tr.appendChild(el('td', p.service));
        var webCell = el('td');
        var href = p.web ? safeHref(p.web.url) : null;
        if (href) {
          webCell.appendChild(link(href, p.web.title || href));
        } else {
          webCell.textContent = '—';
        }
        tr.appendChild(webCell);
        ports.appendChild(tr);
      });
      document.getElementById('details-ports-table').hidden = row.ports.length === 0;
      document.getElementById('details-no-ports').hidden = row.ports.length > 0;
      document.getElementById('details-services').textContent = row.services.length ? row.services.join(', ') : '—';
      document.getElementById('details-rtt').textContent = row.rttMs === null ? '—' : row.rttMs + ' ms';
      dialog.showModal();
    }

    // A poll can land while the user is mid-edit on a note, or right after a
    // save fails: saving happens on blur, so a failed save leaves an input
    // that is no longer focused but still holds text that was never
    // persisted. Rebuilding the table from server state would silently drop
    // that text, so every note input whose value differs from the value it
    // was loaded with is captured here (not only the focused one) and
    // restored onto its replacement once the new rows exist. Focus and
    // cursor position are preserved only for the row actually being typed
    // in, since only one input can be focused at a time.
    //
    // This does not special-case IME composition (an input mid-composition
    // that loses focus here would restore its plain value, not the
    // in-progress composition state) -- a known limitation, not fixed here.
    function captureNoteState() {
      var dirty = {};
      var inputs = tbody.querySelectorAll('input.note-input');
      Array.prototype.forEach.call(inputs, function (input) {
        var loaded = input.getAttribute('data-loaded') || '';
        if (input.value !== loaded) {
          dirty[input.getAttribute('data-mac')] = input.value;
        }
      });
      var active = document.activeElement;
      var focused = null;
      if (active && active.tagName === 'INPUT' && active.className.indexOf('note-input') !== -1) {
        focused = {
          mac: active.getAttribute('data-mac'),
          selectionStart: active.selectionStart,
          selectionEnd: active.selectionEnd
        };
      }
      return { dirty: dirty, focused: focused };
    }

    function restoreNoteState(captured) {
      if (!captured) return;
      Object.keys(captured.dirty).forEach(function (mac) {
        var input = tbody.querySelector('input[data-mac="' + mac + '"]');
        if (input) input.value = captured.dirty[mac];
      });
      if (!captured.focused) return;
      var focusedInput = tbody.querySelector('input[data-mac="' + captured.focused.mac + '"]');
      if (!focusedInput) return;
      focusedInput.focus();
      try {
        focusedInput.setSelectionRange(captured.focused.selectionStart, captured.focused.selectionEnd);
      } catch (e) {
        // Some input states (e.g. mid-composition) reject setSelectionRange;
        // the value is already restored, so losing the cursor position is fine.
      }
    }

    function noteCell(row) {
      var td = el('td');
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'note-input';
      input.maxLength = 500;
      input.value = row.note || '';
      input.setAttribute('data-mac', row.mac);
      input.setAttribute('data-loaded', row.note || '');
      input.setAttribute('aria-label', 'Note for ' + (row.name || row.ip));
      input.addEventListener('blur', function () { saveNote(input, row.mac); });
      input.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          input.blur();
        }
      });
      td.appendChild(input);
      // Empty until a save succeeds for this row; kept as a live region so a
      // screen reader also hears the confirmation, not only sighted users.
      var hint = el('span', '', 'note-saved-hint');
      hint.setAttribute('data-mac', row.mac);
      hint.setAttribute('aria-live', 'polite');
      td.appendChild(hint);
      return td;
    }

    // Keyed by mac so a save on one row cannot cancel or clobber the fade
    // timer of another row's confirmation.
    var noteSavedTimers = {};

    // The confirmation must appear right in the row the user was just
    // editing -- #note-message sits far above the table and was easy to
    // miss, which is what made a successful save read as a silent failure.
    function flashNoteSaved(mac) {
      var hint = tbody.querySelector('span.note-saved-hint[data-mac="' + mac + '"]');
      if (!hint) return;
      hint.textContent = 'Saved';
      hint.className = 'note-saved-hint visible';
      if (noteSavedTimers[mac]) clearTimeout(noteSavedTimers[mac]);
      noteSavedTimers[mac] = setTimeout(function () {
        hint.className = 'note-saved-hint';
        hint.textContent = '';
      }, 2000);
    }

    function saveNote(input, mac) {
      var loaded = input.getAttribute('data-loaded');
      var text = input.value;
      if (text === loaded) return;
      // Clear any earlier failure so it cannot linger next to a fresh,
      // successful attempt.
      showNoteMessage('');
      request('POST', '/api/survey/notes', { mac: mac, text: text }).then(function (r) {
        if (r.status !== 200) {
          var reason = r.body && r.body.error ? r.body.error : ('HTTP ' + r.status);
          showNoteMessage('Note not saved (' + reason + '). Your text is still in the box.');
          return;
        }
        // apply() re-renders the whole table; renderRows() itself preserves
        // every note input whose text differs from what it was loaded with,
        // not only the one that currently has focus. The confirmation is
        // flashed after that rebuild so it lands on the row's fresh cell,
        // not one about to be discarded.
        apply(r.body);
        flashNoteSaved(mac);
      }).catch(function (err) {
        if (err.signedOut) return;
        showNoteMessage('Note not saved (' + err.message + '). Your text is still in the box.');
      });
    }

    function renderRows() {
      var captured = captureNoteState();
      tbody.textContent = '';
      var rows = state.view.rows.slice().sort(compareRows);
      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        if (row.status === 'gone') tr.className = 'gone';

        var statusCell = el('td');
        if (row.status === 'unchanged') {
          statusCell.appendChild(el('span', '—', 'status-none'));
        } else {
          statusCell.appendChild(el('span', row.status, 'badge badge-' + row.status));
        }
        tr.appendChild(statusCell);

        tr.appendChild(el('td', row.ip, 'mono'));

        var nameCell = el('td');
        var href = row.web ? safeHref(row.web.url) : null;
        if (href) {
          nameCell.appendChild(link(href, row.name || row.ip));
        } else {
          nameCell.appendChild(el('span', row.name || '—'));
        }
        if (row.nameSource) nameCell.appendChild(el('span', row.nameSource, 'source'));
        tr.appendChild(nameCell);

        tr.appendChild(el('td', row.privateMac ? 'Private address' : (row.vendor || '—')));
        tr.appendChild(el('td', row.mac, 'mono'));
        // The Web cell links rather than printing text. row.web is only
        // populated when an HTTP response actually arrived - scanner httpGet
        // resolves WebInfo inside the response callback and resolves null on
        // both timeout and error - so its presence already means "answers a
        // browser' and no extra check is needed here. Status is deliberately
        // not filtered: a 404 page is still a page, and its title ('LNKSS Page
        // Not Found') is the most useful label that device has.
        //
        // Both forms link, matching the ports detail view below. A title is
        // the friendlier label; a bare URL is what is shown when the device
        // served no title element.
        var webCell = el('td');
        var webHref = row.web ? safeHref(row.web.url) : null;
        if (webHref) {
          webCell.appendChild(link(webHref, row.web.title || row.web.url));
        } else {
          webCell.textContent = '—';
        }
        tr.appendChild(webCell);

        tr.appendChild(noteCell(row));

        var detailsCell = el('td');
        if (row.ports.length > 0 || row.services.length > 0) {
          var label = row.ports.length === 1 ? '1 port' : (row.ports.length > 1 ? row.ports.length + ' ports' : 'Details');
          var button = el('button', label, 'details-button');
          button.type = 'button';
          button.addEventListener('click', function () { openDetails(row); });
          detailsCell.appendChild(button);
        } else {
          detailsCell.textContent = '—';
        }
        tr.appendChild(detailsCell);

        tbody.appendChild(tr);
      });
      table.hidden = rows.length === 0;
      restoreNoteState(captured);
    }

    function renderToolbar() {
      var scan = state.scan;
      var view = state.view;
      var running = scan.state === 'running';
      scanButton.disabled = running;
      saveButton.disabled = running || !view.unsaved;
      if (running) {
        progress.textContent = 'Scanning ' + scan.stageIndex + ' of ' + scan.stageCount + ': ' + (STAGE_LABELS[scan.stage] || scan.stage) + '…';
      } else if (scan.state === 'unavailable') {
        progress.textContent = 'Scanner unavailable';
      } else if (scan.state === 'failed') {
        progress.textContent = 'Last scan failed: ' + scan.error;
      } else {
        progress.textContent = '';
      }
      if (view.source === 'none') {
        statusLine.textContent = 'No saved survey yet. Run a scan.';
      } else if (view.source === 'saved') {
        statusLine.textContent = 'Saved survey · ' + formatTime(view.savedAt) + ' · ' + view.counts.devices + ' devices';
      } else {
        var comparedTo = view.hasSaved
          ? 'compared with the saved survey'
          : 'no saved survey yet, so nothing to compare with — Save to set a baseline';
        statusLine.textContent = 'Unsaved scan · ' + formatTime(view.scannedAt) + ' · ' + comparedTo + ' · ' + view.counts.devices + ' devices · ' + view.counts.new + ' new · ' + view.counts.gone + ' gone';
      }
    }

    function apply(status) {
      state = status;
      renderToolbar();
      renderRows();
      if (state.scan.state === 'running') schedulePoll();
    }

    function request(method, url, jsonBody) {
      var init = { method: method, credentials: 'same-origin', headers: { accept: 'application/json' } };
      if (jsonBody !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(jsonBody);
      }
      return fetch(url, init)
        .then(function (response) {
          if (response.status === 401) {
            window.location.href = '/';
            // Tagged so callers can tell "the session ended, a redirect is
            // already under way" apart from a transport failure worth
            // reporting and retrying.
            var signedOut = new Error('signed out');
            signedOut.signedOut = true;
            throw signedOut;
          }
          return response.json().catch(function () { return {}; }).then(function (body) {
            return { status: response.status, body: body };
          });
        });
    }

    function schedulePoll() {
      if (pollTimer) return;
      pollTimer = setTimeout(function () {
        pollTimer = null;
        request('GET', '/api/survey').then(function (r) {
          if (r.status !== 200) throw new Error('HTTP ' + r.status);
          showMessage('');
          // apply() assigns state before it renders, so a render failure
          // here must not fall through to the catch below: that would read
          // fields off the now-corrupted state and double-fault, leaving the
          // page blank with no retry scheduled.
          try {
            apply(r.body);
          } catch (applyErr) {
            showMessage('Lost track of the scan (' + applyErr.message + '), retrying.');
            schedulePoll();
          }
        }).catch(function (err) {
          if (err.signedOut) return;
          showMessage('Lost track of the scan (' + err.message + '), retrying.');
          if (state.scan.state === 'running') schedulePoll();
        });
      }, POLL_MS);
    }

    scanButton.addEventListener('click', function () {
      showMessage('');
      scanButton.disabled = true;
      request('POST', '/api/survey/scan').then(function (r) {
        if (r.status === 202) { apply(r.body); return; }
        // Already running, e.g. started in another tab: follow that scan.
        if (r.status === 409) { apply(r.body.status); return; }
        if (r.status === 503) { apply(r.body.status); showMessage('Scanner unavailable.'); return; }
        throw new Error('HTTP ' + r.status);
      }).catch(function (err) {
        if (err.signedOut) return;
        showMessage('Could not start a scan: ' + err.message);
        renderToolbar();
      });
    });

    saveButton.addEventListener('click', function () {
      showMessage('');
      saveButton.disabled = true;
      request('POST', '/api/survey/save').then(function (r) {
        if (r.status === 200) { apply(r.body); return; }
        if (r.status === 409) { showMessage('Nothing to save: the scanner has no finished scan.'); renderToolbar(); return; }
        if (r.status === 503) { showMessage('Scanner unavailable, so its result could not be read. Nothing was saved.'); renderToolbar(); return; }
        throw new Error('HTTP ' + r.status);
      }).catch(function (err) {
        if (err.signedOut) return;
        showMessage('Save failed (' + err.message + '). The unsaved scan is still shown.');
        renderToolbar();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort-key] button'), function (button) {
      button.addEventListener('click', function () {
        var key = button.parentElement.getAttribute('data-sort-key');
        if (key === sortKey) {
          sortDir = -sortDir;
        } else {
          sortKey = key;
          sortDir = 1;
        }
        Array.prototype.forEach.call(document.querySelectorAll('th[data-sort-key]'), function (th) {
          var active = th.getAttribute('data-sort-key') === sortKey;
          th.setAttribute('aria-sort', active ? (sortDir === 1 ? 'ascending' : 'descending') : 'none');
        });
        renderRows();
      });
    });

    apply(state);
  })();
`;

const DETAILS_DIALOG = `
    <dialog id="details-dialog" aria-labelledby="details-title">
      <form method="dialog" class="dialog-close"><button type="submit" aria-label="Close">×</button></form>
      <h2 id="details-title"></h2>
      <p id="details-meta" class="mono"></p>
      <h3>Open ports</h3>
      <table id="details-ports-table">
        <thead><tr><th>Port</th><th>Likely use</th><th>Web</th></tr></thead>
        <tbody id="details-ports"></tbody>
      </table>
      <p id="details-no-ports" hidden>None of the common ports are open.</p>
      <h3>Services</h3>
      <p id="details-services"></p>
      <h3>Response time</h3>
      <p id="details-rtt"></p>
    </dialog>`;

export function renderIpSurveyPage(status: SurveyStatus): string {
  return renderDashboardShell({
    title: 'IP Survey',
    breadcrumb: [
      { label: 'Cards', href: '/' },
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'IP Survey' },
    ],
    extraCss: IP_SURVEY_CSS,
    script: IP_SURVEY_SCRIPT,
    body: `
      <h1>IP Survey</h1>
      <div class="toolbar">
        <button id="scan-button" type="button">Scan</button>
        <button id="save-button" type="button" disabled>Save scan</button>
        <span id="scan-progress" role="status" aria-live="polite"></span>
      </div>
      <p id="survey-status-line"></p>
      <p id="survey-message" role="alert"></p>
      <p id="note-message" role="status" aria-live="polite"></p>
      <div class="table-wrap">
        <table id="survey-table" hidden>
          <thead>
            <tr>
              <th data-sort-key="statusRank" aria-sort="none"><button type="button">Status</button></th>
              <th data-sort-key="ipNum" aria-sort="ascending"><button type="button">IP</button></th>
              <th data-sort-key="name" aria-sort="none"><button type="button">Name</button></th>
              <th data-sort-key="vendor" aria-sort="none"><button type="button">Manufacturer</button></th>
              <th data-sort-key="mac" aria-sort="none"><button type="button">MAC</button></th>
              <th data-sort-key="web" aria-sort="none"><button type="button">Web</button></th>
              <th data-sort-key="note" aria-sort="none">
                <button type="button" aria-describedby="notes-hint">Notes</button>
                <span id="notes-hint" class="col-hint" aria-hidden="true">saved automatically</span>
              </th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="survey-rows"></tbody>
        </table>
      </div>
      ${DETAILS_DIALOG}
      <script type="application/json" id="survey-status">${embedJson(status)}</script>`,
  });
}
