/**
 * "Mapbox" client — historical name, now mostly OpenStreetMap-backed.
 *
 * WHY: Mapbox's Search Box API (suggest+retrieve) bills per SESSION, with a
 * free tier of only 500 sessions/month. Our usage pattern — one-shot
 * programmatic POI lookups from the agent loop, minting a fresh
 * session_token per attempt — is the worst case for that billing model and
 * was racking up unexpected charges. Search Box's session concept exists
 * for interactive autocomplete (a user typing, narrowing down, picking
 * one), which this app never does. See the investigation that led here for
 * the full pricing comparison (Search Box: 500 sessions/mo free, $3/1000
 * after; Geocoding: 100,000 requests/mo free, $0.75/1000 after — but
 * Geocoding API has no POI/business database at all, confirmed live, so it
 * can't replace free-text place search either).
 *
 * CURRENT STATE:
 *   - searchPlaces / getPoiDetails — Geoapify (/v1/geocode/search +
 *     /v2/place-details) FIRST when GEOAPIFY_PLACES_API_KEY is set (see
 *     geoapify.ts's module docstring for why it's primary, not a
 *     fallback), then OpenStreetMap Overpass API as a free backup layer.
 *     Overpass itself: free, no key, not metered/billed at all
 *     (donation-funded infrastructure). Geographic scoping (around:<radius>
 *     for Overpass, filter=circle:... for Geoapify) resolved via Mapbox
 *     Geocoding when a token is present, Nominatim (also free/no-key)
 *     otherwise.
 *   - calculateDistance — Geoapify Routing V1 first (if
 *     GEOAPIFY_ROUTING_API_KEY is set), then OpenRouteService (ORS)
 *     Directions V2 (free HeiGIT "Basic" key: 2000 requests/mo, 40/min),
 *     then Mapbox Directions as a third-choice fallback if a Mapbox token
 *     happens to be present, and a haversine straight-line estimate (with
 *     a rough speed-based duration guess) as the final fallback if none
 *     of the three are available or all error — never throws for type 1/3
 *     anymore, same graceful-degradation contract as the rest of this
 *     file. See geoapifyRoute (./geoapify.ts) / orsDirections /
 *     mapboxDirections below.
 *   - resolveRegionProximity — still Mapbox Geocoding API when a token is
 *     present (low request volume, 100k/mo free tier, already reliable);
 *     gracefully returns null and falls through to Nominatim when absent.
 *
 * ALL Geoapify/Mapbox/ORS calls in this file degrade gracefully when their
 * key is missing/invalid or the request itself fails — no key check
 * throws, and calculateDistance in particular now has four layers to fall
 * through before giving up (see above).
 *
 * RELIABILITY TRADEOFF, why Geoapify is primary now — confirmed by hand,
 * not assumed: the free public Overpass ecosystem failed 100% of
 * search_places calls in TWO separate live eval runs (Tokyo, then Paris),
 * and a direct curl probe against both overpass-api.de (its own
 * /api/status endpoint reports a "Rate limit: 2" per-IP concurrency cap)
 * and the overpass.kumi.systems mirror confirmed this wasn't a false
 * alarm — connection refused / no response from both, at the same time
 * Nominatim answered normally, ruling out a local/network-side cause.
 * overpassPost() (see below) still tries the mirror whenever the primary
 * fails outright — real mitigation, not a full fix, since a global
 * bad-Overpass-day can still take both down, which is exactly what
 * happened twice. Geoapify (commercially operated infrastructure behind
 * its free tier: 3,000 credits/day, no card) is tried first specifically
 * because of this; Overpass is kept as a zero-cost second opinion, not
 * removed. Every provider call in this file is still built to fail SOFT
 * (empty result, never a thrown error) after a short timeout and limited
 * retries, so an unavailable Overpass (or Geoapify) degrades to "no POIs
 * found, agent falls back to general knowledge" (existing, already-relied-
 * on behavior) rather than blocking or crashing a generation request.
 *
 * LICENSE: OpenStreetMap data is ODbL (https://www.openstreetmap.org/copyright)
 * — requires visible attribution wherever it informs displayed text. Wired
 * into server.ts (sourceAttributions) and src/components/ItineraryPane.tsx,
 * same spot as Wikivoyage's CC BY-SA badge.
 *
 * Still mirrors amap.ts's three function signatures exactly (searchPlaces,
 * getPoiDetails, calculateDistance) so server/tools/index.ts doesn't need
 * to change.
 */
