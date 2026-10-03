const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;

export class YarnPlayController {
  #ball;
  #frames;
  #jumpFrames;
  #jumpLayer;
  #contacts;
  #jumpAnchors;
  #ballCenter;
  #referenceSize;
  #config;
  #onComplete;
  #onJumpStart;
  #onJumpEnd;
  #onBallFrame;
  #request = null;
  #lastNow = null;
  #elapsed = 0;
  #batElapsed = 0;
  #phaseElapsed = 0;
  #phase = 'inactive';
  #ballX = 0;
  #ballY = 0;
  #slots = [];
  #park = { x: 0, y: 0 };
  #prepareFrom = { x: 0, y: 0 };
  #batStartIndex = 0;
  #batBaseCount = 0;
  #resumeSource = null;
  #batCount = 0;
  #frameIndex = 0;
  #motionProgress = 0;
  #jumpFrameIndex = -1;
  #jumpProgress = 0;
  #jumpX = 0;
  #jumpY = 0;
  #jumpHeight = 0;
  #jumpSide = 0;
  #jumpDirection = 1;
  #jumpCount = 0;
  #sessionCount = 0;
  #jumpDone = false;
  #active = false;
  #paused = false;

  constructor({ ball, frames, jumpFrames, jumpLayer, contacts, jumpAnchors, ballCenter,
    referencePetSizePx, config, onJumpStart, onJumpEnd, onComplete, onBallFrame }) {
    this.#ball = ball;
    this.#frames = frames;
    this.#jumpFrames = jumpFrames;
    this.#jumpLayer = jumpLayer;
    this.#contacts = contacts;
    this.#jumpAnchors = jumpAnchors;
    this.#ballCenter = ballCenter;
    this.#referenceSize = referencePetSizePx;
    this.#config = config;
    this.#onJumpStart = onJumpStart;
    this.#onJumpEnd = onJumpEnd;
    this.#onComplete = onComplete;
    this.#onBallFrame = onBallFrame;
  }

