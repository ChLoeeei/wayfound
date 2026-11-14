import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Lesson, fetchLessons, filterLessons, parseLessonScope, resetLessonsCache, sortLessons } from '../../src/lib/lessons';

const L = (id: string, scope: string, helpful = 0, harmful = 0): Lesson => ({
  id,
  scope,
  lesson: `lesson ${id}`,
  helpful,
  harmful,
  created_epoch: 1,
  source_case: 'x',
});

const lessons = [L('L01', 'final_answer', 8, 6), L('L02', 'international/search_places', 3, 0), L('L03', 'calculate_distance', 1, 1), L('L04', 'general', 5, 0), L('L05', 'domestic')];

describe('lesson scopes and filters', () => {
  it('parses every allowed scope form', () => {
    expect(parseLessonScope('general')).toEqual({});
    expect(parseLessonScope('domestic')).toEqual({ region: 'domestic' });
    expect(parseLessonScope('search_places')).toEqual({ tool: 'search_places' });
    expect(parseLessonScope('international/calculate_distance')).toEqual({ region: 'international', tool: 'calculate_distance' });
    expect(parseLessonScope('Final_Answer')).toEqual({ tool: 'final_answer' });
    expect(parseLessonScope('')).toEqual({});
  });

  it('filters by this run and by tool scope', () => {
    expect(filterLessons(lessons, 'all')).toHaveLength(5);
    expect(filterLessons(lessons, 'used', ['L02', 'L04', 'L99']).map(l => l.id)).toEqual(['L02', 'L04']);
    expect(filterLessons(lessons, 'used').map(l => l.id)).toEqual([]);
    expect(filterLessons(lessons, 'search_places').map(l => l.id)).toEqual(['L02']);
    expect(filterLessons(lessons, 'calculate_distance').map(l => l.id)).toEqual(['L03']);
    expect(filterLessons(lessons, 'final_answer').map(l => l.id)).toEqual(['L01']);
  });

  it('sorts by net score then id', () => {
    expect(sortLessons(lessons).map(l => l.id)).toEqual(['L04', 'L02', 'L01', 'L03', 'L05']);
  });
});

describe('fetchLessons', () => {
  afterEach(() => {
    resetLessonsCache();
    vi.unstubAllGlobals();
  });

  it('fetches once and shares the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ libraryVersion: 3, method: 'group', epoch: 1, updatedAt: '', lessons }) });
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([fetchLessons(), fetchLessons()]);
    expect(a).toBe(b);
    expect(a.libraryVersion).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/lessons');
  });

  it('retries after a failure instead of caching it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ libraryVersion: 1, method: 'group', epoch: 1, updatedAt: '', lessons: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchLessons()).rejects.toThrow('HTTP 500');
    await expect(fetchLessons()).resolves.toMatchObject({ libraryVersion: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
