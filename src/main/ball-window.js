'use strict';

const path = require('node:path');
const { BrowserWindow, ipcMain, screen } = require('electron');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

class BallWindowManager {
  #petWindow;
  #assetUrl;
  #onGrab;
  #onRelease;
  #onMotion;
  #config;
  #window = null;
  #external = false;
  #dragging = false;
  #paused = false;
  #anchor = { x: 0, y: 0 };
  #listeners;
  #ready = null;
  #samples = [];
  #physicsActive = false;
  #velocity = { x: 0, y: 0 };
  #workArea = null;
  #visualSize = null;
  #bounceXCount = 0;
  #bounceYCount = 0;

  constructor({ petWindow, assetUrl, config, onGrab, onRelease, onMotion }) {
    this.#petWindow = petWindow;
    this.#assetUrl = assetUrl;
    this.#onGrab = onGrab;
    this.#onRelease = onRelease;
    this.#onMotion = onMotion;
    this.#config = config;
    this.#listeners = {
      grab: (event, anchor) => this.#grab(event, anchor),
      move: (event, point) => this.#move(event, point),
      release: (event) => this.#release(event),
      physicsFrame: (event, frame) => this.#physicsFrame(event, frame)
    };
    ipcMain.handle('ball:get-image', (event) => {
      if (!this.#validSender(event)) throw new Error('Invalid yarn-ball window.');
      return this.#assetUrl;
    });
    ipcMain.on('ball:grab', this.#listeners.grab);
    ipcMain.on('ball:move', this.#listeners.move);
    ipcMain.on('ball:release', this.#listeners.release);
    ipcMain.on('ball:physics-frame', this.#listeners.physicsFrame);
  }

  get snapshot() {
    return {
      exists: Boolean(this.#window && !this.#window.isDestroyed()),
      external: this.#external,
      dragging: this.#dragging,
      paused: this.#paused,
      moving: this.#physicsActive,
      velocityX: this.#velocity.x,
      velocityY: this.#velocity.y,
      bounceXCount: this.#bounceXCount,
      bounceYCount: this.#bounceYCount,
      bounds: this.#window && !this.#window.isDestroyed() ? this.#window.getBounds() : null,
      visualSize: this.#visualSize
    };
  }

  get window() { return this.#window; }

  updateConfig(config) { this.#config = config; }

  #validSender(event) {
    return this.#window && !this.#window.isDestroyed() && event.sender === this.#window.webContents;
  }

  #ensureWindow(bounds) {
    if (this.#window && !this.#window.isDestroyed()) return;
    this.#window = new BrowserWindow({
      ...bounds,
      title: 'Desktop Buddy Yarn Ball',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'ball.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    const created = this.#window;
    created.removeMenu();
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', (event) => event.preventDefault());
    this.#ready = new Promise((resolve, reject) => {
      created.webContents.once('did-finish-load', resolve);
      created.webContents.once('did-fail-load', (_event, code, description) => reject(new Error(`Yarn ball window: ${code} ${description}`)));
    });
    created.webContents.once('did-finish-load', () => {
      if (!created.isDestroyed()) {
        created.showInactive();
        created.moveTop();
      }
    });
    created.once('closed', () => {
      if (this.#window === created) this.#window = null;
      this.#dragging = false;
      this.#external = false;
    });
    created.loadFile(path.join(__dirname, '..', 'renderer', 'ball-window.html'));
  }

  updateLocalFrame(frame) {
    if (this.#external || !this.#petWindow || this.#petWindow.isDestroyed()) return;
    if (!frame || ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)
      || frame.width < 8 || frame.height < 8) return;
    const pet = this.#petWindow.getBounds();
    this.#visualSize = { width: frame.width, height: frame.height };
    const width = Math.round(frame.width);
    const height = Math.round(frame.height);
    const bounds = { x: Math.round(pet.x + frame.x),
      y: Math.round(pet.y + frame.y - (height - frame.height)), width, height };
    this.#ensureWindow(bounds);
    const previous = this.#window.getBounds();
    if (Object.keys(bounds).some((key) => bounds[key] !== previous[key])) this.#window.setBounds(bounds);
  }

  async showExternal() {
    const current = this.#window;
    if (!current || current.isDestroyed()) return false;
    const stillCurrent = () => this.#window === current && !current.isDestroyed();
    try {
      await this.#ready;
      if (!stillCurrent()) return false;
      await current.webContents.executeJavaScript('window.__ballReady');
      if (!stillCurrent()) return false;
      const size = this.#visualSize;
      if (size) await current.webContents.executeJavaScript(
        `document.getElementById('ball').style.width = '${size.width}px';
         document.getElementById('ball').style.height = '${size.height}px'; true`);
      if (!stillCurrent()) return false;
      await current.webContents.executeJavaScript("document.body.classList.add('external'); true");
      if (!stillCurrent()) return false;
      current.moveTop();
      return true;
    } catch (error) {
      if (!stillCurrent()) return false;
      throw error;
    }
  }

  async hideExternal() {
    if (!this.#window || this.#window.isDestroyed()) return false;
    if (this.#dragging) return false;
    this.stopPhysics();
    await this.#ready;
    if (!this.#window || this.#window.isDestroyed()) return false;
    if (this.#dragging) return false;
    await this.#window.webContents.executeJavaScript("document.body.classList.remove('external'); true");
    this.#external = false;
    this.#dragging = false;
    return true;
  }

  moveExternal(bounds) {
    if (!this.#external || this.#dragging || !this.#window || this.#window.isDestroyed()) return;
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return;
    const previous = this.#window.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const work = display.workArea;
    const x = Math.round(clamp(bounds.x, work.x, work.x + work.width - previous.width));
    const y = Math.round(clamp(bounds.y, work.y, work.y + work.height - previous.height));
    if (x !== previous.x || y !== previous.y) {
      this.#window.setBounds({ ...previous, x, y });
      this.#onMotion({ ballBounds: this.#window.getBounds(), workArea: work,
        velocityX: 0, velocityY: 0, moving: false });
    }
  }

  setPaused(paused) {
    this.#paused = Boolean(paused);
    if (!this.#window || this.#window.isDestroyed()) return;
    if (this.#paused && this.#dragging) {
      this.#window.webContents.send('ball:cancel-drag');
      this.#release({ sender: this.#window.webContents });
    }
    this.#window.webContents.send('ball:paused-changed', {
      paused: this.#paused, bounds: this.#window.getBounds()
    });
    this.#window.setIgnoreMouseEvents(this.#paused);
  }

  stopPhysics() {
    this.#physicsActive = false;
    this.#velocity = { x: 0, y: 0 };
    if (this.#window && !this.#window.isDestroyed()) {
      this.#window.webContents.send('ball:stop-physics');
    }
  }

  #grab(event, anchor) {
    if (!this.#validSender(event) || this.#paused || this.#dragging) return;
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
    const bounds = this.#window.getBounds();
    this.stopPhysics();
    this.#anchor = { x: clamp(anchor.x, 0, bounds.width), y: clamp(anchor.y, 0, bounds.height) };
    this.#samples = [{ x: bounds.x + this.#anchor.x, y: bounds.y + this.#anchor.y,
      time: performance.now() }];
    this.#external = true;
    this.#dragging = true;
    this.#onGrab(bounds);
  }

  #move(event, point) {
    if (!this.#validSender(event) || !this.#dragging || this.#paused) return;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const bounds = this.#window.getBounds();
    const display = screen.getDisplayNearestPoint(point);
    const work = display.workArea;
    const x = Math.round(clamp(point.x - this.#anchor.x, work.x, work.x + work.width - bounds.width));
    const y = Math.round(clamp(point.y - this.#anchor.y, work.y, work.y + work.height - bounds.height));
    if (x !== bounds.x || y !== bounds.y) this.#window.setBounds({ ...bounds, x, y });
    const now = performance.now();
    this.#samples.push({ x: point.x, y: point.y, time: now });
    this.#samples = this.#samples.filter((sample) => now - sample.time <= 160).slice(-8);
  }

  #releaseVelocity() {
    const now = performance.now();
    const samples = this.#samples.filter((sample) => now - sample.time <= 140);
    if (this.#paused || samples.length < 2 || now - samples.at(-1).time > 100) return { x: 0, y: 0 };
    const meanTime = samples.reduce((sum, sample) => sum + sample.time, 0) / samples.length;
    const meanX = samples.reduce((sum, sample) => sum + sample.x, 0) / samples.length;
    const meanY = samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length;
    const denominator = samples.reduce((sum, sample) => sum + (sample.time - meanTime) ** 2, 0);
    if (denominator < 25) return { x: 0, y: 0 };
    const velocityX = samples.reduce((sum, sample) => sum
      + (sample.time - meanTime) * (sample.x - meanX), 0) / denominator * 1000;
    const velocityY = samples.reduce((sum, sample) => sum
      + (sample.time - meanTime) * (sample.y - meanY), 0) / denominator * 1000;
    const speed = Math.hypot(velocityX, velocityY);
    const factor = speed > this.#config.maxReleaseSpeedPxPerSecond
      ? this.#config.maxReleaseSpeedPxPerSecond / speed : 1;
    return { x: velocityX * factor, y: velocityY * factor };
  }

  #release(event) {
    if (!this.#validSender(event) || !this.#dragging) return;
    this.#dragging = false;
    const bounds = this.#window.getBounds();
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    this.#workArea = screen.getDisplayNearestPoint(center).workArea;
    this.#velocity = this.#releaseVelocity();
    this.#samples = [];
    const moving = Math.hypot(this.#velocity.x, this.#velocity.y)
      >= this.#config.ballStopSpeedPxPerSecond;
    this.#physicsActive = moving;
    this.#onRelease({ ballBounds: bounds, petBounds: this.#petWindow.getBounds(),
      workArea: this.#workArea, velocityX: this.#velocity.x, velocityY: this.#velocity.y,
      moving });
    if (moving && !this.#paused) this.#window.webContents.send('ball:start-physics', {
      bounds, workArea: this.#workArea,
      velocityX: this.#velocity.x, velocityY: this.#velocity.y, config: this.#config
    });
  }

  #physicsFrame(event, frame) {
    if (!this.#validSender(event) || !this.#external || this.#dragging
      || !this.#physicsActive || this.#paused || !frame
      || ![frame.x, frame.y, frame.velocityX, frame.velocityY].every(Number.isFinite)) return;
    const bounds = this.#window.getBounds();
    const work = this.#workArea;
    const x = Math.round(clamp(frame.x, work.x, work.x + work.width - bounds.width));
    const y = Math.round(clamp(frame.y, work.y, work.y + work.height - bounds.height));
    if (x !== bounds.x || y !== bounds.y) this.#window.setBounds({ ...bounds, x, y });
    this.#velocity = { x: frame.velocityX, y: frame.velocityY };
    if (frame.bounceX === true) this.#bounceXCount += 1;
    if (frame.bounceY === true) this.#bounceYCount += 1;
    this.#physicsActive = frame.moving === true;
    this.#onMotion({ ballBounds: this.#window.getBounds(), workArea: work,
      velocityX: this.#velocity.x, velocityY: this.#velocity.y,
      moving: this.#physicsActive, bounceX: frame.bounceX === true,
      bounceY: frame.bounceY === true });
  }

  close() {
    this.stopPhysics();
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
    this.#window = null;
    this.#dragging = false;
    this.#external = false;
    this.#ready = null;
    this.#samples = [];
    this.#workArea = null;
    this.#visualSize = null;
  }

  dispose() {
    this.close();
    ipcMain.removeHandler('ball:get-image');
    ipcMain.removeListener('ball:grab', this.#listeners.grab);
    ipcMain.removeListener('ball:move', this.#listeners.move);
    ipcMain.removeListener('ball:release', this.#listeners.release);
    ipcMain.removeListener('ball:physics-frame', this.#listeners.physicsFrame);
  }
}

module.exports = { BallWindowManager };
