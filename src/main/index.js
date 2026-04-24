const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('./zkauth'); // patch ZKLibTCP.prototype.connect before first use
const ZKLib = require('node-zklib');
const adms = require('./admsServer');

// node-zklib has unhandled rejections in error paths — swallow them so the
// app stays alive while we iterate on the protocol
process.on('unhandledRejection', (reason) => {
  console.log('[UNHANDLED]', reason && reason.message ? reason.message : reason);
});

// FA110 connection config — IP and comm key can be overridden at runtime via IPC
let DEVICE_IP = '192.168.1.193';
let DEVICE_COMM_KEY = 272727;
let DEVICE_MODE = 'adms'; // 'adms' | 'binary' — how we receive real-time events
const DEVICE_PORT = 4370;
const DEVICE_TIMEOUT = 5000;
const DEVICE_INPORT = 5200;

let mainWindow = null;
let zk = null;
let connected = false;
let pollTimer = null;
let pollBusy = false;
let appStartTime = Date.now();
let seenKeys = new Set(); // track already-shown records: "userId|timestamp"

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'RT FA110 — ZKTeco Live Events',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    disconnectDevice();
  });
}

async function connectDevice() {
  zk = new ZKLib(DEVICE_IP, DEVICE_PORT, DEVICE_TIMEOUT, DEVICE_INPORT);

  // Set comm key on the TCP layer before the socket handshake
  if (DEVICE_COMM_KEY) zk.zklibTcp.commKey = DEVICE_COMM_KEY;

  try {
    await zk.createSocket();
    connected = true;
    seenKeys.clear();
    sendStatus({ connected: true, ip: DEVICE_IP, port: DEVICE_PORT });

    // Detect unexpected disconnect from the device side
    const sock = zk.zklibTcp.socket;
    if (sock) {
      sock.once('close', () => {
        console.log('[SOCKET] closed by device');
        connected = false;
        stopPolling();
        sendStatus({ connected: false, error: 'Device closed the socket' });
      });
      sock.on('error', (err) => {
        console.log('[SOCKET ERR]', err.message);
      });
    }

    // Binary real-time events (CMD_REG_EVENT). Used for devices without ADMS
    // (e.g. older F22). FA110 firmware accepts the registration but never emits
    // event packets — ADMS push is the working path there.
    if (DEVICE_MODE === 'binary') {
      try {
        await zk.getRealTimeLogs((record) => {
          console.log('[RT] record', record);
          const event = {
            timestamp: new Date().toISOString(),
            userId: record.deviceUserId ?? record.userId ?? record.pin,
            attTime: record.recordTime instanceof Date
              ? record.recordTime.toISOString()
              : String(record.recordTime ?? record.attTime ?? ''),
            verifyMethod: null,
            inOutStatus: null,
            workCode: null,
          };
          if (mainWindow) mainWindow.webContents.send('zk:event', event);
        });
        console.log('[RT] registered for real-time events');
      } catch (err) {
        console.log('[RT ERR]', err && err.message);
      }
    }
  } catch (err) {
    console.log('[CONNECT ERR]', err.message);
    connected = false;
    sendStatus({ connected: false, error: err.message });
  }
}

const POLL_INTERVAL = 3000; // ms

async function pollOnce() {
  if (pollBusy) { console.log('[POLL] skip — already running'); return; }
  if (!zk || !connected) { console.log('[POLL] skip — not connected'); return; }

  pollBusy = true;
  const t0 = Date.now();
  try {
    console.log('[POLL] requesting attendance log…');
    const result = await zk.getAttendances();
    const data = (result && result.data) || [];
    console.log(`[POLL] got ${data.length} records in ${Date.now() - t0}ms`);

    if (data.length > 0) {
      console.log('[POLL] first record:', data[0]);
      console.log('[POLL] last record:', data[data.length - 1]);
    }

    let newCount = 0;
    for (const record of data) {
      const key = `${record.deviceUserId}|${record.recordTime}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      newCount++;

      const event = {
        timestamp: new Date().toISOString(),
        userId: record.deviceUserId,
        attTime: record.recordTime instanceof Date
          ? record.recordTime.toISOString()
          : String(record.recordTime),
        verifyMethod: null,
        inOutStatus: null,
        workCode: null,
      };
      if (mainWindow) mainWindow.webContents.send('zk:event', event);
    }
    console.log(`[POLL] emitted ${newCount} new events`);
  } catch (err) {
    console.log('[POLL ERR]', err && err.message, err && err.stack);
  } finally {
    pollBusy = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function disconnectDevice() {
  stopPolling();
  if (zk && connected) {
    try {
      await zk.disconnect();
    } catch (_) {
      // ignore disconnect errors on shutdown
    }
    connected = false;
    zk = null;
  }
}

function sendStatus(status) {
  if (mainWindow) {
    mainWindow.webContents.send('zk:status', status);
  }
}

// IPC: renderer requests manual reconnect (optionally with new IP / comm key / mode)
ipcMain.handle('zk:connect', async (_e, ip, commKey, mode) => {
  if (ip && typeof ip === 'string') DEVICE_IP = ip.trim();
  if (commKey !== undefined && commKey !== null) DEVICE_COMM_KEY = Number(commKey);
  if (mode === 'binary' || mode === 'adms') DEVICE_MODE = mode;
  await disconnectDevice();
  await connectDevice();
  return { connected };
});

// IPC: renderer requests disconnect
ipcMain.handle('zk:disconnect', async () => {
  await disconnectDevice();
  sendStatus({ connected: false });
  return { connected };
});

// IPC: renderer requests device info
ipcMain.handle('zk:getInfo', async () => {
  if (!zk || !connected) return { error: 'Not connected' };
  try {
    const info = await zk.getInfo();
    return info;
  } catch (err) {
    return { error: err.message };
  }
});

// IPC: renderer requests a manual attendance log fetch
ipcMain.handle('zk:fetchLog', async () => {
  if (!zk || !connected) return { error: 'Not connected', records: 0 };
  try {
    const result = await zk.getAttendances();
    const data = (result && result.data) || [];
    let newCount = 0;
    for (const record of data) {
      const key = `${record.deviceUserId}|${record.recordTime}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      newCount++;
      const event = {
        timestamp: new Date().toISOString(),
        userId: record.deviceUserId,
        attTime: record.recordTime instanceof Date
          ? record.recordTime.toISOString()
          : String(record.recordTime),
        verifyMethod: null, inOutStatus: null, workCode: null,
      };
      if (mainWindow) mainWindow.webContents.send('zk:event', event);
    }
    return { records: data.length, new: newCount };
  } catch (err) {
    return { error: err.message };
  }
});

app.whenReady().then(async () => {
  createWindow();

  // Start the ADMS HTTP server — FA110 POSTs attendance records here in real time
  adms.start((rec) => {
    const event = {
      timestamp: new Date().toISOString(),
      userId: rec.pin,
      attTime: rec.datetime,
      verifyMethod: rec.verify,
      inOutStatus: rec.status,
      workCode: rec.workcode,
    };
    console.log('[EVENT → renderer]', event);
    if (mainWindow) mainWindow.webContents.send('zk:event', event);
  });

  // Small delay to ensure window is ready before pushing first status
  setTimeout(() => connectDevice(), 500);
});

app.on('window-all-closed', () => {
  disconnectDevice();
  adms.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
    setTimeout(() => connectDevice(), 500);
  }
});
