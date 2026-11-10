import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applyOps,
  emptyLibrary,
  enforceCap,
  loadLibrary,
  normalizeScope,
  saveLibrary,
  similarity,
  snapshotLibrary,
  specificityViolation,
  updateCounters,
  type Lesson,
  type Library,
} from '../../server/experience/library';
import { estimateTokens, regionOfDestination, renderLessonsBlock, selectLessons } from '../../server/experience/retrieve';
import { parseFilterVerdicts, parseLessons, parseOperations, renderTrajectory, type RunRecord } from '../../server/experience/prompts';

const ctx = { epoch: 1, sourceCase: 'chengdu-01' };
const lesson = (over: Partial<Lesson>): Lesson => ({ id: 'L01', scope: 'general', lesson: 'x', helpful: 0, harmful: 0, created_epoch: 1, source_case: 'c', ...over });
const lib = (lessons: Lesson[]): Library => ({ ...emptyLibrary(), lessons, nextId: lessons.length + 1 });

describe('scope', () => {
  it('accepts region, tool, region/tool and general; rejects anything else', () => {
    expect(normalizeScope('International/Search_Places')).toBe('international/search_places');
    expect(normalizeScope('search_places/international')).toBe('international/search_places');
    expect(normalizeScope('domestic')).toBe('domestic');
    expect(normalizeScope('calculate_distance')).toBe('calculate_distance');
    expect(normalizeScope('general')).toBe('general');
    expect(normalizeScope('tokyo')).toBeNull();
    expect(normalizeScope('domestic/international')).toBeNull();
    expect(normalizeScope('a/b/c')).toBeNull();
  });
});

describe('specificity guard', () => {
  it('rejects coordinates, ids, addresses and quoted names', () => {
    expect(specificityViolation('Use lat 35.6762 for the centre')).toMatch(/coordinate/);
    expect(specificityViolation('Look up B0FFG3ABCD first')).toMatch(/id/);
    expect(specificityViolation('Meet at 12 Market Street first')).toMatch(/address/);
    expect(specificityViolation('Search 「宽窄巷子」 by its short name')).toMatch(/name/);
    expect(specificityViolation('Shorten compound POI queries to the core place name before searching')).toBeNull();
  });
});

describe('applyOps', () => {
  it('ADDs with sequential ids and normalized scope, without mutating the input', () => {
    const before = emptyLibrary();
    const { library, applied, rejected } = applyOps(before, [
      { op: 'ADD', scope: 'International/search_places', lesson: 'Shorten compound queries to the core place name' },
      { op: 'add', scope: 'domestic', lesson: 'Search restaurants near the day’s attractions' },
    ], ctx);
    expect(library.lessons.map(l => [l.id, l.scope])).toEqual([['L01', 'international/search_places'], ['L02', 'domestic']]);
    expect(library.lessons[0]).toMatchObject({ helpful: 0, harmful: 0, created_epoch: 1, source_case: 'chengdu-01' });
    expect(library.nextId).toBe(3);
    expect(applied).toHaveLength(2);
    expect(rejected).toHaveLength(0);
    expect(before.lessons).toHaveLength(0);
  });

  it('MODIFY / DELETE require an existing id; invalid scope or specific text is rejected', () => {
    const start = lib([lesson({ id: 'L01', lesson: 'old' }), lesson({ id: 'L02', lesson: 'gone' })]);
    const { library, rejected } = applyOps(start, [
      { op: 'MODIFY', id: 'L01', lesson: 'new text', scope: 'international' },
      { op: 'DELETE', id: 'L02' },
      { op: 'DELETE', id: 'L99' },
      { op: 'ADD', scope: 'paris', lesson: 'fine text' },
      { op: 'KEEP', id: 'L01' },
    ], { epoch: 2, sourceCase: 'x' });
    expect(library.lessons).toHaveLength(1);
    expect(library.lessons[0]).toMatchObject({ id: 'L01', lesson: 'new text', scope: 'international', updated_epoch: 2 });
    expect(rejected.map(r => r.reason)).toEqual(['unknown lesson id "L99"', 'invalid scope "paris"']);
    const specific = applyOps(start, [{ op: 'MODIFY', id: 'L01', lesson: 'Go to 「Louvre」 first' }], ctx);
    expect(specific.rejected.map(r => r.reason)).toEqual(['quotes a specific name']);
    expect(specific.library.lessons[0].lesson).toBe('old');
  });

  it('caps the number of edits per update so the library is never rewritten wholesale', () => {
    const ops = Array.from({ length: 6 }, (_, i) => ({ op: 'ADD', scope: 'general', lesson: `distinct lesson number ${'abcdef'[i]}` }));
    const { library, rejected } = applyOps(emptyLibrary(), ops, ctx);
    expect(library.lessons).toHaveLength(4);
    expect(rejected).toHaveLength(2);
  });
});

describe('counters', () => {
  it('credits used lessons helpful above the group mean and harmful below; ties are neutral', () => {
    const start = lib([lesson({ id: 'L01' }), lesson({ id: 'L02' })]);
    const up = updateCounters(start, ['L01'], 0.75, 0.7);
    expect(up.lessons.map(l => [l.helpful, l.harmful])).toEqual([[1, 0], [0, 0]]);
    const down = updateCounters(up, ['L01', 'L02'], 0.6, 0.7);
    expect(down.lessons.map(l => [l.helpful, l.harmful])).toEqual([[1, 1], [0, 1]]);
    expect(updateCounters(down, ['L01'], 0.705, 0.7)).toBe(down);
  });
});

