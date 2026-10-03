'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app } = require('electron');
const { measureImage } = require('./image-metrics');

const projectRoot = path.resolve(__dirname, '..', '..');
const settingsPath = () => path.join(app?.isPackaged ? app.getPath('userData') : projectRoot, 'config.json');
const defaults = Object.freeze({
  pet: 'orange-cat',
  petSize: 240,
  edgeMargin: 16,
  visualBottomGapPx: 0,
  muted: false,
  startWithWindows: false,
  animation: { blinkIntervalSeconds: null },
  play: {
    durationSeconds: 16, batIntervalMs: 850, ballTravelPx: 88, ballWidthPx: 96, easeMs: 540,
    jumpAfterSeconds: 6, jumpPrepareMs: 260, jumpDurationMs: 1500,
    jumpHeightPx: 32, jumpSidePx: 18, jumpLandMs: 150,
    chaseStartPx: 100, chaseStopPx: 28, chaseSpeedPxPerSecond: 155,
    chaseWalkFrameMs: 105,
    maxReleaseSpeedPxPerSecond: 850, ballFrictionPerSecond: 1.65,
    ballBounceFactor: 0.62, ballStopSpeedPxPerSecond: 22,
    ballInteractionSpeedPxPerSecond: 70
  },
  activity: { lightAfterSeconds: 20, walkAfterSeconds: 90, sleepAfterSeconds: 180, pollMs: 500 },
  windowPadding: { top: 56, right: 32, bottom: 12, left: 32 }
});

