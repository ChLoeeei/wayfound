import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addDailyUsage, budgetExhausted, readDailyUsage, CheckpointStore, codeFingerprint, configKey } from '../eval/progress';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfound-progress-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('daily Geoapify budget', () => {
  it('accumulates within a UTC day and resets at UTC midnight', () => {
    const f = path.join(dir, 'usage.json');
    const day1 = new Date('2026-11-10T10:00:00Z');
    addDailyUsage(f, 1500, day1);
    expect(addDailyUsage(f, 1300, day1).requests).toBe(2800);
    expect(budgetExhausted(readDailyUsage(f, day1), 2700)).toBe(true);
    const day2 = new Date('2026-11-11T00:00:01Z');
    expect(readDailyUsage(f, day2)).toEqual({ date: '2026-11-11', requests: 0 });
    expect(budgetExhausted(readDailyUsage(f, day2), 2700)).toBe(false);
  });

  it('treats a missing or corrupt usage file as zero', () => {
    const f = path.join(dir, 'usage.json');
    expect(readDailyUsage(f).requests).toBe(0);
    fs.writeFileSync(f, '{not json');
    expect(readDailyUsage(f).requests).toBe(0);
  });
});

describe('CheckpointStore', () => {
  it('saves and resumes completed runs', () => {
    const a = new CheckpointStore<{ v: number }>(path.join(dir, 'ck'));
    expect(a.open({ k: 1 }, 'code-v1', false)).toBeNull();
    a.save('tokyo', 1, { v: 7 });
    const b = new CheckpointStore<{ v: number }>(path.join(dir, 'ck'));
    expect(b.open({ k: 1 }, 'code-v1', false)).toBeNull();
    expect(b.has('tokyo', 1)).toBe(true);
    expect(b.has('tokyo', 2)).toBe(false);
    expect(b.load('tokyo', 1)).toEqual({ v: 7 });
    expect(b.completedCount()).toBe(1);
  });

  it('refuses to resume across a code change unless explicitly allowed', () => {
    const a = new CheckpointStore(path.join(dir, 'ck'));
    a.open({}, 'code-v1', false);
    a.save('x', 1, {});
    expect(new CheckpointStore(path.join(dir, 'ck')).open({}, 'code-v2', false)).toMatch(/code changed/);
    expect(new CheckpointStore(path.join(dir, 'ck')).open({}, 'code-v2', true)).toBeNull();
  });

  it('archives instead of deleting on a fresh start', () => {
    const a = new CheckpointStore(path.join(dir, 'ck'));
    a.open({}, 'c', false);
    a.save('x', 1, {});
    const archived = a.archive()!;
    expect(fs.existsSync(path.join(archived, 'runs', 'x-r1.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'ck'))).toBe(false);
  });

  it('keys configs and code deterministically', () => {
    expect(configKey({ a: 1 })).toBe(configKey({ a: 1 }));
    expect(configKey({ a: 1 })).not.toBe(configKey({ a: 2 }));
    fs.writeFileSync(path.join(dir, 'x.ts'), 'one');
    const f1 = codeFingerprint(dir, ['x.ts']);
    fs.writeFileSync(path.join(dir, 'x.ts'), 'two');
    expect(codeFingerprint(dir, ['x.ts'])).not.toBe(f1);
  });
});

describe('Geoapify meter + HTTP-level cache', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.GEOAPIFY_PLACES_API_KEY = 'test-key';
    process.env.TOOL_CACHE_DIR = path.join(dir, 'cache');
    vi.resetModules();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GEOAPIFY_PLACES_API_KEY;
    delete process.env.TOOL_CACHE_DIR;
    vi.resetModules();
  });
  const near = { lat: 48.85, lng: 2.35 };
  const fc = { type: 'FeatureCollection', features: [{ properties: { place_id: 'p1', name: 'Louvre', formatted: 'Louvre, Paris', lon: 2.3376, lat: 48.8606, categories: ['tourism'] } }] };

  it('counts every request, serves repeats from cache, and caches genuine empty results', async () => {
    const { geoapifySearchPlaces, geoapifyMeterSnapshot } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async (url: string) =>
      new Response(JSON.stringify(new URL(url).searchParams.get('text') === 'Louvre' ? fc : { type: 'FeatureCollection', features: [] }), { status: 200 }),
    ) as any;
    await geoapifySearchPlaces('Louvre', near, 5000, 10);
    await geoapifySearchPlaces('Louvre', near, 5000, 10);
    await geoapifySearchPlaces('Nowhere', near, 5000, 10);
    await geoapifySearchPlaces('Nowhere', near, 5000, 10);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(geoapifyMeterSnapshot()).toEqual({ requests: 2, rateLimited: 0, quotaErrors: 0 });
  });

  it('meters 429s (with internal retries) and never caches them', async () => {
    const { geoapifySearchPlaces, geoapifyMeterSnapshot } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async () => new Response('{"message":"Too Many Requests"}', { status: 429 })) as any;
    expect(await geoapifySearchPlaces('Louvre', near, 5000, 10)).toEqual([]);
    const m = geoapifyMeterSnapshot();
    expect(m.rateLimited).toBe(3); // first attempt + 2 internal retries
    expect(m.requests).toBe(3);
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(fc), { status: 200 })) as any;
    expect((await geoapifySearchPlaces('Louvre', near, 5000, 10)).map(p => p.name)).toEqual(['Louvre']);
  }, 15000);

  it('shares the same raw query between retry-on and retry-off rows', async () => {
    const { geoapifySearchPlaces } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(fc), { status: 200 })) as any;
    process.env.DISABLE_GEOAPIFY_SIMPLIFIED_RETRY = 'true';
    await geoapifySearchPlaces('Louvre', near, 5000, 10);
    delete process.env.DISABLE_GEOAPIFY_SIMPLIFIED_RETRY;
    await geoapifySearchPlaces('Louvre', near, 5000, 10);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('network-failure handling', () => {
  it('classifies outages as infra errors, and bad model output as not', async () => {
    const { isInfraError } = await import('../../server/llm');
    for (const m of [
      'Invalid response body while trying to fetch https://api.deepseek.com/chat/completions: read ETIMEDOUT',
      'Invalid response body while trying to fetch https://api.deepseek.com/chat/completions: Socket timeout',
      'Request timed out.',
      'Connection error.',
      'fetch failed',
    ]) {
      expect(isInfraError(new Error(m)), m).toBe(true);
    }
    expect(isInfraError({ status: 503, message: 'Service Unavailable' })).toBe(true);
    expect(isInfraError({ status: 429, message: 'rate limited' })).toBe(true);
    expect(isInfraError(new Error('Unterminated string in JSON at position 24323 (line 1 column 24324)'))).toBe(false);
    expect(isInfraError({ status: 400, message: 'bad request' })).toBe(false);
  });

  it('moves matching completed runs to invalidated/ so they are redone', () => {
    const store = new CheckpointStore<{ error?: string }>(path.join(dir, 'ck'));
    store.open({}, 'c', false);
    store.save('ok', 1, {});
    store.save('net', 1, { error: 'read ETIMEDOUT' });
    expect(store.invalidate(r => !!r.error)).toEqual(['net-r1.json']);
    expect(store.has('net', 1)).toBe(false);
    expect(store.has('ok', 1)).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'ck', 'invalidated'))).toHaveLength(1);
  });

  it('records an accepted code change and adopts the new fingerprint', () => {
    const a = new CheckpointStore(path.join(dir, 'ck'));
    a.open({}, 'v1', false);
    a.save('x', 1, {});
    expect(new CheckpointStore(path.join(dir, 'ck')).open({}, 'v2', true, 'timeouts only')).toBeNull();
    const b = new CheckpointStore(path.join(dir, 'ck'));
    expect(b.open({}, 'v2', false)).toBeNull(); // no flag needed the second time
    expect(b.manifest()!.acceptedCodeChanges).toMatchObject([{ from: 'v1', to: 'v2', completedRunsBefore: 1, note: 'timeouts only' }]);
  });
});
