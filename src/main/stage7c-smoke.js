'use strict';

const { BrowserWindow, screen } = require('electron');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (window) => window.webContents.executeJavaScript('window.__petTest.snapshot()');
let debugWindow = null;

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await delay(60);
  }
  throw new Error(`Stage 7C timeout: ${JSON.stringify(debugWindow ? await snapshot(debugWindow) : await check())}`);
}

async function runStage7CSmoke(window, controls, settings, ballManager) {
  debugWindow = window;
  const original = structuredClone(settings);
  const results = {};
  try {
    controls.applySettings({ play: { durationSeconds: 90,
      chaseStartPx: 90, chaseStopPx: 24 } });
    controls.showContextMenu();
    controls.closeMenu();
    controls.getMenu().getMenuItemById('play').click();
    await waitFor(async () => (await snapshot(window)).state === 'yarnPlay');
    await waitFor(() => ballManager.window && !ballManager.window.isDestroyed());
    const ball = ballManager.window;
    await waitFor(() => ball.isVisible());
    await ball.webContents.executeJavaScript('window.__ballReady');
    const helperContent = await ball.webContents.executeJavaScript(`({
      images: [...document.images].map((image) => decodeURIComponent(image.src)),
      petArtCount: document.querySelectorAll('#pet-art, #idle-frames, #play-frames, #jump-frames').length
    })`);
    results.yarnOnlyHelper = ball.webContents.getURL().endsWith('/ball-window.html')
      && helperContent.images.length === 1
      && helperContent.images[0].endsWith('/Yarn Ball.png')
      && helperContent.petArtCount === 0
      && BrowserWindow.getAllWindows().filter((item) => item.webContents.getURL().endsWith('/index.html')).length === 1;
    const initial = ballManager.snapshot.bounds;
    results.separateWindow = initial.width > 20 && initial.width < window.getBounds().width
      && initial.height > 20 && initial.height < window.getBounds().height;

    async function grabAndRelease(x, y) {
      await ball.webContents.executeJavaScript('window.desktopBall.grab(10, 10)');
      await waitFor(async () => (await snapshot(window)).state === 'ballDragging');
      const during = await snapshot(window);
      const externalVisible = await ball.webContents.executeJavaScript("document.body.classList.contains('external')");
      results.oneBallDuringDrag = (results.oneBallDuringDrag ?? true)
        && !during.play.visible && externalVisible;
      await ball.webContents.executeJavaScript(`window.desktopBall.move(${x + 10}, ${y + 10})`);
      await delay(170);
      await ball.webContents.executeJavaScript('window.desktopBall.release()');
    }

    ball.webContents.sendInputEvent({ type: 'mouseDown', x: 10, y: 10, button: 'left' });
    await waitFor(async () => (await snapshot(window)).state === 'ballDragging', 2000);
    results.pointerInput = (await snapshot(window)).state === 'ballDragging';
    ball.webContents.sendInputEvent({ type: 'mouseUp', x: 10, y: 10, button: 'left' });
    await waitFor(async () => (await snapshot(window)).state === 'yarnPlay');
    const localBeforeTiny = ballManager.snapshot.bounds;
    await grabAndRelease(localBeforeTiny.x + 12, localBeforeTiny.y);
    await waitFor(async () => (await snapshot(window)).state === 'yarnPlay');
    results.tinyAdjustment = (await snapshot(window)).chase?.distanceTravelled === 0;
    results.oneBallAfterReturn = !(await ball.webContents.executeJavaScript("document.body.classList.contains('external')"))
      && (await snapshot(window)).play.visible;

    const shortStart = window.getBounds();
    const shortBall = ballManager.snapshot.bounds;
    await grabAndRelease(shortBall.x - 175, shortBall.y);
    await waitFor(async () => (await snapshot(window)).state === 'chaseBall');
    const shortEnd = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'yarnPlay' && current.play.visible ? current : null;
    }, 6000);
    const shortTravel = Math.hypot(window.getBounds().x - shortStart.x,
      window.getBounds().y - shortStart.y);
    results.shortChase = shortTravel > 70 && shortTravel < 260
      && shortEnd.chase.frameChanges > 0;

    const work = screen.getPrimaryDisplay().workArea;
    const firstPet = window.getBounds();
    const horizontal = { x: work.x + Math.max(10, work.width * 0.28),
      y: Math.min(work.y + work.height - initial.height - 10, firstPet.y + 20) };
    await grabAndRelease(horizontal.x, horizontal.y);
    const horizontalStart = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'chaseBall' ? current : null;
    });
    await ball.webContents.executeJavaScript('window.desktopBall.grab(10, 10)');
    const regrabbed = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'ballDragging' ? current : null;
    });
    results.regrab = !regrabbed.chase.active && ballManager.window === ball;
    await ball.webContents.executeJavaScript(`window.desktopBall.move(${horizontal.x + 10}, ${horizontal.y + 10})`);
    await delay(170);
    await ball.webContents.executeJavaScript('window.desktopBall.release()');
    await waitFor(async () => (await snapshot(window)).state === 'chaseBall');
    const beforePause = window.getBounds();
    controls.setPaused(true);
    await delay(250);
    const paused = await snapshot(window);
    const pauseBounds = window.getBounds();
    await delay(500);
    results.pause = paused.paused && paused.chase.paused
      && JSON.stringify(pauseBounds) === JSON.stringify(window.getBounds());
    controls.setPaused(false);
    const gaitBefore = await snapshot(window);
    await delay(850);
    const gaitAfter = await snapshot(window);
    const gaitFrames = gaitAfter.chase.frameChanges - gaitBefore.chase.frameChanges;
    const gaitTravel = gaitAfter.chase.distanceTravelled - gaitBefore.chase.distanceTravelled;
    results.gaitRate = gaitFrames >= 5 && gaitFrames <= 11
      && gaitAfter.chase.frameIntervalMs === settings.play.chaseWalkFrameMs;
    results.travelRate = gaitTravel > 55 && gaitTravel < 170
      && gaitAfter.chase.speedPxPerSecond === settings.play.chaseSpeedPxPerSecond;
    const horizontalEnd = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'yarnPlay' && current.play.visible ? current : null;
    }, 14000);
    results.horizontal = horizontalStart.chase.active
      && window.getBounds().x < firstPet.x - 100
      && Math.abs(window.getBounds().x - horizontalEnd.chase.targetX) < 35;
    results.walkCycle = horizontalEnd.chase.frameChanges >= 7;
    results.bounds = (() => {
      const cat = window.getBounds();
      const yarn = ballManager.snapshot.bounds;
      return cat.x >= work.x && cat.y >= work.y
        && cat.x + cat.width <= work.x + work.width
        && cat.y + cat.height <= work.y + work.height
        && yarn.x >= work.x && yarn.y >= work.y
        && yarn.x + yarn.width <= work.x + work.width
        && yarn.y + yarn.height <= work.y + work.height;
    })();

    const verticalPet = window.getBounds();
    await grabAndRelease(verticalPet.x + Math.min(50, verticalPet.width / 3), work.y + 35);
    const verticalEnd = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'yarnPlay' && current.play.visible ? current : null;
    }, 14000);
    results.vertical = window.getBounds().y < verticalPet.y - 100
      && verticalEnd.chase.distanceTravelled > 100;

    const diagonalPet = window.getBounds();
    const diagonal = { x: work.x + work.width - initial.width - 30,
      y: work.y + work.height - initial.height - 30 };
    await grabAndRelease(diagonal.x, diagonal.y);
    const diagonalEnd = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'yarnPlay' && current.play.visible ? current : null;
    }, 14000);
    results.diagonal = window.getBounds().x > diagonalPet.x + 100
      && window.getBounds().y > diagonalPet.y + 100
      && diagonalEnd.chase.direction === 1
      && !diagonalEnd.flipped;
    results.reusable = ballManager.window === ball && !ball.isDestroyed();

    await window.webContents.executeJavaScript('window.__petTest.endYarnPlay()');
    await waitFor(async () => (await snapshot(window)).state === 'idle');
    results.cleanup = !ballManager.snapshot.exists && !(await snapshot(window)).play.visible;
    const passed = Object.values(results).every(Boolean);
    console.log('STAGE7C_SMOKE_RESULT', JSON.stringify({ passed, ...results }));
    return passed;
  } finally {
    controls.setPaused(false);
    controls.applySettings(original);
  }
}

module.exports = { runStage7CSmoke };
