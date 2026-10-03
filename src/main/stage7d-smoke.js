'use strict';

const { BrowserWindow, screen } = require('electron');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const petSnapshot = (window) => window.webContents.executeJavaScript('window.__petTest.snapshot()');

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error('Stage 7D test timed out while waiting for ball or cat state.');
}

async function runStage7DSmoke(window, controls, settings, manager) {
  const original = structuredClone(settings);
  const results = {};
  try {
    controls.applySettings({ play: { durationSeconds: 90 } });
    await window.webContents.executeJavaScript('window.__petTest.startYarnPlay()');
    await waitFor(() => manager.window && manager.window.isVisible());
    const ball = manager.window;
    await ball.webContents.executeJavaScript('window.__ballReady');
    const work = screen.getPrimaryDisplay().workArea;
    const model = await ball.webContents.executeJavaScript(`import('./ball-physics.js').then(({ stepBallPhysics }) => {
      const area = { x: 0, y: 0, width: 300, height: 200 };
      const size = { width: 50, height: 40 };
      const config = ${JSON.stringify(settings.play)};
      const run = (x, y, velocityX, velocityY) => stepBallPhysics(
        { x, y, velocityX, velocityY }, 0.05, area, size, config);
      let settling = { x: 100, y: 80, velocityX: 400, velocityY: 200 };
      for (let index = 0; index < 180 && settling.moving !== false; index += 1) {
        settling = stepBallPhysics(settling, 0.05, area, size, config);
      }
      return { left: run(2, 80, -400, 0), right: run(248, 80, 400, 0),
        top: run(100, 2, 0, -400), bottom: run(100, 158, 0, 400), settling };
    })`);
    results.boundaryBounce = model.left.bounceX && model.left.velocityX > 0
      && model.right.bounceX && model.right.velocityX < 0
      && model.top.bounceY && model.top.velocityY > 0
      && model.bottom.bounceY && model.bottom.velocityY < 0
      && [model.left, model.right, model.top, model.bottom]
        .every((item) => Math.hypot(item.velocityX, item.velocityY) < 400
          && item.x >= 0 && item.x <= 250 && item.y >= 0 && item.y <= 160);
    results.eventualStop = !model.settling.moving
      && model.settling.velocityX === 0 && model.settling.velocityY === 0;

    async function grab() {
      await ball.webContents.executeJavaScript('window.desktopBall.grab(10, 10)');
      await waitFor(async () => (await petSnapshot(window)).state === 'ballDragging');
    }
    async function moveTo(x, y) {
      await ball.webContents.executeJavaScript(`window.desktopBall.move(${x + 10}, ${y + 10})`);
    }
    async function release() {
      await ball.webContents.executeJavaScript('window.desktopBall.release()');
    }

    await grab();
    await moveTo(work.x + Math.round(work.width * 0.52), work.y + Math.round(work.height * 0.5));
    await delay(180);
    await release();
    await waitFor(async () => (await petSnapshot(window)).state === 'chaseBall');

    await grab();
    const slowStart = manager.snapshot.bounds;
    await delay(55);
    await moveTo(slowStart.x + 5, slowStart.y);
    await delay(55);
    await moveTo(slowStart.x + 11, slowStart.y);
    await release();
    const slow = await waitFor(() => manager.snapshot.moving ? manager.snapshot : null, 1500);
    await delay(220);
    const slowMoved = manager.snapshot.bounds.x - slowStart.x;
    results.slowRelease = slow.velocityX > 25 && slow.velocityX < 240
      && slowMoved > 8 && slowMoved < 100;

    await grab();
    results.grabMoving = !manager.snapshot.moving
      && manager.snapshot.velocityX === 0
      && !(await ball.webContents.executeJavaScript('window.__ballPhysicsSnapshot().running'));
    const fastStart = manager.snapshot.bounds;
    await delay(20);
    await moveTo(fastStart.x - 45, fastStart.y - 12);
    await delay(25);
    await moveTo(fastStart.x - 95, fastStart.y - 28);
    await release();
    const fast = await waitFor(() => manager.snapshot.moving ? manager.snapshot : null, 1500);
    const releaseSpeed = Math.hypot(fast.velocityX, fast.velocityY);
    results.fastAndClamped = releaseSpeed > slow.velocityX * 2
      && releaseSpeed <= settings.play.maxReleaseSpeedPxPerSecond + 0.1
      && releaseSpeed >= settings.play.maxReleaseSpeedPxPerSecond * 0.6;
    const firstTarget = await waitFor(async () => {
      const current = await petSnapshot(window);
      return current.state === 'chaseBall' ? current.chase.targetX : null;
    });

    controls.setPaused(true);
    await delay(90);
    const pausedBounds = manager.snapshot.bounds;
    const pausedVelocity = manager.snapshot.velocityX;
    await delay(420);
    results.pause = JSON.stringify(manager.snapshot.bounds) === JSON.stringify(pausedBounds)
      && manager.snapshot.velocityX === pausedVelocity
      && (await petSnapshot(window)).chase.paused;
    controls.setPaused(false);
    await delay(270);
    const afterResume = manager.snapshot;
    results.resume = Math.hypot(afterResume.bounds.x - pausedBounds.x,
      afterResume.bounds.y - pausedBounds.y) > 20
      && Math.hypot(afterResume.bounds.x - pausedBounds.x,
        afterResume.bounds.y - pausedBounds.y) < settings.play.maxReleaseSpeedPxPerSecond * 0.35;

    const samples = [];
    for (let index = 0; index < 11; index += 1) {
      samples.push({ ball: manager.snapshot, cat: await petSnapshot(window) });
      await delay(110);
    }
    const speeds = samples.map(({ ball: current }) => Math.hypot(current.velocityX, current.velocityY));
    results.friction = speeds.at(-1) < speeds[0] && speeds.at(-1) < releaseSpeed;
    results.workAreaBounds = samples.every(({ ball: current }) => {
      const bounds = current.bounds;
      return bounds && bounds.x >= work.x && bounds.y >= work.y
        && bounds.x + bounds.width <= work.x + work.width
        && bounds.y + bounds.height <= work.y + work.height;
    });
    const targetValues = samples.map(({ cat }) => cat.chase?.targetX).filter(Number.isFinite);
    results.liveTarget = targetValues.length > 2
      && Math.max(...targetValues) - Math.min(...targetValues) > 25
      && Math.abs(targetValues.at(-1) - firstTarget) > 25;
    results.walkCycle = samples.some(({ cat }) => cat.chase?.frameChanges >= 5)
      && samples.some(({ cat }) => cat.chase?.frameIntervalMs === settings.play.chaseWalkFrameMs)
      && samples.every(({ cat }) => !cat.flipped || cat.chase?.direction === -1);

    await waitFor(() => !manager.snapshot.moving, 9000);
    results.settled = manager.snapshot.velocityX === 0 && manager.snapshot.velocityY === 0;
    const returned = await waitFor(async () => {
      const current = await petSnapshot(window);
      return current.state === 'yarnPlay' && current.play.visible ? current : null;
    }, 18000);
    results.handoff = returned.play.active
      && !(await ball.webContents.executeJavaScript("document.body.classList.contains('external')"))
      && BrowserWindow.getAllWindows().filter((item) => item.webContents.getURL().endsWith('/index.html')).length === 1;
    results.oneWindow = manager.window === ball;

    const petBounds = window.getBounds();
    window.setPosition(work.x + work.width - petBounds.width - 90,
      work.y + work.height - petBounds.height);
    await delay(180);
    await grab();
    const ballWidth = manager.snapshot.bounds.width;
    const ballHeight = manager.snapshot.bounds.height;
    const rightEdge = work.x + work.width - ballWidth;
    await moveTo(rightEdge - 3, work.y + work.height - ballHeight - 50);
    await delay(180);
    await release();
    await waitFor(async () => (await petSnapshot(window)).state === 'chaseBall');
    await grab();
    const edgeY = manager.snapshot.bounds.y;
    const bounceBefore = manager.snapshot.bounceXCount;
    await delay(20);
    await moveTo(rightEdge + 30, edgeY);
    await delay(25);
    await moveTo(rightEdge + 65, edgeY);
    await release();
    await waitFor(() => manager.snapshot.moving);
    const bounced = await waitFor(() => manager.snapshot.bounceXCount > bounceBefore
      ? manager.snapshot : null, 2500);
    results.liveBounce = bounced.bounds.x <= rightEdge
      && bounced.velocityX < 0
      && Math.abs(bounced.velocityX) < settings.play.maxReleaseSpeedPxPerSecond;
    const turned = await waitFor(async () => {
      const current = await petSnapshot(window);
      return current.state === 'chaseBall' && current.chase.direction === -1 ? current : null;
    }, 7000);
    results.chaseTurnsAfterBounce = turned.chase.active && turned.chase.targetX < rightEdge;
    await waitFor(async () => (await petSnapshot(window)).state === 'yarnPlay', 18000);
    results.oneWindow = results.oneWindow && manager.window === ball;

    await window.webContents.executeJavaScript('window.__petTest.endYarnPlay()');
    await waitFor(() => !manager.snapshot.exists);
    results.cleanup = (await petSnapshot(window)).state === 'idle';
    const passed = Object.values(results).every(Boolean);
    console.log('STAGE7D_SMOKE_RESULT', JSON.stringify({ passed, ...results,
      slowVelocity: slow.velocityX, fastVelocity: releaseSpeed, slowMoved }));
    return passed;
  } finally {
    controls.setPaused(false);
    controls.applySettings(original);
  }
}

module.exports = { runStage7DSmoke };
