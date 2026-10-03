'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { screen } = require('electron');
const { defaultSettings } = require('./settings');

const configPath = path.resolve(__dirname, '..', '..', 'config.json');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function waitFor(check, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error('Timed out waiting for Reset to Defaults.');
}

function loginOptions(app) {
  return app.isPackaged
    ? { path: process.execPath, args: [] }
    : { path: process.execPath, args: [`"${app.getAppPath()}"`] };
}

async function formValues(settingsWindow) {
  return settingsWindow.webContents.executeJavaScript(`({
    petSize: Number(document.getElementById('pet-size').value),
    light: Number(document.getElementById('light-delay').value),
    walk: Number(document.getElementById('walk-delay').value),
    sleep: Number(document.getElementById('sleep-delay').value),
    blink: document.getElementById('blink-interval').value,
    startup: document.getElementById('startup-status').textContent,
    hasReset: Boolean(document.getElementById('reset-defaults'))
  })`);
}

async function runStage6ResetSmoke(app, window, settings, controls, dialogTest) {
  const original = structuredClone(settings);
  const results = {};
  let passed = false;
  try {
    controls.applySettings({
      petSize: 280,
      edgeMargin: 24,
      visualBottomGapPx: 6,
      muted: true,
      animation: { blinkIntervalSeconds: 6 },
      play: { durationSeconds: 24, batIntervalMs: 1100, ballTravelPx: 120, ballWidthPx: 110, easeMs: 700 },
      activity: { lightAfterSeconds: 30, walkAfterSeconds: 120, sleepAfterSeconds: 300, pollMs: 750 },
      windowPadding: { ...settings.windowPadding, bottom: 16 }
    });
    controls.setStartWithWindows(true);
    const changed = structuredClone(settings);
    const settingsWindow = controls.openSettings();
    await settingsWindow.webContents.executeJavaScript('window.__settingsReady');
    fs.writeFileSync(
      path.resolve(__dirname, '..', '..', 'test-output', 'stage6-settings.png'),
      (await settingsWindow.webContents.capturePage()).toPNG()
    );
    const changedForm = await formValues(settingsWindow);
    results.changed = changedForm.petSize === 280 && changedForm.light === 30
      && changedForm.walk === 120 && changedForm.sleep === 300 && changedForm.blink === '6'
      && changedForm.startup.includes('On') && changedForm.hasReset
      && changed.play.durationSeconds === 24 && changed.play.ballTravelPx === 120;

    dialogTest.answers.push(1);
    await settingsWindow.webContents.executeJavaScript("document.getElementById('reset-defaults').click(); true");
    await waitFor(() => dialogTest.calls.length === 1);
    await delay(200);
    const confirmation = dialogTest.calls[0];
    results.confirmation = confirmation.parent === settingsWindow
      && confirmation.options.message === 'Reset all Desktop Buddy settings to their default values?'
      && equal(confirmation.options.buttons, ['Reset', 'Cancel'])
      && confirmation.options.defaultId === 1 && confirmation.options.cancelId === 1;
    results.cancel = equal(settings, changed)
      && equal(JSON.parse(fs.readFileSync(configPath, 'utf8')), changed)
      && (await formValues(settingsWindow)).petSize === 280;

    dialogTest.answers.push(0);
    await settingsWindow.webContents.executeJavaScript("document.getElementById('reset-defaults').click(); true");
    await waitFor(() => settingsWindow.webContents.executeJavaScript(
      "document.getElementById('status').textContent === 'Default settings restored.'"
    ));
    const defaults = defaultSettings();
    const pet = await window.webContents.executeJavaScript('window.__petTest.snapshot()');
    const bounds = window.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    results.reset = equal(settings, defaults)
      && equal(JSON.parse(fs.readFileSync(configPath, 'utf8')), defaults)
      && pet.petSize === defaults.petSize && pet.audioMuted === defaults.muted
      && bounds.x === area.x + area.width - bounds.width - defaults.edgeMargin
      && bounds.y + bounds.height === area.y + area.height
      && !app.getLoginItemSettings(loginOptions(app)).openAtLogin;

    await new Promise((resolve) => {
      settingsWindow.once('closed', resolve);
      settingsWindow.close();
    });
    const reopened = controls.openSettings();
    await reopened.webContents.executeJavaScript('window.__settingsReady');
    const restoredForm = await formValues(reopened);
    results.reopen = restoredForm.petSize === defaults.petSize
      && restoredForm.light === defaults.activity.lightAfterSeconds
      && restoredForm.walk === defaults.activity.walkAfterSeconds
      && restoredForm.sleep === defaults.activity.sleepAfterSeconds
      && restoredForm.blink === '' && restoredForm.startup.includes('Off');
    reopened.close();

    passed = Object.values(results).every(Boolean);
    console.log('STAGE6_RESET_SMOKE_RESULT', JSON.stringify({ passed, ...results }));
    return passed;
  } finally {
    if (!passed) {
      controls.applySettings(original);
      controls.setStartWithWindows(original.startWithWindows);
    }
  }
}

async function runStage6DefaultsSmoke(app, window, settings, controls) {
  const defaults = defaultSettings();
  const snapshot = await window.webContents.executeJavaScript('window.__petTest.snapshot()');
  const settingsWindow = controls.openSettings();
  await settingsWindow.webContents.executeJavaScript('window.__settingsReady');
  const form = await formValues(settingsWindow);
  settingsWindow.close();
  const passed = equal(settings, defaults)
    && equal(JSON.parse(fs.readFileSync(configPath, 'utf8')), defaults)
    && snapshot.petSize === defaults.petSize && snapshot.audioMuted === false
    && form.petSize === defaults.petSize && form.light === defaults.activity.lightAfterSeconds
    && form.walk === defaults.activity.walkAfterSeconds && form.sleep === defaults.activity.sleepAfterSeconds
    && form.blink === '' && form.startup.includes('Off')
    && !app.getLoginItemSettings(loginOptions(app)).openAtLogin;
  console.log('STAGE6_DEFAULTS_RESTART_RESULT', JSON.stringify({ passed, settings: equal(settings, defaults), form }));
  return passed;
}

module.exports = { runStage6ResetSmoke, runStage6DefaultsSmoke };
