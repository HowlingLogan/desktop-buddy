'use strict';

const fs = require('node:fs');
const path = require('node:path');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function snapshot(window) {
  return window.webContents.executeJavaScript('window.__petTest.snapshot()');
}

async function clickCat(window) {
  const input = { x: Math.floor(window.getBounds().width / 2), y: Math.floor(window.getBounds().height / 2), button: 'left', clickCount: 1 };
  window.webContents.sendInputEvent({ type: 'mouseDown', ...input });
  window.webContents.sendInputEvent({ type: 'mouseUp', ...input });
  await delay(100);
}

async function capture(window, directory, name) {
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(directory, name), image.toPNG());
}

async function runStage4Smoke(window, pet, settings, moveDragTo) {
  const directory = path.join(__dirname, '..', '..', 'test-output');
  fs.mkdirSync(directory, { recursive: true });
  const initialBounds = window.getBounds();

  await clickCat(window);
  const happy = await snapshot(window);
  await capture(window, directory, 'stage4-happy.png');
  await clickCat(window);
  const rapidClick = await snapshot(window);
  await delay(pet.happy.durationMs + 150);
  const afterHappy = await snapshot(window);
  await clickCat(window);
  const cooldownClick = await snapshot(window);

  const waveStarted = await window.webContents.executeJavaScript('window.__petTest.triggerWave()');
  await delay(100);
  const wave = await snapshot(window);
  await capture(window, directory, 'stage4-wave.png');
  await delay(pet.wave.durationMs + 150);

  await window.webContents.executeJavaScript(`window.__petTest.setSystemIdle(${settings.activity.walkAfterSeconds}, 0)`);
  const dragStarted = await window.webContents.executeJavaScript('window.__petTest.beginDrag()');
  moveDragTo({ x: -10000, y: -10000 });
  const upperLeft = window.getBounds();
  moveDragTo({ x: 10000, y: 10000 });
  const lowerRight = window.getBounds();
  const dragBefore = window.getBounds();
  await delay(pet.walk.startAfterMs + 500);
  const duringDrag = await snapshot(window);
  const dragAfter = window.getBounds();
  const releasedDesktop = await window.webContents.executeJavaScript('window.__petTest.endDrag()');
  const afterDrag = await snapshot(window);
  const releasedCapture = await window.webContents.capturePage();
  const pixels = releasedCapture.toBitmap();
  const releasedWidth = releasedCapture.getSize().width;
  const releasedHeight = releasedCapture.getSize().height;
  let bottomVisibleX = -1;
  for (let x = 0; x < releasedWidth; x += 1) {
    if (pixels[((releasedHeight - 1) * releasedWidth + x) * 4 + 3] > 16) {
      bottomVisibleX = x;
      break;
    }
  }
  const bottomPawIsInteractive = bottomVisibleX >= 0 && await window.webContents.executeJavaScript(
    `Boolean(document.elementFromPoint(${Math.floor(bottomVisibleX * initialBounds.width / releasedWidth)},
      ${Math.floor((releasedHeight - 1) * initialBounds.height / releasedHeight)})?.closest('#pet-art'))`
  );
  const windowEndsAtTaskbar = lowerRight.y + lowerRight.height
    === releasedDesktop.workArea.y + releasedDesktop.workArea.height;

  const passed = happy.state === 'happy' && happy.effectText === pet.effects.happy.text
    && rapidClick.state === 'happy'
    && afterHappy.state === 'idle' && cooldownClick.state === 'idle'
    && waveStarted && wave.state === 'wave' && wave.effectText === pet.effects.wave.text
    && dragStarted && duringDrag.state === 'dragged'
    && dragBefore.x === dragAfter.x && dragBefore.y === dragAfter.y
    && afterDrag.state === 'idle'
    && upperLeft.x === releasedDesktop.minX && upperLeft.y === releasedDesktop.minY
    && lowerRight.x === releasedDesktop.maxX && lowerRight.y === releasedDesktop.maxY
    && bottomPawIsInteractive && windowEndsAtTaskbar
    && releasedDesktop.x >= releasedDesktop.minX && releasedDesktop.x <= releasedDesktop.maxX
    && releasedDesktop.y >= releasedDesktop.minY && releasedDesktop.y <= releasedDesktop.maxY
    && initialBounds.width === dragAfter.width && initialBounds.height === dragAfter.height;

  console.log('STAGE4_SMOKE_RESULT', JSON.stringify({
    passed,
    happy: { state: happy.state, effect: happy.effectText },
    rapidClick: rapidClick.state,
    afterHappy: afterHappy.state,
    cooldownClick: cooldownClick.state,
    wave: { state: wave.state, effect: wave.effectText },
    drag: { started: dragStarted, state: duringDrag.state, boundsStable: dragBefore.x === dragAfter.x && dragBefore.y === dragAfter.y, upperLeft, lowerRight, afterRelease: afterDrag.state, bottomPawIsInteractive, windowEndsAtTaskbar },
    releasedDesktop,
    windowSize: { width: initialBounds.width, height: initialBounds.height },
    configuredSize: settings.petSize
  }));
  return passed;
}

module.exports = { runStage4Smoke };
