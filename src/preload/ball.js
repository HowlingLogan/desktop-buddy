'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBall', {
  getImage: () => ipcRenderer.invoke('ball:get-image'),
  grab: (x, y) => ipcRenderer.send('ball:grab', { x, y }),
  move: (x, y) => ipcRenderer.send('ball:move', { x, y }),
  release: () => ipcRenderer.send('ball:release'),
  physicsFrame: (frame) => ipcRenderer.send('ball:physics-frame', frame),
  onPhysicsStart: (callback) => {
    const listener = (_event, options) => callback(options);
    ipcRenderer.on('ball:start-physics', listener);
  },
  onPhysicsStop: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ball:stop-physics', listener);
  },
  onPausedChanged: (callback) => {
    const listener = (_event, paused) => callback(paused);
    ipcRenderer.on('ball:paused-changed', listener);
  },
  onCancel: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ball:cancel-drag', listener);
  }
});
