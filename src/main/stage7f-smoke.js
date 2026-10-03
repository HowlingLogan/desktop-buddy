'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (window) => window.webContents.executeJavaScript('window.__petTest.snapshot()');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function waitFor(check, label, timeoutMs = 18000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(25);
  }
  throw new Error(`Stage 7F timed out waiting for ${label}.`);
}

async function runStage7FSmoke(window, controls, settings, manager, resetPosition) {
  const original = structuredClone(settings);
  const output = path.resolve(__dirname, '..', '..', 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const results = {};
  const failures = [];
  const onConsole = (_event, details) => {
    if (details?.level === 'error') failures.push(details.message);
  };
  window.webContents.on('console-message', onConsole);
  const work = screen.getPrimaryDisplay().workArea;
  const oneCat = () => BrowserWindow.getAllWindows()
    .filter((item) => item.webContents.getURL().endsWith('/index.html')).length === 1;
  const saveFrame = async (name) => fs.writeFileSync(path.join(output, `stage7f-${name}.png`),
    (await window.webContents.capturePage()).toPNG());
  let ball = null;
  try {
    controls.applySettings({ play: { durationSeconds: 65, jumpAfterSeconds: 2,
      jumpDurationMs: 1100 } });
    const start = async () => {
      await window.webContents.executeJavaScript('window.__petTest.startYarnPlay()');
      await waitFor(async () => (await snapshot(window)).state === 'yarnPlay', 'local play');
    };
    const external = () => ball.webContents.executeJavaScript(
      "document.body.classList.contains('external')");
    const visiblePair = async () => {
      const current = await snapshot(window);
      return { local: current.play.visible, desktop: await external() };
    };
    const assertSingleBall = async () => {
      const pair = await visiblePair();
      return pair.local !== pair.desktop && oneCat() && manager.window === ball;
    };
    const grab = async () => {
      await waitFor(() => manager.window && manager.window.isVisible(), 'helper window');
      ball = manager.window;
      await ball.webContents.executeJavaScript('window.__ballReady');
      await ball.webContents.executeJavaScript('window.desktopBall.grab(10, 10)');
      await waitFor(async () => (await snapshot(window)).state === 'ballDragging', 'ball drag');
      if (!await assertSingleBall()) throw new Error('Duplicate or missing ball during drag.');
    };
    const move = async (x, y) => ball.webContents.executeJavaScript(
      `window.desktopBall.move(${Math.round(x) + 10}, ${Math.round(y) + 10})`);
    const release = async () => ball.webContents.executeJavaScript('window.desktopBall.release()');

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await start();
      if (cycle === 0) {
        const batting = await snapshot(window);
        controls.setPaused(true);
        await delay(80);
        const held = await snapshot(window);
        await delay(280);
        const heldAgain = await snapshot(window);
        results.pauseBatting = held.play.batCount === heldAgain.play.batCount
          && held.play.ballX === heldAgain.play.ballX
          && held.play.ballY === heldAgain.play.ballY;
        controls.setPaused(false);
        results.resumeBatting = batting.play.active && (await snapshot(window)).play.active;
        await saveFrame('batting');
      }
      const jumping = await waitFor(async () => {
        const current = await snapshot(window);
        return current.play.phase === 'jump' ? current : null;
      }, 'jump').catch(async (error) => {
        throw new Error(`${error.message} cycle=${cycle} ${JSON.stringify({ pet: await snapshot(window),
          ball: manager.snapshot, playSettings: settings.play })}`);
      });
      if (cycle === 0) {
        controls.setPaused(true);
        await delay(80);
        const held = await snapshot(window);
        await delay(280);
        const heldAgain = await snapshot(window);
        results.pauseJump = held.play.jump.progress === heldAgain.play.jump.progress
          && held.play.jump.x === heldAgain.play.jump.x
          && held.play.jump.y === heldAgain.play.jump.y;
        controls.setPaused(false);
        await saveFrame('jump');
      }
      const landed = await waitFor(async () => {
        const current = await snapshot(window);
        return current.play.phase === 'batting' && current.play.jump.count >= 1 ? current : null;
      }, 'landing and batting');
      results.jumpAndBatting = (results.jumpAndBatting ?? true)
        && jumping.play.jump.active && landed.play.visible && !landed.flipped;
      await grab();
      const origin = manager.snapshot.bounds;
      const targetX = clamp(origin.x + (cycle % 2 ? 220 : -220), work.x + 8,
        work.x + work.width - origin.width - 8);
      const targetY = clamp(origin.y - 125, work.y + 8,
        work.y + work.height - origin.height - 8);
      await move(targetX, targetY);
      await delay(185);
      await release();
      await waitFor(async () => (await snapshot(window)).state === 'chaseBall', 'slow chase');
      if (cycle === 0) {
        controls.setPaused(true);
        await delay(80);
        const pet = window.getBounds();
        const frozen = await snapshot(window);
        await delay(300);
        results.pauseChase = JSON.stringify(window.getBounds()) === JSON.stringify(pet)
          && (await snapshot(window)).chase.distanceTravelled === frozen.chase.distanceTravelled;
        controls.setPaused(false);
      }
      const arrival = await waitFor(async () => {
        const current = await snapshot(window);
        return current.state === 'returnBall' && current.arrival?.settling ? current : null;
      }, 'arrival').catch(async (error) => {
        throw new Error(`${error.message} ${JSON.stringify({ pet: await snapshot(window),
          ball: manager.snapshot })}`);
      });
      if (cycle === 0) {
        controls.setPaused(true);
        await delay(80);
        const frozen = await snapshot(window);
        const bounds = manager.snapshot.bounds;
        await delay(300);
        results.pauseArrival = (await snapshot(window)).arrival?.elapsed === frozen.arrival.elapsed
          && JSON.stringify(manager.snapshot.bounds) === JSON.stringify(bounds);
        controls.setPaused(false);
        await saveFrame('arrival');
      }
      const returned = await waitFor(async () => {
        const current = await snapshot(window);
        return current.state === 'yarnPlay' && current.play.visible ? current : null;
      }, 'return to batting');
      results.repeatedChase = (results.repeatedChase ?? true) && arrival.play.active
        && returned.play.active && returned.chase.distanceTravelled > 50
        && await assertSingleBall();
      await window.webContents.executeJavaScript('window.__petTest.endYarnPlay()');
      await waitFor(() => !manager.snapshot.exists, 'play cleanup');
      results.cycleCleanup = (results.cycleCleanup ?? true)
        && (await snapshot(window)).state === 'idle' && oneCat();
    }

    await start();
    await grab();
    const bounds = manager.snapshot.bounds;
    const right = work.x + work.width - bounds.width;
    await move(right - 100, clamp(bounds.y - 80, work.y + 8,
      work.y + work.height - bounds.height - 8));
    await delay(30);
    await move(right - 5, manager.snapshot.bounds.y);
    await delay(25);
    const bouncesBefore = manager.snapshot.bounceXCount;
    await release();
    await waitFor(() => manager.snapshot.moving, 'moving throw', 2000);
    results.fastThrow = Math.hypot(manager.snapshot.velocityX, manager.snapshot.velocityY) > 250;
    controls.setPaused(true);
    await delay(80);
    const pausedBall = manager.snapshot;
    const pausedPet = window.getBounds();
    await delay(330);
    results.pausePhysics = JSON.stringify(manager.snapshot.bounds) === JSON.stringify(pausedBall.bounds)
      && JSON.stringify(window.getBounds()) === JSON.stringify(pausedPet)
      && manager.snapshot.velocityX === pausedBall.velocityX;
    controls.setPaused(false);
    await waitFor(() => manager.snapshot.bounceXCount > bouncesBefore, 'boundary bounce', 4000);
    results.bounce = manager.snapshot.bounds.x >= work.x
      && manager.snapshot.bounds.x + manager.snapshot.bounds.width <= work.x + work.width;
    await grab();
    results.grabMoving = !manager.snapshot.moving && manager.snapshot.velocityX === 0;
    const from = manager.snapshot.bounds;
    await move(clamp(from.x - 180, work.x + 8, right - 8),
      clamp(from.y - 100, work.y + 8, work.y + work.height - from.height - 8));
    await delay(185);
    await release();
    await waitFor(async () => (await snapshot(window)).state === 'chaseBall', 'repeat chase');
    await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'yarnPlay' && current.play.visible;
    }, 'repeat return');
    results.rethrow = await assertSingleBall();

    await grab();
    await move(work.x + 100, work.y + 100);
    await delay(185);
    await release();
    await waitFor(async () => (await snapshot(window)).state === 'chaseBall', 'reset chase');
    resetPosition();
    await waitFor(() => !manager.snapshot.exists, 'reset position cleanup');
    const reset = await snapshot(window);
    results.resetPosition = reset.state === 'idle' && !reset.play.active
      && !reset.chase.active && oneCat();

    await start();
    const defaults = await controls.resetToDefaults();
    await waitFor(() => !manager.snapshot.exists, 'defaults cleanup');
    results.resetDefaults = defaults.reset === true
      && (await snapshot(window)).state === 'idle' && oneCat();
    controls.applySettings(original);
    await start();
    await grab();
    const quitBall = manager.snapshot.bounds;
    await move(clamp(quitBall.x - 200, work.x + 8,
      work.x + work.width - quitBall.width - 8),
    clamp(quitBall.y - 110, work.y + 8,
      work.y + work.height - quitBall.height - 8));
    await delay(185);
    await release();
    await waitFor(async () => (await snapshot(window)).state === 'chaseBall', 'quit during chase');
    results.quitWithExternalBall = manager.snapshot.exists && manager.snapshot.external
      && await external() && oneCat();
    results.noConsoleErrors = failures.length === 0;
    const passed = Object.values(results).every(Boolean);
    console.log('STAGE7F_SMOKE_RESULT', JSON.stringify({ passed, ...results,
      errors: failures.slice(0, 3) }));
    return passed;
  } finally {
    window.webContents.removeListener('console-message', onConsole);
    controls.setPaused(false);
    controls.applySettings(original);
  }
}

module.exports = { runStage7FSmoke };
