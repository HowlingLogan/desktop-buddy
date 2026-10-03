const approach = (value, target, amount) => Math.min(target, value + amount);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class WalkController {
  #config;
  #desktop;
  #setPosition;
  #onFrame;
  #onDirection;
  #onFinish;
  #frameCount;
  #request = null;
  #turnTimeout = null;
  #lastNow = null;
  #positionX;
  #visualX;
  #lastSentX = null;
  #speed = 0;
  #direction = -1;
  #distanceTravelled = 0;
  #traversals = 0;
  #running = false;
  #frameIndex = 0;
  #frameChanges = 0;
  #finishing = false;

  constructor({ config, desktop, frameCount, setPosition, onFrame, onDirection, onFinish }) {
    this.#config = config;
    this.#desktop = desktop;
    this.#positionX = desktop.x;
    this.#visualX = desktop.x;
    this.#frameCount = frameCount;
    this.#setPosition = setPosition;
    this.#onFrame = onFrame;
    this.#onDirection = onDirection;
    this.#onFinish = onFinish;
  }

  get snapshot() {
    return {
      x: this.#visualX,
      targetX: this.#positionX,
      minX: this.#desktop.minX,
      maxX: this.#desktop.maxX,
      direction: this.#direction,
      frameIndex: this.#frameIndex,
      frameChanges: this.#frameChanges,
      traversals: this.#traversals
    };
  }

  updateDesktop(desktop) {
    this.#desktop = desktop;
    this.#positionX = clamp(desktop.x, desktop.minX, desktop.maxX);
    this.#visualX = this.#positionX;
    this.#lastSentX = null;
    this.#emitPosition();
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#lastNow = null;
    this.#speed = 0;
    this.#distanceTravelled = 0;
    this.#traversals = 0;
    this.#finishing = false;
    this.#direction = this.#positionX > (this.#desktop.minX + this.#desktop.maxX) / 2 ? -1 : 1;
    this.#onDirection(this.#direction);
    this.#paintFrame();
    this.#request = requestAnimationFrame((now) => this.#tick(now));
  }

  stop() {
    this.#running = false;
    cancelAnimationFrame(this.#request);
    clearTimeout(this.#turnTimeout);
    this.#request = null;
    this.#turnTimeout = null;
    this.#positionX = this.#visualX;
  }

  #tick(now) {
    if (!this.#running) return;
    if (this.#lastNow === null) this.#lastNow = now;
    const dt = Math.min(Math.max((now - this.#lastNow) / 1000, 0), 0.05);
    this.#lastNow = now;

    const boundary = this.#direction > 0 ? this.#desktop.maxX : this.#desktop.minX;
    const remaining = Math.abs(boundary - this.#positionX);
    const comfortableSpeed = Math.sqrt(2 * this.#config.decelerationPxPerSecond2 * remaining);
    const targetSpeed = Math.min(this.#config.speedPxPerSecond, comfortableSpeed);
    if (this.#speed < targetSpeed) {
      this.#speed = approach(this.#speed, targetSpeed, this.#config.accelerationPxPerSecond2 * dt);
    } else {
      this.#speed = Math.max(targetSpeed, this.#speed - this.#config.decelerationPxPerSecond2 * dt);
    }

    const distance = Math.min(remaining, this.#speed * dt);
    this.#positionX += this.#direction * distance;
    this.#advanceVisual(dt);
    this.#paintFrame();

    if (remaining - distance <= 0.5) {
      this.#positionX = boundary;
      this.#speed = 0;
      this.#traversals += 1;
      if (this.#traversals >= this.#config.traversalsPerWalk) {
        this.#finishing = true;
      } else {
        this.#turnTimeout = setTimeout(() => {
          if (!this.#running) return;
          cancelAnimationFrame(this.#request);
          this.#visualX = boundary;
          this.#emitPosition();
          this.#direction *= -1;
          this.#onDirection(this.#direction);
          this.#lastNow = null;
          this.#request = requestAnimationFrame((nextNow) => this.#tick(nextNow));
        }, this.#config.turnPauseMs);
      }
      this.#request = requestAnimationFrame((nextNow) => this.#settle(nextNow));
      return;
    }

    this.#request = requestAnimationFrame((nextNow) => this.#tick(nextNow));
  }

  #settle(now) {
    if (!this.#running) return;
    const dt = Math.min(Math.max((now - this.#lastNow) / 1000, 0), 0.05);
    this.#lastNow = now;
    this.#advanceVisual(dt);
    this.#paintFrame();
    if (Math.abs(this.#positionX - this.#visualX) > 0.25) {
      this.#request = requestAnimationFrame((nextNow) => this.#settle(nextNow));
    } else {
      this.#visualX = this.#positionX;
      this.#emitPosition();
      this.#request = null;
      if (this.#finishing) {
        this.stop();
        this.#onFinish();
      }
    }
  }

  #advanceVisual(dt) {
    const previous = this.#visualX;
    const factor = 1 - Math.exp(-dt * 1000 / this.#config.positionSmoothingMs);
    this.#visualX += (this.#positionX - this.#visualX) * factor;
    if (Math.abs(this.#positionX - this.#visualX) < 0.25) this.#visualX = this.#positionX;
    this.#distanceTravelled += Math.abs(this.#visualX - previous);
    this.#emitPosition();
  }

  #emitPosition() {
    const rounded = Math.round(this.#visualX);
    if (rounded === this.#lastSentX) return;
    this.#lastSentX = rounded;
    this.#setPosition(this.#visualX);
  }

  #paintFrame() {
    const phase = this.#distanceTravelled / this.#config.strideLengthPx * this.#frameCount;
    const index = Math.floor(phase) % this.#frameCount;
    const fraction = phase - Math.floor(phase);
    const blendProgress = clamp((fraction - 0.58) / 0.42, 0, 1);
    const blend = blendProgress * blendProgress * (3 - 2 * blendProgress);
    if (index !== this.#frameIndex) this.#frameChanges += 1;
    this.#frameIndex = index;
    this.#onFrame(index, (index + 1) % this.#frameCount, blend);
  }
}
