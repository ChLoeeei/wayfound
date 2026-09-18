import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// searchPlaces/getPoiDetails no longer touch Mapbox at all (OpenStreetMap
// Overpass + Nominatim instead — see server/tools/mapbox.ts's module
// docstring for why). Most tests below run with NO Mapbox token at all,
// matching the actual current state of this project's .env and exercising
// the real "Mapbox is gone" code path, not just a token-present path we
// assume degrades the same way.
process.env.MAPBOX_ACCESS_TOKEN = '';

const { searchPlaces, getPoiDetails, calculateDistance, stripDescriptors, leadingSubstrings, buildSimplifiedQueries, drainMapboxRequestLog } =
  await import('../../server/tools/mapbox');

const NOMINATIM_PARIS = [{ lat: '48.8566', lon: '2.3522' }];

function overpassOk(elements: unknown[]): Response {
  return jsonResponse({ version: 0.6, elements });
}

const EIFFEL_ELEMENT = {
  type: 'node',
  id: 5013364,
  lat: 48.8583,
  lon: 2.2945,
  tags: { name: 'Eiffel Tower', tourism: 'attraction', 'addr:street': 'Avenue Gustave Eiffel' },
};

describe('searchPlaces (OpenStreetMap)', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    drainMapboxRequestLog();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('resolves proximity via Nominatim (no Mapbox token present) and returns a parsed POI', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('overpass')) return overpassOk([EIFFEL_ELEMENT]);
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await searchPlaces('Eiffel Tower', 'search-region-1');
    expect(r.count).toBe(1);
    expect(r.pois[0]).toEqual({
      id: 'osm:node:5013364',
      name: 'Eiffel Tower',
      address: 'Avenue Gustave Eiffel',
      location: '2.2945,48.8583',
      type: 'attraction',
      rating: undefined,
      photoUrl: undefined,
    });
  });

  it('returns empty without hitting the network for blank keywords', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const r = await searchPlaces('   ', 'search-region-2');
    expect(r).toEqual({ pois: [], count: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns empty without attempting an Overpass query when the region never resolves to coordinates', async () => {
    const overpassCalls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse([]); // no match
      if (url.includes('overpass')) overpassCalls.push(url);
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await searchPlaces('Eiffel Tower', 'unresolvable-region-xyz');
    expect(r).toEqual({ pois: [], count: 0 });
    expect(overpassCalls).toHaveLength(0);
  });

  it('automatically retries with a simplified query on 0 results, and logs which strategy succeeded', async () => {
    // Overpass queries go out as POST — branch by inspecting the posted body.
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('overpass')) {
        const body = String(init?.body ?? '');
        const decoded = decodeURIComponent(body.replace(/^data=/, ''));
        if (decoded.includes('"Eiffel"') && !decoded.includes('"Eiffel Tower"')) {
          return overpassOk([EIFFEL_ELEMENT]);
        }
        return overpassOk([]);
      }
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await searchPlaces('Eiffel Tower', 'search-region-3');
    expect(r.pois.map(p => p.name)).toEqual(['Eiffel Tower']);

    const requests = drainMapboxRequestLog();
    // "Tower" is a descriptor word, so the first retry candidate is the
    // strip-descriptors form ("Eiffel Tower" -> "Eiffel"), not leading-substring.
    expect(requests.map(req => req.strategy)).toEqual(['original', 'strip-descriptors']);
    expect(requests[0].retrievedCount).toBe(0);
    expect(requests[1].retrievedCount).toBe(1);
  });

  it('gives up cleanly (empty, no throw) when every simplified retry also returns 0 results', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('overpass')) return overpassOk([]);
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await searchPlaces('Senso-ji Temple Asakusa', 'search-region-4');
    expect(r).toEqual({ pois: [], count: 0 });
  });

  it('never throws on an Overpass HTTP failure — degrades to empty results', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('overpass')) return new Response('Not Acceptable', { status: 406 });
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    await expect(searchPlaces('Eiffel Tower', 'search-region-5')).resolves.toEqual({ pois: [], count: 0 });
  });

  it(
    'never throws when Overpass itself throws (network/timeout) on BOTH the primary and the mirror — degrades to empty results',
    async () => {
      // 'overpass' matches overpass-api.de AND the overpass.kumi.systems
      // mirror, so this exercises the real retryOnNetworkError path on
      // both instances in sequence (each with its own backoff delays)
      // before finally giving up — genuinely slower than the other cases
      // here, hence the longer test timeout below, not a bug.
      globalThis.fetch = vi.fn(async (url: string) => {
        if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
        if (url.includes('overpass')) throw new TypeError('fetch failed');
        throw new Error(`unexpected url: ${url}`);
      }) as any;

      await expect(searchPlaces('Eiffel Tower', 'search-region-6')).resolves.toEqual({ pois: [], count: 0 });
    },
    20000,
  );

  it(
    'fails over to the independent mirror (overpass.kumi.systems) when the primary returns a 5xx',
    async () => {
      globalThis.fetch = vi.fn(async (url: string) => {
        if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
        if (url.includes('overpass-api.de')) return new Response('Bad Gateway', { status: 502 });
        if (url.includes('overpass.kumi.systems')) return overpassOk([EIFFEL_ELEMENT]);
        throw new Error(`unexpected url: ${url}`);
      }) as any;

      const r = await searchPlaces('Eiffel Tower', 'search-region-mirror-1');
      expect(r.pois.map(p => p.name)).toEqual(['Eiffel Tower']);

      // The diagnostic log should credit whichever instance actually
      // served the response, not always the primary — important for
      // making a real outage visible in tests/eval/reports/mapbox-errors-*.log.
      const [entry] = drainMapboxRequestLog();
      expect(entry.url).toContain('overpass.kumi.systems');
    },
    20000,
  );

  it(
    'fails over to the mirror when the primary instance throws a network error (not just on a 5xx status)',
    async () => {
      globalThis.fetch = vi.fn(async (url: string) => {
        if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
        if (url.includes('overpass-api.de')) throw new TypeError('fetch failed');
        if (url.includes('overpass.kumi.systems')) return overpassOk([EIFFEL_ELEMENT]);
        throw new Error(`unexpected url: ${url}`);
      }) as any;

      const r = await searchPlaces('Eiffel Tower', 'search-region-mirror-2');
      expect(r.pois.map(p => p.name)).toEqual(['Eiffel Tower']);
    },
    20000,
  );

  it('treats a 200 response carrying a `remark` runtime error the same as 0 results', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('overpass')) {
        return jsonResponse({ version: 0.6, elements: [], remark: 'runtime error: Query timed out.' });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    await expect(searchPlaces('Eiffel Tower', 'search-region-7')).resolves.toEqual({ pois: [], count: 0 });
  });

  it('drops an OSM element with no name or no coordinates rather than crashing', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('overpass')) {
        return overpassOk([
          { type: 'node', id: 1, lat: 48.85, lon: 2.29, tags: {} }, // no name
          { type: 'node', id: 2, tags: { name: 'No Coords Place' } }, // no lat/lon or center
          EIFFEL_ELEMENT,
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await searchPlaces('Eiffel Tower', 'search-region-8');
    expect(r.pois.map(p => p.name)).toEqual(['Eiffel Tower']);
  });

  it('strips double quotes from keywords so a literal quote cannot break the Overpass query', async () => {
    let sentBody = '';
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('overpass')) {
        sentBody = decodeURIComponent(String(init?.body ?? '').replace(/^data=/, ''));
        return overpassOk([]);
      }
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    await searchPlaces('Bob"s "Diner"', 'search-region-9');
    // The query must remain syntactically valid: every quote in the
    // constructed QL is a deliberate string-literal delimiter, none of
    // them came from the raw keywords.
    expect((sentBody.match(/"/g) ?? []).length % 2).toBe(0);
    expect(sentBody).not.toContain('Diner"");'); // no stray unescaped quote sequence
  });
});

describe('getPoiDetails (OpenStreetMap)', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches a node by its osm: id', async () => {
    globalThis.fetch = vi.fn(async () => overpassOk([EIFFEL_ELEMENT])) as any;
    const poi = await getPoiDetails('osm:node:5013364');
    expect(poi?.name).toBe('Eiffel Tower');
    expect(poi?.location).toBe('2.2945,48.8583');
  });

  it('returns null for an id that is not in the osm:<type>:<id> format, without hitting the network', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    expect(await getPoiDetails('mapbox_id_123')).toBeNull();
    expect(await getPoiDetails('')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when Overpass finds nothing for that id', async () => {
    globalThis.fetch = vi.fn(async () => overpassOk([])) as any;
    expect(await getPoiDetails('osm:node:999999')).toBeNull();
  });

  it('returns null (not a throw) on an HTTP failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    expect(await getPoiDetails('osm:node:5013364')).toBeNull();
  });

  it(
    'fails over to the independent mirror for a detail lookup when the primary fails',
    async () => {
      globalThis.fetch = vi.fn(async (url: string) => {
        if (url.includes('overpass-api.de')) return new Response('Bad Gateway', { status: 502 });
        if (url.includes('overpass.kumi.systems')) return overpassOk([EIFFEL_ELEMENT]);
        throw new Error(`unexpected url: ${url}`);
      }) as any;
      const poi = await getPoiDetails('osm:node:5013364');
      expect(poi?.name).toBe('Eiffel Tower');
    },
    20000,
  );
});

