// Coalesces draft snapshots: trailing debounce, a max wait from the first unsaved change,
// one write at a time, and a rewrite when a newer snapshot arrived during a write (plan §5).

/** A timer bound to the caller's context (a mod passes one built from its current `cx`). */
export interface Timer {
  now(): number;
  after(ms: number, fn: () => void): { cancel(): void };
}

export interface DraftSink<T> { save(snapshot: T): Promise<void> }

export interface DraftWriterOptions {
  debounceMs: number;
  maxWaitMs: number;
  onError?: (error: unknown) => void;
}

export class DraftWriter<T> {
  private pending: { value: T } | null = null;
  private firstPendingAt: number | null = null;
  private timer: { cancel(): void } | null = null;
  private writing: Promise<void> | null = null;

  constructor(private sink: DraftSink<T>, private clock: { now(): number }, private opts: DraftWriterOptions) {}

  /** Records the latest snapshot and schedules a write. */
  update(value: T, timer: Timer): void {
    this.pending = { value };
    this.firstPendingAt ??= this.clock.now();
    this.timer?.cancel();
    const waited = this.clock.now() - this.firstPendingAt;
    const delay = Math.max(0, Math.min(this.opts.debounceMs, this.opts.maxWaitMs - waited));
    this.timer = timer.after(delay, () => { this.timer = null; void this.kick(); });
  }

  /** Writes the pending snapshot now (e.g. on close). Resolves when nothing is pending. */
  async flush(): Promise<void> {
    this.timer?.cancel();
    this.timer = null;
    await this.kick();
    while (this.writing) await this.writing;
  }

  /** Forgets the pending snapshot (the edits were saved or discarded). A write already running finishes. */
  discard(): void {
    this.timer?.cancel();
    this.timer = null;
    this.pending = null;
    this.firstPendingAt = null;
  }

  private kick(): Promise<void> {
    if (this.writing) return this.writing;
    if (!this.pending) return Promise.resolve();
    this.writing = (async () => {
      while (this.pending) {
        const { value } = this.pending;
        this.pending = null;
        this.firstPendingAt = null;
        try { await this.sink.save(value); }
        catch (e) {
          // Keep the snapshot so flush() or the next change retries it, unless a newer one arrived.
          if (!this.pending) { this.pending = { value }; this.firstPendingAt ??= this.clock.now(); }
          this.opts.onError?.(e);
          break;
        }
      }
    })().finally(() => { this.writing = null; });
    return this.writing;
  }
}
