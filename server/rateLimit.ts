/**
 * Daily request caps for the routes that call the model or a map provider.
 *
 * Two counters, both reset at UTC midnight and kept in this process's
 * memory (one Render / Railway instance; a restart starts the day fresh):
 *
 *   per client IP  — RATE_LIMIT_PER_IP_DAILY  (default 60 units)
 *   site-wide      — RATE_LIMIT_GLOBAL_DAILY  (default 900 units)
 *
 * Routes are weighted by what they cost: a trip generation is 3 units
 * (one long tool loop, ~6–9 Geoapify calls), a replan 2, everything else
 * 1. So the defaults allow about 20 trips per IP and 300 trips site-wide
 * per day, which keeps the site under the Geoapify free tier (2 700
 * requests/day) even if every unit were a generation's worth of searches.
 * Set either variable to 0 to turn that cap off.
 *
 * A rejected request gets 429 with `{ error, code: 'rate_limited', scope:
 * 'ip' | 'global', resetAt }` and a `Retry-After` header; nothing is counted
 * for it. Counting happens before the work, so a request that then fails
 * still spends its units (the model call was most likely made).
 */
import type { NextFunction, Request, Response } from 'express';

export interface RateLimitConfig {
  perIpDaily: number;
  globalDaily: number;
  /** Injected clock for tests. */
  now?: () => number;
}

export type RateLimitDecision =
  | { ok: true; remaining: { ip: number; global: number }; resetAt: string }
  | { ok: false; scope: 'ip' | 'global'; limit: number; resetAt: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function readCap(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function rateLimitConfigFromEnv(): RateLimitConfig {
  return { perIpDaily: readCap('RATE_LIMIT_PER_IP_DAILY', 60), globalDaily: readCap('RATE_LIMIT_GLOBAL_DAILY', 900) };
}

export class DailyRateLimiter {
  private dayKey = '';
  private perIp = new Map<string, number>();
  private total = 0;
  private readonly now: () => number;

  constructor(private readonly cfg: RateLimitConfig) {
    this.now = cfg.now ?? Date.now;
  }

  get config(): Readonly<RateLimitConfig> {
    return this.cfg;
  }

  /** Midnight UTC after `t`, as an ISO string. */
  static resetAtFor(t: number): string {
    return new Date(Math.floor(t / DAY_MS) * DAY_MS + DAY_MS).toISOString();
  }

  private roll(): void {
    const key = String(Math.floor(this.now() / DAY_MS));
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.perIp.clear();
      this.total = 0;
    }
  }

  /** Counts `weight` units for `ip` if both caps allow it; otherwise says which cap refused. */
  consume(ip: string, weight = 1): RateLimitDecision {
    this.roll();
    const resetAt = DailyRateLimiter.resetAtFor(this.now());
    const used = this.perIp.get(ip) ?? 0;
    if (this.cfg.perIpDaily > 0 && used + weight > this.cfg.perIpDaily) return { ok: false, scope: 'ip', limit: this.cfg.perIpDaily, resetAt };
    if (this.cfg.globalDaily > 0 && this.total + weight > this.cfg.globalDaily) return { ok: false, scope: 'global', limit: this.cfg.globalDaily, resetAt };
    this.perIp.set(ip, used + weight);
    this.total += weight;
    return {
      ok: true,
      remaining: { ip: this.cfg.perIpDaily > 0 ? this.cfg.perIpDaily - used - weight : Infinity, global: this.cfg.globalDaily > 0 ? this.cfg.globalDaily - this.total : Infinity },
      resetAt,
    };
  }

  /** Current usage, for the status route / logs. */
  status(ip?: string): { day: string; total: number; ip?: number; resetAt: string } {
    this.roll();
    return { day: this.dayKey, total: this.total, ...(ip != null ? { ip: this.perIp.get(ip) ?? 0 } : {}), resetAt: DailyRateLimiter.resetAtFor(this.now()) };
  }
}

/** The client's IP: Express's `req.ip` (honours `trust proxy`), else the socket. */
export function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

/** Express middleware: consumes `weight` units for the request's IP or answers 429. */
export function rateLimit(limiter: DailyRateLimiter, weight = 1) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = clientIp(req);
    const decision = limiter.consume(ip, weight);
    if (decision.ok) {
      const left = Math.min(decision.remaining.ip, decision.remaining.global);
      res.setHeader('X-RateLimit-Remaining', String(left === Infinity ? -1 : left));
      return next();
    }
    const d = decision as Exclude<RateLimitDecision, { ok: true }>;
    const secs = Math.max(1, Math.ceil((Date.parse(d.resetAt) - Date.now()) / 1000));
    res.setHeader('Retry-After', String(secs));
    console.warn(`[rate-limit] ${d.scope} cap (${d.limit}/day) reached for ${req.method} ${req.path} from ${ip}`);
    res.status(429).json({
      error: d.scope === 'ip' ? 'Daily limit for this network reached; try again tomorrow.' : 'The site has reached its daily limit; try again tomorrow.',
      code: 'rate_limited',
      scope: d.scope,
      limit: d.limit,
      resetAt: d.resetAt,
    });
  };
}
