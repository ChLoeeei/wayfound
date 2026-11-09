import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cachedToolCall } from '../../server/tools/cache';
import { sanitizeImageUrls } from '../../server/agent';

describe('cachedToolCall', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'wayfound-tool-cache-'));
  });
  afterEach(() => {
    delete process.env.TOOL_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a pass-through when TOOL_CACHE_DIR is unset', async () => {
    const fn = vi.fn(async () => ({ pois: [1] }));
    await cachedToolCall(['a'], fn, () => true);
    await cachedToolCall(['a'], fn, () => true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('serves a stored result on the second call with the same key', async () => {
    process.env.TOOL_CACHE_DIR = dir;
    const fn = vi.fn(async () => ({ pois: [1] }));
    const first = await cachedToolCall(['search_places', 'Eiffel', 'Paris'], fn, () => true);
    const second = await cachedToolCall(['search_places', 'Eiffel', 'Paris'], fn, () => true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // A different argument is a different key.
    await cachedToolCall(['search_places', 'Louvre', 'Paris'], fn, () => true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not store results rejected by shouldStore (e.g. empty search during an outage)', async () => {
    process.env.TOOL_CACHE_DIR = dir;
    const fn = vi.fn(async () => ({ pois: [] as number[] }));
    await cachedToolCall(['x'], fn, r => r.pois.length > 0);
    await cachedToolCall(['x'], fn, r => r.pois.length > 0);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(readdirSync(dir)).toHaveLength(0);
  });
});

describe('sanitizeImageUrls', () => {
  const build = (urls: string[]) => ({
    days: [{ dayNumber: 1, slots: [{ period: 'morning', places: urls.map((imageUrl, i) => ({ id: `p${i}`, name: `P${i}`, imageUrl })) }] }],
  });

  it('keeps only photo URLs a tool actually returned, blanks invented ones', () => {
    const real = '/api/image-proxy?url=https%3A%2F%2Fstore.is.autonavi.com%2Fa.jpg';
    const itin = build([real, 'https://images.unsplash.com/photo-1583766395091-2eb9994ed094?w=800', '']);
    sanitizeImageUrls(itin, { servedPhotoUrls: new Set([real]) });
    expect(itin.days[0].slots[0].places.map(p => p.imageUrl)).toEqual([real, '', '']);
  });

  it('tolerates malformed itineraries without throwing', () => {
    expect(() => sanitizeImageUrls({} as any, { servedPhotoUrls: new Set() })).not.toThrow();
    expect(() => sanitizeImageUrls({ days: [{ slots: null }] } as any, { servedPhotoUrls: new Set() })).not.toThrow();
  });
});
