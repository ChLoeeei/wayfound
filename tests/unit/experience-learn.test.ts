import { describe, it, expect } from 'vitest';
import { bestAndWorst, isDegenerateGroup, lessonSubsets, seededRandom, seededShuffle, toRunRecord } from '../eval/learn-core';
import { generateItinerary, type AgentStepRecord } from '../../server/agent';
import { lessonsForDestination } from '../../server/experience/retrieve';
import { emptyLibrary } from '../../server/experience/library';

describe('learn-core', () => {
  it('seeded randomness is reproducible and seed-dependent', () => {
    const a = seededRandom('x');
    const b = seededRandom('x');
    const seq = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seq);
    expect(seededRandom('y')()).not.toBe(seq[0]);
    expect(seq.every(v => v >= 0 && v < 1)).toBe(true);
  });

  it('gives rollouts different, reproducible lesson subsets', () => {
    const lessons = Array.from({ length: 10 }, (_, i) => ({ id: `L${i}` }));
    const s1 = lessonSubsets(lessons, 4, '1:case');
    expect(lessonSubsets(lessons, 4, '1:case')).toEqual(s1);
    expect(new Set(s1.map(s => s.join(','))).size).toBeGreaterThan(1);
    expect(lessonSubsets([], 4, 's')).toEqual([[], [], [], []]);
  });

  it('shuffles deterministically without losing items', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(items, 'e1')).toEqual(seededShuffle(items, 'e1'));
    expect([...seededShuffle(items, 'e1')].sort()).toEqual(items);
  });

  it('detects groups with no comparison signal and picks best / worst', () => {
    expect(isDegenerateGroup([0.7, 0.7, 0.7, 0.7])).toBe(true);
    expect(isDegenerateGroup([0.7])).toBe(true);
    expect(isDegenerateGroup([0.7, 0.71])).toBe(false);
    const { best, worst } = bestAndWorst([{ reward: 0.5, id: 1 }, { reward: 0.8, id: 2 }, { reward: -0.5, id: 3 }]);
    expect([best.id, worst.id]).toEqual([2, 3]);
  });

  it('records a failed rollout as the worst case', () => {
    const r = toRunRecord({ run: 2, trace: [], steps: 3, usedLessonIds: ['L1'], error: 'Unterminated string' });
    expect(r).toMatchObject({ reward: -0.5, hallucinationRate: 1, failed: 'Unterminated string', usedLessonIds: ['L1'] });
  });
});

function fakeClient(reply: string) {
  const requests: any[] = [];
  return {
    requests,
    client: { chat: { completions: { create: async (body: any) => { requests.push(JSON.parse(JSON.stringify(body))); return { choices: [{ message: { role: 'assistant', content: reply } }], usage: {} }; } } } } as any,
  };
}
const short = JSON.stringify({ title: 'T', days: [{ dayNumber: 1, theme: '', slots: [] }] });
const req = { destination: 'Tokyo', days: 1, people: 1, preferences: ['food'] };

describe('lesson injection into the agent', () => {
  it('leaves the system prompt byte-identical without lessons (or with an empty block)', async () => {
    const a = fakeClient(short);
    const b = fakeClient(short);
    await generateItinerary(req, { client: a.client });
    await generateItinerary(req, { client: b.client, lessons: { block: '', ids: [] } });
    expect(b.requests[0].messages[0].content).toBe(a.requests[0].messages[0].content);
    expect(a.requests[0].messages[0].content).not.toContain('Lessons from past runs');
  });

  it('appends the rendered block and records the injected ids as a non-step trace entry', async () => {
    const lib = { ...emptyLibrary(), lessons: [
      { id: 'L01', scope: 'international/search_places', lesson: 'Shorten compound queries to the core place name', helpful: 2, harmful: 0, created_epoch: 1, source_case: 'x' },
      { id: 'L02', scope: 'domestic', lesson: 'Domestic only', helpful: 9, harmful: 0, created_epoch: 1, source_case: 'y' },
    ] };
    const lessons = lessonsForDestination(lib, 'Tokyo');
    expect(lessons.ids).toEqual(['L01']);
    const { client, requests } = fakeClient(short);
    const stepTrace: AgentStepRecord[] = [];
    await generateItinerary(req, { client, stepTrace, lessons });
    const system = requests[0].messages[0].content as string;
    expect(system.endsWith(`\n\n${lessons.block}`)).toBe(true);
    expect(system).toContain('- [L01] (international/search_places)');
    expect(system).not.toContain('Domestic only');
    expect(stepTrace[0]).toMatchObject({ step: -1, segment: 'lessons' });
    expect(stepTrace[0].reasoning).toContain('L01');
    expect(stepTrace.filter(s => !s.segment)).toHaveLength(1);
  });
});
