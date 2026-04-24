const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zkAPI', {
  // Commands → main
  connect: (ip, commKey, mode) => ipcRenderer.invoke('zk:connect', ip, commKey, mode),
  disconnect: () => ipcRenderer.invoke('zk:disconnect'),
  getInfo: () => ipcRenderer.invoke('zk:getInfo'),
  fetchLog: () => ipcRenderer.invoke('zk:fetchLog'),

  // Events ← main
  onStatus: (cb) => ipcRenderer.on('zk:status', (_e, data) => cb(data)),
  onEvent: (cb) => ipcRenderer.on('zk:event', (_e, data) => cb(data)),

  // Cleanup helpers
  offStatus: () => ipcRenderer.removeAllListeners('zk:status'),
  offEvent: () => ipcRenderer.removeAllListeners('zk:event'),
});
