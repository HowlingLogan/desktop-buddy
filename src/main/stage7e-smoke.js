'use strict';

const { BrowserWindow, screen } = require('electron');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (window) => window.webContents.executeJavaScript('window.__petTest.snapshot()');

async function waitFor(check, timeoutMs = 12000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await delay(25);
  }
  throw new Error('Stage 7E state transition timed out.');
}

async function runStage7ESmoke(window, controls, settings, manager) {
  const original = structuredClone(settings);
  const results = {};
  try {
    controls.applySettings({ play: { durationSeconds: 90 } });
    await window.webContents.executeJavaScript('window.__petTest.startYarnPlay()');
    await waitFor(() => manager.window && manager.window.isVisible());
    const ball = manager.window;
    await ball.webContents.executeJavaScript('window.__ballReady');
    const work = screen.getPrimaryDisplay().workArea;
    const oneCat = () => BrowserWindow.getAllWindows()
      .filter((item) => item.webContents.getURL().endsWith('/index.html')).length === 1;
    const externalVisible = () => ball.webContents.executeJavaScript(
      "document.body.classList.contains('external')");

    async function grabMoveRelease(x, y) {
      await ball.webContents.executeJavaScript('window.desktopBall.grab(10, 10)');
      await waitFor(async () => (await snapshot(window)).state === 'ballDragging');
      const dragging = await snapshot(window);
      if (dragging.play.visible || !await externalVisible()) throw new Error('Duplicate ball during drag.');
      await ball.webContents.executeJavaScript(`window.desktopBall.move(${Math.round(x) + 10}, ${Math.round(y) + 10})`);
      await delay(190);
      await ball.webContents.executeJavaScript('window.desktopBall.release()');
    }

    const first = manager.snapshot.bounds;
    const targetX = Math.max(work.x + 10, first.x - 220);
    const targetY = Math.max(work.y + 10, first.y - 150);
    await grabMoveRelease(targetX, targetY);
    await waitFor(async () => (await snapshot(window)).state === 'chaseBall');
    const arriving = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'returnBall' && current.arrival?.settling ? current : null;
    });
    results.arrivalHold = arriving.play.active && !arriving.play.visible
      && await externalVisible() && arriving.chase.active === false;

    controls.setPaused(true);
    const frozen = await snapshot(window);
    const frozenBall = manager.snapshot.bounds;
    await delay(300);
    const stillFrozen = await snapshot(window);
    results.pauseArrival = stillFrozen.paused && stillFrozen.state === 'returnBall'
      && stillFrozen.arrival.elapsed === frozen.arrival.elapsed
      && JSON.stringify(manager.snapshot.bounds) === JSON.stringify(frozenBall);
    controls.setPaused(false);

    await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'returnBall' && current.arrival?.elapsed > 450;
    });
    const before = manager.snapshot.bounds;
    const visualSize = manager.snapshot.visualSize;
    const returned = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'yarnPlay' && current.play.visible ? current : null;
    });
    const pet = window.getBounds();
    const localRect = await window.webContents.executeJavaScript(`(() => {
      const rect = document.getElementById('yarn-ball').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    const handoffDelta = { x: pet.x + localRect.x - before.x,
      y: pet.y + localRect.y - (before.y + before.height - visualSize.height) };
    results.handoffPosition = Math.abs(handoffDelta.x) < 12
      && Math.abs(handoffDelta.y) < 12;
    results.visualSize = Math.abs(localRect.width - visualSize.width) < 1
      && Math.abs(localRect.height - visualSize.height) < 1;
    results.singleBall = !await externalVisible() && returned.play.visible && oneCat();
    results.pawPlay = returned.play.phase === 'batting'
      && returned.play.frameIndex <= 1;

    const second = manager.snapshot.bounds;
    await grabMoveRelease(Math.min(work.x + work.width - second.width - 10, second.x + 180),
      Math.max(work.y + 10, second.y - 90));
    await waitFor(async () => (await snapshot(window)).state === 'chaseBall');
    const again = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'yarnPlay' && current.play.visible ? current : null;
    });
    results.repeat = again.play.active && manager.window === ball && oneCat()
      && !await externalVisible();
    await window.webContents.executeJavaScript('window.__petTest.endYarnPlay()');
    await waitFor(() => !manager.snapshot.exists);
    results.cleanup = (await snapshot(window)).state === 'idle';
    const passed = Object.values(results).every(Boolean);
    console.log('STAGE7E_SMOKE_RESULT', JSON.stringify({ passed, ...results, handoffDelta }));
    return passed;
  } finally {
    controls.setPaused(false);
    controls.applySettings(original);
  }
}

module.exports = { runStage7ESmoke };
