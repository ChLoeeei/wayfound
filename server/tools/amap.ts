/**
 * Amap Web Service API client.
 * Docs: https://lbs.amap.com/api/webservice/summary
 *
 * NOTE: The same key is used for both JS SDK and Web Service in practice,
 * but production should split them. AMAP_API_KEY env var is reused here.
 */

const AMAP_KEY = process.env.AMAP_API_KEY || process.env.GAODE_API_KEY || '';
const AMAP_BASE = 'https://restapi.amap.com';

export interface AmapPoi {
  id: string;
  name: string;
  address: string;
  /** "lng,lat" e.g. "116.404,39.915" */
  location: string;
  type: string;
  /** typecode prefix matches business category */
  typecode?: string;
  rating?: number;
  /** primary photo URL when available */
  photoUrl?: string;
}

export interface AmapSearchResult {
  pois: AmapPoi[];
  count: number;
}

interface AmapTextSearchRaw {
  status: string;
  info: string;
  count: string;
  pois?: Array<{
    id: string;
    name: string;
    address: string | string[];
    location: string;
    type: string;
    typecode: string;
    biz_ext?: { rating?: string };
    photos?: Array<{ url?: string }>;
  }>;
}

function normaliseAddress(addr: string | string[] | undefined): string {
  if (!addr) return '';
  return Array.isArray(addr) ? addr.join(' ') : addr;
}

function parsePoi(raw: NonNullable<AmapTextSearchRaw['pois']>[number]): AmapPoi {
  const ratingStr = raw.biz_ext?.rating;
  return {
    id: raw.id,
    name: raw.name,
    address: normaliseAddress(raw.address),
    location: raw.location,
    type: raw.type,
    typecode: raw.typecode,
    rating: ratingStr ? parseFloat(ratingStr) || undefined : undefined,
    photoUrl: raw.photos?.[0]?.url,
  };
}

/**
 * Search POIs by free-form keywords, scoped to a city/region.
 * @param keywords e.g. "鼎泰丰" or "外滩 上海"
 * @param region city name or adcode (optional but recommended)
 * @param limit page_size, max 25
 */
export async function searchPlaces(
  keywords: string,
  region?: string,
  limit: number = 10,
): Promise<AmapSearchResult> {
  if (!AMAP_KEY) {
    throw new Error('AMAP_API_KEY is not configured');
  }
  if (!keywords.trim()) {
    return { pois: [], count: 0 };
  }
  const params = new URLSearchParams({
    key: AMAP_KEY,
    keywords,
    offset: String(Math.min(Math.max(limit, 1), 25)),
    page: '1',
    extensions: 'all',
    output: 'JSON',
  });
  if (region) params.set('city', region);

  const url = `${AMAP_BASE}/v3/place/text?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Amap text search HTTP ${res.status}`);
  }
  const data = (await res.json()) as AmapTextSearchRaw;
  if (data.status !== '1') {
    throw new Error(`Amap text search failed: ${data.info}`);
  }
  return {
    pois: (data.pois ?? []).map(parsePoi),
    count: parseInt(data.count, 10) || 0,
  };
}

/**
 * Fetch detail for a single POI id (richer than text search).
 */
export async function getPoiDetails(poiId: string): Promise<AmapPoi | null> {
  if (!AMAP_KEY) throw new Error('AMAP_API_KEY is not configured');
  if (!poiId) return null;
  const params = new URLSearchParams({
    key: AMAP_KEY,
    id: poiId,
    extensions: 'all',
    output: 'JSON',
  });
  const url = `${AMAP_BASE}/v3/place/detail?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Amap detail HTTP ${res.status}`);
  const data = (await res.json()) as AmapTextSearchRaw;
  if (data.status !== '1') return null;
  const raw = data.pois?.[0];
  return raw ? parsePoi(raw) : null;
}

/** Result of a distance call between two coordinates. */
export interface DistanceResult {
  /** straight-line / route distance in meters */
  distanceMeters: number;
  /** estimated travel time in seconds (driving) */
  durationSeconds: number;
}

interface AmapDistanceRaw {
  status: string;
  info: string;
  results?: Array<{ distance: string; duration: string }>;
}

/**
 * Compute distance + driving time between two points.
 * type: 0 = straight-line, 1 = driving (default), 3 = walking
 */
export async function calculateDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  type: 0 | 1 | 3 = 1,
): Promise<DistanceResult> {
  if (!AMAP_KEY) throw new Error('AMAP_API_KEY is not configured');
  const params = new URLSearchParams({
    key: AMAP_KEY,
    origins: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    type: String(type),
    output: 'JSON',
  });
  const url = `${AMAP_BASE}/v3/distance?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Amap distance HTTP ${res.status}`);
  const data = (await res.json()) as AmapDistanceRaw;
  if (data.status !== '1') throw new Error(`Amap distance failed: ${data.info}`);
  const first = data.results?.[0];
  return {
    distanceMeters: first ? parseInt(first.distance, 10) || 0 : 0,
    durationSeconds: first ? parseInt(first.duration, 10) || 0 : 0,
  };
}

/** Parse "lng,lat" string into a {lat, lng} object. */
export function parseLngLat(loc: string): { lat: number; lng: number } | null {
  if (!loc) return null;
  const [lngStr, latStr] = loc.split(',');
  const lng = parseFloat(lngStr);
  const lat = parseFloat(latStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
