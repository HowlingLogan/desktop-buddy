'use strict';

const { powerMonitor } = require('electron');

class ActivityMonitor {
  #timer = null;
  #lastSeconds = null;
  #generation = 0;
  #lastReportedSeconds = null;
  #probeTicks = 0;
  #webContents;

  constructor(webContents, pollMs) {
    this.#webContents = webContents;
    this.pollMs = pollMs;
  }

  sample() {
    const seconds = Math.max(0, powerMonitor.getSystemIdleTime());
    if (this.#lastSeconds !== null && seconds < this.#lastSeconds) this.#generation += 1;
    this.#lastSeconds = seconds;
    return { seconds, generation: this.#generation };
  }

  start() {
    if (this.#timer) return;
    const tick = () => {
      const sample = this.sample();
      if (!this.#webContents.isDestroyed()) this.#webContents.send('pet:system-idle', sample);
      this.#probeTicks += 1;
      if (process.argv.includes('--stage5-system-test')
        && (sample.seconds !== this.#lastReportedSeconds || this.#probeTicks % 10 === 0)) {
        console.log('SYSTEM_IDLE_SAMPLE', JSON.stringify({ ...sample, at: new Date().toISOString() }));
        this.#lastReportedSeconds = sample.seconds;
      }
    };
    tick();
    this.#timer = setInterval(tick, this.pollMs);
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  setPollMs(pollMs) {
    if (this.pollMs === pollMs) return;
    const wasRunning = this.#timer !== null;
    this.stop();
    this.pollMs = pollMs;
    if (wasRunning) this.start();
  }
}

module.exports = { ActivityMonitor };
