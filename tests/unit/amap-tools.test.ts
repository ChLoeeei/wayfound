import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Set the env var BEFORE importing the module — the module reads it at top level.
process.env.AMAP_API_KEY = 'test-key';

import { searchPlaces, calculateDistance, parseLngLat } from '../../server/tools/amap';

describe('parseLngLat', () => {
  it('parses "lng,lat"', () => {
    expect(parseLngLat('116.404,39.915')).toEqual({ lng: 116.404, lat: 39.915 });
  });

  it('returns null for malformed input', () => {
    expect(parseLngLat('')).toBeNull();
    expect(parseLngLat('not-a-coord')).toBeNull();
  });
});

describe('searchPlaces', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns parsed POIs from a successful response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: '1',
          info: 'OK',
          count: '1',
          pois: [
            {
              id: 'B0FF',
              name: '外滩',
              address: '中山东一路',
              location: '121.490,31.241',
              type: '风景名胜',
              typecode: '110000',
              biz_ext: { rating: '4.7' },
              photos: [{ url: 'https://x/p.jpg' }],
            },
          ],
        }),
        { status: 200 },
      ),
    ) as any;

    const r = await searchPlaces('外滩', '上海');
    expect(r.count).toBe(1);
    expect(r.pois[0].name).toBe('外滩');
    expect(r.pois[0].rating).toBeCloseTo(4.7);
    expect(r.pois[0].photoUrl).toBe('https://x/p.jpg');
  });

  it('returns empty list for empty keywords without hitting network', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const r = await searchPlaces('   ');
    expect(r.pois).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when Amap returns status != 1', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: '0', info: 'INVALID_USER_KEY', count: '0' }), { status: 200 }),
    ) as any;
    await expect(searchPlaces('test')).rejects.toThrow(/INVALID_USER_KEY/);
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    await expect(searchPlaces('test')).rejects.toThrow(/HTTP 500/);
  });
});

describe('calculateDistance', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed distance + duration', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: '1',
          info: 'OK',
          results: [{ distance: '5400', duration: '900' }],
        }),
        { status: 200 },
      ),
    ) as any;

    const r = await calculateDistance({ lat: 31.241, lng: 121.490 }, { lat: 31.230, lng: 121.470 });
    expect(r.distanceMeters).toBe(5400);
    expect(r.durationSeconds).toBe(900);
  });

  it('returns 0 when results array is empty', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: '1', info: 'OK', results: [] }), { status: 200 }),
    ) as any;
    const r = await calculateDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 0 });
    expect(r.distanceMeters).toBe(0);
    expect(r.durationSeconds).toBe(0);
  });
});