import { createThrottledFetch, readErrorBody } from './http';
import type { Poi, PoiSearchResult, DistanceResult } from './provider';
import { geoapifySearchPlaces, geoapifyPlaceDetails, geoapifyRoute, hasGeoapifyRoutingKey } from './geoapify';

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';
const MAPBOX_BASE = 'https://api.mapbox.com';
const ORS_TOKEN = process.env.ORS_API_KEY || '';
const ORS_BASE = 'https://api.openrouteservice.org';
const OVERPASS_BASE = 'https://overpass-api.de/api/interpreter';
// Independently operated public Overpass instance (Kumi Systems) — used as
// a failover, not a load-balancing target. See overpassPost() below and
// the RELIABILITY TRADEOFF note in this file's module docstring.
const OVERPASS_MIRROR = 'https://overpass.kumi.systems/api/interpreter';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
// Wikimedia/OSM's shared API-etiquette norm: identify the application.
// Nominatim's usage policy explicitly requires this; Overpass doesn't
// strictly enforce it but it's the same courtesy.
const USER_AGENT = 'Wayfound-TravelPlanner/1.0 (educational project)';

// ==================== Rate-limit / reliability handling ====================
//
// Five independent throttled-fetch instances, one per host, each with its
// own spacing state (see ./http) — tuned per host's actual observed
// characteristics, not a single shared config:
//   - mapboxFetch: unchanged from before (Mapbox Directions + Geocoding
//     share the same account-level rate limit).
//   - orsFetch: OpenRouteService's free "Basic" plan caps Directions V2 at
//     40 requests/minute (and 2000/month total) — 1600ms spacing keeps us
//     comfortably under the per-minute cap so a burst of calculate_distance
//     calls in one itinerary generation doesn't burn 429s (and therefore
//     retries) against a small monthly budget.
//   - overpassFetch: much more conservative spacing, a short client-side
//     timeout, and retries on 502/503/504 AND on the fetch call itself
//     throwing — Overpass's failure mode observed live was as often a
//     connection-level failure/timeout as a clean HTTP error.
//   - overpassMirrorFetch: same tuning as overpassFetch except a smaller
//     retry budget (1, not 2) — this is already the fallback tier (see
//     overpassPost() below), so keeping its own retries short bounds the
//     worst case (both instances down) instead of doubling the wait.
//   - nominatimFetch: Nominatim's usage policy asks for max ~1 request/sec.
const mapboxFetch = createThrottledFetch({ minSpacingMs: 150, maxRetries: 2, retryBaseDelayMs: 600 });
const orsFetch = createThrottledFetch({
  minSpacingMs: 1600,
  retryableStatuses: [429, 502, 503, 504],
  maxRetries: 2,
  retryBaseDelayMs: 800,
  retryOnNetworkError: true,
  timeoutMs: 8000,
});
const overpassFetch = createThrottledFetch({
  minSpacingMs: 600,
  retryableStatuses: [429, 502, 503, 504],
  maxRetries: 2,
  retryBaseDelayMs: 800,
  retryOnNetworkError: true,
  timeoutMs: 9000,
});
const overpassMirrorFetch = createThrottledFetch({
  minSpacingMs: 600,
  retryableStatuses: [429, 502, 503, 504],
  maxRetries: 1,
  retryBaseDelayMs: 800,
  retryOnNetworkError: true,
  timeoutMs: 9000,
});
const nominatimFetch = createThrottledFetch({
  minSpacingMs: 1000,
  retryableStatuses: [429, 502, 503, 504],
  maxRetries: 1,
  retryBaseDelayMs: 800,
  retryOnNetworkError: true,
  timeoutMs: 6000,
});

