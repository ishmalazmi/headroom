const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('headroom', {
  getState: () => ipcRenderer.invoke('state'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  refresh: () => ipcRenderer.invoke('refresh'),
  setSettings: (patch) => ipcRenderer.invoke('settings', patch),
  completeOnboarding: (choice) => ipcRenderer.invoke('onboard', choice),
  resize: (height) => ipcRenderer.send('resize', height),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
});
