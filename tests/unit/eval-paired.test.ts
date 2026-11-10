import { describe, it, expect } from 'vitest';
import { pairedComparison, tCritical95, significant, fmtPaired } from '../eval/paired';
import { caseHash } from '../eval/cases';
import type { RunMetrics } from '../eval/aggregate';

const run = (caseId: string, repeat: number, reward: number, extra: Partial<RunMetrics> = {}): RunMetrics => ({
  caseId, region: 'international', repeat, failed: false, degraded: false, toolCorrect: 1, constraint: 1, hallucinationRate: 0.1, judge: 4,
  reward, rewardIncludesJudge: true, steps: 6, promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, judgePromptTokens: 0,
  judgeCompletionTokens: 0, geoapifyRequests: 0, durationMs: 0, ...extra,
});

describe('tCritical95', () => {
  it('matches the t table and approaches 1.96', () => {
    expect(tCritical95(1)).toBeCloseTo(12.706, 3);
    expect(tCritical95(29)).toBeCloseTo(2.045, 3);
    expect(tCritical95(40)).toBeCloseTo(2.021, 2);
    expect(tCritical95(1000)).toBeCloseTo(1.962, 2);
  });
});

describe('pairedComparison', () => {
  it('averages repeats per case, then takes per-case B − A with a t-interval over cases', () => {
    const a = [run('c1', 1, 0.5), run('c1', 2, 0.7), run('c2', 1, 0.4), run('c3', 1, 0.6)];
    const b = [run('c1', 1, 0.7), run('c2', 1, 0.5), run('c2', 2, 0.5), run('c3', 1, 0.9)];
    const p = pairedComparison(a, b, 'reward');
    expect(p.n).toBe(3);
    expect(p.cases.map(c => +c.diff.toFixed(3))).toEqual([0.1, 0.1, 0.3]);
    expect(p.meanDiff).toBeCloseTo(0.5 / 3, 6);
    const sd = Math.sqrt(((0.1 - 0.5 / 3) ** 2 * 2 + (0.3 - 0.5 / 3) ** 2) / 2);
    expect(p.sdDiff).toBeCloseTo(sd, 6);
    expect(p.ci95[0]).toBeCloseTo(0.5 / 3 - 4.303 * sd / Math.sqrt(3), 4);
    expect(p.better).toBe(3);
  });

  it('only pairs cases present in both setups and reports the rest', () => {
    const p = pairedComparison([run('c1', 1, 0.5), run('only-a', 1, 0.1)], [run('c1', 1, 0.6), run('only-b', 1, 0.9)], 'reward');
    expect(p.n).toBe(1);
    expect(p.unpaired).toEqual(['only-a', 'only-b']);
    expect(fmtPaired(p)).toContain('no CI');
  });

  it('is direction-aware for lower-is-better metrics and flags significance', () => {
    const a = ['c1', 'c2', 'c3', 'c4'].map(id => run(id, 1, 0, { hallucinationRate: 0.3 }));
    const b = ['c1', 'c2', 'c3', 'c4'].map((id, i) => run(id, 1, 0, { hallucinationRate: 0.1 + i * 0.01 }));
    const p = pairedComparison(a, b, 'hallucinationRate');
    expect(p.meanDiff).toBeLessThan(0);
    expect(p.better).toBe(4);
    expect(significant(p)).toBe(true);
    expect(fmtPaired(p, { percent: true })).toMatch(/^-\d+\.\dpp \[95% CI .*\] \*/);
  });

  it('a pure noise difference is not significant', () => {
    const a = ['c1', 'c2', 'c3', 'c4'].map(id => run(id, 1, 0.6));
    const b = [0.7, 0.5, 0.65, 0.55].map((r, i) => run(`c${i + 1}`, 1, r));
    expect(significant(pairedComparison(a, b, 'reward'))).toBe(false);
  });
});

describe('caseHash', () => {
  it('ignores key order and changes when content changes', () => {
    const c = { id: 'x', destination: 'Paris', days: 3, people: 2, preferences: ['food'], groupType: 'couple', budget: { min: 1, max: 2 } } as any;
    const reordered = { budget: { max: 2, min: 1 }, preferences: ['food'], groupType: 'couple', people: 2, days: 3, destination: 'Paris', id: 'x' } as any;
    expect(caseHash(c)).toBe(caseHash(reordered));
    expect(caseHash(c)).not.toBe(caseHash({ ...c, days: 4 }));
  });
});
