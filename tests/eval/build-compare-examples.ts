/**
 * Builds the compare page's data file (src/data/compare-examples.json) from
 * committed eval results, so the page shows real runs without calling the
 * API and nothing on it is typed in by hand.
 *
 *   npm run eval:compare-examples -- \
 *     --baseline tests/eval/results/baseline-v2-test-<stamp>.json \
 *     --library  tests/eval/results/group-lessons-test-<stamp>.json \
 *     [--cases id1,id2,...] [--out src/data/compare-examples.json]
 *
 * For every chosen case it takes the median-reward repeat of each setup
 * (not the best one) and reads that run's saved itinerary from the local
 * eval checkpoint (tests/eval/reports/checkpoints/, gitignored). The run is
 * matched by case, repeat and reward, so the itinerary shown is the run the
 * result file reports. The held-out summary at the bottom of the page is
 * `heldOutSummary` over the two result files; tests/unit/compare-examples.test.ts
 * recomputes it from those files and fails if the committed JSON drifts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { allCases, isHardCase, type TaggedCase } from './cases';
import type { MetricKey, RunMetrics } from './aggregate';
import { pairedComparison } from './paired';

export const DEFAULT_EXAMPLE_CASES = [
  'luangprabang-solo-vegetarian-tight',
  'tokyo-family-food-culture',
  'hefei-couple-leisure-food',
  'faroe-family-accessibility-adventure',
];
export const DEFAULT_OUT = 'src/data/compare-examples.json';
const CHECKPOINTS_DIR = 'tests/eval/reports/checkpoints';

export interface ResultsFile {
  meta: { setup: string; split: string; stamp: string; repeats: number; gitCommit?: string; rewardVersion?: number; caseIds?: string[] };
  runs: RunMetrics[];
}

export interface ExamplePlace {
  id: string;
  name: string;
  type: string;
  estimatedCost: number;
  duration: number;
}
export interface ExampleItinerary {
  title: string;
  summary?: string;
  days: Array<{ dayNumber: number; theme?: string; slots: Array<{ period: string; places: ExamplePlace[] }> }>;
}
export interface ExampleSide {
  setup: string;
  repeat: number;
  reward: number;
  toolCorrect: number;
  constraint: number;
  hallucinationRate: number;
  judge: number | null;
  steps: number;
  invalidPoiRefs: number;
  usedLessonIds: string[];
  ungroundedPlaceNames: string[];
  itinerary: ExampleItinerary;
}
export interface CompareExample {
  caseId: string;
  region: 'domestic' | 'international';
  hard: boolean;
  request: Pick<TaggedCase, 'destination' | 'days' | 'people' | 'preferences' | 'groupType' | 'budget' | 'specialNeeds'>;
  off: ExampleSide;
  on: ExampleSide;
}
export interface HeldOutTile {
  key: 'toolCorrectInternational' | 'hallucinationDomestic' | 'rewardCore' | 'rewardAll' | 'promptTokens';
  metric: MetricKey;
  subset: 'core' | 'all';
  region?: 'domestic' | 'international';
  n: number;
  meanA: number;
  meanB: number;
  meanDiff: number;
  ci95: [number, number];
  better: number;
  worse: number;
  tied: number;
}
export interface CompareExamplesFile {
  generatedAt: string;
  baseline: { file: string; setup: string; stamp: string; commit?: string; repeats: number };
  library: { file: string; setup: string; stamp: string; commit?: string; repeats: number };
  heldOut: { cases: number; coreCases: number; repeats: number; tiles: HeldOutTile[] };
  examples: CompareExample[];
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** The bottom-of-page tiles: paired B − A over the two result files. */
export function heldOutSummary(baseline: ResultsFile, library: ResultsFile): CompareExamplesFile['heldOut'] {
  const hardIds = new Set(allCases.filter(isHardCase).map(c => c.id));
  const pick = (runs: RunMetrics[], subset: 'core' | 'all', region?: RunMetrics['region']) =>
    runs.filter(r => (subset === 'all' || !hardIds.has(r.caseId)) && (!region || r.region === region));
  const specs: Array<[HeldOutTile['key'], MetricKey, 'core' | 'all', RunMetrics['region'] | undefined]> = [
    ['toolCorrectInternational', 'toolCorrect', 'core', 'international'],
    ['hallucinationDomestic', 'hallucinationRate', 'core', 'domestic'],
    ['rewardCore', 'reward', 'core', undefined],
    ['rewardAll', 'reward', 'all', undefined],
    ['promptTokens', 'promptTokens', 'core', undefined],
  ];
  const tiles: HeldOutTile[] = specs.map(([key, metric, subset, region]) => {
    const p = pairedComparison(pick(baseline.runs, subset, region), pick(library.runs, subset, region), metric);
    return {
      key,
      metric,
      subset,
      ...(region ? { region } : {}),
      n: p.n,
      meanA: round(p.meanA, 6),
      meanB: round(p.meanB, 6),
      meanDiff: round(p.meanDiff, 6),
      ci95: [round(p.ci95[0], 6), round(p.ci95[1], 6)],
      better: p.better,
      worse: p.worse,
      tied: p.tied,
    };
  });
  const paired = new Set(baseline.runs.map(r => r.caseId).filter(id => library.runs.some(r => r.caseId === id)));
  return {
    cases: paired.size,
    coreCases: [...paired].filter(id => !hardIds.has(id)).length,
    repeats: Math.min(baseline.meta.repeats, library.meta.repeats),
    tiles,
  };
}