// ==================== Full-request diagnostic log ====================
//
// Same mechanism/export name as before this change (drainMapboxRequestLog),
// deliberately kept so tests/eval/run-eval.ts needs no changes — but now
// captures Overpass search attempts instead of Mapbox Search Box ones.
// Arguably more valuable here than it was for Mapbox, given Overpass's
// demonstrated flakiness: every attempt (success or failure) is logged.
export interface MapboxRequestLogEntry {
  timestamp: string;
  method: 'GET' | 'POST';
  /**
   * The actual request is a POST (Overpass QL queries can exceed URL
   * length limits), but this is rendered as the GET-equivalent
   * `?data=<query>` form so it can be pasted straight into a browser or
   * curl to replay — Overpass accepts both.
   */
  url: string;
  /** OSM elements returned by this attempt, before name/coords validation. Absent if the request itself failed. */
  suggestionCount?: number;
  /** How many of those had a usable name + coordinates. Absent if the request failed. */
  retrievedCount?: number;
  /**
   * Always equal to retrievedCount for Overpass results — unlike Mapbox's
   * `proximity` (a soft ranking nudge), Overpass's `around:<radius>` is a
   * hard query-level filter, so every returned element is geographically
   * valid by construction. Kept as a separate field for continuity with
   * the diagnostic log's existing shape/consumers.
   */
  nearbyCount?: number;
  strategy: 'original' | 'strip-descriptors' | 'leading-substring';
}

const requestLog: MapboxRequestLogEntry[] = [];

/** Returns every logged request since the last drain, then clears the log. */
export function drainMapboxRequestLog(): MapboxRequestLogEntry[] {
  const copy = requestLog.slice();
  requestLog.length = 0;
  return copy;
}

// ==================== Region -> proximity resolution ====================
//
// Mapbox Geocoding first (already reliable, generous free tier, per the
// explicit decision to keep it), Nominatim as the free/no-key fallback —
// so Overpass search still has a fast `around:<radius>` anchor to use even
// with zero Mapbox dependency. Each memoized independently per process.

const mapboxRegionCache = new Map<string, { lat: number; lng: number } | null>();

/**
 * Resolves a region name to coordinates via Mapbox Geocoding. Gracefully
 * returns null (never throws) when MAPBOX_ACCESS_TOKEN is missing/invalid —
 * an empty token just produces a 401, treated the same as any other
 * failed lookup here. Callers fall through to nominatimGeocode.
 */
async function resolveRegionProximity(region: string): Promise<{ lat: number; lng: number } | null> {
  const key = region.trim().toLowerCase();
  if (!key) return null;
  if (mapboxRegionCache.has(key)) return mapboxRegionCache.get(key) ?? null;
  if (!MAPBOX_TOKEN) {
    mapboxRegionCache.set(key, null);
    return null;
  }

  let result: { lat: number; lng: number } | null = null;
  try {
    const params = new URLSearchParams({ q: region, access_token: MAPBOX_TOKEN, types: 'place', limit: '1' });
    const res = await mapboxFetch(`${MAPBOX_BASE}/search/geocode/v6/forward?${params.toString()}`);
    if (res.ok) {
      const data = (await res.json()) as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> };
      const coords = data.features?.[0]?.geometry?.coordinates;
      if (coords) result = { lat: coords[1], lng: coords[0] };
    }
  } catch {
    // Best-effort — fall through with null rather than fail the search.
  }
  mapboxRegionCache.set(key, result);
  return result;
}

const nominatimCache = new Map<string, { lat: number; lng: number } | null>();

