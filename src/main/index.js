const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const ZKLib = require('node-zklib');

// FA110 connection config — adjust IP/port as needed
const DEVICE_IP = '192.168.1.201';
const DEVICE_PORT = 4370;
const DEVICE_TIMEOUT = 5000;
const DEVICE_INPORT = 5200;

let mainWindow = null;
let zk = null;
let connected = false;

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

  try {
    await zk.createSocket();
    connected = true;
    sendStatus({ connected: true, ip: DEVICE_IP, port: DEVICE_PORT });

    // Start real-time log listener
    await zk.getRealTimeLogs((log) => {
      if (mainWindow) {
        mainWindow.webContents.send('zk:event', {
          timestamp: new Date().toISOString(),
          userId: log.userId,
          attTime: log.attTime,
          verifyMethod: log.verifyMethod,
          inOutStatus: log.inOutStatus,
          workCode: log.workCode,
        });
      }
    });
  } catch (err) {
    connected = false;
    sendStatus({ connected: false, error: err.message });
  }
}

async function disconnectDevice() {
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

// IPC: renderer requests manual reconnect
ipcMain.handle('zk:connect', async () => {
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

app.whenReady().then(async () => {
  createWindow();
  // Small delay to ensure window is ready before pushing first status
  setTimeout(() => connectDevice(), 500);
});

app.on('window-all-closed', () => {
  disconnectDevice();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
    setTimeout(() => connectDevice(), 500);
  }
});
