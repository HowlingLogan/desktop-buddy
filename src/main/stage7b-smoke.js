'use strict';

const fs = require('node:fs');
const path = require('node:path');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (window) => window.webContents.executeJavaScript('window.__petTest.snapshot()');

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(35);
  }
  throw new Error('Timed out waiting for Stage 7B jump state.');
}

async function runStage7BSmoke(window, controls, settings, pet) {
  const original = structuredClone(settings);
  const output = path.resolve(__dirname, '..', '..', 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const results = {};
  try {
    controls.applySettings({ play: {
      durationSeconds: 9, jumpAfterSeconds: 2, jumpPrepareMs: 200,
      jumpDurationMs: 1200, jumpLandMs: 150
    } });
    await delay(100);
    controls.showContextMenu();
    const menu = controls.getMenu();
    controls.closeMenu();
    menu.getMenuItemById('play').click();
    const first = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'yarnPlay' && current.play.phase === 'batting' ? current : null;
    });
    results.stage7aBatting = first.play.visible && first.play.jump.count === 0;
    const jumping = await waitFor(async () => {
      const current = await snapshot(window);
      return current.play.phase === 'jump' ? current : null;
    });
    results.forward = jumping.play.jump.direction === 1;
    const stationaryBall = { x: jumping.play.ballX, y: jumping.play.ballY };
    const seen = new Set();
    const captured = new Set();
    const samples = [];
    let paused = false;
    let resumed = false;
    while (true) {
      const current = await snapshot(window);
      if (current.play.phase === 'landing' || current.play.phase === 'batting') break;
      if (current.play.phase === 'jump') {
        samples.push(current.play);
        const index = current.play.jump.frameIndex;
        seen.add(index);
        if (!captured.has(index) && (index !== 1 || current.play.jump.progress >= 0.48)) {
          captured.add(index);
          const label = ['left', 'center', 'right'][index];
          fs.writeFileSync(path.join(output, `stage7b-${label}.png`),
            (await window.webContents.capturePage()).toPNG());
        }
        if (!paused && current.play.jump.progress > 0.35 && current.play.jump.progress < 0.75) {
          controls.setPaused(true);
          await delay(100);
          const held = await snapshot(window);
          await delay(500);
          const later = await snapshot(window);
          results.pause = held.paused && held.play.paused && held.play.phase === 'jump'
            && held.play.jump.progress === later.play.jump.progress
            && held.play.jump.x === later.play.jump.x
            && held.play.jump.y === later.play.jump.y
            && held.play.ballX === later.play.ballX && held.play.ballY === later.play.ballY;
          controls.setPaused(false);
          resumed = true;
          paused = true;
        }
      }
      await delay(25);
    }
    results.resume = resumed && (await snapshot(window)).play.jump.progress > samples[0].jump.progress;
    results.allJumpFrames = [0, 1, 2].every((index) => seen.has(index))
      && pet.states.yarnJump.frames.every((url, index) => decodeURIComponent(url)
        .endsWith(`/Jump ${['Left', 'Center', 'Right'][index]} Cat.png`));
    const jumpSamples = samples.filter((entry) => entry.jump.anchor);
    const changes = jumpSamples.slice(1).map((entry, index) => ({
      dx: entry.jump.anchor.x - jumpSamples[index].jump.anchor.x,
      dy: entry.jump.anchor.footY - jumpSamples[index].jump.anchor.footY
    }));
    results.smoothArc = jumpSamples.some((entry) => entry.jump.y < -7)
      && changes.every((change) => Math.hypot(change.dx, change.dy) < 16);
    results.ballStill = jumpSamples.every((entry) => Math.abs(entry.ballX - stationaryBall.x) < 0.01
      && Math.abs(entry.ballY - stationaryBall.y) < 0.01);
    const landing = await waitFor(async () => {
      const current = await snapshot(window);
      return current.play.phase === 'landing' ? current : null;
    }, 1000).catch(() => null);
    results.landing = Boolean(landing && landing.play.jump.y === 0
      && Math.abs(landing.play.jump.anchor.footY - window.getBounds().height) < 1.5);
    if (landing) fs.writeFileSync(path.join(output, 'stage7b-landing.png'),
      (await window.webContents.capturePage()).toPNG());
    const resumedBat = await waitFor(async () => {
      const current = await snapshot(window);
      return current.play.phase === 'batting' && current.play.jump.count === 1 ? current : null;
    });
    results.battingResumed = resumedBat.play.visible && resumedBat.play.jump.frameIndex === -1;
    results.unflipped = await window.webContents.executeJavaScript(`(() => {
      const art = document.getElementById('pet-art');
      return getComputedStyle(art).transform === 'none'
        && [...document.querySelectorAll('#jump-frames img')].length === 3
        && [...document.querySelectorAll('#jump-frames img')]
          .every((image) => getComputedStyle(image).transform === 'none');
    })()`);
    const idle = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'idle' && current.play.phase === 'inactive' ? current : null;
    }, 10000);
    results.cleanup = !idle.play.visible && !idle.play.active && idle.play.jump.frameIndex === -1;

    menu.getMenuItemById('play').click();
    const reverse = await waitFor(async () => {
      const current = await snapshot(window);
      return current.play.phase === 'jump' ? current : null;
    });
    const reverseFrames = new Set([reverse.play.jump.frameIndex]);
    while (true) {
      const current = await snapshot(window);
      if (current.play.phase !== 'jump') break;
      reverseFrames.add(current.play.jump.frameIndex);
      await delay(35);
    }
    results.reverse = reverse.play.jump.direction === -1 && [0, 1, 2].every((index) => reverseFrames.has(index));
    results.quitDuringPlay = (await snapshot(window)).state === 'yarnPlay';
    const passed = Object.values(results).every(Boolean);
    console.log('STAGE7B_SMOKE_RESULT', JSON.stringify({ passed, ...results }));
    return passed;
  } finally {
    controls.applySettings(original);
  }
}

module.exports = { runStage7BSmoke };