function boundedNumber(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value)
    : fallback;
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function normalizeSettings(custom = {}) {
  const padding = custom.windowPadding && typeof custom.windowPadding === 'object'
    ? custom.windowPadding
    : {};
  const activity = custom.activity && typeof custom.activity === 'object' ? custom.activity : {};
  const animation = custom.animation && typeof custom.animation === 'object' ? custom.animation : {};
  const play = custom.play && typeof custom.play === 'object' ? custom.play : {};
  const lightAfterSeconds = boundedNumber(activity.lightAfterSeconds, defaults.activity.lightAfterSeconds, 10, 30);
  const walkAfterSeconds = boundedNumber(activity.walkAfterSeconds, defaults.activity.walkAfterSeconds, 60, 120);
  const sleepAfterSeconds = boundedNumber(activity.sleepAfterSeconds, defaults.activity.sleepAfterSeconds, walkAfterSeconds + 30, 3600);
  return {
    pet: typeof custom.pet === 'string' && /^[a-z0-9-]+$/.test(custom.pet) ? custom.pet : defaults.pet,
    petSize: boundedNumber(custom.petSize, defaults.petSize, 100, 600),
    edgeMargin: boundedNumber(custom.edgeMargin, defaults.edgeMargin, 0, 100),
    visualBottomGapPx: boundedNumber(custom.visualBottomGapPx, defaults.visualBottomGapPx, 0, 40),
    muted: custom.muted === true,
    startWithWindows: custom.startWithWindows === true,
    animation: {
      blinkIntervalSeconds: animation.blinkIntervalSeconds === null || animation.blinkIntervalSeconds === undefined
        ? null : boundedNumber(animation.blinkIntervalSeconds, null, 3, 30)
    },
    play: {
      durationSeconds: boundedNumber(play.durationSeconds, defaults.play.durationSeconds, 5, 120),
      batIntervalMs: boundedNumber(play.batIntervalMs, defaults.play.batIntervalMs, 350, 3000),
      ballTravelPx: boundedNumber(play.ballTravelPx, defaults.play.ballTravelPx, 30, 180),
      ballWidthPx: boundedNumber(play.ballWidthPx, defaults.play.ballWidthPx, 48, 150),
      easeMs: boundedNumber(play.easeMs, defaults.play.easeMs, 200, 2000),
      jumpAfterSeconds: boundedNumber(play.jumpAfterSeconds, defaults.play.jumpAfterSeconds, 2, 60),
      jumpPrepareMs: boundedNumber(play.jumpPrepareMs, defaults.play.jumpPrepareMs, 100, 1000),
      jumpDurationMs: boundedNumber(play.jumpDurationMs, defaults.play.jumpDurationMs, 700, 3000),
      jumpHeightPx: boundedNumber(play.jumpHeightPx, defaults.play.jumpHeightPx, 10, 100),
      jumpSidePx: boundedNumber(play.jumpSidePx, defaults.play.jumpSidePx, 4, 60),
      jumpLandMs: boundedNumber(play.jumpLandMs, defaults.play.jumpLandMs, 80, 500),
      chaseStartPx: boundedNumber(play.chaseStartPx, defaults.play.chaseStartPx, 40, 250),
      chaseStopPx: boundedNumber(play.chaseStopPx, defaults.play.chaseStopPx, 10, 100),
      chaseSpeedPxPerSecond: boundedNumber(play.chaseSpeedPxPerSecond,
        defaults.play.chaseSpeedPxPerSecond, 80, 600),
      chaseWalkFrameMs: boundedNumber(play.chaseWalkFrameMs,
        defaults.play.chaseWalkFrameMs, 60, 240),
      maxReleaseSpeedPxPerSecond: boundedNumber(play.maxReleaseSpeedPxPerSecond,
        defaults.play.maxReleaseSpeedPxPerSecond, 100, 2000),
      ballFrictionPerSecond: boundedNumber(play.ballFrictionPerSecond * 100,
        defaults.play.ballFrictionPerSecond * 100, 20, 800) / 100,
      ballBounceFactor: boundedNumber(play.ballBounceFactor * 100,
        defaults.play.ballBounceFactor * 100, 20, 90) / 100,
      ballStopSpeedPxPerSecond: boundedNumber(play.ballStopSpeedPxPerSecond,
        defaults.play.ballStopSpeedPxPerSecond, 5, 100),
      ballInteractionSpeedPxPerSecond: boundedNumber(play.ballInteractionSpeedPxPerSecond,
        defaults.play.ballInteractionSpeedPxPerSecond, 20, 180)
    },
    activity: {
      lightAfterSeconds,
      walkAfterSeconds,
      sleepAfterSeconds,
      pollMs: boundedNumber(activity.pollMs, defaults.activity.pollMs, 250, 2000)
    },
    windowPadding: Object.fromEntries(
      Object.entries(defaults.windowPadding).map(([side, fallback]) => [
        side,
        boundedNumber(padding[side], fallback, 0, 200)
      ])
    )
  };
}

function defaultSettings() {
  return normalizeSettings();
}

