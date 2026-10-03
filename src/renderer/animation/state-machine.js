export class StateMachine {
  #states;
  #current = null;

  constructor(states) {
    this.#states = states;
  }

  get current() {
    return this.#current;
  }

  enter(name, { force = false } = {}) {
    if (!this.#states[name]) throw new Error(`Unknown pet state: ${name}`);
    if (!force && this.#current && this.#states[this.#current].loop === false) return false;
    this.#current = name;
    return true;
  }

  complete() {
    if (!this.#current) return false;
    const next = this.#states[this.#current].nextState;
    if (!next || !this.#states[next]) return false;
    this.#current = next;
    return true;
  }
}
