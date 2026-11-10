import { createHash } from 'crypto';
import casesJson from './cases.json';
import type { EvalCase } from './scoring';

export type SplitName = 'train' | 'test' | 'all';

/**
 * A case plus its eval-only bookkeeping. `tags` (e.g. "hard", "multi-city")
 * and `addedIn` (case-set version) never reach the agent or the judge.
 */
export type TaggedCase = EvalCase & { tags?: string[]; addedIn?: number };

export const allCases: TaggedCase[] = (casesJson as unknown as { cases: TaggedCase[] }).cases;

/** Hard cases were added in v3 to give the learning loop headroom; reports show results with and without them. */
export const isHardCase = (c: Pick<TaggedCase, 'tags'>) => !!c.tags?.includes('hard');

/** Order-stable hash of one case's content. Stored per checkpointed run, so editing a case invalidates only its runs. */
export function caseHash(c: TaggedCase): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sorted((v as any)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(sorted(c))).digest('hex').slice(0, 16);
}
export const caseSetVersion: number = (casesJson as { version: number }).version;

/**
 * Pick the cases for one eval run. `filterIds` (EVAL_FILTER) wins over
 * `split` when given, so a single case can still be debugged regardless of
 * which side it is on; the report records which ids actually ran.
 */
export function selectCases<T extends EvalCase>(cases: T[], opts: { split: SplitName; filterIds?: string[] }): T[] {
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
