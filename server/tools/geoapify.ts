/**
 * Geoapify client — free-tier (3,000 credits/day per key, no credit card)
 * commercial alternative to the public OpenStreetMap Overpass instances.
 *
 * WHY: live eval testing found the free public Overpass ecosystem (primary
 * + independently-run mirror, see mapbox.ts) failing 100% of search_places
 * calls in two separate real runs (Tokyo, then Paris) — confirmed via a
 * direct curl probe to be a genuine server-side outage (connection
 * refused / no response), not a bug in this app or its network. Geoapify
 * is commercially operated infrastructure behind its free tier, so it's
 * used here as the PRIMARY search/routing provider for international
 * destinations, with the Overpass chain demoted to a free fallback layer
 * (still worth keeping — zero cost, and useful if Geoapify's daily credit
 * budget or service has its own bad day) — see mapbox.ts's searchPlaces/
 * getPoiDetails/calculateDistance for the actual fallback ordering.
 *
 * Two separate API keys (as the user provisioned them in the Geoapify
 * dashboard — Places and Routing are tracked/labeled separately there,
 * even though a single Geoapify account's free tier is one shared credit
 * pool): GEOAPIFY_PLACES_API_KEY for search/place-details,
 * GEOAPIFY_ROUTING_API_KEY for calculate_distance. Both optional — every
 * exported function here degrades the same way the rest of this file's
 * providers do (search: never throws, returns []/null; route: throws so
 * the caller's existing fallback chain decides what's next).
 *
 * Endpoint choice, confirmed by hand (not assumed) against the real API:
 *   - /v1/geocode/search (NOT /v2/places) for name search — v2/places
 *     requires guessing a `categories` value up front (wrong/missing
 *     category silently drops real results, the same class of bug this
 *     project already hit once with Mapbox's proximity-only ranking); the
 *     geocode/search endpoint takes free-text `text=` directly and, per a
 *     live probe, honors `filter=circle:<lon>,<lat>,<radiusMeters>` as a
 *     genuine HARD filter (tested: searching "Eiffel Tower" with a filter
 *     circle over Tokyo did NOT return the real Paris landmark — it
 *     returned an unrelated in-circle result instead), matching Overpass's
 *     around:<radius> hard-filter semantics rather than Mapbox Search
 *     Box's old soft `proximity` ranking hint that caused a wrong-continent
 *     match bug earlier in this project.
 *   - /v2/place-details?id=<place_id> for detail lookups, confirmed to
 *     accept the place_id a geocode/search result returns.
 *   - /v1/routing?waypoints=lat,lon|lat,lon&mode=drive|walk for distance —
 *     confirmed live: returns `distance` (meters) and `time` (seconds).
 *
 * LICENSE: results are OpenStreetMap-sourced (Geoapify's own
 * `datasource.license` field on each result says so) — covered by the
 * same ODbL attribution this file already shows for Overpass/Mapbox
 * results; no separate UI credit needed.
 */
import { createThrottledFetch, readErrorBody } from './http';
import type { Poi, DistanceResult } from './provider';

const PLACES_KEY = process.env.GEOAPIFY_PLACES_API_KEY || '';
const ROUTING_KEY = process.env.GEOAPIFY_ROUTING_API_KEY || '';
const GEOCODE_SEARCH_URL = 'https://api.geoapify.com/v1/geocode/search';
const PLACE_DETAILS_URL = 'https://api.geoapify.com/v2/place-details';
const ROUTING_URL = 'https://api.geoapify.com/v1/routing';

// Independent spacing/retry state per key — no documented per-minute cap
// found, so this is a deliberately moderate pace (not a burst) rather than
// a value tuned against an observed limit like Overpass's was.
const placesFetch = createThrottledFetch({
  minSpacingMs: 250,
  retryableStatuses: [429, 502, 503, 504],
  maxRetries: 2,
  retryBaseDelayMs: 500,
  retryOnNetworkError: true,
  timeoutMs: 8000,
});
const routingFetch = createThrottledFetch({
  minSpacingMs: 250,
  retryableStatuses: [429, 502, 503, 504],
  maxRetries: 2,
  retryBaseDelayMs: 500,
  retryOnNetworkError: true,
  timeoutMs: 8000,
});

export function hasGeoapifyPlacesKey(): boolean {
  return !!PLACES_KEY;
}
export function hasGeoapifyRoutingKey(): boolean {
  return !!ROUTING_KEY;
}

interface GeoapifyFeature {
  properties?: {
    place_id?: string;
    name?: string;
    formatted?: string;
    address_line2?: string;
    lon?: number;
    lat?: number;
    categories?: string[];
    result_type?: string;
  };
  geometry?: { type: string; coordinates?: [number, number] };
}

