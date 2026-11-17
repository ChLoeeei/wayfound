import { describe, expect, it, vi } from 'vitest';
import { DailyRateLimiter, clientIp, rateLimit, rateLimitConfigFromEnv } from '../../server/rateLimit';

const DAY = 24 * 60 * 60 * 1000;

describe('DailyRateLimiter', () => {
  it('caps each IP and the whole site per UTC day, weighted', () => {
    let now = Date.UTC(2026, 10, 17, 10, 0, 0);
    const l = new DailyRateLimiter({ perIpDaily: 6, globalDaily: 10, now: () => now });
    expect(l.consume('a', 3)).toMatchObject({ ok: true, remaining: { ip: 3, global: 7 } });
    expect(l.consume('a', 3)).toMatchObject({ ok: true, remaining: { ip: 0, global: 4 } });
    expect(l.consume('a', 1)).toMatchObject({ ok: false, scope: 'ip', limit: 6, resetAt: '2026-11-18T00:00:00.000Z' });
    // Another IP is still allowed, until the site-wide cap is hit.
    expect(l.consume('b', 3)).toMatchObject({ ok: true, remaining: { ip: 3, global: 1 } });
    expect(l.consume('b', 2)).toMatchObject({ ok: false, scope: 'global', limit: 10 });
    expect(l.consume('b', 1)).toMatchObject({ ok: true });
    expect(l.status('a')).toMatchObject({ total: 10, ip: 6 });
    // A refused request is not counted.
    expect(l.status('b').ip).toBe(4);
    // Midnight UTC resets both counters.
    now += DAY;
    expect(l.consume('a', 3)).toMatchObject({ ok: true, remaining: { ip: 3, global: 7 } });
    expect(l.status().total).toBe(3);
  });

  it('a cap of 0 turns that cap off', () => {
    const l = new DailyRateLimiter({ perIpDaily: 0, globalDaily: 2 });
    expect(l.consume('a', 1).ok).toBe(true);
    expect(l.consume('a', 1).ok).toBe(true);
    expect(l.consume('a', 1)).toMatchObject({ ok: false, scope: 'global' });
    const none = new DailyRateLimiter({ perIpDaily: 0, globalDaily: 0 });
    for (let i = 0; i < 50; i++) expect(none.consume('a', 3).ok).toBe(true);
  });

  it('reads the caps from the environment with safe defaults', () => {
    const saved = { ip: process.env.RATE_LIMIT_PER_IP_DAILY, g: process.env.RATE_LIMIT_GLOBAL_DAILY };
    try {
      delete process.env.RATE_LIMIT_PER_IP_DAILY;
      delete process.env.RATE_LIMIT_GLOBAL_DAILY;
      expect(rateLimitConfigFromEnv()).toEqual({ perIpDaily: 60, globalDaily: 900 });
      process.env.RATE_LIMIT_PER_IP_DAILY = '12';
      process.env.RATE_LIMIT_GLOBAL_DAILY = 'nope';
      expect(rateLimitConfigFromEnv()).toEqual({ perIpDaily: 12, globalDaily: 900 });
      process.env.RATE_LIMIT_GLOBAL_DAILY = '0';
      expect(rateLimitConfigFromEnv().globalDaily).toBe(0);
    } finally {
      if (saved.ip == null) delete process.env.RATE_LIMIT_PER_IP_DAILY;
      else process.env.RATE_LIMIT_PER_IP_DAILY = saved.ip;
      if (saved.g == null) delete process.env.RATE_LIMIT_GLOBAL_DAILY;
      else process.env.RATE_LIMIT_GLOBAL_DAILY = saved.g;
    }
  });
});

describe('rateLimit middleware', () => {
  const mockRes = () => {
    const res: any = { headers: {} as Record<string, string>, statusCode: 200, body: undefined as unknown };
    res.setHeader = (k: string, v: string) => {
      res.headers[k] = v;
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (b: unknown) => {
      res.body = b;
      return res;
    };
    return res;
  };

  it('lets requests through until the cap, then answers 429 with the reason and reset time', () => {
    const l = new DailyRateLimiter({ perIpDaily: 3, globalDaily: 100, now: () => Date.UTC(2026, 10, 17, 23, 0, 0) });
    const mw = rateLimit(l, 3);
    const req: any = { ip: '::ffff:203.0.113.9', method: 'POST', path: '/api/generate-itinerary', socket: {} };
    const next = vi.fn();
    const ok = mockRes();
    mw(req, ok, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(ok.headers['X-RateLimit-Remaining']).toBe('0');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocked = mockRes();
    mw(req, blocked, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'rate_limited', scope: 'ip', limit: 3, resetAt: '2026-11-18T00:00:00.000Z' });
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
    expect(l.status('203.0.113.9').ip).toBe(3); // IPv4-mapped prefix stripped, refused call not counted
    warn.mockRestore();
  });

  it('keys on req.ip (trust proxy) and falls back to the socket address', () => {
    expect(clientIp({ ip: '::ffff:10.0.0.1', socket: { remoteAddress: '1.1.1.1' } } as any)).toBe('10.0.0.1');
    expect(clientIp({ ip: undefined, socket: { remoteAddress: '1.1.1.1' } } as any)).toBe('1.1.1.1');
    expect(clientIp({ ip: undefined, socket: {} } as any)).toBe('unknown');
  });
});
