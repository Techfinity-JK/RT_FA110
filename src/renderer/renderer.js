const tbody       = document.getElementById('event-tbody');
const emptyState  = document.getElementById('empty-state');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const deviceIp    = document.getElementById('device-ip');
const eventCount  = document.getElementById('event-count');
const infoPanel   = document.getElementById('info-panel');
const chkPause    = document.getElementById('chk-pause');
const inputIp      = document.getElementById('input-ip');
const inputCommKey = document.getElementById('input-commkey');
const inputMode    = document.getElementById('input-mode');

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function getIp() {
  const val = inputIp.value.trim();
  const valid = IP_RE.test(val);
  inputIp.classList.toggle('invalid', val.length > 0 && !valid);
  return valid ? val : null;
}

function getCommKey() {
  const val = inputCommKey.value.trim();
  if (val === '') return null;           // empty = don't override
  const n = Number(val);
  const valid = Number.isInteger(n) && n >= 0;
  inputCommKey.classList.toggle('invalid', !valid);
  return valid ? n : null;
}

// ADMS verify codes (ZKTeco push protocol)
const VERIFY_LABELS = {
  0:  ['Password',     'verify-pin'],
  1:  ['Fingerprint',  'verify-fp'],
  2:  ['User',         'verify-pin'],
  3:  ['Password+FP',  'verify-fp'],
  4:  ['Card',         'verify-card'],
  11: ['Face',         'verify-face'],
  15: ['Face+FP',      'verify-face'],
  25: ['Password+Card','verify-card'],
};

const INOUT_LABELS = {
  0: ['Check In',    'badge-in'],
  1: ['Check Out',   'badge-out'],
  4: ['OT In',       'badge-in'],
  5: ['OT Out',      'badge-out'],
};

let totalEvents = 0;
const MAX_ROWS = 500;

function verifyLabel(code) {
  const [label, cls] = VERIFY_LABELS[code] ?? [`#${code}`, 'verify-pin'];
  return `<span class="${cls}">${label}</span>`;
}

function inOutBadge(code) {
  const [label, cls] = INOUT_LABELS[code] ?? [`Code ${code}`, 'badge-def'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function formatTs(iso) {
  return new Date(iso).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addRow(ev) {
  if (chkPause.checked) return;

  totalEvents++;
  eventCount.textContent = totalEvents;

  // Remove empty state
  if (emptyState.style.display !== 'none') emptyState.style.display = 'none';

  const tr = document.createElement('tr');
  tr.className = 'new-row';
  tr.innerHTML = `
    <td>${totalEvents}</td>
    <td>${formatTs(ev.timestamp)}</td>
    <td>${ev.userId ?? '—'}</td>
    <td>${ev.attTime ?? '—'}</td>
    <td>${verifyLabel(ev.verifyMethod)}</td>
    <td>${inOutBadge(ev.inOutStatus)}</td>
    <td>${ev.workCode ?? '—'}</td>
  `;

  tbody.insertBefore(tr, tbody.firstChild);

  // Trim old rows to prevent DOM bloat
  while (tbody.rows.length > MAX_ROWS) {
    tbody.deleteRow(tbody.rows.length - 1);
  }
}

function setStatus({ connected, ip, port, error, connecting }) {
  if (connecting) {
    statusDot.className = 'dot connecting';
    statusText.textContent = 'Connecting…';
    deviceIp.textContent = '';
    return;
  }
  if (connected) {
    statusDot.className = 'dot connected';
    statusText.textContent = 'Connected';
    deviceIp.textContent = ip ? `${ip}:${port}` : '';
    // Sync the field with whatever IP is live
    if (ip && inputIp.value.trim() === '') inputIp.value = ip;
  } else {
    statusDot.className = 'dot disconnected';
    statusText.textContent = error ? `Error: ${error}` : 'Disconnected';
    deviceIp.textContent = '';
  }
}

// ── IPC listeners ──────────────────────────────────────────
window.zkAPI.onStatus(setStatus);
window.zkAPI.onEvent(addRow);

// ── Toolbar buttons ────────────────────────────────────────
document.getElementById('btn-connect').addEventListener('click', async () => {
  const ip = getIp();
  if (!ip) { inputIp.focus(); return; }
  const commKey = getCommKey();
  const mode = inputMode.value;
  setStatus({ connecting: true });
  const result = await window.zkAPI.connect(ip, commKey, mode);
  setStatus(result);
});

// Connect on Enter inside either field
[inputIp, inputCommKey].forEach(el => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-connect').click();
  });
});

document.getElementById('btn-disconnect').addEventListener('click', async () => {
  await window.zkAPI.disconnect();
  setStatus({ connected: false });
});

document.getElementById('btn-info').addEventListener('click', async () => {
  const info = await window.zkAPI.getInfo();
  infoPanel.classList.remove('hidden');
  infoPanel.textContent = JSON.stringify(info, null, 2);
});

document.getElementById('btn-fetch').addEventListener('click', async () => {
  const result = await window.zkAPI.fetchLog();
  infoPanel.classList.remove('hidden');
  infoPanel.textContent = 'Fetch Log → ' + JSON.stringify(result, null, 2);
});

document.getElementById('btn-clear').addEventListener('click', () => {
  tbody.innerHTML = '';
  totalEvents = 0;
  eventCount.textContent = 0;
  emptyState.style.display = '';
  infoPanel.classList.add('hidden');
});
