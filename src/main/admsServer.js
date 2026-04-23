const http = require('http');
const url = require('url');

const PORT = 8080;

let server = null;
let emitFn = null;

// ── ATTLOG parser ──────────────────────────────────────────
// Tab-separated: PIN \t DateTime \t Status \t Verify \t WorkCode \t ...
function parseAttlogLine(line) {
  const parts = line.split('\t');
  if (parts.length < 2) return null;
  const [pin, datetime, status, verify, workcode] = parts;
  return {
    pin: (pin || '').trim(),
    datetime: (datetime || '').trim(),
    status: status !== undefined ? Number(status) : null,
    verify: verify !== undefined ? Number(verify) : null,
    workcode: workcode !== undefined ? Number(workcode) : 0,
  };
}

// Device config returned on the initial GET /iclock/cdata handshake.
// Realtime=1 tells the FA110 to push events immediately rather than batch.
function buildDeviceConfig(sn) {
  return [
    `GET OPTION FROM: ${sn || 'unknown'}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=None',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP UserPic',
    'TimeZone=8',
    'Realtime=1',
    'Encrypt=None',
  ].join('\n');
}

function handleCdata(req, res, query, body) {
  const table = query.table || '';

  // Initial handshake: device GETs config
  if (req.method === 'GET') {
    console.log(`[ADMS] handshake SN=${query.SN} options=${query.options || ''}`);
    const cfg = buildDeviceConfig(query.SN);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(cfg);
    return;
  }

  // Data upload from device
  if (table === 'ATTLOG') {
    const lines = body.split(/\r?\n/).filter(Boolean);
    console.log(`[ADMS] ATTLOG ${lines.length} record(s) from SN=${query.SN}`);
    for (const line of lines) {
      const rec = parseAttlogLine(line);
      console.log('[ADMS ATTLOG]', rec || line);
      if (rec && emitFn) emitFn(rec);
    }
  } else if (table) {
    console.log(`[ADMS] ${table} ${body.length}B from SN=${query.SN}`);
    console.log('[ADMS BODY]', body.substring(0, 400));
  } else {
    console.log(`[ADMS] POST cdata (no table) ${body.length}B`);
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`OK: ${body.split(/\r?\n/).filter(Boolean).length}`);
}

function handleGetrequest(req, res, query) {
  // Polled every few seconds by the device. Reply "OK" when we have no commands.
  console.log(`[ADMS] heartbeat SN=${query.SN}`);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
}

function start(onEvent) {
  if (server) return;
  emitFn = onEvent;

  server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname || '';

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      console.log(`[ADMS] ${req.method} ${req.url} (body ${body.length}B)`);

      if (pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`ADMS server alive at ${new Date().toISOString()} (from ${req.socket.remoteAddress})`);
      } else if (pathname.startsWith('/iclock/cdata')) {
        handleCdata(req, res, parsed.query, body);
      } else if (pathname.startsWith('/iclock/getrequest')) {
        handleGetrequest(req, res, parsed.query);
      } else if (pathname.startsWith('/iclock/devicecmd')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } else {
        console.log(`[ADMS] 404 ${pathname}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  });

  server.on('error', (err) => console.log('[ADMS ERR]', err.message));
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ADMS] listening on 0.0.0.0:${PORT}`);
  });
}

function stop() {
  if (server) { server.close(); server = null; }
}

module.exports = { start, stop, PORT };
