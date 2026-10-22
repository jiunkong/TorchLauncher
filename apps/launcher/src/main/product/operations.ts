/** One operation owns the product root until all cancellation/cleanup has settled. */
export class Operations {
  private active: { controller: AbortController; task: Promise<unknown> } | undefined;
  private closing = false;
  get busy() {
    return this.active !== undefined;
  }
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active || this.closing) return Promise.reject(new Error('busy'));
    const controller = new AbortController();
    // Reserve synchronously, before user code or await can re-enter.
    const task = Promise.resolve()
      .then(() => work(controller.signal))
      .finally(() => {
        if (this.active?.task === task) this.active = undefined;
      });
    this.active = { controller, task };
    return task;
  }
  cancel() {
    this.active?.controller.abort();
  }
  async close() {
    this.closing = true;
    this.cancel();
    await this.active?.task.catch(() => {});
  }
}
