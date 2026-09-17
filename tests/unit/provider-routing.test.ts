import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isLikelyMainlandChina, getMapProvider, parseLngLat } from '../../server/tools/provider';

describe('isLikelyMainlandChina', () => {
  it('recognises mainland China cities by Chinese name', () => {
    expect(isLikelyMainlandChina('北京')).toBe(true);
    expect(isLikelyMainlandChina('上海浦东')).toBe(true);
    expect(isLikelyMainlandChina('成都, 重庆')).toBe(true);
  });

  it('recognises mainland China cities by English name, case-insensitively (hardened)', () => {
    expect(isLikelyMainlandChina('Beijing')).toBe(true);
    expect(isLikelyMainlandChina('beijing')).toBe(true);
    expect(isLikelyMainlandChina('BEIJING')).toBe(true);
    expect(isLikelyMainlandChina('A weekend in Chengdu')).toBe(true);
    expect(isLikelyMainlandChina("Xi'an")).toBe(true);
  });

  it('recognises a generic "China" / "中国" mention', () => {
    expect(isLikelyMainlandChina('China')).toBe(true);
    expect(isLikelyMainlandChina('中国')).toBe(true);
  });

  it('does not flag international destinations', () => {
    expect(isLikelyMainlandChina('Tokyo')).toBe(false);
    expect(isLikelyMainlandChina('Paris')).toBe(false);
    expect(isLikelyMainlandChina('New York')).toBe(false);
  });

  it('deliberately excludes Hong Kong / Macau / Taiwan (no reliable Amap coverage)', () => {
    expect(isLikelyMainlandChina('Hong Kong')).toBe(false);
    expect(isLikelyMainlandChina('香港')).toBe(false);
    expect(isLikelyMainlandChina('Macau')).toBe(false);
    expect(isLikelyMainlandChina('Taipei')).toBe(false);
  });

  it('is defensive about empty/undefined input', () => {
    expect(isLikelyMainlandChina('')).toBe(false);
    expect(isLikelyMainlandChina(undefined as unknown as string)).toBe(false);
  });
});

describe('getMapProvider', () => {
  it('routes mainland China destinations to amap', () => {
    expect(getMapProvider('北京')).toBe('amap');
    expect(getMapProvider('Chengdu')).toBe('amap');
  });

  it('routes everything else to mapbox', () => {
    expect(getMapProvider('Tokyo')).toBe('mapbox');
    expect(getMapProvider('Paris')).toBe('mapbox');
    expect(getMapProvider('Hong Kong')).toBe('mapbox');
  });
});

describe('parseLngLat', () => {
  it('parses "lng,lat"', () => {
    expect(parseLngLat('2.3522,48.8566')).toEqual({ lng: 2.3522, lat: 48.8566 });
  });

  it('returns null for malformed input', () => {
    expect(parseLngLat('')).toBeNull();
    expect(parseLngLat('not-a-coord')).toBeNull();
  });
});

// ---- ToolContext / runTool provider routing --------------------------

process.env.AMAP_API_KEY = process.env.AMAP_API_KEY || 'test-key';
process.env.MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || 'test-token';

vi.mock('../../server/tools/amap', () => ({
  searchPlaces: vi.fn(async () => ({ pois: [{ id: 'amap-1', name: 'Amap Place', address: '', location: '116.4,39.9', type: 'attraction' }], count: 1 })),
  getPoiDetails: vi.fn(async () => null),
  calculateDistance: vi.fn(async () => ({ distanceMeters: 111, durationSeconds: 22 })),
}));
vi.mock('../../server/tools/mapbox', () => ({
  searchPlaces: vi.fn(async () => ({ pois: [{ id: 'mapbox-1', name: 'Mapbox Place', address: '', location: '2.35,48.85', type: 'poi' }], count: 1 })),
  getPoiDetails: vi.fn(async () => null),
  calculateDistance: vi.fn(async () => ({ distanceMeters: 333, durationSeconds: 44 })),
}));
vi.mock('../../server/tools/wikivoyage', () => ({
  getDestinationContext: vi.fn(async (destination: string) =>
    destination === 'nowhere' ? null : { title: destination, extract: 'mock extract', url: 'https://en.wikivoyage.org/wiki/Mock', source: 'wikivoyage', license: 'CC BY-SA 4.0' },
  ),
}));

