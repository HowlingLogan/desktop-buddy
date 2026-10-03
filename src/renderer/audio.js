export class AudioManager {
  #muted;
  #playing = new Set();

  constructor(muted = false) {
    this.#muted = muted;
  }

  get muted() {
    return this.#muted;
  }

  setMuted(muted) {
    this.#muted = Boolean(muted);
    for (const audio of this.#playing) audio.muted = this.#muted;
  }

  async play(url, volume = 1) {
    if (!url || this.#muted) return false;
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.muted = this.#muted;
    this.#playing.add(audio);
    audio.addEventListener('ended', () => this.#playing.delete(audio), { once: true });
    try {
      await audio.play();
      return true;
    } catch {
      this.#playing.delete(audio);
      return false;
    }
  }

  stopAll() {
    for (const audio of this.#playing) audio.pause();
    this.#playing.clear();
  }
}
