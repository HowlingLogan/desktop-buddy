'use strict';

const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { loadSettings, loadPet } = require('./settings');
const { runStage4Smoke } = require('./stage4-smoke');
const { ActivityMonitor } = require('./activity-monitor');
const { runStage5Smoke } = require('./stage5-smoke');
const { createControls } = require('./controls');
const { runStage6Smoke } = require('./stage6-smoke');
const { runStage6ResetSmoke, runStage6DefaultsSmoke } = require('./stage6-reset-smoke');
const { runStage7ASmoke } = require('./stage7a-smoke');
const { runStage7BSmoke } = require('./stage7b-smoke');
const { BallWindowManager } = require('./ball-window');
const { runStage7CSmoke } = require('./stage7c-smoke');
const { runStage7DSmoke } = require('./stage7d-smoke');
const { runStage7ESmoke } = require('./stage7e-smoke');
const { runStage7FSmoke } = require('./stage7f-smoke');

let petWindow;

// Development launches share one Electron profile even if a command supplies a
// different --user-data-dir. Electron's single-instance lock is profile-scoped.
if (!app.isPackaged) {
  const runtimeDirectory = path.join(__dirname, '..', '..', 'runtime');
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  app.setPath('userData', runtimeDirectory);
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  console.log('Desktop Buddy is already running; keeping the existing pet window.');
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.showInactive();
      petWindow.moveTop();
    }
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function windowBounds(display, settings) {
  const { workArea } = display;
  const padding = settings.windowPadding;
  const width = Math.min(workArea.width, settings.petSize + padding.left + padding.right);
  const height = Math.min(workArea.height, settings.petSize + padding.top + padding.bottom);
  return {
    x: workArea.x + Math.max(0, workArea.width - width - settings.edgeMargin),
    y: workArea.y + Math.max(0, workArea.height - height),
    width,
    height
  };
}

function desktopRange(bounds, display, settings, preferredY = null) {
  const { workArea } = display;
  const farthestX = workArea.x + workArea.width - bounds.width;
  const minX = Math.min(workArea.x + settings.edgeMargin, farthestX);
  const maxX = Math.max(minX, farthestX - settings.edgeMargin);
  const maxY = workArea.y + workArea.height - bounds.height;
  const minY = Math.min(workArea.y + settings.edgeMargin, maxY);
  return {
    minX,
    maxX,
    minY,
    maxY,
    y: preferredY === null ? maxY : clamp(preferredY, minY, maxY),
    workArea
  };
}

