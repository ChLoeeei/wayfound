/**
 * Aggregation for repeated eval runs: per-repeat averages over cases, then
 * mean ± spread across repeats (v2 plan: "report each number as mean ±
 * spread over the 3 runs"). Pure functions so they can be unit tested
 * without calling the live agent.
 */

export interface RunMetrics {
  caseId: string;
  region: 'domestic' | 'international';
  repeat: number;
  failed: boolean;
  /** Provider-side trouble (search errors / mostly-empty searches) even after reruns. */
  degraded: boolean;
  toolCorrect: number;
  constraint: number;
  hallucinationRate: number;
  judge: number | null;
  reward: number;
  rewardIncludesJudge: boolean;
  steps: number;
  /** Agent + judge combined. */
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  judgePromptTokens: number;
  judgeCompletionTokens: number;
  durationMs: number;
}

export interface Spread {
  mean: number;
  /** Sample standard deviation across repeats (0 for a single repeat). */
  std: number;
  min: number;
  max: number;
  n: number;
}

export function spread(values: number[]): Spread | null {
  const xs = values.filter(v => Number.isFinite(v));
  if (xs.length === 0) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.length > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) : 0;
  return { mean, std: Math.sqrt(variance), min: Math.min(...xs), max: Math.max(...xs), n: xs.length };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export const METRIC_KEYS = [
  'hallucinationRate',
  'toolCorrect',
  'constraint',
  'judge',
  'reward',
  'steps',
  'promptTokens',
  'cachedPromptTokens',
  'completionTokens',
  'judgePromptTokens',
  'judgeCompletionTokens',
  'durationMs',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** One repeat's case-average for each metric. Failed runs count as failures, not skipped (see failedRunMetrics). */
export function repeatAverages(runs: RunMetrics[]): Record<MetricKey, number> {
  const out = {} as Record<MetricKey, number>;
  for (const k of METRIC_KEYS) {
    const vals = runs.map(r => r[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    out[k] = avg(vals);
  }
  return out;
}

export interface GroupSummary {
  runCount: number;
  failedRuns: number;
  degradedRuns: number;
  /** False if any run's reward left out the judge term; then `reward` is the no-judge variant. */
  rewardIncludesJudge: boolean;
  metrics: Record<MetricKey, Spread | null>;
}

export function summarizeGroup(runs: RunMetrics[]): GroupSummary {
  const repeats = [...new Set(runs.map(r => r.repeat))].sort((a, b) => a - b);
  const perRepeat = repeats.map(rep => repeatAverages(runs.filter(r => r.repeat === rep)));
  const metrics = {} as Record<MetricKey, Spread | null>;
  for (const k of METRIC_KEYS) metrics[k] = spread(perRepeat.map(p => p[k]));
  return {
    runCount: runs.length,
    failedRuns: runs.filter(r => r.failed).length,
    degradedRuns: runs.filter(r => r.degraded).length,
    rewardIncludesJudge: runs.length > 0 && runs.every(r => r.rewardIncludesJudge),
    metrics,
  };
}

export function summarizeRuns(runs: RunMetrics[]) {
  return {
    overall: summarizeGroup(runs),
    domestic: summarizeGroup(runs.filter(r => r.region === 'domestic')),
    international: summarizeGroup(runs.filter(r => r.region === 'international')),
  };
}

/** "12.3% ± 1.1" style formatting for reports. */
export function fmtSpread(s: Spread | null, opts: { percent?: boolean; digits?: number } = {}): string {
  if (!s) return '—';
  const scale = opts.percent ? 100 : 1;
  const d = opts.digits ?? (opts.percent ? 1 : 2);
  const body = `${(s.mean * scale).toFixed(d)}${opts.percent ? '%' : ''}`;
  return s.n > 1 ? `${body} ± ${(s.std * scale).toFixed(d)}` : body;
}
