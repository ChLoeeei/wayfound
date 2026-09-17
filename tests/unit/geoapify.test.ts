import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const EIFFEL_FEATURE = {
  type: 'Feature',
  properties: {
    place_id: 'abc123',
    name: 'Eiffel Tower',
    formatted: 'Eiffel Tower, Paris, France',
    address_line2: 'Avenue Gustave Eiffel, Paris',
    lon: 2.2945,
    lat: 48.8583,
    categories: ['tourism', 'tourism.attraction'],
  },
  geometry: { type: 'Point', coordinates: [2.2945, 48.8583] },
};

describe('geoapify.ts, with GEOAPIFY_PLACES_API_KEY / GEOAPIFY_ROUTING_API_KEY unset', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    delete process.env.GEOAPIFY_PLACES_API_KEY;
    delete process.env.GEOAPIFY_ROUTING_API_KEY;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it('geoapifySearchPlaces returns [] without hitting the network', async () => {
    vi.resetModules();
    const { geoapifySearchPlaces } = await import('../../server/tools/geoapify');
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const r = await geoapifySearchPlaces('Eiffel Tower', { lat: 48.8566, lng: 2.3522 }, 15000, 5);
    expect(r).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('geoapifyPlaceDetails returns null without hitting the network', async () => {
    vi.resetModules();
    const { geoapifyPlaceDetails } = await import('../../server/tools/geoapify');
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    expect(await geoapifyPlaceDetails('abc123')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('geoapifyRoute throws without hitting the network (caller decides the fallback)', async () => {
    vi.resetModules();
    const { geoapifyRoute } = await import('../../server/tools/geoapify');
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    await expect(geoapifyRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, 1)).rejects.toThrow(/GEOAPIFY_ROUTING_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hasGeoapifyPlacesKey / hasGeoapifyRoutingKey report false', async () => {
    vi.resetModules();
    const { hasGeoapifyPlacesKey, hasGeoapifyRoutingKey } = await import('../../server/tools/geoapify');
    expect(hasGeoapifyPlacesKey()).toBe(false);
    expect(hasGeoapifyRoutingKey()).toBe(false);
  });
});

describe('geoapify.ts, with keys configured', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.GEOAPIFY_PLACES_API_KEY = 'test-places-key';
    process.env.GEOAPIFY_ROUTING_API_KEY = 'test-routing-key';
    vi.resetModules();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GEOAPIFY_PLACES_API_KEY;
    delete process.env.GEOAPIFY_ROUTING_API_KEY;
    vi.resetModules();
  });

  it('geoapifySearchPlaces parses a successful FeatureCollection into Poi[]', async () => {
    const { geoapifySearchPlaces } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async (url: string) => {
      expect(url).toContain('api.geoapify.com/v1/geocode/search');
      expect(url).toContain('text=Eiffel');
      expect(url).toContain('filter=circle%3A2.3522%2C48.8566%2C15000');
      return jsonResponse({ type: 'FeatureCollection', features: [EIFFEL_FEATURE] });
    }) as any;

    const r = await geoapifySearchPlaces('Eiffel Tower', { lat: 48.8566, lng: 2.3522 }, 15000, 5);
    expect(r).toEqual([
      {
        id: 'geoapify:abc123',
        name: 'Eiffel Tower',
        address: 'Avenue Gustave Eiffel, Paris',
        location: '2.2945,48.8583',
        type: 'tourism',
        rating: undefined,
        photoUrl: undefined,
      },
    ]);
  });

  it('geoapifySearchPlaces drops a feature with no place_id/name/coordinates rather than crashing', async () => {
    const { geoapifySearchPlaces } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        type: 'FeatureCollection',
        features: [{ properties: { name: 'No id or coords' } }, EIFFEL_FEATURE],
      }),
    ) as any;
    const r = await geoapifySearchPlaces('Eiffel Tower', { lat: 48.8566, lng: 2.3522 }, 15000, 5);
    expect(r.map(p => p.name)).toEqual(['Eiffel Tower']);
  });

  it('geoapifySearchPlaces never throws on an HTTP failure — degrades to []', async () => {
    const { geoapifySearchPlaces } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async () => new Response('Forbidden', { status: 403 })) as any;
    await expect(geoapifySearchPlaces('Eiffel Tower', { lat: 48.8566, lng: 2.3522 }, 15000, 5)).resolves.toEqual([]);
  });

  it('geoapifySearchPlaces never throws on a network error — degrades to []', async () => {
    const { geoapifySearchPlaces } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as any;
    await expect(geoapifySearchPlaces('Eiffel Tower', { lat: 48.8566, lng: 2.3522 }, 15000, 5)).resolves.toEqual([]);
  });

  it('geoapifyPlaceDetails resolves a place by its raw (unprefixed) place_id', async () => {
    const { geoapifyPlaceDetails } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async (url: string) => {
      expect(url).toContain('id=abc123');
      return jsonResponse({ type: 'FeatureCollection', features: [EIFFEL_FEATURE] });
    }) as any;
    const poi = await geoapifyPlaceDetails('abc123');
    expect(poi).toEqual({
      id: 'geoapify:abc123',
      name: 'Eiffel Tower',
      address: 'Avenue Gustave Eiffel, Paris',
      location: '2.2945,48.8583',
      type: 'tourism',
      rating: undefined,
      photoUrl: undefined,
    });
  });

  it('geoapifyPlaceDetails returns null (not a throw) on an HTTP failure', async () => {
    const { geoapifyPlaceDetails } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    expect(await geoapifyPlaceDetails('abc123')).toBeNull();
  });

  it('geoapifyRoute parses a successful routing response', async () => {
    const { geoapifyRoute } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async (url: string) => {
      expect(url).toContain('api.geoapify.com/v1/routing');
      expect(url).toContain('mode=walk');
      return jsonResponse({ features: [{ properties: { distance: 5144.2, time: 4769.448 } }] });
    }) as any;
    const r = await geoapifyRoute({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8738, lng: 2.295 }, 3);
    expect(r).toEqual({ distanceMeters: 5144, durationSeconds: 4769 });
  });

  it('geoapifyRoute uses mode=drive for type 1', async () => {
    const { geoapifyRoute } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async (url: string) => {
      expect(url).toContain('mode=drive');
      return jsonResponse({ features: [{ properties: { distance: 1000, time: 120 } }] });
    }) as any;
    await geoapifyRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, 1);
  });

  it('geoapifyRoute throws (not a silent empty result) on an HTTP failure', async () => {
    const { geoapifyRoute } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    await expect(geoapifyRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, 1)).rejects.toThrow(/Geoapify routing HTTP 500/);
  });

  it('geoapifyRoute throws when the response has no usable route', async () => {
    const { geoapifyRoute } = await import('../../server/tools/geoapify');
    globalThis.fetch = vi.fn(async () => jsonResponse({ features: [] })) as any;
    await expect(geoapifyRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, 1)).rejects.toThrow(/returned no route/);
  });

  it('hasGeoapifyPlacesKey / hasGeoapifyRoutingKey report true', async () => {
    const { hasGeoapifyPlacesKey, hasGeoapifyRoutingKey } = await import('../../server/tools/geoapify');
    expect(hasGeoapifyPlacesKey()).toBe(true);
    expect(hasGeoapifyRoutingKey()).toBe(true);
  });
});