/** Nominatim fallback geocoder — free, no key. Used only when Mapbox Geocoding isn't available or didn't resolve. */
async function nominatimGeocode(region: string): Promise<{ lat: number; lng: number } | null> {
  const key = region.trim().toLowerCase();
  if (!key) return null;
  if (nominatimCache.has(key)) return nominatimCache.get(key) ?? null;

  let result: { lat: number; lng: number } | null = null;
  try {
    const params = new URLSearchParams({ q: region, format: 'json', limit: '1' });
    const res = await nominatimFetch(`${NOMINATIM_BASE}/search?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.ok) {
      const data = (await res.json()) as Array<{ lat: string; lon: string }>;
      const hit = data[0];
      if (hit) {
        const lat = parseFloat(hit.lat);
        const lng = parseFloat(hit.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) result = { lat, lng };
      }
    }
  } catch {
    // Best-effort — fall through with null.
  }
  nominatimCache.set(key, result);
  return result;
}

/** Mapbox Geocoding first, Nominatim as the free fallback. */
async function resolveProximity(region: string): Promise<{ lat: number; lng: number } | null> {
  return (await resolveRegionProximity(region)) ?? (await nominatimGeocode(region));
}

// ==================== Query simplification (reused from before) ====================
//
// Same escalating-strategy approach validated against the earlier Mapbox
// Search Box implementation: verbose queries ("Senso-ji Temple Asakusa")
// often don't match a name-search directly. Kept deliberately conservative
// here (buildSimplifiedQueries(keywords, 2), not the full cascade) — the
// Overpass public instance's tight concurrency limit means every extra
// attempt has a real cost, unlike Mapbox's much higher headroom.

const DESCRIPTOR_WORDS = [
  'temple', 'shrine', 'taisha', 'jinja', 'grand shrine',
  'market', 'garden', 'gardens', 'museum', 'district', 'pavilion',
  'castle', 'palace', 'tower', 'park', 'cathedral', 'church', 'mosque',
  'aquarium', 'zoo', 'stadium', 'bridge', 'gate', 'hall', 'square',
  'tomb', 'mausoleum', 'memorial', 'monument', 'observatory', 'plaza',
  'building', 'complex', 'shopping street', 'street', 'avenue',
];

/** Removes every descriptor word (whole-word, case-insensitive) and collapses whitespace. */
export function stripDescriptors(query: string): string {
  let result = query;
  for (const word of DESCRIPTOR_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** Leading substrings, longest first, dropping one trailing word at a time down to a single word. Empty/1-word input yields []. */
export function leadingSubstrings(query: string): string[] {
  const words = query.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let n = words.length - 1; n >= 1; n--) {
    out.push(words.slice(0, n).join(' '));
  }
  return out;
}

export interface SimplifiedQueryCandidate {
  query: string;
  strategy: 'strip-descriptors' | 'leading-substring';
}

/** Ordered, deduplicated simplified-query candidates to retry once the original has returned 0 results. Never includes the original itself. */
export function buildSimplifiedQueries(original: string, maxCandidates = 4): SimplifiedQueryCandidate[] {
  const stripped = stripDescriptors(original);
  const strippedChanged = Boolean(stripped) && stripped.toLowerCase() !== original.trim().toLowerCase();

  const candidates: SimplifiedQueryCandidate[] = [];
  if (strippedChanged) candidates.push({ query: stripped, strategy: 'strip-descriptors' });
  for (const s of leadingSubstrings(strippedChanged ? stripped : original)) {
    candidates.push({ query: s, strategy: 'leading-substring' });
  }

  const seen = new Set<string>([original.trim().toLowerCase()]);
  const deduped: SimplifiedQueryCandidate[] = [];
  for (const c of candidates) {
    const key = c.query.toLowerCase();
    if (!c.query || seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  return deduped.slice(0, maxCandidates);
}

// ==================== Overpass search + detail ====================

const SEARCH_RADIUS_METERS = 15000; // generous city-scale radius, keeps the query cheap

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  /** Present on a soft/inline error even with HTTP 200 (e.g. a server-side query timeout) — must be checked separately from res.ok. */
  remark?: string;
}

/** Escapes Overpass QL regex metacharacters AND strips double quotes (the string-literal delimiter) — a literal place name should never be able to break query syntax. */
function sanitizeForOverpassRegex(s: string): string {
  return s.replace(/"/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function elementToPoi(el: OverpassElement): Poi | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const tags = el.tags ?? {};
  const name = tags.name;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;
  const addressParts = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean);
  return {
    id: `osm:${el.type}:${el.id}`,
    name,
    address: addressParts.length > 0 ? addressParts.join(' ') : '',
    location: `${lon},${lat}`,
    type: tags.tourism ?? tags.amenity ?? tags.shop ?? tags.leisure ?? tags.historic ?? 'poi',
    // OSM tags carry neither a numeric rating nor a photo URL — same
    // content gap as the old Mapbox Search Box implementation had; the
    // agent already treats these as LLM-estimated for international
    // destinations regardless of provider.
    rating: undefined,
    photoUrl: undefined,
  };
}

/**
 * POSTs an Overpass QL query to the primary public instance, falling over
 * to an independently-operated mirror if the primary fails outright —
 * either the fetch itself throwing (after overpassFetch's own retries are
 * exhausted) or a non-2xx response. Live testing found overpass-api.de
 * failing under load with a mix of 504/429/network-abort within a single
 * run; two independently-run servers failing at the same moment is a
 * meaningfully rarer event, so this improves real-world odds of a working
 * response at zero cost (no new account/key). Still never throws to the
 * caller in a way they don't already handle — if the mirror ALSO fails,
 * its response/thrown error is returned/propagated exactly like a
 * lone-primary failure was before this existed; overpassSearchOnce and
 * getPoiDetails' existing try/catch + `!res.ok` handling covers both.
 */
async function overpassPost(ql: string): Promise<{ res: Response; base: string }> {
  const body = `data=${encodeURIComponent(ql)}`;
  const headers = { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' };
  try {
    const res = await overpassFetch(OVERPASS_BASE, { method: 'POST', headers, body });
    if (res.ok) return { res, base: OVERPASS_BASE };
    console.log(`[osm] primary Overpass instance returned HTTP ${res.status}, trying mirror`);
  } catch (err: any) {
    console.log(`[osm] primary Overpass instance failed (network): ${err?.message ?? err}, trying mirror`);
  }
  const res = await overpassMirrorFetch(OVERPASS_MIRROR, { method: 'POST', headers, body });
  return { res, base: OVERPASS_MIRROR };
}

/**
 * One Overpass search attempt for a single query string within
 * SEARCH_RADIUS_METERS of `proximity`. Never throws — any failure (HTTP
 * error, network error, or a 200 response carrying a `remark` runtime
 * error) is logged and treated as "found nothing", per this file's
 * documented reliability tradeoff.
 */
async function overpassSearchOnce(
  query: string,
  proximity: { lat: number; lng: number },
  limit: number,
  strategy: MapboxRequestLogEntry['strategy'],
): Promise<Poi[]> {
  const escaped = sanitizeForOverpassRegex(query.trim());
  const ql = `[out:json][timeout:8];(node["name"~"${escaped}",i](around:${SEARCH_RADIUS_METERS},${proximity.lat},${proximity.lng});way["name"~"${escaped}",i](around:${SEARCH_RADIUS_METERS},${proximity.lat},${proximity.lng}););out center ${limit};`;

  const requestEntry: MapboxRequestLogEntry = {
    timestamp: new Date().toISOString(),
    method: 'POST',
    // Corrected below to whichever instance (primary or mirror) actually
    // served the response — placeholder until then.
    url: `${OVERPASS_BASE}?data=${encodeURIComponent(ql)}`,
    strategy,
  };
  requestLog.push(requestEntry);

  let res: Response;
  try {
    const attempt = await overpassPost(ql);
    res = attempt.res;
    requestEntry.url = `${attempt.base}?data=${encodeURIComponent(ql)}`;
  } catch (err: any) {
    requestEntry.suggestionCount = 0;
    requestEntry.retrievedCount = 0;
    requestEntry.nearbyCount = 0;
    console.log(`[osm] Overpass request failed (network, primary and mirror both): ${err?.message ?? err}`);
    return [];
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    requestEntry.suggestionCount = 0;
    requestEntry.retrievedCount = 0;
    requestEntry.nearbyCount = 0;
    console.log(`[osm] Overpass HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    return [];
  }

  let data: OverpassResponse;
  try {
    data = (await res.json()) as OverpassResponse;
  } catch {
    requestEntry.suggestionCount = 0;
    requestEntry.retrievedCount = 0;
    requestEntry.nearbyCount = 0;
    return [];
  }
  if (data.remark) {
    // A 200 response can still carry a runtime error (e.g. a server-side
    // query timeout) in `remark` instead of a non-2xx status.
    requestEntry.suggestionCount = 0;
    requestEntry.retrievedCount = 0;
    requestEntry.nearbyCount = 0;
    console.log(`[osm] Overpass returned a runtime remark (treated as 0 results): ${data.remark}`);
    return [];
  }

  const elements = data.elements ?? [];
  const pois = elements.map(elementToPoi).filter((p): p is Poi => p !== null);
  requestEntry.suggestionCount = elements.length;
  requestEntry.retrievedCount = pois.length;
  // Overpass's around:<radius> is a hard filter, not a ranking hint like
  // Mapbox's proximity was — every result here is geographically valid by
  // construction, no separate sanity check needed (unlike the old
  // Mapbox-based implementation, which had to add one after finding
  // "successful" matches on the wrong continent).
  requestEntry.nearbyCount = pois.length;
  return pois;
}

/**
 * Search POIs by free-form keywords, scoped to a city/region. `region` is
 * required in practice: without a resolvable proximity anchor, an unscoped
 * name search would be far too expensive/unscoped to attempt against any
 * of the providers below, so this returns empty rather than trying.
 *
 * Provider order (see geoapify.ts's module docstring for why Geoapify goes
 * first — confirmed, not assumed, more reliable than the free public
 * Overpass ecosystem as of live testing):
 *   1. Geoapify (/v1/geocode/search, hard-filtered by radius) — skipped
 *      entirely if GEOAPIFY_PLACES_API_KEY is unset. If the original
 *      keywords return 0 results, retries with up to 2 simplified
 *      candidates (see buildSimplifiedQueries) before falling through —
 *      fixed after live testing showed a compound/verbose query (e.g.
 *      "Odaiba Aqua City shopping") that Geoapify's free-text search
 *      didn't match would previously fall straight to Overpass on a
 *      single miss, giving Geoapify only one attempt vs. Overpass's
 *      three; both providers now get the same retry budget.
 *   2. OpenStreetMap Overpass (around:<radius> query, hard-filtered by
 *      construction) — primary instance, then an independent mirror. Same
 *      original + up-to-2-simplified-candidates retry pattern —
 *      deliberately conservative vs. the old Mapbox implementation's
 *      up-to-4, given Overpass's tight per-IP concurrency limit.
 * Never throws — any/all provider failures degrade to `{ pois: [], count: 0 }`.
 */
export async function searchPlaces(
  keywords: string,
  region?: string,
  limit: number = 10,
): Promise<PoiSearchResult> {
  if (!keywords.trim()) return { pois: [], count: 0 };
  const cappedLimit = Math.min(Math.max(limit, 1), 10);

  const proximity = region ? await resolveProximity(region) : null;
  if (!proximity) return { pois: [], count: 0 };

  // Computed once, shared by both providers' retry sequences below —
  // stripDescriptors/leadingSubstrings is pure string manipulation on
  // `keywords`, not tied to either provider.
  const candidates = buildSimplifiedQueries(keywords, 2);

  let geoapifyPois = await geoapifySearchPlaces(keywords, proximity, SEARCH_RADIUS_METERS, cappedLimit);
  if (geoapifyPois.length === 0 && candidates.length > 0) {
    for (const candidate of candidates) {
      geoapifyPois = await geoapifySearchPlaces(candidate.query, proximity, SEARCH_RADIUS_METERS, cappedLimit);
      if (geoapifyPois.length > 0) {
        console.log(`[geoapify] simplified retry succeeded: ${JSON.stringify(keywords)} -> ${JSON.stringify(candidate.query)}`);
        break;
      }
    }
  }
  if (geoapifyPois.length > 0) return { pois: geoapifyPois, count: geoapifyPois.length };

  let pois = await overpassSearchOnce(keywords, proximity, cappedLimit, 'original');
  if (pois.length === 0) {
    if (candidates.length > 0) {
      console.log(`[osm] 0 results for ${JSON.stringify(keywords)} — retrying with ${candidates.length} simplified quer${candidates.length === 1 ? 'y' : 'ies'}`);
    }
    for (const candidate of candidates) {
      pois = await overpassSearchOnce(candidate.query, proximity, cappedLimit, candidate.strategy);
      if (pois.length > 0) {
        console.log(`[osm] simplified retry succeeded via "${candidate.strategy}": ${JSON.stringify(keywords)} -> ${JSON.stringify(candidate.query)}`);
        break;
      }
    }
    if (pois.length === 0 && candidates.length > 0) {
      console.log(`[osm] all simplified retries returned 0 results for ${JSON.stringify(keywords)}`);
    }
  }
  return { pois, count: pois.length };
}

/**
 * Fetch a single POI by id, as returned by searchPlaces — either
 * "geoapify:<place_id>" or "osm:<node|way|relation>:<id>" depending on
 * which provider actually served the original search. Never throws — any
 * failure returns null.
 */
export async function getPoiDetails(poiId: string): Promise<Poi | null> {
  if (!poiId) return null;
  if (poiId.startsWith('geoapify:')) {
    return geoapifyPlaceDetails(poiId.slice('geoapify:'.length));
  }
  const match = /^osm:(node|way|relation):(\d+)$/.exec(poiId);
  if (!match) return null;
  const [, osmType, osmId] = match;

  const ql = `[out:json][timeout:8];${osmType}(${osmId});out center;`;
  let res: Response;
  try {
    res = (await overpassPost(ql)).res;
  } catch (err: any) {
    console.log(`[osm] Overpass detail lookup failed (network, primary and mirror both): ${err?.message ?? err}`);
    return null;
  }
  if (!res.ok) return null;

  let data: OverpassResponse;
  try {
    data = (await res.json()) as OverpassResponse;
  } catch {
    return null;
  }
  if (data.remark) return null;
  const el = data.elements?.[0];
  return el ? elementToPoi(el) : null;
}

// ==================== Distance (ORS primary, Mapbox fallback, haversine last resort) ====================

interface MapboxDirectionsRaw {
  code: string;
  routes?: Array<{ distance: number; duration: number }>;
}

interface OrsDirectionsRaw {
  features?: Array<{ properties?: { summary?: { distance: number; duration: number } } }>;
}

/** ORS's own profile names — 1=driving, 3=walking (matches the Mapbox-era type convention this file already used). */
function orsProfile(type: 1 | 3): string {
  return type === 3 ? 'foot-walking' : 'driving-car';
}

/** Real road-network distance/duration via OpenRouteService Directions V2. Throws on any failure — caller decides how to fall back. */
async function orsDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  type: 1 | 3,
): Promise<DistanceResult> {
  const profile = orsProfile(type);
  const params = new URLSearchParams({
    api_key: ORS_TOKEN,
    start: `${origin.lng},${origin.lat}`,
    end: `${destination.lng},${destination.lat}`,
  });
  const url = `${ORS_BASE}/v2/directions/${profile}?${params.toString()}`;
  const res = await orsFetch(url);
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(`ORS directions HTTP ${res.status}${body ? `: ${body}` : ''} (profile=${profile})`);
  }
  const data = (await res.json()) as OrsDirectionsRaw;
  const summary = data.features?.[0]?.properties?.summary;
  if (!summary) throw new Error(`ORS directions returned no route (profile=${profile})`);
  return { distanceMeters: Math.round(summary.distance), durationSeconds: Math.round(summary.duration) };
}

