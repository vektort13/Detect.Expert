// Sliding-window limiter: at most `limit` acquisitions in any trailing `windowMs`. Equivalent to a token
// bucket of `limit / windowMs` with no initial burst, so "20 batches/s/document" (REQ-011) holds for every
// one-second window, not only on average. O(1) per call, fixed memory.

export class RateLimiter {
  private readonly stamps: number[];
  private head = 0;
  private filled = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    this.stamps = new Array<number>(limit).fill(0);
  }

  /** Consumes a slot if one is free at `now`. */
  tryAcquire(now: number): boolean {
    if (this.filled < this.limit) {
      this.stamps[(this.head + this.filled) % this.limit] = now;
      this.filled++;
      return true;
    }
    const oldest = this.stamps[this.head] ?? 0;
    if (now - oldest < this.windowMs) return false;
    this.stamps[this.head] = now;
    this.head = (this.head + 1) % this.limit;
    return true;
  }

  /** Milliseconds until a slot frees up; 0 when one is available now. */
  waitMs(now: number): number {
    if (this.filled < this.limit) return 0;
    const oldest = this.stamps[this.head] ?? 0;
    const wait = this.windowMs - (now - oldest);
    return wait > 0 ? wait : 0;
  }
}
