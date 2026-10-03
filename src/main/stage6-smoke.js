'use strict';

const { screen } = require('electron');
const { normalizeSettings } = require('./settings');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (window) => window.webContents.executeJavaScript('window.__petTest.snapshot()');

async function visibleBottomGap(window) {
  const image = await window.webContents.capturePage();
  const pixels = image.toBitmap();
  const { width, height } = image.getSize();
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 16) return height - 1 - y;
    }
  }
  return height;
}

async function waitFor(check, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error('Timed out waiting for Stage 6 state.');
}

async function runStage6Smoke(window, settings, controls, moveDragTo, resetPosition) {
  const original = structuredClone(settings);
  const results = {};
  try {
    const beforeMenu = controls.state();
    const rightClick = { x: Math.floor(window.getBounds().width / 2), y: Math.floor(window.getBounds().height / 2), button: 'right' };
    window.webContents.sendInputEvent({ type: 'mouseDown', ...rightClick });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...rightClick });
    await waitFor(() => controls.state().menuOpenCount > beforeMenu.menuOpenCount, 2500);
    const menu = controls.getMenu();
    results.menu = Boolean(menu?.getMenuItemById('pause') && menu.getMenuItemById('settings')
      && menu.getMenuItemById('quit') && menu.getMenuItemById('size')
      && menu.getMenuItemById('play')?.enabled === true);
    results.startupOff = normalizeSettings({}).startWithWindows === false;
    controls.closeMenu();

    await window.webContents.executeJavaScript(`window.__petTest.setSystemIdle(${settings.activity.walkAfterSeconds}, 0)`);
    await waitFor(async () => (await snapshot(window)).state === 'walk', 14000);
    controls.setPaused(true);
    await delay(100);
    const paused = await snapshot(window);
    const pausedBounds = window.getBounds();
    await delay(650);
    const stillPaused = await snapshot(window);
    await window.webContents.executeJavaScript(`window.__petTest.setSystemIdle(${settings.activity.sleepAfterSeconds}, 0)`);
    await delay(100);
    const pausedAtSleepThreshold = await snapshot(window);
    results.pause = paused.paused && paused.state === 'idle'
      && stillPaused.paused && window.getBounds().x === pausedBounds.x
      && pausedAtSleepThreshold.paused && pausedAtSleepThreshold.state === 'idle';

    await window.webContents.executeJavaScript(`window.__petTest.setSystemIdle(${settings.activity.walkAfterSeconds}, 1)`);
    controls.setPaused(false);
    const resumed = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'walk' && !current.paused ? current : null;
    }, 14000);
    results.resume = resumed.state === 'walk';
    controls.setPaused(true);

    controls.setMuted(true);
    await delay(100);
    results.mute = controls.state().muted && (await snapshot(window)).audioMuted;
    controls.setMuted(false);
    await delay(100);
    results.unmute = !controls.state().muted && !(await snapshot(window)).audioMuted;

    await window.webContents.executeJavaScript('window.__petTest.beginDrag()');
    moveDragTo({ x: -10000, y: -10000 });
    await window.webContents.executeJavaScript('window.__petTest.endDrag()');
    resetPosition();
    await delay(120);
    const resetBounds = window.getBounds();
    const workArea = screen.getPrimaryDisplay().workArea;
    results.reset = resetBounds.x >= workArea.x + workArea.width - resetBounds.width - settings.edgeMargin - 1
      && resetBounds.y + resetBounds.height === workArea.y + workArea.height;

    const newSize = original.petSize === 280 ? 200 : 280;
    controls.setPetSize(newSize);
    await delay(150);
    const sizeBounds = window.getBounds();
    const sizeSnapshot = await snapshot(window);
    const resizedBottomGap = await visibleBottomGap(window);
    await window.webContents.executeJavaScript('window.__petTest.beginDrag()');
    moveDragTo({ x: 10000, y: 10000 });
    const resizedDragBounds = window.getBounds();
    await window.webContents.executeJavaScript('window.__petTest.endDrag()');
    results.size = controls.state().petSize === newSize && sizeSnapshot.petSize === newSize
      && sizeBounds.width === newSize + settings.windowPadding.left + settings.windowPadding.right
      && sizeBounds.y + sizeBounds.height === workArea.y + workArea.height
      && resizedBottomGap <= 1
      && resizedDragBounds.x + resizedDragBounds.width <= workArea.x + workArea.width
      && resizedDragBounds.y + resizedDragBounds.height === workArea.y + workArea.height;

    const settingsWindow = controls.openSettings();
    await settingsWindow.webContents.executeJavaScript('window.__settingsReady');
    results.settingsOpen = !settingsWindow.isDestroyed()
      && await settingsWindow.webContents.executeJavaScript(
        "document.querySelector('h1')?.textContent === 'Desktop Buddy Settings'"
      );
    await settingsWindow.webContents.executeJavaScript(`
      document.getElementById('pet-size').value = '200';
      document.getElementById('light-delay').value = '10';
      document.getElementById('walk-delay').value = '60';
      document.getElementById('sleep-delay').value = '150';
      document.getElementById('blink-interval').value = '4';
      document.getElementById('settings-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    `);
    await waitFor(() => settingsWindow.webContents.executeJavaScript(
      "document.getElementById('status').textContent === 'Settings saved.'"
    ));
    results.settingsSave = settings.petSize === 200 && settings.activity.lightAfterSeconds === 10
      && settings.activity.walkAfterSeconds === 60 && settings.activity.sleepAfterSeconds === 150
      && settings.animation.blinkIntervalSeconds === 4
      && (await snapshot(window)).petSize === 200;

    const passed = Object.values(results).every(Boolean);
    console.log('STAGE6_SMOKE_RESULT', JSON.stringify({ passed, ...results }));
    return passed;
  } finally {
    controls.applySettings(original);
    controls.setPaused(false);
  }
}

module.exports = { runStage6Smoke };