interface GeoapifyFeatureCollection {
  features?: GeoapifyFeature[];
}

function featureToPoi(f: GeoapifyFeature): Poi | null {
  const p = f.properties;
  const lon = p?.lon ?? f.geometry?.coordinates?.[0];
  const lat = p?.lat ?? f.geometry?.coordinates?.[1];
  const name = p?.name;
  if (!p?.place_id || !name || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    id: `geoapify:${p.place_id}`,
    name,
    address: p.address_line2 ?? p.formatted ?? '',
    location: `${lon},${lat}`,
    type: p.categories?.[0] ?? p.result_type ?? 'poi',
    // Same content gap as Overpass/Mapbox results — OSM data has neither.
    rating: undefined,
    photoUrl: undefined,
  };
}

/**
 * Free-text POI search within radiusMeters of `proximity`. Never throws —
 * any failure (missing key, HTTP error, network error) is logged and
 * treated as "found nothing", so mapbox.ts's searchPlaces can try this
 * first and fall through to Overpass exactly like a legitimate empty
 * result.
 */
export async function geoapifySearchPlaces(
  keywords: string,
  proximity: { lat: number; lng: number },
  radiusMeters: number,
  limit: number,
): Promise<Poi[]> {
  if (!PLACES_KEY) return [];
  const params = new URLSearchParams({
    text: keywords,
    filter: `circle:${proximity.lng},${proximity.lat},${radiusMeters}`,
    limit: String(limit),
    apiKey: PLACES_KEY,
  });
  const url = `${GEOCODE_SEARCH_URL}?${params.toString()}`;
  let res: Response;
  try {
    res = await placesFetch(url);
  } catch (err: any) {
    console.log(`[geoapify] places search failed (network): ${err?.message ?? err}`);
    return [];
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    console.log(`[geoapify] places search HTTP ${res.status}${body ? `: ${body}` : ''}`);
    return [];
  }
  let data: GeoapifyFeatureCollection;
  try {
    data = (await res.json()) as GeoapifyFeatureCollection;
  } catch {
    return [];
  }
  return (data.features ?? []).map(featureToPoi).filter((p): p is Poi => p !== null);
}

/**
 * Fetch a single POI by its raw Geoapify place_id — the caller (mapbox.ts)
 * strips the "geoapify:" id prefix before calling this, the same way it
 * parses the "osm:<type>:<id>" prefix for Overpass ids. Never throws — any
 * failure returns null.
 */
export async function geoapifyPlaceDetails(placeId: string): Promise<Poi | null> {
  if (!PLACES_KEY || !placeId) return null;
  const params = new URLSearchParams({ id: placeId, apiKey: PLACES_KEY });
  const url = `${PLACE_DETAILS_URL}?${params.toString()}`;
  let res: Response;
  try {
    res = await placesFetch(url);
  } catch (err: any) {
    console.log(`[geoapify] place-details lookup failed (network): ${err?.message ?? err}`);
    return null;
  }
  if (!res.ok) return null;
  let data: GeoapifyFeatureCollection;
  try {
    data = (await res.json()) as GeoapifyFeatureCollection;
  } catch {
    return null;
  }
  const feature = data.features?.[0];
  return feature ? featureToPoi({ ...feature, properties: { ...feature.properties, place_id: placeId } }) : null;
}

interface GeoapifyRoutingRaw {
  features?: Array<{ properties?: { distance?: number; time?: number } }>;
}

/**
 * Real road-network distance/duration via Geoapify Routing V1. Throws on
 * any failure (missing key, HTTP error, no route) — caller (mapbox.ts's
 * calculateDistance) decides how to fall back, same contract as
 * orsDirections/mapboxDirections.
 */
export async function geoapifyRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  type: 1 | 3,
): Promise<DistanceResult> {
  if (!ROUTING_KEY) throw new Error('GEOAPIFY_ROUTING_API_KEY is not configured');
  const mode = type === 3 ? 'walk' : 'drive';
  const params = new URLSearchParams({
    waypoints: `${origin.lat},${origin.lng}|${destination.lat},${destination.lng}`,
    mode,
    apiKey: ROUTING_KEY,
  });
  const url = `${ROUTING_URL}?${params.toString()}`;
  const res = await routingFetch(url);
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(`Geoapify routing HTTP ${res.status}${body ? `: ${body}` : ''} (mode=${mode})`);
  }
  const data = (await res.json()) as GeoapifyRoutingRaw;
  const props = data.features?.[0]?.properties;
  if (!props || typeof props.distance !== 'number' || typeof props.time !== 'number') {
    throw new Error(`Geoapify routing returned no route (mode=${mode})`);
  }
  return { distanceMeters: Math.round(props.distance), durationSeconds: Math.round(props.time) };
}
