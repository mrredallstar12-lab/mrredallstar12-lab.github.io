export class RateLimitRepository {
  constructor(db) {
    this.db = db;
  }

  async check(bucketKey, limit, windowSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const resetAt = now + windowSeconds;
    const row = await this.db.prepare("SELECT count, reset_at FROM auth_rate_limits WHERE bucket_key = ?").bind(bucketKey).first();
    if (!row || Number(row.reset_at) <= now) {
      await this.db.prepare("INSERT OR REPLACE INTO auth_rate_limits (bucket_key, count, reset_at) VALUES (?, 1, ?)").bind(bucketKey, resetAt).run();
      return { ok: true, remaining: limit - 1, resetAt };
    }
    if (Number(row.count) >= limit) return { ok: false, remaining: 0, resetAt: Number(row.reset_at) };
    await this.db.prepare("UPDATE auth_rate_limits SET count = count + 1 WHERE bucket_key = ?").bind(bucketKey).run();
    return { ok: true, remaining: limit - Number(row.count) - 1, resetAt: Number(row.reset_at) };
  }
}

