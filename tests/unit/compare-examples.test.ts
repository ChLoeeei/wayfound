/**
 * The compare page's data file is generated from committed eval results.
 * These tests make sure it stays that way: the held-out tiles must equal a
 * fresh paired comparison of the two result files it names, and every
 * example run must be a run those files report.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import committed from '../../src/data/compare-examples.json';
import { heldOutSummary, medianRun, type ResultsFile } from '../eval/build-compare-examples';
import { allCases, isHardCase } from '../eval/cases';
import type { RunMetrics } from '../eval/aggregate';

const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')) as ResultsFile;

describe('src/data/compare-examples.json', () => {
  const baseline = read(committed.baseline.file);
  const library = read(committed.library.file);

  it('names two committed result files of the expected setups', () => {
    expect(baseline.meta.setup).toBe(committed.baseline.setup);
    expect(library.meta.setup).toBe(committed.library.setup);
    expect(baseline.meta.stamp).toBe(committed.baseline.stamp);
    expect(library.meta.stamp).toBe(committed.library.stamp);
    expect(baseline.meta.split).toBe('test');
    expect(library.meta.split).toBe('test');
  });

  it('held-out tiles equal a fresh paired comparison of those files', () => {
    expect(heldOutSummary(baseline, library)).toEqual(committed.heldOut);
  });

  it('every example side is the median-reward run of that case in its result file', () => {
    for (const e of committed.examples) {
      const c = allCases.find(x => x.id === e.caseId)!;
      expect(c, e.caseId).toBeDefined();
      expect(e.region).toBe(c.region);
      expect(e.hard).toBe(isHardCase(c));
      expect(e.request.destination).toBe(c.destination);
      for (const [side, file] of [
        [e.off, baseline],
        [e.on, library],
      ] as const) {
        const runs = file.runs.filter(r => r.caseId === e.caseId && !r.failed);
        const m = medianRun(runs);
        expect(side.repeat).toBe(m.repeat);
        expect(side.reward).toBe(m.reward);
        expect(side.hallucinationRate).toBe(m.hallucinationRate);
        expect(side.toolCorrect).toBe(m.toolCorrect);
        expect(side.steps).toBe(m.steps);
        const places = side.itinerary.days.flatMap(d => d.slots.flatMap(s => s.places));
        expect(places.length).toBeGreaterThan(0);
        // The marks come from the same run: their share is that run's hallucination rate.
        expect(side.ungroundedPlaceNames.length / places.length).toBeCloseTo(m.hallucinationRate, 6);
      }
      expect(e.off.usedLessonIds).toEqual([]);
      expect(e.on.usedLessonIds.length).toBeGreaterThan(0);
    }
  });

  it('includes at least one example the library made worse', () => {
    expect(committed.examples.some(e => e.on.reward < e.off.reward)).toBe(true);
  });
});

describe('medianRun', () => {
  const run = (repeat: number, reward: number) => ({ repeat, reward, caseId: 'x', region: 'domestic' }) as RunMetrics;
  it('takes the middle run by reward, not the best', () => {
    expect(medianRun([run(1, 0.9), run(2, 0.1), run(3, 0.5)]).repeat).toBe(3);
    expect(medianRun([run(1, 0.5), run(2, 0.5), run(3, 0.9)]).repeat).toBe(2);
    expect(medianRun([run(1, 0.7)]).repeat).toBe(1);
  });
});