function loadSettings() {
  let custom = {};
  try {
    custom = readJson(settingsPath());
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
      throw new Error('Configuration must be a JSON object.');
    }
  } catch (error) {
    console.warn('Using default configuration:', error.message);
  }
  return normalizeSettings(custom);
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  const filename = settingsPath();
  const temporary = `${filename}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, filename);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  return normalized;
}

function loadPet(settings) {
  const petDirectory = path.join(projectRoot, 'pets', settings.pet);
  const pet = readJson(path.join(petDirectory, 'pet.json'));
  if (!pet.states?.idle?.frames?.length) {
    throw new Error('Pet pack needs an idle frame.');
  }

  const allowedAssetDirectory = path.join(projectRoot, 'assets') + path.sep;
  const allowedPetDirectory = petDirectory + path.sep;
  function imageUrl(filename) {
    if (typeof filename !== 'string') {
      throw new Error('Pet frame names must be strings.');
    }
    const framePath = path.resolve(petDirectory, filename);
    if (!framePath.startsWith(allowedAssetDirectory) && !framePath.startsWith(allowedPetDirectory)) {
      throw new Error('Pet image must be inside assets or its pet pack.');
    }
    if (!fs.existsSync(framePath)) {
      throw new Error(`Pet image not found: ${filename}`);
    }
    return pathToFileURL(framePath).href;
  }

  const states = {};
  const metricCache = new Map();
  for (const [name, state] of Object.entries(pet.states)) {
    if (!state || !Array.isArray(state.frames) || state.frames.length === 0) {
      throw new Error(`State ${name} needs at least one frame.`);
    }
    const frames = state.frames.map(imageUrl);
    states[name] = {
      frames,
      frameMetrics: state.frames.map((filename) => {
        const framePath = path.resolve(petDirectory, filename);
        if (!metricCache.has(framePath)) metricCache.set(framePath, measureImage(framePath));
        return metricCache.get(framePath);
      }),
      loop: state.loop === true,
      nextState: typeof state.nextState === 'string' ? state.nextState : null
    };
  }
  const blink = pet.states.blink;
  if (blink && blink.frames.length !== 2) {
    throw new Error('The blink state needs open and closed frames.');
  }
  const intervals = pet.ambient?.blinkIntervalMs;
  const minInterval = boundedNumber(intervals?.[0], 3500, 1000, 30000);
  const maxInterval = boundedNumber(intervals?.[1], 7500, minInterval, 60000);
  const walk = pet.states.walk;
  if (walk && walk.frames.length < 2) {
    throw new Error('The walk state needs at least two frames.');
  }
  if (pet.states.yarnPlay && pet.states.yarnPlay.frames.length !== 2) {
    throw new Error('Yarn play needs separate left and right cat frames.');
  }
  if (pet.states.yarnJump && pet.states.yarnJump.frames.length !== 3) {
    throw new Error('Yarn jump needs separate left, center, and right cat frames.');
  }
  const jumpAnchors = pet.states.yarnJump?.anchorsPx;
  if (pet.states.yarnJump && (!Array.isArray(jumpAnchors) || jumpAnchors.length !== 3
    || jumpAnchors.some((anchor, index) => !Number.isFinite(anchor?.bodyX)
      || !Number.isFinite(anchor?.footY) || anchor.bodyX < 0 || anchor.footY < 0
      || anchor.bodyX > states.yarnJump.frameMetrics[index].width
      || anchor.footY > states.yarnJump.frameMetrics[index].height))) {
    throw new Error('Yarn jump needs a valid body and landing-foot anchor for each frame.');
  }
  const pawContacts = pet.states.yarnPlay?.pawContactsPx;
  if (pet.states.yarnPlay && (!Array.isArray(pawContacts) || pawContacts.length !== 2
    || pawContacts.some((point, index) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y)
      || point.x < 0 || point.y < 0 || point.x > states.yarnPlay.frameMetrics[index].width
      || point.y > states.yarnPlay.frameMetrics[index].height))) {
    throw new Error('Yarn play needs a valid paw-contact point for each cat frame.');
  }
  const ballCenter = pet.play?.ballCenterPx;
  if (pet.states.yarnPlay && (!Number.isFinite(ballCenter?.x) || !Number.isFinite(ballCenter?.y)
    || ballCenter.x < 0 || ballCenter.y < 0)) {
    throw new Error('Yarn play needs a valid yarn-ball center point.');
  }
  if (pet.states.yarnPlay && (!Number.isFinite(pet.play?.referencePetSizePx)
    || pet.play.referencePetSizePx <= 0)) {
    throw new Error('Yarn play needs a reference pet size.');
  }
  const restIntervals = walk?.restMs;
  const minRest = boundedNumber(restIntervals?.[0], 5000, 1000, 60000);
  const maxRest = boundedNumber(restIntervals?.[1], 9000, minRest, 120000);
  const happy = pet.states.happy;
  const wave = pet.states.wave;
  for (const [name, state] of [['happy', happy], ['wave', wave], ['read', pet.states.read]]) {
    if (state && state.frames.length !== 2) {
      throw new Error(`The ${name} state needs two frames.`);
    }
  }
  for (const name of ['headphones', 'sleep']) {
    if (pet.states[name] && pet.states[name].frames.length < 2) {
      throw new Error(`The ${name} state needs at least two frames.`);
    }
  }
  const waveIntervals = wave?.intervalMs;
  const minWave = boundedNumber(waveIntervals?.[0], 18000, 3000, 60000);
  const maxWave = boundedNumber(waveIntervals?.[1], 26000, minWave, 120000);
  const effects = {};
  for (const [name, effect] of Object.entries(pet.effects || {})) {
    if (!effect || !['bubble', 'heart'].includes(effect.kind)) continue;
    effects[name] = {
      kind: effect.kind,
      text: typeof effect.text === 'string' ? effect.text.slice(0, 20) : '',
      durationMs: boundedNumber(effect.durationMs, 1200, 200, 5000)
    };
  }

  return {
    name: typeof pet.name === 'string' ? pet.name : settings.pet,
    visualBottomGapPx: settings.visualBottomGapPx,
    states,
    blink: blink ? {
      closeMs: boundedNumber(blink.closeMs, 85, 40, 300),
      holdMs: boundedNumber(blink.holdMs, 90, 30, 400),
      openMs: boundedNumber(blink.openMs, 115, 40, 300),
      intervalMs: [minInterval, maxInterval],
      doubleBlinkChance: typeof pet.ambient?.doubleBlinkChance === 'number'
        ? Math.max(0, Math.min(1, pet.ambient.doubleBlinkChance))
        : 0.12,
      doubleBlinkGapMs: boundedNumber(pet.ambient?.doubleBlinkGapMs, 180, 100, 500)
    } : null,
    walk: walk ? {
      speedPxPerSecond: boundedNumber(walk.speedPxPerSecond, 120, 40, 400),
      accelerationPxPerSecond2: boundedNumber(walk.accelerationPxPerSecond2, 500, 100, 2000),
      decelerationPxPerSecond2: boundedNumber(walk.decelerationPxPerSecond2, 650, 100, 2000),
      strideLengthPx: boundedNumber(walk.strideLengthPx, 46, 30, 200),
      positionSmoothingMs: boundedNumber(walk.positionSmoothingMs, 38, 10, 100),
      startAfterMs: boundedNumber(walk.startAfterMs, 3500, 1000, 30000),
      restMs: [minRest, maxRest],
      turnPauseMs: boundedNumber(walk.turnPauseMs, 260, 0, 2000),
      traversalsPerWalk: boundedNumber(walk.traversalsPerWalk, 2, 1, 4)
    } : null,
    happy: happy ? {
      durationMs: boundedNumber(happy.durationMs, 3000, 500, 10000),
      cycleMs: boundedNumber(happy.cycleMs, 620, 200, 2000),
      cooldownMs: boundedNumber(happy.cooldownMs, 4200, 500, 15000)
    } : null,
    wave: wave ? {
      durationMs: boundedNumber(wave.durationMs, 1400, 500, 5000),
      cycleMs: boundedNumber(wave.cycleMs, 520, 200, 2000),
      startAfterMs: boundedNumber(wave.startAfterMs, 1600, 500, 30000),
      intervalMs: [minWave, maxWave]
    } : null,
    read: pet.states.read ? {
      durationMs: boundedNumber(pet.states.read.durationMs, 6000, 1000, 30000),
      cycleMs: boundedNumber(pet.states.read.cycleMs, 1500, 200, 5000)
    } : null,
    headphones: pet.states.headphones ? {
      durationMs: boundedNumber(pet.states.headphones.durationMs, 6000, 1000, 30000),
      cycleMs: boundedNumber(pet.states.headphones.cycleMs, 1200, 200, 5000)
    } : null,
    sleep: pet.states.sleep ? true : null,
    play: pet.states.yarnPlay && pet.play?.ballImage
      ? { ballUrl: imageUrl(pet.play.ballImage), pawContacts, ballCenter,
        referencePetSizePx: pet.play.referencePetSizePx, jumpAnchors }
      : null,
    effects
  };
}

module.exports = { loadSettings, loadPet, normalizeSettings, defaultSettings, saveSettings };
