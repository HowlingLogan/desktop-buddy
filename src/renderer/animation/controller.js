import { ImageLoader } from './image-loader.js';
import { StateMachine } from './state-machine.js';
import { WalkController } from './walk-controller.js';
import { YarnPlayController } from './yarn-play-controller.js';
import { ChaseController } from './chase-controller.js';
import { Effects } from '../effects.js';

const easeInOutCubic = (progress) => progress < 0.5
  ? 4 * progress * progress * progress
  : 1 - Math.pow(-2 * progress + 2, 3) / 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ARRIVAL_HOLD_MS = 140;
const BALL_TO_PAW_MS = 360;

export class AnimationController {
  #pet;
  #art;
  #base;
  #overlay;
  #walkLayer;
  #reactionLayer;
  #playLayer;
  #jumpLayer;
  #ball;
  #walkFrames = [];
  #reactionFrames = {};
  #playFrames = [];
  #jumpFrames = [];
  #alignedFrames = [];
  #effects;
  #loader = new ImageLoader();
  #machine;
  #walk;
  #play;
  #chase;
  #desktop;
  #ballBridge;
  #externalBall = null;
  #externalWorkArea = null;
  #ballSpeed = 0;
  #ballMoving = false;
  #returnRequest = null;
  #returnState = null;
  #ballEpoch = 0;
  #pendingBallRelease = null;
  #handoffReady = Promise.resolve(true);
  #playConfig;
  #setPosition;
  #blinkTimeout = null;
  #walkTimeout = null;
  #waveTimeout = null;
  #blinkFrameRequest = null;
  #reactionRequest = null;
  #blinkStartedAt = null;
  #reactionStartedAt = null;
  #lastHappyAt = -Infinity;
  #pendingHappy = false;
  #wavePending = false;
  #pendingPlay = false;
  #stopped = false;
  #paused = false;
  #blinkIntervalSeconds = null;
  #activityConfig;
  #idleSeconds = 0;
  #activityGeneration = 0;
  #activityTier = 'active';

