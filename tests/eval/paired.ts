/**
 * Paired comparison of two eval setups (e.g. baseline vs Core 1 library).
 *
 * Unit of analysis = one test case. For each case present in BOTH setups,
 * take its mean over that setup's repeats, then the difference B − A. The
 * mean of those per-case differences, with a 95% t-interval over cases, is
 * the headline. Pairing removes the case-to-case difficulty spread (a hard
 * case is hard under both setups), which is far larger than the setup
 * effect, so it is much more sensitive than comparing two pooled means.
 *
 * Failed runs are included with their worst-case metrics (same as the
 * aggregate), so a setup that fails more is penalized, not flattered.
 */
import type { MetricKey, RunMetrics } from './aggregate';

/** Two-sided 95% Student-t critical values, df 1..30. */
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08,
  2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function tCritical95(df: number): number {
  if (df < 1) return NaN;
  if (df <= 30) return T975[df - 1];
  // Cornish-Fisher style expansion around z = 1.96; within 0.001 of exact for df > 30.
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
}

export interface PairedCase {
  caseId: string;
  region: RunMetrics['region'];
  a: number;
  b: number;
  diff: number;
  nA: number;
  nB: number;
}

export interface PairedResult {
  metric: MetricKey;
  /** Cases present in both setups. */
  n: number;
  meanA: number;
  meanB: number;
  /** Mean of per-case (B − A). */
  meanDiff: number;
  /** Sample std of the per-case differences. */
  sdDiff: number;
  ci95: [number, number];
  /** B better / worse / tied, by case (direction aware: lower is better for hallucination). */
  better: number;
  worse: number;
  tied: number;
  cases: PairedCase[];
  /** Case ids only in one setup, left out of the comparison. */
  unpaired: string[];
}

/** Metrics where a lower value is better. */
export const LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set(['hallucinationRate', 'steps', 'promptTokens', 'completionTokens', 'geoapifyRequests', 'durationMs', 'cachedPromptTokens', 'judgePromptTokens', 'judgeCompletionTokens']);

function caseMeans(runs: RunMetrics[], metric: MetricKey) {
  const by = new Map<string, { region: RunMetrics['region']; vals: number[] }>();
  for (const r of runs) {
    const v = r[metric];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const e = by.get(r.caseId) ?? { region: r.region, vals: [] };
    e.vals.push(v);
    by.set(r.caseId, e);
  }
  return by;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function pairedComparison(a: RunMetrics[], b: RunMetrics[], metric: MetricKey, tieEpsilon = 1e-9): PairedResult {
  const ma = caseMeans(a, metric);
  const mb = caseMeans(b, metric);
  const ids = [...ma.keys()].filter(id => mb.has(id)).sort();
  const unpaired = [...new Set([...ma.keys(), ...mb.keys()])].filter(id => !(ma.has(id) && mb.has(id))).sort();
  const cases: PairedCase[] = ids.map(id => {
    const ea = ma.get(id)!;
    const eb = mb.get(id)!;
    const av = mean(ea.vals);
    const bv = mean(eb.vals);
    return { caseId: id, region: ea.region, a: av, b: bv, diff: bv - av, nA: ea.vals.length, nB: eb.vals.length };
  });
  const n = cases.length;
  const diffs = cases.map(c => c.diff);
  const meanDiff = n ? mean(diffs) : NaN;
  const sdDiff = n > 1 ? Math.sqrt(diffs.reduce((s, d) => s + (d - meanDiff) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? tCritical95(n - 1) * (sdDiff / Math.sqrt(n)) : NaN;
  const sign = LOWER_IS_BETTER.has(metric) ? -1 : 1;
  return {
    metric,
    n,
    meanA: n ? mean(cases.map(c => c.a)) : NaN,
    meanB: n ? mean(cases.map(c => c.b)) : NaN,
    meanDiff,
    sdDiff,
    ci95: [meanDiff - half, meanDiff + half],
    better: cases.filter(c => sign * c.diff > tieEpsilon).length,
    worse: cases.filter(c => sign * c.diff < -tieEpsilon).length,
    tied: cases.filter(c => Math.abs(c.diff) <= tieEpsilon).length,
    cases,
    unpaired,
  };
}

/** True when the 95% CI excludes 0. */
export const significant = (p: PairedResult) => Number.isFinite(p.ci95[0]) && (p.ci95[0] > 0 || p.ci95[1] < 0);

export function fmtPaired(p: PairedResult, opts: { percent?: boolean; digits?: number } = {}): string {
  const s = opts.percent ? 100 : 1;
  const d = opts.digits ?? (opts.percent ? 1 : 3);
  const f = (x: number) => `${x >= 0 ? '+' : ''}${(x * s).toFixed(d)}${opts.percent ? 'pp' : ''}`;
  if (p.n < 2) return `${f(p.meanDiff)} (n=${p.n}, no CI)`;
  return `${f(p.meanDiff)} [95% CI ${f(p.ci95[0])}, ${f(p.ci95[1])}]${significant(p) ? ' *' : ''}  (n=${p.n}; B better in ${p.better}, worse in ${p.worse}, tied ${p.tied})`;
}
