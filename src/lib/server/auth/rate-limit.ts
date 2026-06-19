export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now = new Date()): RateLimitResult {
    const normalizedKey = key.trim() || "anonymous";
    const current = now.getTime();
    const bucket = this.buckets.get(normalizedKey);

    if (!bucket || bucket.resetAt <= current) {
      this.buckets.set(normalizedKey, { count: 1, resetAt: current + this.windowMs });
      return { allowed: true };
    }

    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
      };
    }

    bucket.count += 1;
    return { allowed: true };
  }

  reset(key: string) {
    this.buckets.delete(key.trim() || "anonymous");
  }
}