/** Real road-network distance/duration via Mapbox Directions V5. Throws on any failure — caller decides how to fall back. */
async function mapboxDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  type: 1 | 3,
): Promise<DistanceResult> {
  const profile = type === 3 ? 'walking' : 'driving';
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const params = new URLSearchParams({ access_token: MAPBOX_TOKEN, overview: 'false' });
  const url = `${MAPBOX_BASE}/directions/v5/mapbox/${profile}/${coords}?${params.toString()}`;
  const res = await mapboxFetch(url);
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(`Mapbox directions HTTP ${res.status}${body ? `: ${body}` : ''} (profile=${profile}, coords=${coords})`);
  }
  const data = (await res.json()) as MapboxDirectionsRaw;
  if (data.code !== 'Ok') {
    const msg = (data as any).message;
    throw new Error(`Mapbox directions failed: ${data.code}${msg ? ` — ${msg}` : ''} (profile=${profile}, coords=${coords})`);
  }
  const first = data.routes?.[0];
  if (!first) throw new Error(`Mapbox directions returned no route (profile=${profile}, coords=${coords})`);
  return { distanceMeters: Math.round(first.distance), durationSeconds: Math.round(first.duration) };
}

/**
 * Compute distance + travel time between two points.
 * type: 0 = straight-line (computed locally, no API call, no token needed),
 * 1 = driving (default), 3 = walking.
 *
 * For type 1/3, tries four layers in order, each only attempted if the
 * previous one is unavailable or fails, and NEVER throws — a genuine
 * behavior change from the Mapbox-only version, extending the same
 * graceful-degradation contract the rest of this file already has:
 *   1. Geoapify Routing V1, if GEOAPIFY_ROUTING_API_KEY is set — tried
 *      first (see geoapify.ts's module docstring for why).
 *   2. OpenRouteService Directions V2, if ORS_API_KEY is set.
 *   3. Mapbox Directions V5, if MAPBOX_ACCESS_TOKEN is set (and neither
 *      Geoapify nor ORS was usable).
 *   4. A haversine straight-line estimate with a rough speed-based
 *      duration guess — not a real route, but keeps the agent's "keep the
 *      daily route compact" instruction usable even with zero routing
 *      providers configured, rather than silently returning nothing.
 * Each fallback is logged via console.warn so a degraded-quality distance
 * is visible in server logs, not silently indistinguishable from a real one.
 */