describe('cap', () => {
  it('merges near-duplicates in the same scope first, summing counters', () => {
    expect(similarity('Shorten compound queries to the core name', 'Shorten compound queries to the core name.')).toBeGreaterThan(0.9);
    const lessons = [
      lesson({ id: 'L01', lesson: 'Shorten compound queries to the core place name', helpful: 3 }),
      lesson({ id: 'L02', lesson: 'Shorten compound queries to the core place name.', helpful: 1, harmful: 1 }),
      lesson({ id: 'L03', lesson: 'Call calculate_distance only between searched POIs' }),
    ];
    const out = enforceCap(lib(lessons), 2);
    expect(out.lessons.map(l => l.id)).toEqual(['L01', 'L03']);
    expect(out.lessons[0]).toMatchObject({ helpful: 4, harmful: 1 });
  });

  it('drops the lowest-rated lessons when nothing is similar enough to merge', () => {
    const lessons = [
      lesson({ id: 'L01', lesson: 'alpha strategy about searching', helpful: 2 }),
      lesson({ id: 'L02', lesson: 'beta idea on distances', harmful: 3 }),
      lesson({ id: 'L03', lesson: 'gamma rule for the final json', helpful: 1 }),
    ];
    expect(enforceCap(lib(lessons), 2).lessons.map(l => l.id)).toEqual(['L01', 'L03']);
  });
});

describe('load / save / snapshot', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-lib-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns an empty library when missing, bumps libraryVersion on save, writes snapshots', () => {
    const file = path.join(dir, 'library.json');
    expect(loadLibrary(file).lessons).toEqual([]);
    const saved = saveLibrary(file, applyOps(emptyLibrary(), [{ op: 'ADD', scope: 'general', lesson: 'a lesson' }], ctx).library);
    expect(saved.libraryVersion).toBe(1);
    expect(loadLibrary(file).lessons).toHaveLength(1);
    const snap = snapshotLibrary(file, saved, 'epoch-1');
    expect(path.basename(snap)).toBe('library.epoch-1.json');
    fs.writeFileSync(file, JSON.stringify({ ...saved, schemaVersion: 99 }));
    expect(() => loadLibrary(file)).toThrow(/schemaVersion/);
  });
});

describe('retrieve', () => {
  const l = (id: string, scope: string, helpful: number, harmful = 0) => lesson({ id, scope, helpful, harmful, lesson: `lesson ${id} about ${scope}` });

  it('filters by region, ranks by helpful − harmful, drops proven-harmful lessons', () => {
    const library = lib([
      l('L01', 'domestic', 5),
      l('L02', 'international/search_places', 2),
      l('L03', 'general', 3),
      l('L04', 'international', 0, 3),
      l('L05', 'search_places', 2),
    ]);
    expect(regionOfDestination('成都')).toBe('domestic');
    expect(regionOfDestination('Tokyo')).toBe('international');
    const picked = selectLessons(library, { region: 'international' }).map(x => x.id);
    // L02 and L05 tie on net 2; the more specific scope wins.
    expect(picked).toEqual(['L03', 'L02', 'L05']);
    expect(selectLessons(library, { region: 'domestic' }).map(x => x.id)).toEqual(['L01', 'L03', 'L05']);
  });

  it('respects the lesson count and token caps', () => {
    const many = lib(Array.from({ length: 20 }, (_, i) => l(`L${i + 10}`, 'general', 20 - i)));
    expect(selectLessons(many, { region: 'domestic' })).toHaveLength(12);
    const tight = selectLessons(many, { region: 'domestic', maxTokens: 60 });
    expect(estimateTokens(renderLessonsBlock(tight))).toBeLessThanOrEqual(60);
    expect(tight.length).toBeGreaterThan(0);
  });

  it('renders nothing for an empty selection', () => {
    expect(renderLessonsBlock([])).toBe('');
    expect(renderLessonsBlock([l('L01', 'general', 1)])).toContain('- [L01] (general)');
  });
});

describe('prompt parsing', () => {
  it('parses lessons and operations through fences and prose, capping lessons at 2', () => {
    expect(parseLessons('```json\n{"lessons":[{"scope":"general","lesson":"a"},{"scope":"x","lesson":"b"},{"lesson":"c"}]}\n```')).toHaveLength(2);
    expect(parseLessons('Here you go: {"lessons":[{"lesson":" a "}]} thanks')[0]).toMatchObject({ scope: 'general', lesson: 'a' });
    expect(parseLessons('not json')).toEqual([]);
    expect(parseOperations('{"operations":[{"op":"KEEP","id":"L01"}]}')).toHaveLength(1);
  });

  it('filter fails closed: missing or unparseable verdicts count as specific', () => {
    expect([...parseFilterVerdicts('{"verdicts":[{"index":0,"specific":false},{"index":1,"specific":true}]}', 3)]).toEqual([1, 2]);
    expect([...parseFilterVerdicts('garbage', 2)]).toEqual([0, 1]);
  });

  it('renders a trajectory with scores, tool errors and ungrounded places', () => {
    const run: RunRecord = {
      run: 1, reward: 0.5, toolCorrect: 0.8, constraint: 1, hallucinationRate: 0.2, judge: 4, steps: 5, usedLessonIds: [],
      trace: [{ step: 0, name: 'search_places', args: { keywords: 'temple' }, ok: false, resultSummary: 'error: timeout' }],
      unverifiedPlaces: ['Some Place'], issues: ['1 call(s) referenced a POI id never returned by search_places'],
    };
    const text = renderTrajectory(run);
    expect(text).toContain('reward=0.500');
    expect(text).toContain('search_places({"keywords":"temple"}) -> ERROR');
    expect(text).toContain('NOT found in any search result (1): Some Place');
  });
});
