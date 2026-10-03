export class Effects {
  #layer;
  #timeout = null;

  constructor(layer) {
    this.#layer = layer;
  }

  show(effect) {
    this.clear();
    if (!effect) return;
    const element = document.createElement('span');
    element.className = `effect effect--${effect.kind}`;
    element.textContent = effect.text;
    element.style.animationDuration = `${effect.durationMs}ms`;
    this.#layer.appendChild(element);
    this.#timeout = setTimeout(() => this.clear(), effect.durationMs);
  }

  clear() {
    clearTimeout(this.#timeout);
    this.#timeout = null;
    this.#layer.replaceChildren();
  }

  get currentText() {
    return this.#layer.textContent;
  }
}