  get snapshot() {
    const ballWidth = Number.parseFloat(this.#ball.style.width) || this.#ball.getBoundingClientRect().width;
    const ballHeight = ballWidth * this.#ball.naturalHeight / this.#ball.naturalWidth;
    return {
      active: this.#active,
      paused: this.#paused,
      phase: this.#phase,
      visible: !this.#ball.hidden,
      ballX: this.#ballX,
      ballY: this.#ballY,
      leftX: this.#slots[0]?.x ?? 0,
      rightX: this.#slots[1]?.x ?? 0,
      ballWidth,
      bodyCenterX: this.#ballX + ballWidth * this.#ballCenter.x / this.#ball.naturalWidth,
      bodyCenterY: window.innerHeight - ballHeight + this.#ballY
        + ballHeight * this.#ballCenter.y / this.#ball.naturalHeight,
      parkBodyX: this.#park.x + ballWidth * this.#ballCenter.x / this.#ball.naturalWidth,
      parkBodyY: window.innerHeight - ballHeight + this.#park.y
        + ballHeight * this.#ballCenter.y / this.#ball.naturalHeight,
      parkX: this.#park.x,
      parkY: this.#park.y,
      slots: this.#slots,
      batCount: this.#batCount,
      frameIndex: this.#frameIndex,
      motionProgress: this.#motionProgress,
      jump: {
        active: this.#phase === 'jump' || this.#phase === 'landing',
        frameIndex: this.#jumpFrameIndex,
        progress: this.#jumpProgress,
        x: this.#jumpX,
        y: this.#jumpY,
        direction: this.#jumpDirection,
        count: this.#jumpCount,
        parkX: this.#park.x,
        parkY: this.#park.y,
        anchor: this.#visibleJumpAnchor()
      }
    };
  }

  updateConfig(config) { this.#config = config; }

  start() {
    if (this.#active) return false;
    this.#active = true;
    this.#paused = false;
    this.#phase = 'batting';
    this.#elapsed = 0;
    this.#batElapsed = 0;
    this.#phaseElapsed = 0;
    this.#batBaseCount = 0;
    this.#batStartIndex = 0;
    this.#resumeSource = null;
    this.#batCount = 0;
    this.#frameIndex = 0;
    this.#motionProgress = 0;
    this.#jumpFrameIndex = -1;
    this.#jumpProgress = 0;
    this.#jumpCount = 0;
    this.#jumpDone = false;
    this.#sessionCount += 1;
    this.#jumpDirection = this.#sessionCount % 2 === 1 ? 1 : -1;
    this.#lastNow = null;
    const sizeScale = this.#frames[0].getBoundingClientRect().width / this.#referenceSize;
    this.#ball.style.width = `${Math.min(this.#config.ballWidthPx * sizeScale, window.innerWidth * 0.4)}px`;
    this.#layoutSlots();
    this.#park = { x: (this.#slots[0].x + this.#slots[1].x) / 2,
      y: (this.#slots[0].y + this.#slots[1].y) / 2 };
    this.#ballX = this.#slots[0].x;
    this.#ballY = this.#slots[0].y;
    this.#showBatFrame(0);
    this.#jumpFrames.forEach((frame) => { frame.style.opacity = '0'; });
    this.#jumpLayer.style.transform = 'none';
    this.#ball.hidden = false;
    this.#paintBall();
    this.#request = requestAnimationFrame((now) => this.#tick(now));
    return true;
  }

  pause() {
    if (!this.#active || this.#paused) return;
    this.#paused = true;
    cancelAnimationFrame(this.#request);
    this.#request = null;
    this.#lastNow = null;
  }

  resume() {
    if (!this.#active || !this.#paused) return;
    this.#paused = false;
    this.#lastNow = null;
    if (this.#phase !== 'external' && this.#phase !== 'ready') this.#request = requestAnimationFrame((now) => this.#tick(now));
  }

  detach() {
    if (!this.#active || this.#phase === 'external') return false;
    const wasJumping = this.#phase === 'jump' || this.#phase === 'landing';
    cancelAnimationFrame(this.#request);
    this.#request = null;
    this.#lastNow = null;
    this.#phase = 'external';
    this.#ball.hidden = true;
    this.#frames.forEach((frame) => { frame.style.opacity = '0'; });
    this.#jumpFrames.forEach((frame) => { frame.style.opacity = '0'; });
    this.#jumpLayer.style.transform = 'none';
    this.#jumpFrameIndex = -1;
    this.#jumpX = 0;
    this.#jumpY = 0;
    if (wasJumping) this.#onJumpEnd();
    return true;
  }

  attachAt(x, top) {
    if (!this.prepareAttachAt(x, top)) return false;
    return this.commitAttach();
  }

  prepareAttachAt(x, top) {
    if (!this.#active || this.#phase !== 'external') return false;
    this.#layoutSlots();
    this.#park = { x: (this.#slots[0].x + this.#slots[1].x) / 2,
      y: (this.#slots[0].y + this.#slots[1].y) / 2 };
    const width = Number.parseFloat(this.#ball.style.width);
    const height = width * this.#ball.naturalHeight / this.#ball.naturalWidth;
    this.#ballX = clamp(x, 0, Math.max(0, window.innerWidth - width));
    this.#ballY = clamp(top - (window.innerHeight - height), height - window.innerHeight, 0);
    this.#resumeSource = { x: this.#ballX, y: this.#ballY };
    this.#phase = 'ready';
    this.#batElapsed = 0;
    this.#batBaseCount = this.#batCount;
    this.#batStartIndex = Math.abs(this.#ballX - this.#slots[0].x)
      < Math.abs(this.#ballX - this.#slots[1].x) ? 0 : 1;
    this.#motionProgress = 0;
    this.#showBatFrame(this.#batStartIndex);
    this.#ball.hidden = true;
    this.#lastNow = null;
    return true;
  }

  commitAttach() {
    if (!this.#active || this.#phase !== 'ready') return false;
    this.#phase = 'batting';
    this.#ball.hidden = false;
    this.#paintBall();
    if (!this.#paused) this.#request = requestAnimationFrame((now) => this.#tick(now));
    return true;
  }

  stop({ completed = false } = {}) {
    if (!this.#active) return;
    const wasJumping = this.#phase === 'jump' || this.#phase === 'landing';
    this.#active = false;
    this.#paused = false;
    this.#phase = 'inactive';
    cancelAnimationFrame(this.#request);
    this.#request = null;
    this.#lastNow = null;
    this.#ball.hidden = true;
    this.#frames.forEach((frame) => { frame.style.opacity = '0'; });
    this.#jumpFrames.forEach((frame) => { frame.style.opacity = '0'; });
    this.#jumpLayer.style.transform = 'none';
    this.#jumpX = 0;
    this.#jumpY = 0;
    this.#jumpFrameIndex = -1;
    if (wasJumping) this.#onJumpEnd();
    if (completed) this.#onComplete();
  }

  #layoutSlots() {
    const ballWidth = Number.parseFloat(this.#ball.style.width);
    const ballHeight = ballWidth * this.#ball.naturalHeight / this.#ball.naturalWidth;
    const bodyX = ballWidth * this.#ballCenter.x / this.#ball.naturalWidth;
    const bodyY = ballHeight * this.#ballCenter.y / this.#ball.naturalHeight;
    const maxX = Math.max(0, window.innerWidth - ballWidth);
    const minY = Math.min(0, ballHeight - window.innerHeight);
    this.#slots = this.#frames.map((frame, index) => {
      const rect = frame.getBoundingClientRect();
      const scale = Math.min(rect.width / frame.naturalWidth, rect.height / frame.naturalHeight);
      const drawX = rect.left + (rect.width - frame.naturalWidth * scale) / 2;
      const drawY = rect.top + rect.height - frame.naturalHeight * scale;
      const contactX = drawX + this.#contacts[index].x * scale;
      const contactY = drawY + this.#contacts[index].y * scale;
      return {
        x: clamp(contactX - bodyX, 0, maxX),
        y: clamp(contactY - (window.innerHeight - ballHeight + bodyY), minY, 0),
        contactX, contactY
      };
    });
    const contactTravel = this.#slots[1].x - this.#slots[0].x;
    const sizeScale = this.#frames[0].getBoundingClientRect().width / this.#referenceSize;
    const maxTravel = this.#config.ballTravelPx * sizeScale;
    if (Math.abs(contactTravel) > maxTravel) {
      const center = (this.#slots[0].x + this.#slots[1].x) / 2;
      const half = maxTravel / 2;
      this.#slots[0].x = center - Math.sign(contactTravel) * half;
      this.#slots[1].x = center + Math.sign(contactTravel) * half;
    }
  }

  #showBatFrame(index) {
    this.#frameIndex = index;
    this.#frames.forEach((frame, i) => { frame.style.opacity = i === index ? '1' : '0'; });
  }

  #showJumpFrame(index) {
    if (index === this.#jumpFrameIndex) return;
    this.#jumpFrameIndex = index;
    this.#jumpFrames.forEach((frame, i) => { frame.style.opacity = i === index ? '1' : '0'; });
  }

  #visibleJumpAnchor() {
    if (this.#jumpFrameIndex < 0) return null;
    const frame = this.#jumpFrames[this.#jumpFrameIndex];
    const rect = frame.getBoundingClientRect();
    const scale = Math.min(rect.width / frame.naturalWidth, rect.height / frame.naturalHeight);
    const drawX = rect.left + (rect.width - frame.naturalWidth * scale) / 2;
    const drawY = rect.top + rect.height - frame.naturalHeight * scale;
    return {
      x: drawX + this.#jumpAnchors[this.#jumpFrameIndex].bodyX * scale,
      footY: drawY + this.#jumpAnchors[this.#jumpFrameIndex].footY * scale
    };
  }

  #paintBall() {
    this.#ball.style.transform = `translate3d(${this.#ballX.toFixed(2)}px, ${this.#ballY.toFixed(2)}px, 0)`;
    if (!this.#ball.hidden && this.#onBallFrame) {
      const width = Number.parseFloat(this.#ball.style.width);
      const height = width * this.#ball.naturalHeight / this.#ball.naturalWidth;
      this.#onBallFrame({ x: this.#ballX, y: window.innerHeight - height + this.#ballY,
        width, height });
    }
  }

  #paintJump() {
    this.#jumpLayer.style.transform = `translate3d(${this.#jumpX.toFixed(2)}px, ${this.#jumpY.toFixed(2)}px, 0)`;
  }

  #tick(now) {
    if (!this.#active || this.#paused) return;
    if (this.#lastNow === null) this.#lastNow = now;
    const dt = Math.max(0, now - this.#lastNow);
    this.#lastNow = now;
    this.#elapsed += dt;
    if (this.#elapsed >= this.#config.durationSeconds * 1000) {
      this.stop({ completed: true });
      return;
    }
    if (this.#phase === 'batting') this.#tickBatting(dt);
    else if (this.#phase === 'prepare') this.#tickPrepare(dt);
    else if (this.#phase === 'jump') this.#tickJump(dt);
    else if (this.#phase === 'landing') this.#tickLanding(dt);
    this.#request = requestAnimationFrame((nextNow) => this.#tick(nextNow));
  }

  #tickBatting(dt) {
    this.#batElapsed += dt;
    const interval = this.#config.batIntervalMs;
    const travelMs = Math.min(this.#config.easeMs, interval * 0.8);
    const leg = Math.floor(this.#batElapsed / interval);
    const phase = this.#batElapsed - leg * interval;
    const from = (this.#batStartIndex + leg) % 2;
    const to = 1 - from;
    this.#motionProgress = clamp(phase / travelMs, 0, 1);
    const source = this.#resumeSource && leg === 0 ? this.#resumeSource : this.#slots[from];
    const eased = ease(this.#motionProgress);
    this.#ballX = source.x + (this.#slots[to].x - source.x) * eased;
    this.#ballY = source.y + (this.#slots[to].y - source.y) * eased;
    this.#paintBall();
    this.#batCount = this.#batBaseCount + leg + (this.#motionProgress >= 1 ? 1 : 0);
    const shown = this.#motionProgress >= 1 ? to : from;
    if (shown !== this.#frameIndex) this.#showBatFrame(shown);

    const jumpMs = this.#config.jumpPrepareMs + this.#config.jumpDurationMs
      + this.#config.jumpLandMs + 500;
    if (!this.#jumpDone && this.#jumpFrames.length === 3
      && this.#elapsed >= this.#config.jumpAfterSeconds * 1000
      && this.#motionProgress >= 1
      && this.#elapsed + jumpMs < this.#config.durationSeconds * 1000) {
      this.#jumpDone = true;
      this.#phase = 'prepare';
      this.#phaseElapsed = 0;
      this.#prepareFrom = { x: this.#ballX, y: this.#ballY };
    }
  }

  #tickPrepare(dt) {
    this.#phaseElapsed += dt;
    const p = clamp(this.#phaseElapsed / this.#config.jumpPrepareMs, 0, 1);
    const eased = ease(p);
    this.#ballX = this.#prepareFrom.x + (this.#park.x - this.#prepareFrom.x) * eased;
    this.#ballY = this.#prepareFrom.y + (this.#park.y - this.#prepareFrom.y) * eased;
    this.#paintBall();
    if (p >= 1) this.#beginJump();
  }

  #beginJump() {
    this.#phase = 'jump';
    this.#phaseElapsed = 0;
    this.#jumpProgress = 0;
    this.#jumpCount += 1;
    const ballWidth = Number.parseFloat(this.#ball.style.width);
    const parkBodyX = this.#park.x + ballWidth * this.#ballCenter.x / this.#ball.naturalWidth;
    const available = [];
    this.#jumpLayer.style.transform = 'none';
    this.#jumpFrames.forEach((frame, index) => {
      frame.style.left = '0px';
      frame.style.top = frame.dataset.baseTop;
      const rect = frame.getBoundingClientRect();
      const scale = Math.min(rect.width / frame.naturalWidth, rect.height / frame.naturalHeight);
      const drawX = rect.left + (rect.width - frame.naturalWidth * scale) / 2;
      const drawY = rect.top + rect.height - frame.naturalHeight * scale;
      const shiftX = parkBodyX - (drawX + this.#jumpAnchors[index].bodyX * scale);
      const shiftY = window.innerHeight - (drawY + this.#jumpAnchors[index].footY * scale);
      frame.style.left = `${shiftX.toFixed(2)}px`;
      frame.style.top = `${(Number.parseFloat(frame.style.top) + shiftY).toFixed(2)}px`;
      const alignedLeft = drawX + shiftX;
      available.push(alignedLeft, window.innerWidth - (alignedLeft + frame.naturalWidth * scale));
    });
    const sizeScale = this.#frames[0].getBoundingClientRect().width / this.#referenceSize;
    this.#jumpSide = Math.max(0, Math.min(this.#config.jumpSidePx * sizeScale, ...available));
    this.#jumpHeight = Math.max(0, Math.min(this.#config.jumpHeightPx * sizeScale,
      this.#jumpLayer.getBoundingClientRect().top - 8));
    this.#onJumpStart();
    this.#showJumpFrame(this.#jumpDirection === 1 ? 0 : 2);
    this.#jumpX = -this.#jumpDirection * this.#jumpSide;
    this.#jumpY = 0;
    this.#paintJump();
  }

  #tickJump(dt) {
    this.#phaseElapsed += dt;
    const p = clamp(this.#phaseElapsed / this.#config.jumpDurationMs, 0, 1);
    this.#jumpProgress = p;
    const sprite = p < 0.32 ? 0 : p < 0.68 ? 1 : 2;
    this.#showJumpFrame(this.#jumpDirection === 1 ? sprite : 2 - sprite);
    this.#jumpX = this.#jumpDirection * this.#jumpSide * (2 * ease(p) - 1);
    this.#jumpY = -this.#jumpHeight * Math.sin(Math.PI * ease(p));
    this.#paintJump();
    if (p >= 1) {
      this.#phase = 'landing';
      this.#phaseElapsed = 0;
      this.#jumpY = 0;
      this.#paintJump();
    }
  }

  #tickLanding(dt) {
    this.#phaseElapsed += dt;
    if (this.#phaseElapsed < this.#config.jumpLandMs) return;
    this.#phase = 'batting';
    this.#phaseElapsed = 0;
    this.#batElapsed = 0;
    this.#batBaseCount = this.#batCount;
    this.#batStartIndex = this.#jumpDirection === 1 ? 1 : 0;
    this.#resumeSource = { ...this.#park };
    this.#showBatFrame(this.#batStartIndex);
    this.#jumpFrames.forEach((frame) => { frame.style.opacity = '0'; });
    this.#jumpLayer.style.transform = 'none';
    this.#jumpX = 0;
    this.#jumpY = 0;
    this.#jumpFrameIndex = -1;
    this.#onJumpEnd();
  }
}
