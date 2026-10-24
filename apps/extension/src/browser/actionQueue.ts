export class ActionQueueError extends Error {
  readonly code = "ACTION_TIMEOUT";
  readonly retryable = true;
  constructor(tabId: number, timeoutMs: number) { super(`Action on tab ${tabId} timed out after ${timeoutMs}ms`); this.name = "ActionQueueError"; }
}

/** Serializes mutations per tab. A rejection never poisons the following queue item. */
export class ActionQueue {
  private readonly tails = new Map<number, Promise<void>>();
  private readonly timeoutMs: number;
  constructor(timeoutMs = 8000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new RangeError("timeoutMs must be a positive integer");
    this.timeoutMs = timeoutMs;
  }

  enqueue<T>(tabId: number, action: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
    if (!Number.isInteger(tabId) || tabId < 0) return Promise.reject(new TypeError("tabId must be a non-negative integer"));
    const previous = this.tails.get(tabId) ?? Promise.resolve();
    let release!: () => void;
    const tail = previous.then(() => new Promise<void>((resolve) => { release = resolve; }));
    this.tails.set(tabId, tail);
    void tail.then(() => { if (this.tails.get(tabId) === tail) this.tails.delete(tabId); });
    return previous.then(() => new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        reject(new ActionQueueError(tabId, this.timeoutMs));
      }, this.timeoutMs);
      Promise.resolve().then(() => action(controller.signal)).then(resolve, reject).finally(() => {
        clearTimeout(timer);
        release();
      });
    }));
  }
}
