/**
 * Wikivoyage client — free, no API key, travel-guide-specific text via the
 * public MediaWiki Action API (https://en.wikivoyage.org/w/api.php). Used
 * by the get_destination_context tool (see ./index.ts) to ground
 * aiNote / "why visit" / practical-tips text in real content instead of
 * relying purely on the model's parametric memory. Chosen over a generic
 * web-search tool specifically because it needs no key and returns
 * travel-guide-focused text rather than noisy general search results.
 *
 * LICENSE: Wikivoyage content is CC BY-SA 4.0
 * (https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft) — requires visible
 * attribution wherever this content informs displayed text, and
 * share-alike for any reused/derived text. This is wired into the UI at
 * server.ts (computes `sourceAttributions` from the tool-call trace) and
 * src/components/ItineraryPane.tsx (renders the attribution badge) — do
 * not remove that wiring without also removing this tool, and see
 * CLAUDE.md / the README's licensing notes for the product-level
 * requirement this satisfies.
 *
 * Two-step lookup, the same shape as amap.ts/mapbox.ts's search-then-detail
 * pattern: `list=search` finds the best-matching article (handles
 * romanization, redirects, and topic hints — an exact `titles=` lookup is
 * case-sensitive and has no fuzzy matching), then `prop=extracts` by
 * pageid fetches the actual intro text. Verified against the live API
 * before landing this.
 */
import { createThrottledFetch, readErrorBody } from './http';

const WIKIVOYAGE_BASE = 'https://en.wikivoyage.org/w/api.php';
// Wikimedia's API etiquette policy asks for a descriptive User-Agent
// identifying the application, even though it isn't strictly enforced for
// the API (unlike raw content URLs).
const USER_AGENT = 'Wayfound-TravelPlanner/1.0 (educational project)';
// Wikivoyage's API is far more permissive than Mapbox's, but every
// external client in this codebase goes through the same shared
// throttle/retry wrapper (see ./http) rather than a raw fetch — cheap
// insurance, and each client gets its own independent spacing state.
const wikivoyageFetch = createThrottledFetch({ minSpacingMs: 100, maxRetries: 2, retryBaseDelayMs: 500 });

interface WikivoyageSearchRaw {
  query?: { search?: Array<{ pageid: number; title: string }> };
}

interface WikivoyageExtractRaw {
  query?: { pages?: Record<string, { pageid: number; title: string; extract?: string }> };
}

export interface DestinationContext {
  title: string;
  /** Plain-text intro extract, capped to keep the tool result token-budget-friendly. */
  extract: string;
  url: string;
  /** Always 'wikivoyage' today — kept as a field in case another source is ever added. */
  source: 'wikivoyage';
  license: string;
}

const MAX_EXTRACT_CHARS = 1500;

async function callApi<T>(params: Record<string, string>): Promise<T> {
  const url = `${WIKIVOYAGE_BASE}?${new URLSearchParams({ format: 'json', ...params }).toString()}`;
  const res = await wikivoyageFetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(`Wikivoyage API HTTP ${res.status}${body ? `: ${body}` : ''} (params=${JSON.stringify(params)})`);
  }
  return (await res.json()) as T;
}

async function searchTitle(query: string): Promise<{ pageid: number; title: string } | undefined> {
  const searchData = await callApi<WikivoyageSearchRaw>({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '1',
  });
  return searchData.query?.search?.[0];
}

/**
 * Fetch a short travel-guide extract for a destination.
 *
 * Always searches by `destination` ALONE first. Folding a topic straight
 * into the search query (e.g. "北京" + "culture history" -> "北京 culture
 * history") was tried and reverted — verified against the live API:
 * searching "北京 culture history" ranks an unrelated "Automotive history"
 * article above the correct "Beijing" page, while "北京" alone correctly
 * finds "Beijing" first. Mixed-script (CJK destination + English topic)
 * queries are especially prone to this. `topic` is only ever tried as a
 * fallback *after* the plain-destination search comes back empty — it can
 * only help find something when there was otherwise nothing, never corrupt
 * a lookup that would have succeeded on its own. Wikivoyage's plain-text
 * extract API also only returns an article's intro, not an arbitrary named
 * section, so `topic` was never going to scope *which part* of the article
 * comes back anyway — just, at best, which article gets found at all.
 *
 * Returns null when there's no matching article at all — a very obscure
 * destination genuinely may not have one; this is not an error condition.
 */
export async function getDestinationContext(
  destination: string,
  topic?: string,
): Promise<DestinationContext | null> {
  if (!destination.trim()) return null;

  let hit = await searchTitle(destination);
  if (!hit && topic?.trim()) {
    hit = await searchTitle(`${destination} ${topic}`);
  }
  if (!hit) return null;

  const extractData = await callApi<WikivoyageExtractRaw>({
    action: 'query',
    prop: 'extracts',
    pageids: String(hit.pageid),
    exintro: '1',
    explaintext: '1',
  });
  const page = extractData.query?.pages?.[String(hit.pageid)];
  const extract = page?.extract?.trim();
  if (!extract) return null;

  return {
    title: hit.title,
    extract: extract.length > MAX_EXTRACT_CHARS ? `${extract.slice(0, MAX_EXTRACT_CHARS)}…` : extract,
    url: `https://en.wikivoyage.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
    source: 'wikivoyage',
    license: 'CC BY-SA 4.0',
  };
}
