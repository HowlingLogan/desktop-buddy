'use strict';

const path = require('node:path');
const { BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const { normalizeSettings, defaultSettings, saveSettings } = require('./settings');

const sizes = [160, 200, 240, 280, 320];

function createControls({ app, petWindow, settings, onSettingsApplied, onResetPosition, onStartPlay,
  onPauseChanged = () => {}, playAvailable, confirmReset = dialog.showMessageBox }) {
  let paused = false;
  let settingsWindow = null;
  let menu = null;
  let menuOpenCount = 0;

  const loginOptions = () => app.isPackaged
    ? { path: process.execPath, args: [] }
    : { path: process.execPath, args: [`"${app.getAppPath()}"`] };
  const startsWithWindows = () => settings.startWithWindows
    && app.getLoginItemSettings(loginOptions()).openAtLogin;
  const state = () => ({ paused, muted: settings.muted, petSize: settings.petSize, startsWithWindows: startsWithWindows(), menuOpenCount });

  function reportError(title, error) {
    console.error(title, error);
    dialog.showErrorBox(title, error.message || String(error));
  }

  function applySettings(patch) {
    const normalized = normalizeSettings({
      ...settings,
      ...patch,
      activity: { ...settings.activity, ...patch.activity },
      animation: { ...settings.animation, ...patch.animation },
      play: { ...settings.play, ...patch.play }
    });
    const saved = saveSettings(normalized);
    onSettingsApplied(saved);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('settings:changed', { ...saved, startsWithWindows: startsWithWindows() });
    }
    return saved;
  }

  function setPaused(next) {
    paused = Boolean(next);
    onPauseChanged(paused);
    if (!petWindow.isDestroyed()) petWindow.webContents.send('pet:paused-changed', paused);
    return paused;
  }

  function setMuted(next) {
    applySettings({ muted: Boolean(next) });
    return settings.muted;
  }

  function setPetSize(size) {
    applySettings({ petSize: size });
    return settings.petSize;
  }

  function setStartWithWindows(enabled) {
    const options = loginOptions();
    app.setLoginItemSettings({ ...options, openAtLogin: Boolean(enabled) });
    if (app.getLoginItemSettings(options).openAtLogin !== Boolean(enabled)) {
      throw new Error('Windows did not apply the startup preference.');
    }
    applySettings({ startWithWindows: Boolean(enabled) });
    return startsWithWindows();
  }

  async function resetToDefaults() {
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : petWindow;
    const answer = await confirmReset(parent, {
      type: 'warning',
      title: 'Reset Desktop Buddy Settings',
      message: 'Reset all Desktop Buddy settings to their default values?',
      buttons: ['Reset', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (answer.response !== 0) return { reset: false };

    const options = loginOptions();
    const previouslyRegistered = app.getLoginItemSettings(options).openAtLogin;
    if (previouslyRegistered || settings.startWithWindows) {
      app.setLoginItemSettings({ ...options, openAtLogin: false });
      if (app.getLoginItemSettings(options).openAtLogin) {
        throw new Error('Windows did not remove Desktop Buddy from startup. Settings were not reset.');
      }
    }
    let saved;
    try {
      saved = saveSettings(defaultSettings());
    } catch (error) {
      if (previouslyRegistered) app.setLoginItemSettings({ ...options, openAtLogin: true });
      throw error;
    }
    onSettingsApplied(saved);
    onResetPosition();
    const updated = { ...saved, startsWithWindows: false };
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('settings:changed', updated);
    }
    return { reset: true, settings: updated };
  }

  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
      settingsWindow.focus();
      return settingsWindow;
    }
    settingsWindow = new BrowserWindow({
      title: 'Desktop Buddy Settings',
      width: 460,
      height: 540,
      minWidth: 460,
      minHeight: 540,
      resizable: false,
      autoHideMenuBar: true,
      show: false,
      backgroundColor: '#fffaf3',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'settings.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    const current = settingsWindow;
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    current.webContents.on('will-navigate', (event) => event.preventDefault());
    current.once('ready-to-show', () => current.show());
    current.once('closed', () => { if (settingsWindow === current) settingsWindow = null; });
    current.loadFile(path.join(__dirname, '..', 'settings', 'index.html'));
    return current;
  }

  const fromSettingsWindow = (event) => settingsWindow && !settingsWindow.isDestroyed()
    && event.sender === settingsWindow.webContents;
  ipcMain.handle('settings:get', (event) => {
    if (!fromSettingsWindow(event)) throw new Error('Invalid settings window.');
    return { ...settings, startsWithWindows: startsWithWindows() };
  });
  ipcMain.handle('settings:save', (event, patch) => {
    if (!fromSettingsWindow(event)) throw new Error('Invalid settings window.');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings values.');
    const saved = applySettings({
      petSize: patch.petSize,
      activity: patch.activity,
      animation: patch.animation
    });
    return saved;
  });
  ipcMain.handle('settings:reset', (event) => {
    if (!fromSettingsWindow(event)) throw new Error('Invalid settings window.');
    return resetToDefaults();
  });
  ipcMain.handle('settings:close', (event) => {
    if (!fromSettingsWindow(event)) throw new Error('Invalid settings window.');
    settingsWindow.close();
  });

  function showContextMenu() {
    if (petWindow.isDestroyed()) return;
    const run = (title, action) => () => {
      try { action(); } catch (error) { reportError(title, error); }
    };
    menu = Menu.buildFromTemplate([
      { id: 'play', label: 'Play with yarn ball', enabled: playAvailable,
        click: run('Could not start yarn play', onStartPlay) },
      { type: 'separator' },
      { id: 'pause', label: paused ? 'Resume' : 'Pause', click: run('Pause / Resume failed', () => setPaused(!paused)) },
      { id: 'mute', label: settings.muted ? 'Unmute' : 'Mute', click: run('Mute / Unmute failed', () => setMuted(!settings.muted)) },
      { id: 'reset', label: 'Reset position', click: run('Reset position failed', onResetPosition) },
      {
        id: 'size', label: 'Pet size', submenu: sizes.map((size) => ({
          id: `size-${size}`,
          label: `${size} px`,
          type: 'radio',
          checked: settings.petSize === size,
          click: run('Pet size change failed', () => setPetSize(size))
        }))
      },
      { id: 'settings', label: 'Settings…', click: run('Could not open settings', openSettings) },
      { type: 'separator' },
      {
        id: 'startup', label: 'Start with Windows', type: 'checkbox',
        checked: startsWithWindows(),
        click: run('Startup preference failed', () => setStartWithWindows(!startsWithWindows()))
      },
      { type: 'separator' },
      { id: 'quit', label: 'Quit', click: () => app.quit() }
    ]);
    menuOpenCount += 1;
    menu.popup({ window: petWindow });
  }

  function dispose() {
    if (menu && !petWindow.isDestroyed()) menu.closePopup(petWindow);
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    ipcMain.removeHandler('settings:get');
    ipcMain.removeHandler('settings:save');
    ipcMain.removeHandler('settings:reset');
    ipcMain.removeHandler('settings:close');
  }

  return {
    state, showContextMenu, getMenu: () => menu,
    closeMenu: () => { if (menu && !petWindow.isDestroyed()) menu.closePopup(petWindow); },
    setPaused, setMuted, setPetSize, setStartWithWindows, resetToDefaults, openSettings, applySettings, dispose
  };
}

module.exports = { createControls };
