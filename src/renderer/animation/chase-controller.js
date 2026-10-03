const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class ChaseController {
  #onPosition;
  #onFrame;
  #onDirection;
  #onFinish;
  #canFinish;
  #frameCount;
  #speed;
  #frameIntervalMs;
  #gaitElapsedMs = 0;
  #x = 0;
  #y = 0;
  #targetX = 0;
  #targetY = 0;
  #stopDistance = 0;
  #distanceTravelled = 0;
  #frameChanges = 0;
  #frameIndex = 0;
  #direction = 1;
  #running = false;
  #paused = false;
  #lastNow = null;
  #request = null;

  constructor({ frameCount, onPosition, onFrame, onDirection, onFinish, canFinish = () => true }) {
    this.#frameCount = frameCount;
    this.#onPosition = onPosition;
    this.#onFrame = onFrame;
    this.#onDirection = onDirection;
    this.#onFinish = onFinish;
    this.#canFinish = canFinish;
  }

  get snapshot() {
    return { active: this.#running, paused: this.#paused, x: this.#x, y: this.#y,
      targetX: this.#targetX, targetY: this.#targetY,
      direction: this.#direction, frameIndex: this.#frameIndex,
      frameChanges: this.#frameChanges, distanceTravelled: this.#distanceTravelled,
      speedPxPerSecond: this.#speed, frameIntervalMs: this.#frameIntervalMs };
  }

  start({ x, y, targetX, targetY, speed, frameIntervalMs, stopDistance }) {
    this.stop();
    this.#x = x;
    this.#y = y;
    this.#targetX = targetX;
    this.#targetY = targetY;
    this.#speed = speed;
    this.#frameIntervalMs = frameIntervalMs;
    this.#stopDistance = stopDistance;
    this.#distanceTravelled = 0;
    this.#gaitElapsedMs = 0;
    this.#frameChanges = 0;
    this.#frameIndex = 0;
    this.#lastNow = null;
    this.#paused = false;
    this.#running = true;
    this.#request = requestAnimationFrame((now) => this.#tick(now));
  }

  pause() {
    if (!this.#running || this.#paused) return;
    this.#paused = true;
    cancelAnimationFrame(this.#request);
    this.#request = null;
    this.#lastNow = null;
  }

  resume() {
    if (!this.#running || !this.#paused) return;
    this.#paused = false;
    this.#lastNow = null;
    this.#request = requestAnimationFrame((now) => this.#tick(now));
  }

  stop() {
    cancelAnimationFrame(this.#request);
    this.#request = null;
    this.#running = false;
    this.#paused = false;
    this.#lastNow = null;
  }

  setTarget(x, y) {
    if (!this.#running || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.#targetX = x;
    this.#targetY = y;
  }

  #tick(now) {
    if (!this.#running || this.#paused) return;
    if (this.#lastNow === null) this.#lastNow = now;
    const dt = clamp((now - this.#lastNow) / 1000, 0, 0.05);
    this.#lastNow = now;
    const dx = this.#targetX - this.#x;
    const dy = this.#targetY - this.#y;
    const remaining = Math.hypot(dx, dy);
    if (remaining <= this.#stopDistance + 0.75 && this.#canFinish()) {
      this.stop();
      this.#onFinish({ x: this.#x, y: this.#y });
      return;
    }
    if (Math.abs(dx) > 1) {
      this.#direction = Math.sign(dx);
      this.#onDirection(this.#direction);
    }
    const travel = Math.max(0, Math.min(remaining - this.#stopDistance, this.#speed * dt,
      Math.max(30, remaining * 3) * dt));
    this.#x += dx / remaining * travel;
    this.#y += dy / remaining * travel;
    this.#distanceTravelled += travel;
    this.#onPosition(this.#x, this.#y);
    if (travel > 0.02) this.#gaitElapsedMs += dt * 1000;
    const phase = this.#gaitElapsedMs / this.#frameIntervalMs;
    const index = Math.floor(phase) % this.#frameCount;
    const fraction = phase - Math.floor(phase);
    const t = clamp((fraction - 0.58) / 0.42, 0, 1);
    const blend = t * t * (3 - 2 * t);
    if (index !== this.#frameIndex) this.#frameChanges += 1;
    this.#frameIndex = index;
    this.#onFrame(index, (index + 1) % this.#frameCount, blend);
    this.#request = requestAnimationFrame((next) => this.#tick(next));
  }
}
