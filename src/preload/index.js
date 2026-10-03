'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBuddy', {
  getInitialPet: () => ipcRenderer.invoke('pet:get-initial'),
  setHorizontalPosition: (x) => ipcRenderer.send('pet:set-horizontal-position', x),
  beginDrag: (x, y) => ipcRenderer.send('pet:begin-drag', { x, y }),
  moveDrag: () => ipcRenderer.send('pet:drag-move'),
  endDrag: () => ipcRenderer.invoke('pet:end-drag'),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  ballLocalFrame: (frame) => ipcRenderer.send('pet:ball-local-frame', frame),
  ballHandoffReady: () => ipcRenderer.invoke('pet:ball-handoff-ready'),
  ballReattach: () => ipcRenderer.invoke('pet:ball-reattach'),
  moveExternalBall: (position) => ipcRenderer.send('pet:ball-move-external', position),
  hideBallWindow: () => ipcRenderer.send('pet:hide-ball-window'),
  stopBallPhysics: () => ipcRenderer.send('pet:stop-ball-physics'),
  setChasePosition: (x, y) => ipcRenderer.send('pet:set-chase-position', { x, y }),
  getBallState: () => ipcRenderer.invoke('pet:get-ball-state'),
  getDesktop: () => ipcRenderer.invoke('pet:get-desktop'),
  onBallGrabbed: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('pet:ball-grabbed', listener);
    return () => ipcRenderer.removeListener('pet:ball-grabbed', listener);
  },
  onBallReleased: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('pet:ball-released', listener);
    return () => ipcRenderer.removeListener('pet:ball-released', listener);
  },
  onBallMotion: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('pet:ball-motion', listener);
    return () => ipcRenderer.removeListener('pet:ball-motion', listener);
  },
  onStartYarnPlay: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('pet:start-yarn-play', listener);
    return () => ipcRenderer.removeListener('pet:start-yarn-play', listener);
  },
  onPausedChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, paused) => callback(paused);
    ipcRenderer.on('pet:paused-changed', listener);
    return () => ipcRenderer.removeListener('pet:paused-changed', listener);
  },
  onSettingsUpdated: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('pet:settings-updated', listener);
    return () => ipcRenderer.removeListener('pet:settings-updated', listener);
  },
  onResetPosition: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('pet:reset-position', listener);
    return () => ipcRenderer.removeListener('pet:reset-position', listener);
  },
  onSystemIdle: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, sample) => callback(sample);
    ipcRenderer.on('pet:system-idle', listener);
    return () => ipcRenderer.removeListener('pet:system-idle', listener);
  },
  onWorkAreaChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, area) => callback(area);
    ipcRenderer.on('pet:work-area-changed', listener);
    return () => ipcRenderer.removeListener('pet:work-area-changed', listener);
  }
});