/** The repeat whose reward is the median of the case's repeats (ties: lowest repeat number). */
export function medianRun(runs: RunMetrics[]): RunMetrics {
  const sorted = [...runs].sort((a, b) => a.reward - b.reward || a.repeat - b.repeat);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

interface CheckpointRun {
  id: string;
  repeat: number;
  steps: number;
  reward: { value: number };
  toolCalls: { score: number; invalidPoiRefs: number };
  constraints: { score: number };
  hallucination: { rate: number; unverifiedPlaceNames: string[] };
  judge?: { weighted_total: number } | null;
  usedLessonIds?: string[];
  itineraryFile: string;
}

/** Finds the checkpoint record of one reported run by setup, case, repeat and reward. */
function findCheckpointRun(setup: string, split: string, run: RunMetrics, root: string): { record: CheckpointRun; dir: string } {
  const dirs = fs
    .readdirSync(root)
    .map(d => path.join(root, d))
    .filter(d => fs.existsSync(path.join(d, 'manifest.json')))
    .filter(d => {
      const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
      return m.config?.setup === setup && m.config?.split === split;
    });
  for (const dir of dirs) {
    const f = path.join(dir, 'runs', `${run.caseId}-r${run.repeat}.json`);
    if (!fs.existsSync(f)) continue;
    const record = JSON.parse(fs.readFileSync(f, 'utf8')) as CheckpointRun;
    if (Math.abs(record.reward.value - run.reward) < 5e-4) return { record, dir };
  }
  throw new Error(`No checkpoint run for ${setup}/${run.caseId} r${run.repeat} with reward ${run.reward} under ${root}`);
}

function trimItinerary(raw: any): ExampleItinerary {
  return {
    title: String(raw.title ?? ''),
    ...(raw.summary ? { summary: String(raw.summary) } : {}),
    days: (raw.days ?? []).map((d: any) => ({
      dayNumber: Number(d.dayNumber),
      ...(d.theme ? { theme: String(d.theme) } : {}),
      slots: (d.slots ?? []).map((s: any) => ({
        period: String(s.period),
        places: (s.places ?? []).map((p: any, i: number) => ({
          id: String(p.id ?? `${d.dayNumber}-${s.period}-${i}`),
          name: String(p.name ?? ''),
          type: String(p.type ?? 'attraction'),
          estimatedCost: Number(p.estimatedCost) || 0,
          duration: Number(p.duration) || 0,
        })),
      })),
    })),
  };
}

function buildSide(results: ResultsFile, caseId: string, root: string): ExampleSide {
  const runs = results.runs.filter(r => r.caseId === caseId && !r.failed);
  if (runs.length === 0) throw new Error(`${results.meta.setup}: no successful runs for ${caseId}`);
  const run = medianRun(runs);
  const { record, dir } = findCheckpointRun(results.meta.setup, results.meta.split, run, root);
  const itineraryPath = path.join(path.dirname(dir), '..', record.itineraryFile);
  const itinerary = JSON.parse(fs.readFileSync(itineraryPath, 'utf8'));
  return {
    setup: results.meta.setup,
    repeat: run.repeat,
    reward: run.reward,
    toolCorrect: run.toolCorrect,
    constraint: run.constraint,
    hallucinationRate: run.hallucinationRate,
    judge: run.judge,
    steps: run.steps,
    invalidPoiRefs: record.toolCalls.invalidPoiRefs,
    usedLessonIds: record.usedLessonIds ?? [],
    ungroundedPlaceNames: record.hallucination.unverifiedPlaceNames,
    itinerary: trimItinerary(itinerary),
  };
}

export function buildCompareExamples(opts: {
  baselineFile: string;
  libraryFile: string;
  caseIds?: string[];
  checkpointsDir?: string;
}): CompareExamplesFile {
  const baseline = JSON.parse(fs.readFileSync(opts.baselineFile, 'utf8')) as ResultsFile;
  const library = JSON.parse(fs.readFileSync(opts.libraryFile, 'utf8')) as ResultsFile;
  const root = opts.checkpointsDir ?? CHECKPOINTS_DIR;
  const examples = (opts.caseIds ?? DEFAULT_EXAMPLE_CASES).map(caseId => {
    const c = allCases.find(x => x.id === caseId);
    if (!c) throw new Error(`Unknown case ${caseId}`);
    return {
      caseId,
      region: c.region,
      hard: isHardCase(c),
      request: {
        destination: c.destination,
        days: c.days,
        people: c.people,
        preferences: c.preferences,
        groupType: c.groupType,
        budget: c.budget,
        specialNeeds: c.specialNeeds,
      },
      off: buildSide(baseline, caseId, root),
      on: buildSide(library, caseId, root),
    } satisfies CompareExample;
  });
  const describe = (f: string, r: ResultsFile) => ({
    file: path.relative(process.cwd(), f).split(path.sep).join('/'),
    setup: r.meta.setup,
    stamp: r.meta.stamp,
    ...(r.meta.gitCommit ? { commit: r.meta.gitCommit } : {}),
    repeats: r.meta.repeats,
  });
  return {
    generatedAt: new Date().toISOString(),
    baseline: describe(opts.baselineFile, baseline),
    library: describe(opts.libraryFile, library),
    heldOut: heldOutSummary(baseline, library),
    examples,
  };
}

if (process.argv[1] && /build-compare-examples\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const baselineFile = opt('baseline');
  const libraryFile = opt('library');
  if (!baselineFile || !libraryFile) {
    console.error('Usage: tsx tests/eval/build-compare-examples.ts --baseline <A.json> --library <B.json> [--cases a,b] [--out file]');
    process.exit(1);
  }
  const out = opt('out') ?? DEFAULT_OUT;
  const file = buildCompareExamples({ baselineFile, libraryFile, caseIds: opt('cases')?.split(',').map(s => s.trim()).filter(Boolean) });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  console.log(`Wrote ${out}: ${file.examples.length} examples, ${file.heldOut.tiles.length} held-out tiles`);
  for (const e of file.examples) {
    console.log(`  ${e.caseId}: off r${e.off.repeat} reward ${e.off.reward.toFixed(3)} (${e.off.ungroundedPlaceNames.length} ungrounded) | on r${e.on.repeat} reward ${e.on.reward.toFixed(3)} (${e.on.ungroundedPlaceNames.length} ungrounded, lessons ${e.on.usedLessonIds.join(',') || '-'})`);
  }
  for (const tile of file.heldOut.tiles) console.log(`  ${tile.key}: n=${tile.n} diff=${tile.meanDiff} ci=[${tile.ci95.join(', ')}] better=${tile.better} worse=${tile.worse}`);
}
