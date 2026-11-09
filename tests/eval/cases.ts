import casesJson from './cases.json';
import type { EvalCase } from './scoring';

export type SplitName = 'train' | 'test' | 'all';

export const allCases: EvalCase[] = (casesJson as { cases: EvalCase[] }).cases;
export const caseSetVersion: number = (casesJson as { version: number }).version;

/**
 * Pick the cases for one eval run. `filterIds` (EVAL_FILTER) wins over
 * `split` when given, so a single case can still be debugged regardless of
 * which side it is on; the report records which ids actually ran.
 */
export function selectCases(cases: EvalCase[], opts: { split: SplitName; filterIds?: string[] }): EvalCase[] {
  const ids = (opts.filterIds ?? []).filter(Boolean);
  if (ids.length > 0) return cases.filter(c => ids.includes(c.id));
  if (opts.split === 'all') return cases;
  return cases.filter(c => c.split === opts.split);
}

export function parseSplit(raw: string | undefined): SplitName {
  const v = (raw ?? 'test').trim().toLowerCase();
  if (v === 'train' || v === 'test' || v === 'all') return v;
  throw new Error(`EVAL_SPLIT must be train, test or all (got ${JSON.stringify(raw)})`);
}
