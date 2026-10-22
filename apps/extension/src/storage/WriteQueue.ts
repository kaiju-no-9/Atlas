export class WriteQueue {
  private readonly pending = new Map<string, Promise<void>>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const settled = next.then(() => undefined, () => undefined);
    this.pending.set(key, settled);
    void settled.finally(() => {
      if (this.pending.get(key) === settled) this.pending.delete(key);
    });
    return next;
  }
}
