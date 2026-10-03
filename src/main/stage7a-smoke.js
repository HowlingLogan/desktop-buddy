'use strict';

const fs = require('node:fs');
const path = require('node:path');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (window) => window.webContents.executeJavaScript('window.__petTest.snapshot()');

async function waitFor(check, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(75);
  }
  throw new Error('Timed out waiting for Stage 7A play state.');
}

async function runStage7ASmoke(window, controls, settings) {
  const original = structuredClone(settings);
  const output = path.resolve(__dirname, '..', '..', 'test-output');
  const results = {};
  try {
    controls.applySettings({ play: { durationSeconds: 5, batIntervalMs: 650, ballTravelPx: 90, easeMs: 420 } });
    await delay(100);
    const boundsBefore = window.getBounds();
    const priorMenuCount = controls.state().menuOpenCount;
    const rightClick = { x: Math.floor(boundsBefore.width / 2), y: Math.floor(boundsBefore.height / 2), button: 'right' };
    window.webContents.sendInputEvent({ type: 'mouseDown', ...rightClick });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...rightClick });
    await waitFor(() => controls.state().menuOpenCount > priorMenuCount, 2500);
    const menu = controls.getMenu();
    results.menu = menu.getMenuItemById('play')?.enabled === true;
    controls.closeMenu();
    menu.getMenuItemById('play').click();
    await waitFor(async () => (await snapshot(window)).state === 'yarnPlay');
    const separate = await window.webContents.executeJavaScript(`({
      ballParent: document.getElementById('yarn-ball').parentElement.id,
      ballSrc: decodeURIComponent(document.getElementById('yarn-ball').src),
      catSources: [...document.querySelectorAll('#play-frames img')].map((image) => decodeURIComponent(image.src)),
      playing: document.getElementById('pet-art').classList.contains('playing')
    })`);
    results.separate = separate.ballParent === 'pet-stage'
      && separate.ballSrc.endsWith('/Yarn Ball.png')
      && separate.catSources[0].endsWith('/Play Left Cat.png')
      && separate.catSources[1].endsWith('/Play Right Cat.png')
      && separate.playing;

    const samples = [];
    let leftCaptured = false;
    let rightCaptured = false;
    for (let index = 0; index < 44; index += 1) {
      const current = (await snapshot(window)).play;
      samples.push(current);
      if (current.motionProgress === 1 && current.frameIndex === 1 && !rightCaptured) {
        fs.writeFileSync(path.join(output, 'stage7a-right.png'), (await window.webContents.capturePage()).toPNG());
        rightCaptured = true;
      }
      if (current.motionProgress === 1 && current.frameIndex === 0 && current.batCount >= 2 && !leftCaptured) {
        fs.writeFileSync(path.join(output, 'stage7a-left.png'), (await window.webContents.capturePage()).toPNG());
        leftCaptured = true;
      }
      await delay(45);
    }
    const width = boundsBefore.width;
    const xValues = samples.map((entry) => entry.ballX);
    const deltas = xValues.slice(1).map((x, index) => x - xValues[index]);
    results.frames = samples.some((entry) => entry.frameIndex === 0)
      && samples.some((entry) => entry.frameIndex === 1)
      && Math.max(...samples.map((entry) => entry.batCount)) >= 2 && leftCaptured && rightCaptured;
    results.ballMovement = deltas.some((delta) => delta > 0.5)
      && deltas.some((delta) => delta < -0.5)
      && Math.max(...deltas.map(Math.abs)) < 45
      && samples.every((entry) => entry.ballX >= 0 && entry.ballX + entry.ballWidth <= width + 0.5)
      && JSON.stringify(window.getBounds()) === JSON.stringify(boundsBefore);
    const contactSamples = samples.filter((entry) => entry.motionProgress === 1);
    results.pawAlignment = contactSamples.length > 0 && contactSamples.every((entry) => {
      const target = entry.slots[entry.frameIndex];
      return Math.hypot(entry.bodyCenterX - target.contactX, entry.bodyCenterY - target.contactY) < 1;
    });
    results.poseTiming = samples.every((entry, index) => index === 0
      || entry.frameIndex === samples[index - 1].frameIndex || entry.motionProgress === 1);
    results.unflipped = await window.webContents.executeJavaScript(`(() => {
      const art = document.getElementById('pet-art');
      return getComputedStyle(art).transform === 'none'
        && [...document.querySelectorAll('#play-frames img')]
          .every((image) => getComputedStyle(image).transform === 'none');
    })()`);
    console.log('STAGE7A_VISUAL_CONTACTS', JSON.stringify(samples[0].slots));

    await window.webContents.executeJavaScript(`window.__petTest.setSystemIdle(${settings.activity.sleepAfterSeconds}, 0)`);
    const duringAfk = await snapshot(window);
    await window.webContents.executeJavaScript('window.__petTest.setSystemIdle(0, 1)');
    results.afkHeld = duringAfk.state === 'yarnPlay' && (await snapshot(window)).state === 'yarnPlay';

    controls.setPaused(true);
    await delay(100);
    const held = await snapshot(window);
    await delay(850);
    const heldLater = await snapshot(window);
    results.pause = held.state === 'yarnPlay' && held.paused && held.play.paused
      && Math.abs(held.play.ballX - heldLater.play.ballX) < 0.01
      && held.play.batCount === heldLater.play.batCount;
    controls.setPaused(false);
    const resumed = await waitFor(async () => {
      const current = await snapshot(window);
      return current.play.ballX !== held.play.ballX && !current.play.paused ? current : null;
    }, 2200);
    results.resume = resumed.state === 'yarnPlay';

    const after = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'idle' && !current.play.visible ? current : null;
    }, 6500);
    results.cleanup = after.state === 'idle' && !after.play.active && !after.play.visible;

    await window.webContents.executeJavaScript(`window.__petTest.setSystemIdle(${settings.activity.walkAfterSeconds}, 0)`);
    const walking = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'walk' ? current : null;
    }, 12000);
    await window.webContents.executeJavaScript('window.__petTest.setSystemIdle(0, 1)');
    const backToIdle = await waitFor(async () => {
      const current = await snapshot(window);
      return current.state === 'idle' ? current : null;
    });
    results.ambientRestored = walking.state === 'walk' && backToIdle.state === 'idle';

    const sizedContacts = [];
    for (const size of [160, 320]) {
      controls.setPetSize(size);
      await delay(120);
      menu.getMenuItemById('play').click();
      const contact = await waitFor(async () => {
        const current = await snapshot(window);
        return current.state === 'yarnPlay' && current.play.motionProgress === 1 ? current.play : null;
      });
      const target = contact.slots[contact.frameIndex];
      sizedContacts.push(Math.hypot(contact.bodyCenterX - target.contactX,
        contact.bodyCenterY - target.contactY) < 1 && Math.abs(contact.ballWidth - 96 * size / 240) < 1);
      await window.webContents.executeJavaScript('window.__petTest.endYarnPlay()');
      await waitFor(async () => (await snapshot(window)).state === 'idle');
    }
    results.sizeAnchors = sizedContacts.every(Boolean);
    controls.setPetSize(original.petSize);

    menu.getMenuItemById('play').click();
    await waitFor(async () => (await snapshot(window)).state === 'yarnPlay');
    const passed = Object.values(results).every(Boolean);
    console.log('STAGE7A_SMOKE_RESULT', JSON.stringify({ passed, ...results }));
    return passed;
  } finally {
    controls.applySettings(original);
  }
}

module.exports = { runStage7ASmoke };