describe('calculateDistance', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('type 0 (straight-line) needs no token and never hits the network', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const r = await calculateDistance({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5072, lng: -0.1276 }, 0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.durationSeconds).toBe(0);
    expect(r.distanceMeters).toBeGreaterThan(330_000);
  });

  it(
    'type 1 (driving) falls back to a haversine estimate — never throws — when neither ORS nor Mapbox is configured',
    async () => {
      // This file's top-level import already ran with MAPBOX_ACCESS_TOKEN=''
      // (see the comment there) and ORS_API_KEY unset — matching a project
      // with neither provider configured, the worst case this fallback
      // chain has to survive.
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as any;
      const r = await calculateDistance({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, 1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(r.distanceMeters).toBeGreaterThan(0);
      expect(r.durationSeconds).toBeGreaterThan(0);
    },
    20000,
  );

  // The ORS/Mapbox-configured paths need their own module instance (env
  // vars are read once at import time — see the top of this file), so
  // these use vi.resetModules() + a fresh dynamic import per test instead
  // of the shared top-level `calculateDistance` binding used above.
  describe('with ORS and/or Mapbox configured', () => {
    afterEach(() => {
      delete process.env.ORS_API_KEY;
      process.env.MAPBOX_ACCESS_TOKEN = '';
      vi.resetModules();
    });

    it('uses ORS Directions V2 when ORS_API_KEY is set', async () => {
      process.env.ORS_API_KEY = 'test-ors-key';
      vi.resetModules();
      const { calculateDistance: calc } = await import('../../server/tools/mapbox');
      const fetchSpy = vi.fn().mockResolvedValue(
        jsonResponse({ features: [{ properties: { summary: { distance: 5234, duration: 612 } } }] }),
      );
      globalThis.fetch = fetchSpy as any;
      const r = await calc({ lat: 48.8566, lng: 2.3522 }, { lat: 48.86, lng: 2.36 }, 1);
      expect(r).toEqual({ distanceMeters: 5234, durationSeconds: 612 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toContain('api.openrouteservice.org/v2/directions/driving-car');
    });

    it('falls through to Mapbox Directions when ORS fails and a Mapbox token is present', async () => {
      process.env.ORS_API_KEY = 'test-ors-key';
      process.env.MAPBOX_ACCESS_TOKEN = 'test-mapbox-token';
      vi.resetModules();
      const { calculateDistance: calc } = await import('../../server/tools/mapbox');
      globalThis.fetch = vi.fn(async (url: any) => {
        if (String(url).includes('openrouteservice')) return new Response('server error', { status: 500 });
        return jsonResponse({ code: 'Ok', routes: [{ distance: 4100, duration: 480 }] });
      }) as any;
      const r = await calc({ lat: 48.8566, lng: 2.3522 }, { lat: 48.86, lng: 2.36 }, 1);
      expect(r).toEqual({ distanceMeters: 4100, durationSeconds: 480 });
    }, 20000);

    it('falls back to a haversine estimate when both ORS and Mapbox fail', async () => {
      process.env.ORS_API_KEY = 'test-ors-key';
      process.env.MAPBOX_ACCESS_TOKEN = 'test-mapbox-token';
      vi.resetModules();
      const { calculateDistance: calc } = await import('../../server/tools/mapbox');
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('server error', { status: 500 })) as any;
      const r = await calc({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5072, lng: -0.1276 }, 1);
      expect(r.distanceMeters).toBeGreaterThan(330_000);
      expect(r.durationSeconds).toBeGreaterThan(0);
    }, 20000);
  });
});

// Geoapify is the new PRIMARY provider for search_places/get_poi_details/
// calculate_distance internationally (see server/tools/geoapify.ts's
// module docstring for why) — these confirm the orchestration in mapbox.ts
// actually prefers it and only falls through to Overpass/ORS/Mapbox when
// Geoapify is unconfigured or genuinely finds nothing, not on every call.
describe('Geoapify integration (primary provider)', () => {
  let originalFetch: typeof fetch;
  const GEOAPIFY_FEATURE_COLLECTION = {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          place_id: 'geo-abc',
          name: 'Eiffel Tower',
          formatted: 'Eiffel Tower, Paris, France',
          lon: 2.2945,
          lat: 48.8583,
          categories: ['tourism.attraction'],
        },
      },
    ],
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GEOAPIFY_PLACES_API_KEY;
    delete process.env.GEOAPIFY_ROUTING_API_KEY;
    delete process.env.ORS_API_KEY;
    process.env.MAPBOX_ACCESS_TOKEN = '';
    vi.resetModules();
  });

  it('searchPlaces uses Geoapify and never touches Overpass when Geoapify finds a result', async () => {
    process.env.GEOAPIFY_PLACES_API_KEY = 'test-places-key';
    vi.resetModules();
    const { searchPlaces } = await import('../../server/tools/mapbox');
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('api.geoapify.com/v1/geocode/search')) return jsonResponse(GEOAPIFY_FEATURE_COLLECTION);
      throw new Error(`unexpected url (should not reach Overpass): ${url}`);
    }) as any;

    const r = await searchPlaces('Eiffel Tower', 'search-region-geoapify-1');
    expect(r.pois).toEqual([
      {
        id: 'geoapify:geo-abc',
        name: 'Eiffel Tower',
        address: 'Eiffel Tower, Paris, France',
        location: '2.2945,48.8583',
        type: 'tourism.attraction',
        rating: undefined,
        photoUrl: undefined,
      },
    ]);
  });

  it('searchPlaces falls through to Overpass when Geoapify is configured but finds nothing', async () => {
    process.env.GEOAPIFY_PLACES_API_KEY = 'test-places-key';
    vi.resetModules();
    const { searchPlaces } = await import('../../server/tools/mapbox');
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('api.geoapify.com')) return jsonResponse({ type: 'FeatureCollection', features: [] });
      if (url.includes('overpass')) return overpassOk([EIFFEL_ELEMENT]);
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await searchPlaces('Eiffel Tower', 'search-region-geoapify-2');
    expect(r.pois.map(p => p.name)).toEqual(['Eiffel Tower']);
  });

  it('retries Geoapify with a simplified query before ever falling through to Overpass', async () => {
    // Regression test: Geoapify used to get exactly one attempt (the raw
    // keywords) before falling to Overpass, unlike Overpass's own
    // original + 2-simplified-candidate retry — found via live testing
    // (a compound query like "Odaiba Aqua City shopping" missed on
    // Geoapify's first try and fell straight to Overpass, which happened
    // to be down that day). Both providers now get the same retry budget.
    process.env.GEOAPIFY_PLACES_API_KEY = 'test-places-key';
    vi.resetModules();
    const { searchPlaces } = await import('../../server/tools/mapbox');
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('nominatim.openstreetmap.org')) return jsonResponse(NOMINATIM_PARIS);
      if (url.includes('overpass')) throw new Error('should not reach Overpass — Geoapify simplified retry should have succeeded first');
      if (url.includes('api.geoapify.com/v1/geocode/search')) {
        const params = new URL(url).searchParams;
        // "Tower" is a descriptor word, so the first simplified candidate
        // is the strip-descriptors form ("Eiffel Tower" -> "Eiffel").
        if (params.get('text') === 'Eiffel') return jsonResponse(GEOAPIFY_FEATURE_COLLECTION);
        return jsonResponse({ type: 'FeatureCollection', features: [] });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await searchPlaces('Eiffel Tower', 'search-region-geoapify-retry');
    expect(r.pois.map(p => p.name)).toEqual(['Eiffel Tower']);
  });

  it('getPoiDetails routes a "geoapify:" id to Geoapify Place Details, not Overpass', async () => {
    process.env.GEOAPIFY_PLACES_API_KEY = 'test-places-key';
    vi.resetModules();
    const { getPoiDetails } = await import('../../server/tools/mapbox');
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('api.geoapify.com/v2/place-details')) {
        expect(url).toContain('id=geo-abc');
        return jsonResponse(GEOAPIFY_FEATURE_COLLECTION);
      }
      throw new Error(`unexpected url (should not reach Overpass): ${url}`);
    }) as any;

    const poi = await getPoiDetails('geoapify:geo-abc');
    expect(poi?.name).toBe('Eiffel Tower');
  });

  it('calculateDistance tries Geoapify Routing before ORS/Mapbox/haversine', async () => {
    process.env.GEOAPIFY_ROUTING_API_KEY = 'test-routing-key';
    process.env.ORS_API_KEY = 'test-ors-key'; // configured but should never be called
    vi.resetModules();
    const { calculateDistance: calc } = await import('../../server/tools/mapbox');
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('api.geoapify.com/v1/routing')) {
        return jsonResponse({ features: [{ properties: { distance: 5234, time: 612 } }] });
      }
      throw new Error(`unexpected url (should not reach ORS): ${url}`);
    }) as any;

    const r = await calc({ lat: 48.8566, lng: 2.3522 }, { lat: 48.86, lng: 2.36 }, 1);
    expect(r).toEqual({ distanceMeters: 5234, durationSeconds: 612 });
  });
});

