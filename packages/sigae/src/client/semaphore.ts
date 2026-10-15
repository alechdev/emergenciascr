/** Limits how many requests run at once. Waiters are served in order. */
export class Semaphore {
  #available: number;
  readonly #waiters: Array<() => void> = [];

  constructor(max: number) {
    this.#available = max;
  }

  /** Resolves with a release function, or rejects with the signal's reason if it aborts. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.#available > 0) {
      this.#available--;
      return Promise.resolve(this.#releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(this.#releaser());
      };
      const onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index !== -1) this.#waiters.splice(index, 1);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiters.shift();
      if (next) next();
      else this.#available++;
    };
  }
}