export async function calculateDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  type: 0 | 1 | 3 = 1,
): Promise<DistanceResult> {
  if (type === 0) {
    return { distanceMeters: haversineMeters(origin, destination), durationSeconds: 0 };
  }
  if (hasGeoapifyRoutingKey()) {
    try {
      return await geoapifyRoute(origin, destination, type);
    } catch (err: any) {
      console.warn(`[mapbox.ts] Geoapify routing failed, falling back: ${err.message ?? err}`);
    }
  }
  if (ORS_TOKEN) {
    try {
      return await orsDirections(origin, destination, type);
    } catch (err: any) {
      console.warn(`[mapbox.ts] ORS directions failed, falling back: ${err.message ?? err}`);
    }
  }
  if (MAPBOX_TOKEN) {
    try {
      return await mapboxDirections(origin, destination, type);
    } catch (err: any) {
      console.warn(`[mapbox.ts] Mapbox directions failed, falling back to straight-line estimate: ${err.message ?? err}`);
    }
  }
  const distanceMeters = haversineMeters(origin, destination);
  // Rough average speeds, not routed — just enough to make the duration
  // read as "an estimate" rather than 0 ("instant").
  const speedMetersPerSecond = type === 3 ? 1.3 : 11; // ~4.7 km/h walking, ~40 km/h driving-ish average
  return { distanceMeters: Math.round(distanceMeters), durationSeconds: Math.round(distanceMeters / speedMetersPerSecond) };
}

/** Great-circle distance in meters — used for type 0 (straight-line) only. */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
