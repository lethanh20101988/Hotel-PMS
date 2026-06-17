/** Token bucket đơn giản — giới hạn message/socket tránh spam. */

export type RateLimiterOptions = {
  maxMessages: number;
  windowMs: number;
};

export class MessageRateLimiter {
  private readonly maxMessages: number;
  private readonly windowMs: number;

  constructor(opts: RateLimiterOptions = { maxMessages: 60, windowMs: 60_000 }) {
    this.maxMessages = opts.maxMessages;
    this.windowMs = opts.windowMs;
  }

  allow(timestamps: number[]): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }
    if (timestamps.length >= this.maxMessages) return false;
    timestamps.push(now);
    return true;
  }
}
