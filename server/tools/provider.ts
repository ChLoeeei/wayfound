/**
 * Shared map-provider contract: the normalized POI shape both amap.ts and
 * mapbox.ts return, plus the routing heuristic that decides which provider
 * a given destination should use.
 *
 * Extracted from tests/eval/scoring.ts's original isLikelyMainlandChina()
 * (Priority 1 eval harness) so production routing and the eval harness
 * share one implementation instead of two copies that can drift.
 */

/** Which backend map/POI provider a destination should route through. */
export type MapProvider = 'amap' | 'mapbox';

/**
 * Normalized place-of-interest shape returned by every provider's
 * search/detail tool. Providers differ in what they can actually fill in —
 * Amap (mainland China) reliably has `rating`/`photoUrl`; Mapbox does not
 * expose either, so those stay undefined for international POIs. Every
 * consumer downstream (ToolContext, runTool, the agent) works off this
 * shape regardless of which provider produced it.
 */
export interface Poi {
  id: string;
  name: string;
  address: string;
  /** "lng,lat" — matches Amap's convention; see parseLngLat(). */
  location: string;
  type: string;
  typecode?: string;
  rating?: number;
  photoUrl?: string;
}

export interface PoiSearchResult {
  pois: Poi[];
  count: number;
}

/** Result of a distance/duration calculation between two coordinates. */
export interface DistanceResult {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Mainland-China city/keyword hints used to route a destination to Amap
 * (which has real POI coverage there) vs. Mapbox (everywhere else).
 * Deliberately excludes Hong Kong / Macau / Taiwan — Amap's mainland Web
 * Service API doesn't reliably cover them, so they route to Mapbox.
 *
 * Hardened vs. the original eval-only version: matches English city names
 * case-insensitively too (a domestic-China trip typed as "Beijing" rather
 * than "北京" would otherwise misroute to Mapbox), plus a generic
 * "china" / "中国" catch-all.
 *
 * Still a simple substring heuristic, not a real geocoder — known
 * limitation, see architecture notes. Good enough for routing a search
 * tool call, not authoritative for anything else.
 */
const MAINLAND_CHINA_CITY_HINTS: Array<{ zh: string; en: string }> = [
  { zh: '北京', en: 'beijing' },
  { zh: '上海', en: 'shanghai' },
  { zh: '广州', en: 'guangzhou' },
  { zh: '深圳', en: 'shenzhen' },
  { zh: '成都', en: 'chengdu' },
  { zh: '杭州', en: 'hangzhou' },
  { zh: '西安', en: "xi'an" },
  { zh: '重庆', en: 'chongqing' },
  { zh: '南京', en: 'nanjing' },
  { zh: '苏州', en: 'suzhou' },
  { zh: '武汉', en: 'wuhan' },
  { zh: '天津', en: 'tianjin' },
  { zh: '青岛', en: 'qingdao' },
  { zh: '大连', en: 'dalian' },
  { zh: '厦门', en: 'xiamen' },
  { zh: '丽江', en: 'lijiang' },
  { zh: '桂林', en: 'guilin' },
  { zh: '三亚', en: 'sanya' },
  { zh: '哈尔滨', en: 'harbin' },
  { zh: '长沙', en: 'changsha' },
  { zh: '昆明', en: 'kunming' },
  { zh: '贵阳', en: 'guiyang' },
  { zh: '拉萨', en: 'lhasa' },
  { zh: '乌鲁木齐', en: 'urumqi' },
  { zh: '兰州', en: 'lanzhou' },
  { zh: '太原', en: 'taiyuan' },
  { zh: '石家庄', en: 'shijiazhuang' },
  { zh: '济南', en: 'jinan' },
  { zh: '郑州', en: 'zhengzhou' },
  { zh: '合肥', en: 'hefei' },
];

const MAINLAND_CHINA_GENERIC_HINTS = ['中国', 'china', 'prc'];

/**
 * Best-effort heuristic: does this destination look like mainland China?
 * Case-insensitive on the English side (Chinese characters have no case).
 */
export function isLikelyMainlandChina(destination: string): boolean {
  const raw = destination ?? '';
  const lower = raw.toLowerCase();
  const hasCityHint = MAINLAND_CHINA_CITY_HINTS.some(({ zh, en }) => raw.includes(zh) || lower.includes(en));
  if (hasCityHint) return true;
  return MAINLAND_CHINA_GENERIC_HINTS.some(hint => lower.includes(hint));
}

/** Route a destination to the map/POI provider that actually has data there. */
export function getMapProvider(destination: string): MapProvider {
  return isLikelyMainlandChina(destination) ? 'amap' : 'mapbox';
}

/** Parse "lng,lat" into {lat,lng}. Shared by both providers' clients. */
export function parseLngLat(loc: string): { lat: number; lng: number } | null {
  if (!loc) return null;
  const [lngStr, latStr] = loc.split(',');
  const lng = parseFloat(lngStr);
  const lat = parseFloat(latStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