describe('ToolContext provider resolution', () => {
  it('resolves amap for a mainland China destination', async () => {
    const { ToolContext } = await import('../../server/tools/index');
    const ctx = new ToolContext('北京');
    expect(ctx.provider).toBe('amap');
  });

  it('resolves mapbox for an international destination', async () => {
    const { ToolContext } = await import('../../server/tools/index');
    const ctx = new ToolContext('Paris');
    expect(ctx.provider).toBe('mapbox');
  });
});

describe('runTool provider branching', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('search_places on an amap-provider context calls the amap client, not mapbox', async () => {
    const { ToolContext, runTool } = await import('../../server/tools/index');
    const amap = await import('../../server/tools/amap');
    const mapbox = await import('../../server/tools/mapbox');
    const ctx = new ToolContext('北京');

    const result: any = await runTool(ctx, 'search_places', { keywords: '故宫' });

    expect(amap.searchPlaces).toHaveBeenCalledWith('故宫', undefined, 10);
    expect(mapbox.searchPlaces).not.toHaveBeenCalled();
    expect(result.results[0].name).toBe('Amap Place');
  });

  it('search_places on a mapbox-provider context calls the mapbox client, not amap', async () => {
    const { ToolContext, runTool } = await import('../../server/tools/index');
    const amap = await import('../../server/tools/amap');
    const mapbox = await import('../../server/tools/mapbox');
    const ctx = new ToolContext('Paris');

    const result: any = await runTool(ctx, 'search_places', { keywords: 'Eiffel Tower' });

    expect(mapbox.searchPlaces).toHaveBeenCalledWith('Eiffel Tower', undefined, 10);
    expect(amap.searchPlaces).not.toHaveBeenCalled();
    expect(result.results[0].name).toBe('Mapbox Place');
  });

  it('calculate_distance uses the POI cache regardless of provider, then calls the matching client', async () => {
    const { ToolContext, runTool } = await import('../../server/tools/index');
    const mapbox = await import('../../server/tools/mapbox');
    const ctx = new ToolContext('Paris');

    await runTool(ctx, 'search_places', { keywords: 'anything' }); // populates the cache with mapbox-1
    const result: any = await runTool(ctx, 'calculate_distance', {
      originPoiId: 'mapbox-1',
      destinationPoiId: 'mapbox-1',
    });

    expect(mapbox.calculateDistance).toHaveBeenCalled();
    expect(result.distanceMeters).toBe(333);
  });

  it('calculate_distance errors on an unknown POI id without calling either client', async () => {
    const { ToolContext, runTool } = await import('../../server/tools/index');
    const amap = await import('../../server/tools/amap');
    const mapbox = await import('../../server/tools/mapbox');
    const ctx = new ToolContext('Tokyo');

    const result: any = await runTool(ctx, 'calculate_distance', {
      originPoiId: 'never-searched',
      destinationPoiId: 'also-never-searched',
    });

    expect(result.error).toMatch(/Unknown POI id/);
    expect(amap.calculateDistance).not.toHaveBeenCalled();
    expect(mapbox.calculateDistance).not.toHaveBeenCalled();
  });

  it('get_destination_context is not provider-routed — same call regardless of destination', async () => {
    const { ToolContext, runTool } = await import('../../server/tools/index');
    const wikivoyage = await import('../../server/tools/wikivoyage');
    const ctx = new ToolContext('Kyoto'); // resolves to mapbox, but shouldn't matter for this tool

    const result: any = await runTool(ctx, 'get_destination_context', { destination: 'Kyoto', topic: 'food' });

    expect(wikivoyage.getDestinationContext).toHaveBeenCalledWith('Kyoto', 'food');
    expect(result.title).toBe('Kyoto');
  });

  it('get_destination_context returns an error payload (not a throw) when Wikivoyage has no matching article', async () => {
    const { ToolContext, runTool } = await import('../../server/tools/index');
    const ctx = new ToolContext('Kyoto');

    const result: any = await runTool(ctx, 'get_destination_context', { destination: 'nowhere' });

    expect(result.error).toMatch(/No Wikivoyage article/);
  });
});