  constructor(pet, elements, desktop, setPosition, activityConfig, animationConfig = {}, playConfig = {}, ballBridge = null) {
    this.#pet = pet;
    this.#art = elements.art;
    this.#base = elements.base;
    this.#overlay = elements.overlay;
    this.#walkLayer = elements.walkLayer;
    this.#reactionLayer = elements.reactionLayer;
    this.#playLayer = elements.playLayer;
    this.#jumpLayer = elements.jumpLayer;
    this.#ball = elements.ball;
    this.#effects = new Effects(elements.effectLayer);
    this.#setPosition = setPosition;
    this.#desktop = desktop;
    this.#ballBridge = ballBridge;
    this.#activityConfig = activityConfig;
    this.#playConfig = playConfig;
    this.#blinkIntervalSeconds = animationConfig.blinkIntervalSeconds ?? null;
    this.#machine = new StateMachine(pet.states);
    if (pet.walk) {
      this.#walk = new WalkController({
        config: pet.walk,
        desktop,
        frameCount: pet.states.walk.frames.length,
        setPosition: (x) => this.#setPosition(x),
        onFrame: (index, next, blend) => this.#paintWalkFrame(index, next, blend),
        onDirection: (direction) => this.#art.classList.toggle('left', direction < 0),
        onFinish: () => this.#finishWalk()
      });
    }
  }

  get state() {
    return this.#machine.current;
  }

  get snapshot() {
    return {
      state: this.state,
      closedOpacity: Number(this.#overlay.style.opacity),
      baseLoaded: this.#base.naturalWidth > 0,
      overlayLoaded: this.#overlay.naturalWidth > 0,
      walkFramesLoaded: this.#walkFrames.every((image) => image.naturalWidth > 0),
      reactionFramesLoaded: Object.values(this.#reactionFrames).flat().every((image) => image.naturalWidth > 0),
      playFramesLoaded: this.#playFrames.every((image) => image.naturalWidth > 0),
      jumpFramesLoaded: this.#jumpFrames.every((image) => image.naturalWidth > 0),
      ballLoaded: !this.#pet.play || this.#ball.naturalWidth > 0,
      play: this.#play?.snapshot ?? null,
      chase: this.#chase?.snapshot ?? null,
      externalBall: this.#externalBall,
      ballSpeed: this.#ballSpeed,
      ballMoving: this.#ballMoving,
      arrival: this.#returnState ? { elapsed: this.#returnState.elapsed,
        settling: this.#returnState.elapsed < ARRIVAL_HOLD_MS,
        targetX: this.#returnState.targetX, targetY: this.#returnState.targetY,
        startY: this.#returnState.y } : null,
      effectText: this.#effects.currentText,
      idleSeconds: this.#idleSeconds,
      activityTier: this.#activityTier,
      paused: this.#paused,
      flipped: this.#art.classList.contains('left'),
      walk: this.#walk?.snapshot ?? null
    };
  }

  async start() {
    const urls = Object.values(this.#pet.states).flatMap((state) => state.frames);
    if (this.#pet.play) urls.push(this.#pet.play.ballUrl);
    await this.#loader.preload(urls);

    this.#base.src = this.#pet.states.idle.frames[0];
    this.#overlay.src = this.#pet.states.blink?.frames[1] || this.#base.src;
    this.#alignedFrames.push([this.#base, this.#pet.states.idle.frameMetrics[0]]);
    this.#alignedFrames.push([this.#overlay, this.#pet.states.blink?.frameMetrics[1] || this.#pet.states.idle.frameMetrics[0]]);
    if (this.#pet.walk) {
      for (const [index, url] of this.#pet.states.walk.frames.entries()) {
        const image = document.createElement('img');
        image.className = 'pet-frame walk-frame';
        image.alt = '';
        image.draggable = false;
        image.src = url;
        this.#walkLayer.appendChild(image);
        this.#walkFrames.push(image);
        this.#alignedFrames.push([image, this.#pet.states.walk.frameMetrics[index]]);
      }
    }
    for (const name of ['happy', 'wave', 'read', 'headphones', 'sleep']) {
      if (!this.#pet[name]) continue;
      this.#reactionFrames[name] = this.#pet.states[name].frames.map((url, index) => {
        const image = document.createElement('img');
        image.className = `pet-frame reaction-frame ${name === 'sleep' ? 'sleep-frame' : ''}`;
        if (name === 'sleep') image.style.setProperty('--sleep-delay', `${index * 5 / this.#pet.states.sleep.frames.length - 5}s`);
        image.alt = '';
        image.draggable = false;
        image.src = url;
        this.#reactionLayer.appendChild(image);
        this.#alignedFrames.push([image, this.#pet.states[name].frameMetrics[index]]);
        return image;
      });
    }
    if (this.#pet.play) {
      this.#playFrames = this.#pet.states.yarnPlay.frames.map((url, index) => {
        const image = document.createElement('img');
        image.className = 'pet-frame play-frame';
        image.alt = '';
        image.draggable = false;
        image.src = url;
        this.#playLayer.appendChild(image);
        this.#alignedFrames.push([image, this.#pet.states.yarnPlay.frameMetrics[index]]);
        return image;
      });
      this.#ball.src = this.#pet.play.ballUrl;
      if (this.#pet.states.yarnJump) {
        this.#jumpFrames = this.#pet.states.yarnJump.frames.map((url, index) => {
          const image = document.createElement('img');
          image.className = 'pet-frame jump-frame';
          image.alt = '';
          image.draggable = false;
          image.src = url;
          this.#jumpLayer.appendChild(image);
          this.#alignedFrames.push([image, this.#pet.states.yarnJump.frameMetrics[index]]);
          return image;
        });
      }
    }
    await Promise.all([
      this.#base.decode(),
      this.#overlay.decode(),
      ...this.#walkFrames.map((image) => image.decode()),
      ...Object.values(this.#reactionFrames).flat().map((image) => image.decode()),
      ...this.#playFrames.map((image) => image.decode()),
      ...this.#jumpFrames.map((image) => image.decode()),
      ...(this.#pet.play ? [this.#ball.decode()] : [])
    ]);
    this.alignFrames();
    if (this.#pet.play) {
      this.#play = new YarnPlayController({
        ball: this.#ball,
        frames: this.#playFrames,
        jumpFrames: this.#jumpFrames,
        jumpLayer: this.#jumpLayer,
        jumpAnchors: this.#pet.play.jumpAnchors,
        contacts: this.#pet.play.pawContacts,
        ballCenter: this.#pet.play.ballCenter,
        referencePetSizePx: this.#pet.play.referencePetSizePx,
        config: this.#playConfig,
        onJumpStart: () => this.#art.classList.add('jumping'),
        onJumpEnd: () => this.#art.classList.remove('jumping'),
        onBallFrame: (frame) => this.#ballBridge?.localFrame(frame),
        onComplete: () => this.endYarnPlay()
      });
      this.#chase = new ChaseController({
        frameCount: this.#walkFrames.length,
        onPosition: (x, y) => this.#ballBridge?.setChasePosition(x, y),
        onFrame: (index, next, blend) => this.#paintWalkFrame(index, next, blend),
        onDirection: (direction) => this.#art.classList.toggle('left', direction < 0),
        onFinish: () => this.#finishChase(),
        canFinish: () => this.#ballSpeed <= this.#playConfig.ballInteractionSpeedPxPerSecond
      });
    }

    this.#machine.enter('idle');
    this.#overlay.style.opacity = '0';
    if (this.#pet.blink) this.#scheduleBlink();
  }

  handleSystemIdle(sample) {
    if (!sample || !Number.isFinite(sample.seconds) || !Number.isFinite(sample.generation)) return;
    const previousTier = this.#activityTier;
    const previousSeconds = this.#idleSeconds;
    const activityResumed = sample.generation > this.#activityGeneration || sample.seconds < previousSeconds;
    this.#idleSeconds = sample.seconds;
    this.#activityGeneration = sample.generation;
    const { lightAfterSeconds, walkAfterSeconds, sleepAfterSeconds } = this.#activityConfig;
    const nextTier = sample.seconds >= sleepAfterSeconds ? 'sleep'
      : sample.seconds >= walkAfterSeconds ? 'roam'
        : sample.seconds >= lightAfterSeconds ? 'light' : 'active';
    if (this.#paused) {
      this.#activityTier = nextTier;
      return;
    }
    if (this.#play?.snapshot.active) {
      this.#activityTier = nextTier;
      return;
    }
    const tierOrder = { active: 0, light: 1, roam: 2, sleep: 3 };
    if (activityResumed || tierOrder[nextTier] < tierOrder[previousTier]) {
      this.#returnFromInactivity();
    }
    if (nextTier === previousTier) return;
    this.#activityTier = nextTier;
    if (nextTier === 'sleep') {
      this.#beginSleep();
    } else if (nextTier === 'roam') {
      if (this.#pet.walk) this.#scheduleWalk(this.#pet.walk.startAfterMs);
      if (this.#pet.wave && !this.#waveTimeout) this.#scheduleWave();
    } else if (nextTier === 'light') {
      clearTimeout(this.#walkTimeout);
      this.#walkTimeout = null;
      if (this.#pet.wave) this.#scheduleWave(this.#pet.wave.startAfterMs);
    }
  }

  updateDesktop(desktop) {
    if (this.#play?.snapshot.active) this.endYarnPlay({ restoreAmbient: false });
    this.#desktop = desktop;
    this.#walk?.updateDesktop(desktop);
    this.alignFrames();
    if (!this.#stopped && !this.#paused && this.state === 'idle') this.#scheduleAmbient(true);
  }

  alignFrames() {
    const width = this.#art.clientWidth;
    const height = this.#art.clientHeight;
    const bottomGap = window.innerHeight - this.#art.offsetTop - height;
    if (!width || !height) return;
    for (const [image, metrics] of this.#alignedFrames) {
      const scale = Math.min(width / metrics.width, height / metrics.height);
      const shift = bottomGap + metrics.bottomTransparentRows * scale - this.#pet.visualBottomGapPx;
      if (image.classList.contains('play-frame') || image.classList.contains('jump-frame')) {
        image.style.top = `${shift.toFixed(2)}px`;
        image.style.transform = 'none';
        if (image.classList.contains('jump-frame')) image.dataset.baseTop = image.style.top;
      } else image.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
    }
  }

  updateVisualBottomGap(pixels) {
    this.#pet.visualBottomGapPx = pixels;
    this.alignFrames();
  }

  updateActivityConfig(config) {
    this.#activityConfig = config;
    this.handleSystemIdle({ seconds: this.#idleSeconds, generation: this.#activityGeneration });
  }

  updatePlayConfig(config) {
    this.#playConfig = config;
    this.#play?.updateConfig(config);
  }

  setBlinkIntervalSeconds(seconds) {
    this.#blinkIntervalSeconds = seconds;
    if (this.state === 'idle' && !this.#stopped && !this.#paused && this.#pet.blink) this.#scheduleBlink();
  }

  setPaused(paused) {
    if (this.#paused === paused) return;
    this.#paused = paused;
    if (paused) {
      if (this.#play?.snapshot.active) {
        clearTimeout(this.#blinkTimeout);
        clearTimeout(this.#walkTimeout);
        clearTimeout(this.#waveTimeout);
        this.#blinkTimeout = null;
        this.#walkTimeout = null;
        this.#waveTimeout = null;
        this.#play.pause();
        this.#chase?.pause();
        if (this.#returnRequest !== null) {
          cancelAnimationFrame(this.#returnRequest);
          this.#returnRequest = null;
          if (this.#returnState) this.#returnState.lastNow = null;
        }
        return;
      }
      this.#cancelActiveAnimation();
      this.#walk?.stop();
      this.#effects.clear();
      this.#pendingHappy = false;
      this.#wavePending = false;
      this.#pendingPlay = false;
      this.#machine.enter('idle', { force: true });
      this.#art.classList.remove('walking', 'left', 'reacting', 'sleeping', 'dragged');
    } else if (!this.#stopped) {
      if (this.#play?.snapshot.active) {
        this.#play.resume();
        this.#chase?.resume();
        if (this.#returnState) this.#returnRequest = requestAnimationFrame((now) => this.#tickReturnBall(now));
        if (this.#pendingBallRelease) {
          const pending = this.#pendingBallRelease;
          this.#pendingBallRelease = null;
          void this.onBallReleased(pending);
        }
        return;
      }
      if (this.#activityTier === 'sleep') this.#beginSleep();
      else this.#scheduleAmbient(true);
    }
  }

  resetToIdle() {
    this.endYarnPlay({ restoreAmbient: false });
    this.#cancelActiveAnimation();
    this.#walk?.stop();
    this.#effects.clear();
    this.#pendingHappy = false;
    this.#wavePending = false;
    this.#pendingPlay = false;
    this.#machine.enter('idle', { force: true });
    this.#art.classList.remove('walking', 'left', 'reacting', 'sleeping', 'dragged');
    if (!this.#stopped && !this.#paused) this.#scheduleAmbient(true);
  }

  startYarnPlay() {
    if (this.#stopped || !this.#play || this.state === 'dragged') return false;
    if (this.#play?.snapshot.active) return true;
    if (['blink', 'happy', 'wave', 'read', 'headphones'].includes(this.state)) {
      this.#pendingPlay = true;
      return true;
    }
    this.#pendingPlay = false;
    this.#cancelActiveAnimation();
    this.#walk?.stop();
    this.#effects.clear();
    this.#pendingHappy = false;
    this.#wavePending = false;
    this.#art.classList.remove('walking', 'left', 'reacting', 'sleeping');
    for (const image of Object.values(this.#reactionFrames).flat()) image.style.opacity = '0';
    this.#machine.enter('yarnPlay', { force: true });
    this.#art.classList.add('playing');
    this.#play.start();
    if (this.#paused) this.#play.pause();
    return true;
  }

  endYarnPlay({ restoreAmbient = true } = {}) {
    if (!this.#play?.snapshot.active
      && !['yarnPlay', 'ballDragging', 'chaseBall', 'returnBall'].includes(this.state)) return false;
    this.#ballEpoch += 1;
    this.#chase?.stop();
    cancelAnimationFrame(this.#returnRequest);
    this.#returnRequest = null;
    this.#returnState = null;
    this.#externalBall = null;
    this.#externalWorkArea = null;
    this.#ballSpeed = 0;
    this.#ballMoving = false;
    this.#pendingBallRelease = null;
    this.#play?.stop();
    this.#ballBridge?.hideWindow();
    this.#art.classList.remove('playing', 'jumping', 'walking', 'left');
    this.#machine.enter('idle', { force: true });
    if (restoreAmbient && !this.#stopped && !this.#paused) {
      if (this.#activityTier === 'sleep') this.#beginSleep();
      else this.#scheduleAmbient(true);
    }
    return true;
  }

  onBallGrabbed(info) {
    if (!this.#play?.snapshot.active || this.#stopped || this.#paused) return;
    const epoch = ++this.#ballEpoch;
    this.#chase?.stop();
    cancelAnimationFrame(this.#returnRequest);
    this.#returnRequest = null;
    this.#returnState = null;
    this.#pendingBallRelease = null;
    this.#play.pause();
    this.#externalBall = info.ballBounds;
    this.#ballSpeed = 0;
    this.#ballMoving = false;
    this.#handoffReady = this.#ballBridge.handoffReady().then((ready) => {
      if (epoch !== this.#ballEpoch || !this.#play?.snapshot.active) return false;
      if (!ready) {
        this.endYarnPlay();
        return false;
      }
      this.#play.detach();
      if (!this.#paused) this.#play.resume();
      this.#art.classList.remove('playing', 'jumping', 'walking', 'left');
      this.#machine.enter('ballDragging', { force: true });
      return ready;
    }).catch((error) => {
      console.error('Yarn ball handoff failed:', error);
      if (epoch === this.#ballEpoch) this.endYarnPlay();
      return false;
    });
  }

  async onBallReleased(info) {
    if (!this.#play?.snapshot.active || !info?.ballBounds) return;
    if (this.#paused) {
      this.#pendingBallRelease = info;
      return;
    }
    const epoch = this.#ballEpoch;
    this.#externalBall = info.ballBounds;
    this.#externalWorkArea = info.workArea;
    this.#ballSpeed = Math.hypot(info.velocityX || 0, info.velocityY || 0);
    this.#ballMoving = info.moving === true;
    if (!await this.#handoffReady || epoch !== this.#ballEpoch) return;
    const latestBall = this.#externalBall || info.ballBounds;
    const play = this.#play.snapshot;
    const petBounds = info.petBounds;
    const work = info.workArea;
    const centerX = latestBall.x + play.ballWidth * this.#pet.play.ballCenter.x
      / this.#ball.naturalWidth;
    const visualHeight = play.ballWidth * this.#ball.naturalHeight / this.#ball.naturalWidth;
    const centerY = latestBall.y + latestBall.height - visualHeight
      + visualHeight * this.#pet.play.ballCenter.y / this.#ball.naturalHeight;
    const targetX = clamp(centerX - play.parkBodyX, work.x,
      work.x + work.width - petBounds.width);
    const targetY = clamp(centerY - play.parkBodyY, work.y,
      work.y + work.height - petBounds.height);
    const distance = Math.hypot(targetX - petBounds.x, targetY - petBounds.y);
    const scale = this.#art.clientWidth / this.#pet.play.referencePetSizePx;
    const localX = latestBall.x - petBounds.x;
    const localTop = latestBall.y + latestBall.height - visualHeight - petBounds.y;
    const fitsLocal = localX >= 0 && localTop >= 0
      && localX + play.ballWidth <= petBounds.width
      && localTop + visualHeight <= petBounds.height;
    if (distance < this.#playConfig.chaseStartPx * scale && fitsLocal
      && this.#ballSpeed <= this.#playConfig.ballInteractionSpeedPxPerSecond) {
      await this.#reattachBall(epoch, localX, localTop);
      return;
    }
    this.#machine.enter('chaseBall', { force: true });
    this.#art.classList.add('walking');
    this.#chase.start({ x: petBounds.x, y: petBounds.y, targetX, targetY,
      speed: this.#playConfig.chaseSpeedPxPerSecond,
      frameIntervalMs: this.#playConfig.chaseWalkFrameMs,
      stopDistance: this.#playConfig.chaseStopPx * scale });
    if (this.#paused) this.#chase.pause();
  }

  onBallMotion(info) {
    if (!this.#play?.snapshot.active || !info?.ballBounds) return;
    this.#externalBall = info.ballBounds;
    this.#externalWorkArea = info.workArea;
    this.#ballSpeed = Math.hypot(info.velocityX || 0, info.velocityY || 0);
    this.#ballMoving = info.moving === true;
    if (this.state === 'returnBall') {
      const state = this.#returnState;
      if (state) {
        const work = info.workArea || state.workArea;
        state.targetX = clamp(state.petX + this.#play.snapshot.parkX,
          work.x, work.x + work.width - info.ballBounds.width);
        state.targetY = clamp(state.petY + window.innerHeight - info.ballBounds.height
          + this.#play.snapshot.parkY,
        work.y, work.y + work.height - info.ballBounds.height);
      }
      return;
    }
    if (this.state !== 'chaseBall') return;
    const play = this.#play.snapshot;
    const work = info.workArea;
    const ball = info.ballBounds;
    const bodyX = ball.x + play.ballWidth * this.#pet.play.ballCenter.x / this.#ball.naturalWidth;
    const visualHeight = play.ballWidth * this.#ball.naturalHeight / this.#ball.naturalWidth;
    const bodyY = ball.y + ball.height - visualHeight
      + visualHeight * this.#pet.play.ballCenter.y / this.#ball.naturalHeight;
    this.#chase.setTarget(
      clamp(bodyX - play.parkBodyX, work.x, work.x + work.width - window.innerWidth),
      clamp(bodyY - play.parkBodyY, work.y, work.y + work.height - window.innerHeight)
    );
  }

  #finishChase() {
    if (!this.#play?.snapshot.active || !this.#externalBall) return;
    this.#ballBridge.stopPhysics();
    this.#ballSpeed = 0;
    this.#ballMoving = false;
    this.#machine.enter('returnBall', { force: true });
    void this.#beginReturnBall(this.#ballEpoch);
  }

  async #beginReturnBall(epoch) {
    try {
      const [desktop, ballState] = await Promise.all([
        this.#ballBridge.getDesktop(), this.#ballBridge.getBallState()
      ]);
      if (epoch !== this.#ballEpoch || !ballState?.bounds || this.state !== 'returnBall') return;
      this.#externalBall = ballState.bounds;
      const play = this.#play.snapshot;
      const ballWidth = this.#externalBall.width;
      const ballHeight = this.#externalBall.height;
      const work = desktop.workArea;
      const targetX = clamp(desktop.x + play.parkX, work.x, work.x + work.width - ballWidth);
      const targetY = clamp(desktop.y + window.innerHeight - ballHeight + play.parkY,
        work.y, work.y + work.height - ballHeight);
      this.#returnState = {
        x: this.#externalBall.x, y: this.#externalBall.y, targetX, targetY,
        elapsed: 0, lastNow: null, settled: false, epoch,
        petX: desktop.x, petY: desktop.y, workArea: work
      };
      if (!this.#paused) this.#returnRequest = requestAnimationFrame((now) => this.#tickReturnBall(now));
    } catch (error) {
      console.error('Could not begin yarn-ball return:', error);
      if (epoch === this.#ballEpoch) this.endYarnPlay();
    }
  }

  #tickReturnBall(now) {
    const state = this.#returnState;
    if (!state || this.#paused || state.epoch !== this.#ballEpoch) return;
    if (state.lastNow === null) state.lastNow = now;
    state.elapsed += clamp(now - state.lastNow, 0, 50);
    state.lastNow = now;
    if (state.elapsed < ARRIVAL_HOLD_MS) {
      this.#returnRequest = requestAnimationFrame((next) => this.#tickReturnBall(next));
      return;
    }
    if (!state.settled) {
      state.settled = true;
      this.#art.classList.remove('walking', 'left');
    }
    const progress = clamp((state.elapsed - ARRIVAL_HOLD_MS) / BALL_TO_PAW_MS, 0, 1);
    const eased = easeInOutCubic(progress);
    const x = state.x + (state.targetX - state.x) * eased;
    const y = state.y + (state.targetY - state.y) * eased;
    this.#ballBridge.moveExternal({ x, y });
    this.#externalBall = { ...this.#externalBall, x, y };
    if (progress < 1) {
      this.#returnRequest = requestAnimationFrame((next) => this.#tickReturnBall(next));
      return;
    }
    this.#returnRequest = null;
    this.#returnState = null;
    void this.#reattachBall(state.epoch);
  }

  async #reattachBall(epoch) {
    try {
      const returningFromChase = this.state === 'returnBall';
      const [currentDesktop, ballState] = await Promise.all([
        this.#ballBridge.getDesktop(), this.#ballBridge.getBallState()
      ]);
      if (epoch !== this.#ballEpoch || !this.#play?.snapshot.active || !ballState?.bounds) return;
      const localX = ballState.bounds.x - currentDesktop.x;
      const visualHeight = ballState.visualSize?.height ?? ballState.bounds.height;
      const localTop = ballState.bounds.y + ballState.bounds.height - visualHeight
        - currentDesktop.y;
      if (!this.#play.prepareAttachAt(localX, localTop)) return;
      const hidden = await this.#ballBridge.reattach();
      if (!hidden || epoch !== this.#ballEpoch || !this.#play?.snapshot.active) {
        if (epoch === this.#ballEpoch) this.#play.detach();
        return;
      }
      this.#externalBall = null;
      if (returningFromChase) {
        this.#desktop = currentDesktop;
        this.#walk?.updateDesktop(currentDesktop);
      }
      this.#art.classList.remove('walking', 'left');
      this.#art.classList.add('playing');
      this.#machine.enter('yarnPlay', { force: true });
      this.#play.commitAttach();
      if (this.#paused) this.#play.pause();
    } catch (error) {
      console.error('Could not return yarn ball to local play:', error);
      if (epoch === this.#ballEpoch) this.endYarnPlay();
    }
  }

  triggerBlink() {
    if (this.#stopped || this.#paused || !this.#pet.blink || this.state !== 'idle' || !this.#machine.enter('blink')) {
      return false;
    }
    clearTimeout(this.#blinkTimeout);
    this.#blinkTimeout = null;
    this.#blinkStartedAt = null;
    this.#blinkFrameRequest = requestAnimationFrame((now) => this.#tickBlink(now));
    return true;
  }

  triggerHappy() {
    const now = performance.now();
    if (this.#stopped || !this.#pet.happy || this.state === 'dragged'
      || this.state === 'happy' || now - this.#lastHappyAt < this.#pet.happy.cooldownMs) {
      return false;
    }
    if (this.#play?.snapshot.active) this.endYarnPlay({ restoreAmbient: false });
    if (this.state === 'sleep') {
      this.#returnFromInactivity();
      this.#activityTier = 'active';
    }
    if (this.state === 'blink' || this.state === 'wave') {
      this.#pendingHappy = true;
      return true;
    }
    this.#lastHappyAt = now;
    return this.#beginReaction('happy');
  }

  triggerWave() {
    if (this.#stopped || this.#paused || !this.#pet.wave || this.state !== 'idle') return false;
    this.#wavePending = false;
    return this.#beginReaction('wave');
  }

  beginDrag() {
    if (this.#stopped || this.state === 'dragged') return false;
    this.endYarnPlay({ restoreAmbient: false });
    this.#cancelActiveAnimation();
    this.#walk?.stop();
    this.#effects.clear();
    this.#pendingHappy = false;
    this.#wavePending = false;
    this.#machine.enter('dragged', { force: true });
    this.#art.classList.remove('walking', 'left', 'reacting', 'sleeping');
    this.#art.classList.add('dragged');
    return true;
  }

  endDrag(desktop) {
    if (this.state !== 'dragged') return;
    this.updateDesktop(desktop);
    this.#machine.enter('idle', { force: true });
    this.#art.classList.remove('dragged');
    if (!this.#stopped && !this.#paused) this.#scheduleAmbient(true);
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.endYarnPlay({ restoreAmbient: false });
    clearTimeout(this.#blinkTimeout);
    clearTimeout(this.#walkTimeout);
    clearTimeout(this.#waveTimeout);
    cancelAnimationFrame(this.#blinkFrameRequest);
    cancelAnimationFrame(this.#reactionRequest);
    this.#walk?.stop();
    this.#effects.clear();
    this.#blinkTimeout = null;
    this.#walkTimeout = null;
    this.#waveTimeout = null;
    this.#blinkFrameRequest = null;
    this.#reactionRequest = null;
    this.#overlay.style.opacity = '0';
    if (['blink', 'happy', 'wave', 'read', 'headphones', 'walk', 'dragged'].includes(this.state)) {
      this.#machine.enter('idle', { force: true });
    }
    this.#art.classList.remove('walking', 'left', 'reacting', 'dragged');
  }

  resume() {
    if (!this.#stopped) return;
    this.#stopped = false;
    if (!this.#paused) this.#scheduleAmbient(true);
  }

  #scheduleBlink(delay) {
    if (this.#stopped || this.#paused) return;
    clearTimeout(this.#blinkTimeout);
    const [defaultMin, defaultMax] = this.#pet.blink.intervalMs;
    const center = this.#blinkIntervalSeconds === null ? null : this.#blinkIntervalSeconds * 1000;
    const min = center === null ? defaultMin : center * 0.75;
    const max = center === null ? defaultMax : center * 1.25;
    this.#blinkTimeout = setTimeout(
      () => this.triggerBlink(),
      delay ?? (min + Math.random() * (max - min))
    );
  }

  #scheduleWalk(delay) {
    if (this.#stopped || this.#paused || this.#activityTier !== 'roam') return;
    clearTimeout(this.#walkTimeout);
    const [min, max] = this.#pet.walk.restMs;
    this.#walkTimeout = setTimeout(
      () => this.#startWalk(),
      delay ?? (min + Math.random() * (max - min))
    );
  }

  #scheduleWave(delay) {
    if (this.#stopped || this.#paused || (this.#activityTier !== 'light' && this.#activityTier !== 'roam')) return;
    const [min, max] = this.#pet.wave.intervalMs;
    clearTimeout(this.#waveTimeout);
    this.#waveTimeout = setTimeout(
      () => this.#startLightActivity(),
      delay ?? (min + Math.random() * (max - min))
    );
  }

  #scheduleAmbient(initial = false) {
    if (this.#stopped || this.#paused) return;
    if (this.#pet.blink) this.#scheduleBlink();
    if (this.#activityTier === 'roam' && this.#pet.walk) this.#scheduleWalk(initial ? this.#pet.walk.startAfterMs : undefined);
    if ((this.#activityTier === 'light' || this.#activityTier === 'roam') && this.#pet.wave) {
      this.#scheduleWave(initial ? this.#pet.wave.startAfterMs : undefined);
    }
  }

  #cancelActiveAnimation() {
    clearTimeout(this.#blinkTimeout);
    clearTimeout(this.#walkTimeout);
    clearTimeout(this.#waveTimeout);
    cancelAnimationFrame(this.#blinkFrameRequest);
    cancelAnimationFrame(this.#reactionRequest);
    this.#blinkTimeout = null;
    this.#walkTimeout = null;
    this.#waveTimeout = null;
    this.#blinkFrameRequest = null;
    this.#reactionRequest = null;
    this.#overlay.style.opacity = '0';
  }

  #startLightActivity() {
    this.#waveTimeout = null;
    if (this.#stopped || this.#paused || (this.#activityTier !== 'light' && this.#activityTier !== 'roam')) return;
    if (this.state !== 'idle') {
      this.#wavePending = true;
      return;
    }
    this.#wavePending = false;
    const choices = ['wave', 'read', 'headphones'].filter((name) => this.#pet[name]);
    this.#beginReaction(choices[Math.floor(Math.random() * choices.length)]);
  }

  #returnFromInactivity() {
    clearTimeout(this.#walkTimeout);
    clearTimeout(this.#waveTimeout);
    this.#walkTimeout = null;
    this.#waveTimeout = null;
    this.#wavePending = false;
    if (this.state === 'happy' || this.state === 'dragged') return;
    if (['walk', 'wave', 'read', 'headphones', 'sleep'].includes(this.state)) {
      this.#cancelActiveAnimation();
      this.#walk?.stop();
      this.#effects.clear();
      this.#art.classList.remove('walking', 'left', 'reacting', 'sleeping');
      this.#machine.enter('idle', { force: true });
      if (!this.#stopped && this.#pet.blink) this.#scheduleBlink();
    }
  }

  #beginSleep() {
    if (this.#stopped || this.#paused || !this.#pet.sleep || this.state === 'sleep' || this.state === 'dragged') return;
    if (['happy', 'wave', 'read', 'headphones'].includes(this.state)) return;
    this.#cancelActiveAnimation();
    this.#walk?.stop();
    this.#art.classList.remove('walking', 'left', 'reacting');
    for (const image of Object.values(this.#reactionFrames).flat()) image.style.opacity = '0';
    this.#reactionFrames.sleep[0].style.opacity = '1';
    for (const image of this.#reactionFrames.sleep.slice(1)) image.style.opacity = '0';
    this.#machine.enter('sleep', { force: true });
    this.#art.classList.add('sleeping');
    this.#effects.show(this.#pet.effects.sleep);
  }

  #beginReaction(name) {
    if (this.state === 'walk') this.#walk.stop();
    if (!this.#machine.enter(name)) return false;
    this.#cancelActiveAnimation();
    this.#art.classList.remove('walking', 'left');
    for (const image of Object.values(this.#reactionFrames).flat()) image.style.opacity = '0';
    this.#reactionFrames[name][0].style.opacity = '1';
    this.#art.classList.add('reacting');
    this.#effects.show(this.#pet.effects[name]);
    this.#reactionStartedAt = null;
    this.#reactionRequest = requestAnimationFrame((now) => this.#tickReaction(now, name));
    return true;
  }

  #tickReaction(now, name) {
    if (this.#stopped || this.state !== name) return;
    if (this.#reactionStartedAt === null) this.#reactionStartedAt = now;
    const elapsed = now - this.#reactionStartedAt;
    const { durationMs, cycleMs } = this.#pet[name];
    if (elapsed >= durationMs) {
      this.#finishReaction(name);
      return;
    }
    const frames = this.#reactionFrames[name];
    const cyclePhase = (elapsed % cycleMs) / cycleMs;
    const phase = cyclePhase * frames.length;
    const index = Math.floor(phase);
    const blend = frames.length === 2
      ? cyclePhase < 0.4 ? 0
        : cyclePhase < 0.5 ? easeInOutCubic((cyclePhase - 0.4) / 0.1)
          : cyclePhase < 0.9 ? 1 : 1 - easeInOutCubic((cyclePhase - 0.9) / 0.1)
      : easeInOutCubic(Math.max(0, Math.min(1, (phase - index - 0.58) / 0.42)));
    frames.forEach((image, frameIndex) => {
      image.style.opacity = String(frames.length === 2
        ? (frameIndex === 0 ? 1 - blend : blend)
        : frameIndex === index ? 1 - blend
          : frameIndex === (index + 1) % frames.length ? blend : 0);
    });
    this.#reactionRequest = requestAnimationFrame((nextNow) => this.#tickReaction(nextNow, name));
  }

  #finishReaction(name) {
    this.#reactionRequest = null;
    this.#reactionStartedAt = null;
    this.#art.classList.remove('reacting');
    this.#machine.complete();
    if (this.#pendingPlay) {
      this.#pendingPlay = false;
      this.startYarnPlay();
      return;
    }
    if (this.#pendingHappy && name !== 'happy') {
      this.#pendingHappy = false;
      this.triggerHappy();
      return;
    }
    if (this.#paused) return;
    if (this.#activityTier === 'sleep') {
      this.#beginSleep();
      return;
    }
    if (this.#pet.blink) this.#scheduleBlink();
    if (this.#activityTier === 'roam' && this.#pet.walk) this.#scheduleWalk(this.#pet.walk.startAfterMs);
    if ((this.#activityTier === 'light' || this.#activityTier === 'roam') && this.#pet.wave) this.#scheduleWave();
  }

  #startWalk() {
    if (this.#stopped || this.#paused || this.#activityTier !== 'roam') return;
    if (this.state !== 'idle' || !this.#machine.enter('walk')) {
      this.#scheduleWalk(350);
      return;
    }
    clearTimeout(this.#blinkTimeout);
    this.#blinkTimeout = null;
    this.#art.classList.add('walking');
    this.#walk.start();
  }

  #finishWalk() {
    this.#machine.enter('idle');
    this.#art.classList.remove('walking', 'left');
    if (this.#pet.blink) this.#scheduleBlink();
    if (this.#activityTier === 'roam') this.#scheduleWalk();
    if (this.#wavePending) {
      this.#wavePending = false;
      this.#scheduleWave(650);
    }
  }

  #paintWalkFrame(index, next, blend) {
    this.#walkFrames.forEach((image, frameIndex) => {
      image.style.opacity = String(frameIndex === index ? 1 - blend : frameIndex === next ? blend : 0);
    });
  }

  #tickBlink(now) {
    if (this.#stopped) return;
    if (this.#blinkStartedAt === null) this.#blinkStartedAt = now;
    const elapsed = now - this.#blinkStartedAt;
    const { closeMs, holdMs, openMs } = this.#pet.blink;
    const total = closeMs + holdMs + openMs;

    let closedOpacity;
    if (elapsed < closeMs) {
      closedOpacity = easeInOutCubic(Math.min(1, elapsed / closeMs));
    } else if (elapsed < closeMs + holdMs) {
      closedOpacity = 1;
    } else {
      closedOpacity = 1 - easeInOutCubic(Math.min(1, (elapsed - closeMs - holdMs) / openMs));
    }
    this.#overlay.style.opacity = String(closedOpacity);

    if (elapsed < total) {
      this.#blinkFrameRequest = requestAnimationFrame((nextNow) => this.#tickBlink(nextNow));
      return;
    }

    this.#overlay.style.opacity = '0';
    this.#blinkFrameRequest = null;
    this.#blinkStartedAt = null;
    this.#machine.complete();
    if (this.#pendingPlay) {
      this.#pendingPlay = false;
      this.startYarnPlay();
      return;
    }
    if (this.#pendingHappy) {
      this.#pendingHappy = false;
      this.triggerHappy();
      return;
    }
    if (this.#wavePending) {
      this.#wavePending = false;
      this.#scheduleWave(500);
    }
    if (Math.random() < this.#pet.blink.doubleBlinkChance) {
      this.#scheduleBlink(this.#pet.blink.doubleBlinkGapMs);
    } else {
      this.#scheduleBlink();
    }
  }
}
