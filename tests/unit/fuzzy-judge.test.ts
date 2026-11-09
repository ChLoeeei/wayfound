import { describe, it, expect } from 'vitest';
import {
  WEIGHTS,
  PASS_THRESHOLD,
  RUBRIC_DIMENSIONS,
  weightedTotal,
  type DimScore,
  type RubricDim,
} from '../../tests/fuzzy/judge';

const allFives = (): Record<RubricDim, DimScore> => {
  const o = {} as Record<RubricDim, DimScore>;
  for (const d of RUBRIC_DIMENSIONS) o[d] = { score: 5, reason: '' };
  return o;
};

const allOnes = (): Record<RubricDim, DimScore> => {
  const o = {} as Record<RubricDim, DimScore>;
  for (const d of RUBRIC_DIMENSIONS) o[d] = { score: 1, reason: '' };
  return o;
};

describe('weightedTotal — PRD §7.3 rubric math', () => {
  it('all 5s totals 5.0', () => {
    expect(weightedTotal(allFives())).toBe(5);
  });

  it('all 1s totals 1.0', () => {
    expect(weightedTotal(allOnes())).toBe(1);
  });

  it('all 3s totals 3.0 (below pass threshold 3.5)', () => {
    const scores = {} as Record<RubricDim, DimScore>;
    for (const d of RUBRIC_DIMENSIONS) scores[d] = { score: 3, reason: '' };
    expect(weightedTotal(scores)).toBe(3);
    expect(weightedTotal(scores)).toBeLessThan(PASS_THRESHOLD);
  });

  it('respects per-dimension weights', () => {
    // route_logic weighted 0.20; bumping it from 3 → 5 with everything else 3 gives delta 0.40
    const base = {} as Record<RubricDim, DimScore>;
    for (const d of RUBRIC_DIMENSIONS) base[d] = { score: 3, reason: '' };
    const bumped = { ...base, route_logic: { score: 5, reason: '' } };
    expect(weightedTotal(bumped) - weightedTotal(base)).toBeCloseTo(0.4, 2);
  });

  it('weights sum to 1.0', () => {
    const sum = RUBRIC_DIMENSIONS.reduce((acc, d) => acc + WEIGHTS[d], 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('parseJudgeOutput', () => {
  const dims = ['route_logic', 'time_allocation', 'meal_coverage', 'physical_intensity', 'budget_match', 'preference_match', 'weather_adaptation'];
  it('parses valid JSON as-is', async () => {
    const { parseJudgeOutput } = await import('../fuzzy/judge');
    const ok = { scores: Object.fromEntries(dims.map(d => [d, { score: 4, reason: 'ok' }])) };
    expect(parseJudgeOutput(JSON.stringify(ok))?.scores.route_logic.reason).toBe('ok');
  });

  it('salvages scores when a reason contains unescaped double quotes', async () => {
    const { parseJudgeOutput } = await import('../fuzzy/judge');
    const broken = `{"scores":{${dims.map((d, i) => `"${d}":{"score":${i % 5},"reason":"去"浅草寺"很合理"}`).join(',')}}}`;
    expect(() => JSON.parse(broken)).toThrow();
    const parsed = parseJudgeOutput(broken)!;
    expect(dims.map(d => Number(parsed.scores[d].score))).toEqual([0, 1, 2, 3, 4, 0, 1]);
  });

  it('returns null when a dimension is missing entirely', async () => {
    const { parseJudgeOutput } = await import('../fuzzy/judge');
    expect(parseJudgeOutput('{"scores":{"route_logic":{"score":3}}}')).toBeNull();
  });
});
