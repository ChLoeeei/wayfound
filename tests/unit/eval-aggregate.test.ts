import { describe, it, expect } from 'vitest';
import { computeReward, REWARD_WEIGHTS } from '../eval/scoring';
import { spread, summarizeGroup, summarizeRuns, fmtSpread, type RunMetrics } from '../eval/aggregate';

describe('computeReward', () => {
  it('uses the frozen weights from the v2 plan', () => {
    expect(REWARD_WEIGHTS).toEqual({ toolCorrect: 0.3, constraint: 0.3, judge: 0.2, hallucination: 0.5 });
  });

  it('spans [-0.5, 0.8]', () => {
    expect(computeReward({ toolCorrect: 1, constraint: 1, judgeOutOf5: 5, hallucinationRate: 0 }).value).toBeCloseTo(0.8);
    expect(computeReward({ toolCorrect: 0, constraint: 0, judgeOutOf5: 0, hallucinationRate: 1 }).value).toBeCloseTo(-0.5);
  });

  it('normalizes the judge from 0-5 and penalizes hallucination', () => {
    const r = computeReward({ toolCorrect: 0.9, constraint: 0.8, judgeOutOf5: 4, hallucinationRate: 0.2 });
    expect(r.value).toBeCloseTo(0.3 * 0.9 + 0.3 * 0.8 + 0.2 * 0.8 - 0.5 * 0.2);
    expect(r.includesJudge).toBe(true);
  });

  it('leaves the judge term out (not imputed) when the judge was skipped, and says so', () => {
    const r = computeReward({ toolCorrect: 1, constraint: 1, judgeOutOf5: null, hallucinationRate: 0 });
    expect(r.value).toBeCloseTo(0.6);
    expect(r.includesJudge).toBe(false);
  });
});

function run(o: Partial<RunMetrics>): RunMetrics {
  return {
    caseId: 'c', region: 'domestic', repeat: 1, failed: false, degraded: false,
    toolCorrect: 1, constraint: 1, hallucinationRate: 0, judge: 4, reward: 0.76, rewardIncludesJudge: true,
    steps: 5, promptTokens: 1000, cachedPromptTokens: 0, completionTokens: 500, judgePromptTokens: 0, judgeCompletionTokens: 0, durationMs: 1000, ...o,
  };
}

describe('aggregate', () => {
  it('computes mean and sample std', () => {
    const s = spread([0.1, 0.2, 0.3])!;
    expect(s.mean).toBeCloseTo(0.2);
    expect(s.std).toBeCloseTo(0.1);
    expect(spread([0.5])!.std).toBe(0);
    expect(spread([])).toBeNull();
  });

  it('averages over cases within a repeat first, then spreads across repeats', () => {
    // Repeat 1: halluc avg 0.1; repeat 2: halluc avg 0.3.
    const g = summarizeGroup([
      run({ caseId: 'a', repeat: 1, hallucinationRate: 0.0 }),
      run({ caseId: 'b', repeat: 1, hallucinationRate: 0.2 }),
      run({ caseId: 'a', repeat: 2, hallucinationRate: 0.2 }),
      run({ caseId: 'b', repeat: 2, hallucinationRate: 0.4 }),
    ]);
    expect(g.metrics.hallucinationRate!.mean).toBeCloseTo(0.2);
    expect(g.metrics.hallucinationRate!.n).toBe(2);
    expect(g.metrics.hallucinationRate!.std).toBeCloseTo(Math.SQRT2 * 0.1);
  });

  it('ignores null judge scores rather than counting them as 0', () => {
    const g = summarizeGroup([run({ judge: 4 }), run({ caseId: 'b', judge: null, rewardIncludesJudge: false })]);
    expect(g.metrics.judge!.mean).toBe(4);
    expect(g.rewardIncludesJudge).toBe(false);
  });

  it('splits by region and counts failed / degraded runs', () => {
    const s = summarizeRuns([
      run({ region: 'domestic' }),
      run({ caseId: 'x', region: 'international', failed: true, hallucinationRate: 1, reward: -0.5 }),
      run({ caseId: 'y', region: 'international', degraded: true }),
    ]);
    expect(s.overall.runCount).toBe(3);
    expect(s.domestic.runCount).toBe(1);
    expect(s.international.failedRuns).toBe(1);
    expect(s.international.degradedRuns).toBe(1);
    expect(s.international.metrics.hallucinationRate!.mean).toBeCloseTo(0.5);
  });

  it('formats mean ± std, omitting the spread for a single repeat', () => {
    expect(fmtSpread({ mean: 0.123, std: 0.011, min: 0, max: 0, n: 3 }, { percent: true })).toBe('12.3% ± 1.1');
    expect(fmtSpread({ mean: 0.123, std: 0, min: 0, max: 0, n: 1 }, { percent: true })).toBe('12.3%');
    expect(fmtSpread(null)).toBe('—');
  });
});