// Query-simplification logic is unchanged from the earlier Mapbox Search
// Box implementation — still relevant (Overpass's name search is exact
// substring/regex, not fuzzy, so verbose queries still benefit).
describe('stripDescriptors', () => {
  it('strips a trailing descriptor word', () => {
    expect(stripDescriptors('Senso-ji Temple Asakusa')).toBe('Senso-ji Asakusa');
    expect(stripDescriptors('Kiyomizu-dera Temple')).toBe('Kiyomizu-dera');
  });

  it('returns the input unchanged when there is nothing to strip', () => {
    expect(stripDescriptors('Gion')).toBe('Gion');
  });
});

describe('leadingSubstrings', () => {
  it('drops one trailing word at a time down to a single word', () => {
    expect(leadingSubstrings('Senso-ji Asakusa')).toEqual(['Senso-ji']);
  });

  it('returns nothing for a single word', () => {
    expect(leadingSubstrings('Gion')).toEqual([]);
  });
});

describe('buildSimplifiedQueries', () => {
  it('strips a descriptor then falls back to the leading proper noun', () => {
    expect(buildSimplifiedQueries('Senso-ji Temple Asakusa')).toEqual([
      { query: 'Senso-ji Asakusa', strategy: 'strip-descriptors' },
      { query: 'Senso-ji', strategy: 'leading-substring' },
    ]);
  });

  it('gives up (no candidates) for an already-single-word query', () => {
    expect(buildSimplifiedQueries('Gion')).toEqual([]);
  });
});