async function waitForPet(webContents, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot;
  while (Date.now() < deadline) {
    lastSnapshot = await webContents.executeJavaScript('window.__petTest.snapshot()');
    if (predicate(lastSnapshot)) return lastSnapshot;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for a pet animation state: ${JSON.stringify(lastSnapshot)}`);
}

function createPetWindow(settings, pet) {
  const deterministicSmoke = process.argv.includes('--smoke-test') || process.argv.includes('--stage4-smoke-test')
    || process.argv.includes('--stage5-smoke-test') || process.argv.includes('--stage6-smoke-test')
    || process.argv.includes('--stage6-reset-smoke-test') || process.argv.includes('--stage6-defaults-smoke-test')
    || process.argv.includes('--stage7a-smoke-test') || process.argv.includes('--stage7b-smoke-test')
    || process.argv.includes('--stage7c-smoke-test') || process.argv.includes('--stage7d-smoke-test')
    || process.argv.includes('--stage7e-smoke-test') || process.argv.includes('--stage7f-smoke-test');
  petWindow = new BrowserWindow({
    ...windowBounds(screen.getPrimaryDisplay(), settings),
    title: 'Desktop Buddy',
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
    opacity: 0.01,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  let restY = petWindow.getBounds().y;
  let lastWorkArea = screen.getPrimaryDisplay().workArea;
  let dragging = false;
  let dragAnchor = null;

  petWindow.removeMenu();
  petWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  petWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  petWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Pet renderer stopped:', details.reason);
  });

  const petContents = petWindow.webContents;
  const ballWindow = new BallWindowManager({
    petWindow,
    assetUrl: pet.play?.ballUrl,
    config: settings.play,
    onGrab: (bounds) => {
      if (!petContents.isDestroyed()) petContents.send('pet:ball-grabbed', { ballBounds: bounds, petBounds: petWindow.getBounds() });
    },
    onRelease: (info) => {
      if (!petContents.isDestroyed()) petContents.send('pet:ball-released', info);
    },
    onMotion: (info) => {
      if (!petContents.isDestroyed()) petContents.send('pet:ball-motion', info);
    }
  });
  const activityMonitor = new ActivityMonitor(petContents, settings.activity.pollMs);
  let controls;
  ipcMain.handle('pet:get-initial', (event) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petContents) {
      throw new Error('Invalid pet window.');
    }
    return {
      pet,
      settings,
      systemIdle: deterministicSmoke ? { seconds: 0, generation: 0 } : activityMonitor.sample(),
      desktop: { x: petWindow.getBounds().x, ...desktopRange(petWindow.getBounds(), screen.getPrimaryDisplay(), settings, restY) },
      smokeTest: process.argv.includes('--smoke-test') || process.argv.includes('--stage4-smoke-test')
        || process.argv.includes('--stage5-smoke-test') || process.argv.includes('--stage6-smoke-test')
        || process.argv.includes('--stage6-reset-smoke-test') || process.argv.includes('--stage6-defaults-smoke-test')
        || process.argv.includes('--stage7a-smoke-test')
        || process.argv.includes('--stage7b-smoke-test')
        || process.argv.includes('--stage7c-smoke-test')
        || process.argv.includes('--stage7d-smoke-test')
        || process.argv.includes('--stage7e-smoke-test')
        || process.argv.includes('--stage7f-smoke-test')
        || process.argv.includes('--stage5-system-test')
    };
  });
  const onHorizontalPosition = (event, x) => {
    if (!petWindow || petWindow.isDestroyed() || dragging || event.sender !== petContents || !Number.isFinite(x)) return;
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2 });
    const fixed = windowBounds(display, settings);
    const range = desktopRange(fixed, display, settings, restY);
    const targetX = Math.round(clamp(x, range.minX, range.maxX));
    if (targetX !== bounds.x || range.y !== bounds.y
      || bounds.width !== fixed.width || bounds.height !== fixed.height) {
      petWindow.setBounds({ x: targetX, y: range.y, width: fixed.width, height: fixed.height });
    }
  };
  ipcMain.on('pet:set-horizontal-position', onHorizontalPosition);
  const validPet = (event) => petWindow && !petWindow.isDestroyed() && event.sender === petContents;
  const onLocalBallFrame = (event, frame) => {
    if (validPet(event)) ballWindow.updateLocalFrame(frame);
  };
  ipcMain.on('pet:ball-local-frame', onLocalBallFrame);
  ipcMain.handle('pet:ball-handoff-ready', async (event) => {
    if (!validPet(event)) throw new Error('Invalid pet window.');
    return ballWindow.showExternal();
  });
  ipcMain.handle('pet:ball-reattach', async (event) => {
    if (!validPet(event)) throw new Error('Invalid pet window.');
    return ballWindow.hideExternal();
  });
  const onMoveExternalBall = (event, position) => {
    if (validPet(event)) ballWindow.moveExternal(position);
  };
  ipcMain.on('pet:ball-move-external', onMoveExternalBall);
  const onHideBallWindow = (event) => {
    if (validPet(event)) ballWindow.close();
  };
  ipcMain.on('pet:hide-ball-window', onHideBallWindow);
  const onStopBallPhysics = (event) => {
    if (validPet(event)) ballWindow.stopPhysics();
  };
  ipcMain.on('pet:stop-ball-physics', onStopBallPhysics);
  const onChasePosition = (event, position) => {
    if (!validPet(event) || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const previous = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: position.x + previous.width / 2,
      y: position.y + previous.height / 2 });
    const work = display.workArea;
    const fixed = windowBounds(display, settings);
    const x = Math.round(clamp(position.x, work.x, work.x + work.width - fixed.width));
    const y = Math.round(clamp(position.y, work.y, work.y + work.height - fixed.height));
    if (x !== previous.x || y !== previous.y || fixed.width !== previous.width
      || fixed.height !== previous.height) {
      petWindow.setBounds({ x, y, width: fixed.width, height: fixed.height });
    }
    restY = y;
  };
  ipcMain.on('pet:set-chase-position', onChasePosition);
  ipcMain.handle('pet:get-ball-state', (event) => {
    if (!validPet(event)) throw new Error('Invalid pet window.');
    return ballWindow.snapshot;
  });
  ipcMain.handle('pet:get-desktop', (event) => {
    if (!validPet(event)) throw new Error('Invalid pet window.');
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2 });
    return { x: bounds.x, ...desktopRange(bounds, display, settings, restY) };
  });
  const onBeginDrag = (event, anchor) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petContents) return;
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
    const bounds = petWindow.getBounds();
    dragAnchor = {
      x: clamp(anchor.x, 0, bounds.width),
      y: clamp(anchor.y, 0, bounds.height)
    };
    dragging = true;
  };
  const moveDragTo = (cursor) => {
    if (!petWindow || petWindow.isDestroyed() || !dragging || !dragAnchor) return;
    const bounds = petWindow.getBounds();
    const range = desktopRange(bounds, screen.getPrimaryDisplay(), settings, restY);
    const x = Math.round(clamp(cursor.x - dragAnchor.x, range.minX, range.maxX));
    const y = Math.round(clamp(cursor.y - dragAnchor.y, range.minY, range.maxY));
    if (x !== bounds.x || y !== bounds.y) petWindow.setPosition(x, y);
    restY = y;
  };
  const onDragMove = (event) => {
    if (event.sender === petContents) moveDragTo(screen.getCursorScreenPoint());
  };
  ipcMain.on('pet:begin-drag', onBeginDrag);
  ipcMain.on('pet:drag-move', onDragMove);
  ipcMain.handle('pet:end-drag', (event) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petContents) {
      throw new Error('Invalid pet window.');
    }
    dragging = false;
    dragAnchor = null;
    const bounds = petWindow.getBounds();
    return { x: bounds.x, ...desktopRange(bounds, screen.getPrimaryDisplay(), settings, restY) };
  });
  const applySettings = (updated) => {
    if (petWindow.isDestroyed()) return;
    const previous = petWindow.getBounds();
    const previousBottom = previous.y + previous.height;
    const layoutChanged = updated.petSize !== settings.petSize
      || JSON.stringify(updated.windowPadding) !== JSON.stringify(settings.windowPadding);
    const desktopChanged = layoutChanged || updated.edgeMargin !== settings.edgeMargin;
    Object.assign(settings, updated);
    ballWindow.updateConfig(settings.play);
    activityMonitor.setPollMs(settings.activity.pollMs);
    const display = screen.getPrimaryDisplay();
    const target = windowBounds(display, settings);
    const range = desktopRange(target, display, settings);
    target.x = clamp(previous.x, range.minX, range.maxX);
    target.y = clamp(previousBottom - target.height, range.minY, range.maxY);
    restY = target.y;
    if (target.x !== previous.x || target.y !== previous.y
      || target.width !== previous.width || target.height !== previous.height) {
      petWindow.setBounds(target);
    }
    petContents.send('pet:settings-updated', {
      settings,
      desktop: desktopChanged ? { x: target.x, ...desktopRange(target, display, settings, restY) } : null
    });
  };
  const resetPosition = () => {
    if (petWindow.isDestroyed()) return;
    dragging = false;
    dragAnchor = null;
    const display = screen.getPrimaryDisplay();
    const bounds = windowBounds(display, settings);
    restY = bounds.y;
    petWindow.setBounds(bounds);
    petContents.send('pet:work-area-changed', {
      x: bounds.x,
      ...desktopRange(bounds, display, settings, restY)
    });
    petContents.send('pet:reset-position');
  };
  const resetDialogTest = { answers: [], calls: [] };
  controls = createControls({
    app, petWindow, settings, onSettingsApplied: applySettings, onResetPosition: resetPosition,
    onPauseChanged: (paused) => ballWindow.setPaused(paused),
    onStartPlay: () => petContents.send('pet:start-yarn-play'), playAvailable: Boolean(pet.play),
    confirmReset: process.argv.includes('--stage6-reset-smoke-test')
      ? async (parent, options) => {
        resetDialogTest.calls.push({ parent, options });
        return { response: resetDialogTest.answers.shift() ?? 1 };
      }
      : process.argv.includes('--stage7f-smoke-test')
        ? async () => ({ response: 0 })
      : undefined
  });
  const onShowContextMenu = (event) => {
    if (event.sender === petContents) controls.showContextMenu();
  };
  ipcMain.on('pet:show-context-menu', onShowContextMenu);
  petWindow.webContents.once('did-finish-load', async () => {
    try {
      const result = await petWindow.webContents.executeJavaScript('window.__petReady');
      petWindow.showInactive();
      petWindow.setBounds(windowBounds(screen.getPrimaryDisplay(), settings));
      await petWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      petWindow.setOpacity(1);
      if (!deterministicSmoke) activityMonitor.start();
      if (process.argv.includes('--stage5-system-test')) {
        let lastProbeState = '';
        const probeTimer = setInterval(async () => {
          if (petContents.isDestroyed()) return;
          try {
            const snapshot = await petContents.executeJavaScript('window.__petTest.snapshot()');
            const key = `${snapshot.activityTier}:${snapshot.state}`;
            if (key !== lastProbeState) {
              console.log('SYSTEM_PET_STATE', JSON.stringify({ tier: snapshot.activityTier, state: snapshot.state, idleSeconds: snapshot.idleSeconds }));
              lastProbeState = key;
            }
          } catch (error) {
            console.warn('Activity probe snapshot failed:', error.message);
          }
        }, 500);
        petWindow.once('closed', () => clearInterval(probeTimer));
      }

      if (process.argv.includes('--stage6-smoke-test')) {
        const passed = await runStage6Smoke(petWindow, settings, controls, moveDragTo, resetPosition);
        if (passed) {
          controls.getMenu().getMenuItemById('quit').click();
          setTimeout(() => app.exit(1), 3000).unref();
        } else {
          petWindow.destroy();
          app.exit(1);
        }
        return;
      }

      if (process.argv.includes('--stage6-reset-smoke-test')) {
        const passed = await runStage6ResetSmoke(app, petWindow, settings, controls, resetDialogTest);
        app.exit(passed ? 0 : 1);
        return;
      }

      if (process.argv.includes('--stage6-defaults-smoke-test')) {
        const passed = await runStage6DefaultsSmoke(app, petWindow, settings, controls);
        app.exit(passed ? 0 : 1);
        return;
      }

      if (process.argv.includes('--stage7a-smoke-test')) {
        const passed = await runStage7ASmoke(petWindow, controls, settings);
        if (passed) {
          controls.getMenu().getMenuItemById('quit').click();
          setTimeout(() => app.exit(1), 3000).unref();
        } else app.exit(1);
        return;
      }

      if (process.argv.includes('--stage7b-smoke-test')) {
        const passed = await runStage7BSmoke(petWindow, controls, settings, pet);
        if (passed) {
          controls.getMenu().getMenuItemById('quit').click();
          setTimeout(() => app.exit(1), 3000).unref();
        } else app.exit(1);
        return;
      }

      if (process.argv.includes('--stage7c-smoke-test')) {
        const passed = await runStage7CSmoke(petWindow, controls, settings, ballWindow);
        app.exit(passed ? 0 : 1);
        return;
      }

      if (process.argv.includes('--stage7d-smoke-test')) {
        const passed = await runStage7DSmoke(petWindow, controls, settings, ballWindow);
        app.exit(passed ? 0 : 1);
        return;
      }

      if (process.argv.includes('--stage7e-smoke-test')) {
        const passed = await runStage7ESmoke(petWindow, controls, settings, ballWindow);
        app.exit(passed ? 0 : 1);
        return;
      }

      if (process.argv.includes('--stage7f-smoke-test')) {
        const passed = await runStage7FSmoke(petWindow, controls, settings, ballWindow, resetPosition);
        if (passed) {
          app.once('will-quit', (event) => {
            const helperClosed = !ballWindow.snapshot.exists;
            console.log('STAGE7F_QUIT_RESULT', JSON.stringify({ passed: helperClosed,
              helperClosed }));
            if (!helperClosed) {
              event.preventDefault();
              app.exit(1);
            }
          });
          controls.showContextMenu();
          controls.closeMenu();
          controls.getMenu().getMenuItemById('quit').click();
          setTimeout(() => app.exit(1), 3000).unref();
        } else app.exit(1);
        return;
      }

      if (process.argv.includes('--stage5-smoke-test')) {
        const passed = await runStage5Smoke(petWindow, settings);
        petWindow.destroy();
        app.exit(passed ? 0 : 1);
        return;
      }

      if (process.argv.includes('--stage4-smoke-test')) {
        const passed = await runStage4Smoke(petWindow, pet, settings, moveDragTo);
        petWindow.destroy();
        app.exit(passed ? 0 : 1);
        return;
      }

      if (process.argv.includes('--smoke-test')) {
        const outputDirectory = path.join(__dirname, '..', '..', 'test-output');
        fs.mkdirSync(outputDirectory, { recursive: true });
        const initialBounds = petWindow.getBounds();
        let idlePainted = false;
        try {
          const capture = await petWindow.webContents.capturePage();
          fs.writeFileSync(path.join(outputDirectory, 'stage2-idle.png'), capture.toPNG());
          const pixels = capture.toBitmap();
          const centerIndex = (Math.floor(capture.getSize().height / 2) * capture.getSize().width
            + Math.floor(capture.getSize().width / 2)) * 4 + 3;
          idlePainted = pixels[centerIndex] > 100;
        } catch (error) {
          console.warn('Window capture unavailable:', error.message);
        }
        let blinkResult = { tested: false };
        if (pet.blink) {
          await petWindow.webContents.executeJavaScript('window.__petTest.triggerBlink(); true');
          await new Promise((resolve) => setTimeout(resolve, pet.blink.closeMs + Math.floor(pet.blink.holdMs / 2)));
          const midBlink = await petWindow.webContents.executeJavaScript('window.__petTest.snapshot()');
          try {
            const capture = await petWindow.webContents.capturePage();
            fs.writeFileSync(path.join(outputDirectory, 'stage2-blink.png'), capture.toPNG());
          } catch (error) {
            console.warn('Blink capture unavailable:', error.message);
          }
          await new Promise((resolve) => setTimeout(resolve, pet.blink.holdMs + pet.blink.openMs + 100));
          const afterBlink = await petWindow.webContents.executeJavaScript('window.__petTest.snapshot()');
          blinkResult = {
            tested: true,
            midBlink,
            afterBlink,
            passed: midBlink.state === 'blink' && midBlink.closedOpacity > 0.9
              && afterBlink.state === 'idle' && afterBlink.closedOpacity < 0.1
          };
        }
        const boundsStable = JSON.stringify(initialBounds) === JSON.stringify(petWindow.getBounds());
        await petWindow.webContents.executeJavaScript(
          `window.__petTest.setSystemIdle(${settings.activity.walkAfterSeconds}, 0)`
        );
        let walkResult = { tested: false, passed: true };
        if (pet.walk) {
          const left = await waitForPet(
            petWindow.webContents,
            (snapshot) => snapshot.state === 'walk' && snapshot.walk.direction === -1 && snapshot.walk.frameChanges >= 2,
            pet.walk.startAfterMs + 5000
          );
          const leftBounds = petWindow.getBounds();
          fs.writeFileSync(
            path.join(outputDirectory, 'stage3-left.png'),
            (await petWindow.webContents.capturePage()).toPNG()
          );
          await new Promise((resolve) => setTimeout(resolve, 700));
          const leftLater = await petWindow.webContents.executeJavaScript('window.__petTest.snapshot()');
          const turned = await waitForPet(
            petWindow.webContents,
            (snapshot) => snapshot.state === 'walk' && snapshot.walk.direction === 1 && snapshot.walk.traversals >= 1,
            25000
          );
          await new Promise((resolve) => setTimeout(resolve, 700));
          const rightLater = await petWindow.webContents.executeJavaScript('window.__petTest.snapshot()');
          const rightBounds = petWindow.getBounds();
          fs.writeFileSync(
            path.join(outputDirectory, 'stage3-right.png'),
            (await petWindow.webContents.capturePage()).toPNG()
          );
          const range = desktopRange(rightBounds, screen.getPrimaryDisplay(), settings);
          walkResult = {
            tested: true,
            leftX: [left.walk.x, leftLater.walk.x],
            rightX: [turned.walk.x, rightLater.walk.x],
            frameChanges: [left.walk.frameChanges, leftLater.walk.frameChanges],
            flippedLeft: left.flipped,
            flippedRight: rightLater.flipped,
            bounds: { left: leftBounds, right: rightBounds },
            passed: left.flipped && !rightLater.flipped
              && leftLater.walk.x < left.walk.x - 20
              && leftLater.walk.frameChanges > left.walk.frameChanges
              && rightLater.walk.x > turned.walk.x + 20
              && Math.abs(leftBounds.width - initialBounds.width) <= 1
              && Math.abs(leftBounds.height - initialBounds.height) <= 1
              && Math.abs(rightBounds.width - initialBounds.width) <= 1
              && Math.abs(rightBounds.height - initialBounds.height) <= 1
              && leftBounds.y === initialBounds.y && rightBounds.y === initialBounds.y
              && leftBounds.x >= range.minX && leftBounds.x <= range.maxX
              && rightBounds.x >= range.minX && rightBounds.x <= range.maxX
          };
        }
        const passed = result.loaded && idlePainted && (!pet.blink || blinkResult.passed)
          && boundsStable && walkResult.passed;
        console.log('SMOKE_TEST_RESULT', JSON.stringify({ ...result, idlePainted, blinkResult, boundsStable, walkResult }));
        petWindow.destroy();
        app.exit(passed ? 0 : 1);
      }
    } catch (error) {
      console.error('Pet startup failed:', error);
      if (deterministicSmoke) app.exit(1);
      else {
        dialog.showErrorBox('Desktop Buddy could not display the cat', error.message);
        app.quit();
      }
    }
  });

  petWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  const reposition = () => {
    if (petWindow && !petWindow.isDestroyed()) {
      const previous = petWindow.getBounds();
      const display = screen.getPrimaryDisplay();
      const wasAtBaseline = Math.abs(previous.y + previous.height - (lastWorkArea.y + lastWorkArea.height)) <= 1;
      const updated = windowBounds(display, settings);
      const range = desktopRange(updated, display, settings, restY);
      updated.x = clamp(previous.x, range.minX, range.maxX);
      updated.y = wasAtBaseline && !dragging ? range.maxY : clamp(previous.y, range.minY, range.maxY);
      restY = updated.y;
      lastWorkArea = display.workArea;
      petWindow.setBounds(updated);
      petWindow.webContents.send('pet:work-area-changed', {
        x: updated.x,
        ...range
      });
    }
  };
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  petWindow.once('closed', () => {
    activityMonitor.stop();
    ipcMain.removeListener('pet:set-horizontal-position', onHorizontalPosition);
    ipcMain.removeListener('pet:ball-local-frame', onLocalBallFrame);
    ipcMain.removeListener('pet:ball-move-external', onMoveExternalBall);
    ipcMain.removeListener('pet:hide-ball-window', onHideBallWindow);
    ipcMain.removeListener('pet:stop-ball-physics', onStopBallPhysics);
    ipcMain.removeListener('pet:set-chase-position', onChasePosition);
    ipcMain.removeHandler('pet:ball-handoff-ready');
    ipcMain.removeHandler('pet:ball-reattach');
    ipcMain.removeHandler('pet:get-ball-state');
    ipcMain.removeHandler('pet:get-desktop');
    ballWindow.dispose();
    ipcMain.removeListener('pet:begin-drag', onBeginDrag);
    ipcMain.removeListener('pet:drag-move', onDragMove);
    ipcMain.removeListener('pet:show-context-menu', onShowContextMenu);
    ipcMain.removeHandler('pet:get-initial');
    ipcMain.removeHandler('pet:end-drag');
    screen.removeListener('display-metrics-changed', reposition);
    screen.removeListener('display-added', reposition);
    screen.removeListener('display-removed', reposition);
    controls.dispose();
    petWindow = null;
  });
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  try {
    const settings = loadSettings();
    if (process.argv.includes('--stage5-system-test')) {
      settings.activity = { ...settings.activity, lightAfterSeconds: 3, walkAfterSeconds: 7, sleepAfterSeconds: 25 };
    }
    const pet = loadPet(settings);
    createPetWindow(settings, pet);
    if (process.argv.includes('--stage5-system-test')) {
      const testWindow = new BrowserWindow({
        title: 'Desktop Buddy Activity Test',
        width: 480,
        height: 360,
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      testWindow.loadFile(path.join(__dirname, 'activity-test.html'));
    }
  } catch (error) {
    dialog.showErrorBox('Desktop Buddy could not start', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
