'use strict';

const fs = require('node:fs');
const path = require('node:path');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (window) => window.webContents.executeJavaScript('window.__petTest.snapshot()');
const setIdle = (window, seconds, generation = 0) => window.webContents.executeJavaScript(
  `window.__petTest.setSystemIdle(${seconds}, ${generation})`
);

async function runStage5Smoke(window, settings) {
  const output = path.join(__dirname, '..', '..', 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const size = window.getBounds();
  const initial = await snapshot(window);

  await setIdle(window, settings.activity.lightAfterSeconds);
  const light = await snapshot(window);
  await delay(1900);
  const lightAction = await snapshot(window);

  await setIdle(window, 0, 1);
  const resetAfterLight = await snapshot(window);
  await setIdle(window, settings.activity.walkAfterSeconds, 1);
  const roam = await snapshot(window);
  await delay(3800);
  const walking = await snapshot(window);

  await setIdle(window, settings.activity.sleepAfterSeconds, 1);
  const sleep = await snapshot(window);
  await delay(350);
  fs.writeFileSync(path.join(output, 'stage5-sleep.png'), (await window.webContents.capturePage()).toPNG());
  await setIdle(window, 0, 2);
  await delay(350);
  const wake = await snapshot(window);
  fs.writeFileSync(path.join(output, 'stage5-wake.png'), (await window.webContents.capturePage()).toPNG());
  const finalSize = window.getBounds();

  const passed = initial.activityTier === 'active' && initial.state === 'idle'
    && light.activityTier === 'light' && light.state === 'idle'
    && ['wave', 'read', 'headphones'].includes(lightAction.state)
    && resetAfterLight.activityTier === 'active' && resetAfterLight.state === 'idle'
    && roam.activityTier === 'roam' && walking.state === 'walk'
    && sleep.activityTier === 'sleep' && sleep.state === 'sleep'
    && wake.activityTier === 'active' && wake.state === 'idle'
    && Math.abs(size.width - finalSize.width) <= 1
    && Math.abs(size.height - finalSize.height) <= 1;
  console.log('STAGE5_SMOKE_RESULT', JSON.stringify({ passed, states: {
    initial: initial.state, light: lightAction.state, afterActivity: resetAfterLight.state,
    roam: walking.state, sleep: sleep.state, wake: wake.state
  }, tiers: [initial.activityTier, light.activityTier, roam.activityTier, sleep.activityTier, wake.activityTier],
  size: { before: size, after: finalSize } }));
  return passed;
}

module.exports = { runStage5Smoke };
