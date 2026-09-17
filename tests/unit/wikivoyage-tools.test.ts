import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDestinationContext } = await import('../../server/tools/wikivoyage');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const SEARCH_KYOTO = {
  query: { search: [{ pageid: 18579, title: 'Kyoto' }] },
};

const EXTRACT_KYOTO = {
  query: {
    pages: {
      '18579': {
        pageid: 18579,
        title: 'Kyoto',
        extract: "Kyōto (京都) was the capital of Japan for over a millennium, and carries a reputation as the nation's most beautiful city.",
      },
    },
  },
};

describe('getDestinationContext', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns a parsed extract for a matched destination', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('list=search')) return jsonResponse(SEARCH_KYOTO);
      if (url.includes('prop=extracts')) return jsonResponse(EXTRACT_KYOTO);
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await getDestinationContext('Kyoto');
    expect(r).not.toBeNull();
    expect(r?.title).toBe('Kyoto');
    expect(r?.extract).toContain('capital of Japan');
    expect(r?.source).toBe('wikivoyage');
    expect(r?.license).toBe('CC BY-SA 4.0');
    expect(r?.url).toBe('https://en.wikivoyage.org/wiki/Kyoto');
  });

  it('searches by destination alone first, ignoring topic, when that already finds a match', async () => {
    // Confirmed against the live API: folding a topic straight into the
    // query (e.g. "北京 culture history") can rank an unrelated article
    // above the correct destination page, while the bare destination finds
    // it correctly. So topic must never be used when the plain search
    // already succeeds — only as a fallback (see the next test).
    const searchUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('list=search')) {
        searchUrls.push(url);
        return jsonResponse(SEARCH_KYOTO);
      }
      if (url.includes('prop=extracts')) return jsonResponse(EXTRACT_KYOTO);
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await getDestinationContext('Kyoto', 'food');
    expect(searchUrls).toHaveLength(1);
    expect(new URL(searchUrls[0]).searchParams.get('srsearch')).toBe('Kyoto');
    expect(r?.title).toBe('Kyoto');
  });

  it('falls back to a destination+topic search only when the plain destination search finds nothing', async () => {
    const searchUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('list=search')) {
        const q = new URL(url).searchParams.get('srsearch');
        searchUrls.push(q ?? '');
        if (q === 'Kyoto') return jsonResponse({ query: { search: [] } });
        return jsonResponse(SEARCH_KYOTO);
      }
      if (url.includes('prop=extracts')) return jsonResponse(EXTRACT_KYOTO);
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await getDestinationContext('Kyoto', 'food');
    expect(searchUrls).toEqual(['Kyoto', 'Kyoto food']);
    expect(r?.title).toBe('Kyoto');
  });

  it('returns null when search finds no matching article', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('list=search')) return jsonResponse({ query: { search: [] } });
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await getDestinationContext('Xyzzyplace123NotReal');
    expect(r).toBeNull();
  });

  it('returns null for empty input without hitting the network', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const r = await getDestinationContext('   ');
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when the matched page has no extract text', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('list=search')) return jsonResponse(SEARCH_KYOTO);
      if (url.includes('prop=extracts')) return jsonResponse({ query: { pages: { '18579': { pageid: 18579, title: 'Kyoto' } } } });
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await getDestinationContext('Kyoto');
    expect(r).toBeNull();
  });

  it('truncates an overly long extract', async () => {
    const longExtract = 'A'.repeat(2000);
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('list=search')) return jsonResponse(SEARCH_KYOTO);
      if (url.includes('prop=extracts')) {
        return jsonResponse({ query: { pages: { '18579': { pageid: 18579, title: 'Kyoto', extract: longExtract } } } });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    const r = await getDestinationContext('Kyoto');
    expect(r?.extract.length).toBeLessThan(2000);
    expect(r?.extract.endsWith('…')).toBe(true);
  });

  it('throws with status and body when the search call itself fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"error":"boom"}', { status: 500 })) as any;
    await expect(getDestinationContext('Kyoto')).rejects.toThrow(/HTTP 500/);
  });

  it('sends a descriptive User-Agent header', async () => {
    let sentHeaders: HeadersInit | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      sentHeaders = init?.headers;
      if (url.includes('list=search')) return jsonResponse({ query: { search: [] } });
      throw new Error(`unexpected url: ${url}`);
    }) as any;

    await getDestinationContext('Kyoto');
    expect((sentHeaders as Record<string, string>)?.['User-Agent']).toMatch(/Wayfound/);
  });
});
