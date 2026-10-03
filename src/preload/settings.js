'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (values) => ipcRenderer.invoke('settings:save', values),
  reset: () => ipcRenderer.invoke('settings:reset'),
  onChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  close: () => ipcRenderer.invoke('settings:close')
});
