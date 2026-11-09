/**
 * Standalone agent evaluation harness.
 *
 * Runs the live DeepSeek tool-use agent against a fixed set of planning
 * queries (tests/eval/cases.json) and scores each run on:
 *   1. Tool-call correctness  — did it call the right tools, with valid
 *      args, without referencing POIs it never searched for?
 *   2. Constraint satisfaction — day count, schema validity, budget
 *      adherence, special-needs coverage.
 *   3. Hallucination rate     — what fraction of places in the final
 *      itinerary don't trace back to an actual search_places result?
 *      Grounded via Amap for mainland China and Mapbox everywhere else
 *      (see server/tools/provider.ts's getMapProvider).
 *   4. (optional) LLM-as-judge itinerary quality — reuses the 7-dimension
 *      rubric from tests/fuzzy/judge.ts.
 *
 * This is a reporting tool, not a CI gate — see tests/fuzzy/run.test.ts for
 * the smaller, pass/fail vitest suite that runs in CI.
 *
 * Cases (cases.json v2): 60 queries with a FROZEN train/test split, 15
 * domestic + 15 international on each side, each destination in exactly
 * one split. `train` feeds the v2 learning loop only; every headline
 * number comes from `test`. tests/unit/eval-cases.test.ts guards this.
 *
 * Usage:
 *   npm run eval                         # test split, 1 repeat, with LLM-judge
 *   npm run eval:test                    # test split, 3 repeats (headline numbers)
 *   EVAL_SPLIT=train npm run eval        # train | test | all (default test)
 *   EVAL_REPEATS=3 npm run eval          # repeat every case N times -> mean ± spread
 *   EVAL_FILTER=tokyo-family-food-culture npm run eval   # specific ids (overrides EVAL_SPLIT)
 *   EVAL_SKIP_JUDGE=1 npm run eval       # skip the judge (reward then excludes the judge term)
 *   EVAL_TEMPERATURE=0.7 npm run eval    # agent loop temperature (default 0.6)
 *   EVAL_DEGRADED_RERUNS=1               # reruns per run hit by provider errors (default 1, 0 = off)
 *   EVAL_SETUP=baseline                  # label for the ablation row this run belongs to
 *   TOOL_CACHE_DIR=tests/eval/.tool-cache  # replay tool responses (see server/tools/cache.ts)
 *
 * A full-split run (no EVAL_FILTER) also writes a compact, committable
 * summary to tests/eval/results/ with the case ids, cases.json hash, git
 * commit and env flags that produced it.
 *
 * Every run also writes tests/eval/reports/mapbox-errors-<timestamp>.log,
 * two sections: (1) every failed Mapbox-path tool call (HTTP status,
 * Mapbox's own error body, which function, the model's args) plus
 * search_places calls that came back HTTP-200-but-zero-results (a
 * language/format mismatch wouldn't necessarily throw — it'd just find
 * nothing); (2) every search_places request's exact outgoing method + full
 * URL + query params, success or failure, for replaying one directly
 * against Mapbox. Written every run, even when empty, so the filename is
 * predictable.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { generateItinerary, type ToolCallRecord, type AgentStepRecord, type AgentUsage } from '../../server/agent';
import { judgeItinerary, type RubricResult } from '../fuzzy/judge';
import { getMapProvider } from '../../server/tools/provider';
import { computeSourceAttributions, computeGroundingWarning } from '../../server/tools/attributions';
import { drainMapboxRequestLog, type MapboxRequestLogEntry } from '../../server/tools/mapbox';
import {
  scoreToolCallCorrectness,
  scoreConstraintSatisfaction,
  scoreHallucinationRate,
  scoreDestinationContextUsage,
  computeReward,
  REWARD_VERSION,
  REWARD_WEIGHTS,
  type Reward,
  type EvalCase,
  type ToolCallScore,
  type ConstraintScore,
  type HallucinationScore,
  type DestinationContextScore,
} from './scoring';
import type { Itinerary } from '../../src/types';
import { allCases, caseSetVersion, parseSplit, selectCases } from './cases';
import { summarizeRuns, fmtSpread, type RunMetrics, type GroupSummary } from './aggregate';
import { toolCacheDir, toolCacheStats } from '../../server/tools/cache';

const filterIds = (process.env.EVAL_FILTER ?? '').split(',').map(s => s.trim()).filter(Boolean);
const split = parseSplit(process.env.EVAL_SPLIT);
const cases = selectCases(allCases, { split, filterIds });
const skipJudge = process.env.EVAL_SKIP_JUDGE === '1';
const repeats = Math.max(1, Math.floor(Number(process.env.EVAL_REPEATS ?? 1)) || 1);
const temperature = process.env.EVAL_TEMPERATURE !== undefined ? Number(process.env.EVAL_TEMPERATURE) : undefined;
const degradedReruns = Math.max(0, Math.floor(Number(process.env.EVAL_DEGRADED_RERUNS ?? 1)) || 0);
const setupLabel = process.env.EVAL_SETUP?.trim() || 'default';

interface CaseResult {
  id: string;
  destination: string;
  region: 'domestic' | 'international';
  /** 1-based repeat index. */
  repeat: number;
  /** 1 + number of reruns this run needed because of provider-side errors. */
  attempts: number;
  /** Still provider-degraded after all reruns (see isProviderDegraded). */
  degraded: boolean;
  steps: number;
  usage: AgentUsage;
  reward: Reward;
  durationMs: number;
  error?: string;
  toolCalls: ToolCallScore;
  constraints: ConstraintScore;
  hallucination: HallucinationScore;
  destinationContext: DestinationContextScore;
  judge?: RubricResult;
  /**
   * Path (relative to tests/eval/reports/) to this case's full generated
   * itinerary JSON — coordinates, aiNote text, the whole day-by-day plan,
   * plus sourceAttributions/groundingWarning exactly as a real API
   * response would carry them. Absent for a case that failed to generate
   * at all (nothing to save). Kept as a sibling file rather than inlined
   * into the summary report so report-*.json/latest.json stay small and
   * diffable even as itineraries get long; scoring only ever needed the
   * trace, not the full object, until now (manual review does).
   */
  itineraryFile?: string;
}

interface MapboxDiagnosticEntry {
  caseId: string;
  destination: string;
  step: number;
  toolName: string;
  args: Record<string, any>;
  kind: 'error' | 'empty-result';
  detail: string;
}

/**
 * Scan one case's tool-call trace for Mapbox-path problems, for the
 * mapbox-errors-<timestamp>.log file. Two kinds:
 *   - 'error': the call actually failed (HTTP status + Mapbox's error body,
 *     already baked into resultSummary by mapbox.ts / summariseToolResult).
 *   - 'empty-result': search_places returned HTTP 200 with zero POIs — not
 *     a thrown error at all, so it would never show up as `!ok`, but
 *     exactly what a language/format mismatch would produce (see the
 *     hypothesis this is here to check).
 * Only collected for cases whose destination actually routes to Mapbox —
 * an Amap-side failure isn't part of what we're diagnosing here.
 */
function collectMapboxDiagnostics(c: EvalCase, trace: ToolCallRecord[]): MapboxDiagnosticEntry[] {
  if (getMapProvider(c.destination) !== 'mapbox') return [];
  const entries: MapboxDiagnosticEntry[] = [];
  for (const t of trace) {
    if (!t.ok) {
      entries.push({
        caseId: c.id,
        destination: c.destination,
        step: t.step,
        toolName: t.name,
        args: t.args,
        kind: 'error',
        detail: t.resultSummary,
      });
    } else if (t.name === 'search_places' && /^0 result/.test(t.resultSummary)) {
      entries.push({
        caseId: c.id,
        destination: c.destination,
        step: t.step,
        toolName: t.name,
        args: t.args,
        kind: 'empty-result',
        detail: t.resultSummary,
      });
    }
  }
  return entries;
}

type RunInfo = Pick<CaseResult, 'id' | 'destination' | 'region' | 'repeat' | 'attempts' | 'degraded' | 'steps' | 'usage' | 'durationMs'>;

/** A failed generation scores as the worst case on every term (halluc 1, reward -0.5), never skipped. */
function failedResult(info: RunInfo, message: string): CaseResult {
  return {
    ...info,
    reward: computeReward({ toolCorrect: 0, constraint: 0, judgeOutOf5: null, hallucinationRate: 1 }),
    error: message,
    toolCalls: { score: 0, totalCalls: 0, errorCalls: 0, usedSearchPlaces: false, invalidPoiRefs: 0, issues: ['generation failed'] },
    constraints: { score: 0, schemaValid: false, dayCountMatches: false, budgetAdherence: 0, specialNeedsAddressed: 0, issues: ['generation failed'] },
    hallucination: { rate: 1, verifiable: false, totalPlaces: 0, unverifiedPlaceNames: [] },
    destinationContext: { called: false, calledCount: 0, successCount: 0, attributionConsistent: true, score: 1, issues: [] },
  };
}

/**
 * Run hygiene (v2 plan): a run is provider-degraded when a search_places
 * call errored, or most searches came back empty (computeGroundingWarning).
 * That reflects Overpass/Geoapify having a bad day, not the agent, so the
 * run is retried (EVAL_DEGRADED_RERUNS) and flagged if it stays degraded.
 */
function isProviderDegraded(trace: ToolCallRecord[]): boolean {
  return trace.some(t => t.name === 'search_places' && !t.ok) || computeGroundingWarning(trace);
}

function regionOf(c: EvalCase): 'domestic' | 'international' {
  return c.region ?? (getMapProvider(c.destination) === 'amap' ? 'domestic' : 'international');
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY is not set — the eval harness calls the live agent, so it needs a real key.');
    process.exit(1);
  }
  if (cases.length === 0) {
    console.error('No cases matched EVAL_FILTER.');
    process.exit(1);
  }

  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
  });

  console.log(
    `\nRunning eval harness: ${cases.length} case(s) × ${repeats} repeat(s), split=${filterIds.length ? `filter(${filterIds.join(',')})` : split}, setup=${setupLabel}` +
      `${skipJudge ? ', LLM-judge skipped' : ''}${temperature !== undefined ? `, temperature=${temperature}` : ''}${toolCacheDir() ? `, tool cache=${toolCacheDir()}` : ''}\n`,
  );

  // Computed once up front so per-case itinerary files can be named with it as they're generated.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const itinerariesDir = path.join(process.cwd(), 'tests', 'eval', 'reports', 'itineraries');
  fs.mkdirSync(itinerariesDir, { recursive: true });

  const results: CaseResult[] = [];
  const mapboxDiagnostics: MapboxDiagnosticEntry[] = [];
  const mapboxRequests: Array<MapboxRequestLogEntry & { caseId: string; destination: string }> = [];

  // Repeat-major order: one full pass over the cases per repeat, so an
  // interrupted run still has complete repeats rather than a few cases × 3.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    if (repeats > 1) console.log(`--- repeat ${repeat}/${repeats} ---`);
    for (const c of cases) {
      const r = await runCaseWithReruns(c, repeat, client, stamp, itinerariesDir, mapboxDiagnostics, mapboxRequests);
      results.push(r);
    }
  }

  const meta = buildMeta(stamp);
  writeReports(results, stamp, meta);
  writeMapboxDiagnosticsLog(mapboxDiagnostics, mapboxRequests, stamp);
  if (filterIds.length === 0) writeCommittedResult(results, stamp, meta);
  printSummary(results);
  if (toolCacheDir()) {
    const st = toolCacheStats();
    console.log(`Tool cache: ${st.hits} hit(s), ${st.misses} miss(es), ${st.writes} write(s)`);
  }
  console.log(`Full itinerary JSON for each generated run: tests/eval/reports/itineraries/${stamp}-<case-id>-r<repeat>.json`);
}

async function runCaseWithReruns(
  c: EvalCase,
  repeat: number,
  client: OpenAI,
  stamp: string,
  itinerariesDir: string,
  mapboxDiagnostics: MapboxDiagnosticEntry[],
  mapboxRequests: Array<MapboxRequestLogEntry & { caseId: string; destination: string }>,
): Promise<CaseResult> {
  let result: CaseResult | null = null;
  for (let attempt = 1; attempt <= 1 + degradedReruns; attempt++) {
    const isLast = attempt === 1 + degradedReruns;
    const { result: r, trace } = await runCaseOnce(c, repeat, attempt, client, stamp, itinerariesDir);
    result = r;
    // Diagnostics only for the attempt we keep, so the log matches the report.
    if (!r.degraded || isLast) {
      mapboxDiagnostics.push(...collectMapboxDiagnostics(c, trace));
      for (const req of drainMapboxRequestLog()) mapboxRequests.push({ caseId: c.id, destination: c.destination, ...req });
      break;
    }
    drainMapboxRequestLog();
    console.log(`    ↻ provider-degraded run, rerunning (${attempt}/${degradedReruns})`);
  }
  return result!;
}

async function runCaseOnce(
  c: EvalCase,
  repeat: number,
  attempt: number,
  client: OpenAI,
  stamp: string,
  itinerariesDir: string,
): Promise<{ result: CaseResult; trace: ToolCallRecord[] }> {
  const trace: ToolCallRecord[] = [];
  const stepTrace: AgentStepRecord[] = [];
  const usage: AgentUsage = { promptTokens: 0, completionTokens: 0, completions: 0 };
  const start = Date.now();
  const region = regionOf(c);
  const tag = repeats > 1 ? ` r${repeat}` : '';
  process.stdout.write(`  ${c.id}${tag} — ${c.destination} ${c.days}d ${c.people}p ... `);
  const info = (): RunInfo => ({
    id: c.id,
    destination: c.destination,
    region,
    repeat,
    attempts: attempt,
    degraded: isProviderDegraded(trace),
    steps: stepTrace.length,
    usage,
    durationMs: Date.now() - start,
  });
  try {
    const itinerary = (await generateItinerary(
      {
        destination: c.destination,
        days: c.days,
        people: c.people,
        preferences: c.preferences,
        groupType: c.groupType,
        budget: c.budget,
        specialNeeds: c.specialNeeds,
      },
      { client, trace, stepTrace, usage, temperature },
    )) as Itinerary;
    const base = info();

    // server.ts's /api/generate-itinerary computes these from the trace
    // after generateItinerary() returns; replicated via the same shared
    // functions so the saved itinerary reads exactly like a real API
    // response and scoreDestinationContextUsage checks real wiring.
    itinerary.sourceAttributions = computeSourceAttributions(trace, c.destination);
    itinerary.groundingWarning = computeGroundingWarning(trace) || undefined;

    const toolCalls = scoreToolCallCorrectness(trace, c.destination);
    const constraints = scoreConstraintSatisfaction(itinerary, c);
    const hallucination = scoreHallucinationRate(trace, itinerary, c.destination);
    const destinationContext = scoreDestinationContextUsage(trace, itinerary);
    // Only the trip request goes to the judge, not eval bookkeeping (id/split/region).
    const { id: _id, split: _split, region: _region, ...userProfile } = c;
    const judge = skipJudge ? undefined : await judgeItinerary({ userProfile, itinerary }, client);
    const reward = computeReward({
      toolCorrect: toolCalls.score,
      constraint: constraints.score,
      judgeOutOf5: judge ? judge.weighted_total : null,
      hallucinationRate: hallucination.rate,
    });

    const itineraryFileName = `${stamp}-${c.id}-r${repeat}.json`;
    fs.writeFileSync(path.join(itinerariesDir, itineraryFileName), JSON.stringify(itinerary, null, 2));

    console.log(
      `reward=${reward.value.toFixed(3)} tools=${toolCalls.score.toFixed(2)} constraints=${constraints.score.toFixed(2)} halluc=${(hallucination.rate * 100).toFixed(0)}%${judge ? ` judge=${judge.weighted_total}` : ''} steps=${base.steps}${base.degraded ? ' [PROVIDER-DEGRADED]' : ''} [${base.durationMs}ms]`,
    );
    return {
      trace,
      result: { ...base, reward, toolCalls, constraints, hallucination, destinationContext, judge, itineraryFile: `itineraries/${itineraryFileName}` },
    };
  } catch (err: any) {
    const message = err.message ?? String(err);
    console.log(`FAILED: ${message}`);
    return { trace, result: failedResult(info(), message) };
  }
}

function toRunMetrics(r: CaseResult): RunMetrics {
  return {
    caseId: r.id,
    region: r.region,
    repeat: r.repeat,
    failed: !!r.error,
    degraded: r.degraded,
    toolCorrect: r.toolCalls.score,
    constraint: r.constraints.score,
    hallucinationRate: r.hallucination.rate,
    judge: r.judge ? r.judge.weighted_total : null,
    reward: r.reward.value,
    rewardIncludesJudge: r.reward.includesJudge,
    steps: r.steps,
    promptTokens: r.usage.promptTokens,
    completionTokens: r.usage.completionTokens,
    durationMs: r.durationMs,
  };
}

function buildMeta(stamp: string) {
  const casesRaw = fs.readFileSync(path.join(process.cwd(), 'tests', 'eval', 'cases.json'));
  let gitCommit: string | null = null;
  let gitDirty: boolean | null = null;
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    gitDirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0;
  } catch {
    // Not a git checkout; leave null.
  }
  return {
    stamp,
    setup: setupLabel,
    split: filterIds.length ? 'filter' : split,
    caseSetVersion,
    casesSha256: createHash('sha256').update(casesRaw).digest('hex').slice(0, 16),
    caseIds: cases.map(c => c.id),
    repeats,
    temperature: temperature ?? 0.6,
    judge: !skipJudge,
    degradedReruns,
    rewardVersion: REWARD_VERSION,
    rewardWeights: REWARD_WEIGHTS,
    gitCommit,
    gitDirty,
    flags: {
      DISABLE_GEOAPIFY_SIMPLIFIED_RETRY: process.env.DISABLE_GEOAPIFY_SIMPLIFIED_RETRY === 'true',
      DISABLE_ERROR_RECOVERY: process.env.DISABLE_ERROR_RECOVERY === 'true',
      TOOL_CACHE: !!toolCacheDir(),
    },
  };
}
type EvalMeta = ReturnType<typeof buildMeta>;

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function buildSummary(results: CaseResult[]) {
  const ok = results.filter(r => !r.error);
  const called = ok.filter(r => r.destinationContext.called);
  return {
    generatedAt: new Date().toISOString(),
    caseCount: new Set(results.map(r => r.id)).size,
    runCount: results.length,
    failedRunCount: results.length - ok.length,
    degradedRunCount: results.filter(r => r.degraded).length,
    rerunCount: results.reduce((n, r) => n + (r.attempts - 1), 0),
    /** Mean ± spread across repeats of each repeat's case-average; failed runs count as worst-case. */
    aggregate: summarizeRuns(results.map(toRunMetrics)),
    // Informational, not graded — see scoring.ts's scoreDestinationContextUsage docstring.
    destinationContextUsageRate: ok.length > 0 ? called.length / ok.length : 0,
    destinationContextSuccessRate: called.length > 0 ? avg(called.map(r => (r.destinationContext.successCount > 0 ? 1 : 0))) : null,
    destinationContextAttributionWiringOkRate: ok.length > 0 ? avg(ok.map(r => r.destinationContext.score)) : 1,
    judgePassRate: ok.some(r => r.judge) ? ok.filter(r => r.judge?.pass).length / ok.filter(r => r.judge).length : null,
  };
}

function headlineRows(g: GroupSummary): Array<[string, string]> {
  const m = g.metrics;
  return [
    ['Hallucination rate', fmtSpread(m.hallucinationRate, { percent: true })],
    ['Tool-call correctness', fmtSpread(m.toolCorrect)],
    ['Constraint satisfaction', fmtSpread(m.constraint)],
    ['LLM-judge (0-5)', fmtSpread(m.judge)],
    [`Reward${g.rewardIncludesJudge ? '' : ' (no judge term)'}`, fmtSpread(m.reward, { digits: 3 })],
    ['Avg steps', fmtSpread(m.steps, { digits: 1 })],
    ['Tokens per run (prompt / completion)', `${fmtSpread(m.promptTokens, { digits: 0 })} / ${fmtSpread(m.completionTokens, { digits: 0 })}`],
  ];
}

function printSummary(results: CaseResult[]) {
  const s = buildSummary(results);
  console.log('\n=== Eval summary ===');
  console.log(
    `  ${s.caseCount} case(s), ${s.runCount} run(s): ${s.failedRunCount} failed, ${s.degradedRunCount} still provider-degraded, ${s.rerunCount} rerun(s)`,
  );
  console.log(`  (mean ± sample std across ${repeats} repeat(s))`);
  for (const [label, g] of [['overall', s.aggregate.overall], ['domestic', s.aggregate.domestic], ['international', s.aggregate.international]] as const) {
    if (g.runCount === 0) continue;
    console.log(`  [${label}]`);
    for (const [k, v] of headlineRows(g)) console.log(`    ${k.padEnd(38)} ${v}`);
  }
  console.log(
    `  get_destination_context usage: ${(s.destinationContextUsageRate * 100).toFixed(0)}% of runs; attribution wiring OK in ${(s.destinationContextAttributionWiringOkRate * 100).toFixed(0)}%`,
  );
  console.log('====================\n');
}

function renderMarkdown(summary: ReturnType<typeof buildSummary>, results: CaseResult[], meta: EvalMeta): string {
  const lines: string[] = [];
  lines.push('# Wayfound agent eval report');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push(
    `- Setup: **${meta.setup}**, split: **${meta.split}**, ${summary.caseCount} case(s) × ${meta.repeats} repeat(s) = ${summary.runCount} run(s); temperature ${meta.temperature}; judge ${meta.judge ? 'on' : 'off'}`,
  );
  lines.push(`- Runs: ${summary.failedRunCount} failed to generate, ${summary.degradedRunCount} still provider-degraded after ${summary.rerunCount} rerun(s)`);
  lines.push(`- cases.json v${meta.caseSetVersion} sha256 \`${meta.casesSha256}\`, commit \`${meta.gitCommit ?? 'n/a'}\`${meta.gitDirty ? ' (dirty)' : ''}, reward v${meta.rewardVersion}`);
  lines.push(`- Flags: ${Object.entries(meta.flags).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  lines.push('- Numbers are mean ± sample std across repeats of each repeat\'s case-average. Failed runs count as worst-case (halluc 100%, reward -0.5).');
  lines.push('');
  const groups = [['Overall', summary.aggregate.overall], ['Domestic', summary.aggregate.domestic], ['International', summary.aggregate.international]] as const;
  const shown = groups.filter(([, g]) => g.runCount > 0);
  lines.push(`| Metric | ${shown.map(([l]) => l).join(' | ')} |`);
  lines.push(`|---|${shown.map(() => '---:').join('|')}|`);
  const rowsByGroup = shown.map(([, g]) => headlineRows(g));
  for (let i = 0; i < rowsByGroup[0].length; i++) {
    lines.push(`| ${rowsByGroup[0][i][0]} | ${rowsByGroup.map(r => r[i][1]).join(' | ')} |`);
  }
  lines.push('');
  lines.push(
    `get_destination_context (Wikivoyage) usage: ${(summary.destinationContextUsageRate * 100).toFixed(0)}% of runs; CC BY-SA attribution wiring OK in ${(summary.destinationContextAttributionWiringOkRate * 100).toFixed(0)}%.`,
  );
  lines.push('');
  lines.push('## Runs');
  lines.push('');
  lines.push('| Case | Rep | Region | Reward | Tools | Constraints | Halluc. | Judge | Steps | Notes | Time |');
  lines.push('|---|---:|---|---:|---:|---:|---:|---:|---:|---|---:|');
  for (const r of results) {
    const notes = [r.degraded ? 'provider-degraded' : '', r.attempts > 1 ? `${r.attempts} attempts` : ''].filter(Boolean).join(', ');
    if (r.error) {
      lines.push(`| ${r.id} | ${r.repeat} | ${r.region} | ${r.reward.value.toFixed(3)} | — | — | — | — | ${r.steps} | FAILED: ${r.error} | ${r.durationMs}ms |`);
      continue;
    }
    const caseLabel = r.itineraryFile ? `[${r.id}](${r.itineraryFile})` : r.id;
    lines.push(
      `| ${caseLabel} | ${r.repeat} | ${r.region} | ${r.reward.value.toFixed(3)} | ${r.toolCalls.score.toFixed(2)} | ${r.constraints.score.toFixed(2)} | ${(r.hallucination.rate * 100).toFixed(0)}% | ${r.judge ? r.judge.weighted_total.toFixed(2) : '—'} | ${r.steps} | ${notes} | ${r.durationMs}ms |`,
    );
  }
  lines.push('');
  lines.push('## Issues by run');
  lines.push('');
  let anyIssues = false;
  for (const r of results) {
    const allIssues = [...r.toolCalls.issues, ...r.constraints.issues, ...r.destinationContext.issues];
    if (r.error) allIssues.push(`generation error: ${r.error}`);
    if (allIssues.length === 0) continue;
    anyIssues = true;
    lines.push(`**${r.id}** (repeat ${r.repeat})`);
    for (const issue of allIssues) lines.push(`- ${issue}`);
    lines.push('');
  }
  if (!anyIssues) lines.push('None.');
  return lines.join('\n');
}

function writeReports(results: CaseResult[], stamp: string, meta: EvalMeta) {
  const dir = path.join(process.cwd(), 'tests', 'eval', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const summary = buildSummary(results);
  const payload = JSON.stringify({ meta, summary, results }, null, 2);
  const markdown = renderMarkdown(summary, results, meta);

  fs.writeFileSync(path.join(dir, `report-${stamp}.json`), payload);
  fs.writeFileSync(path.join(dir, `report-${stamp}.md`), markdown);
  fs.writeFileSync(path.join(dir, 'latest.json'), payload);
  fs.writeFileSync(path.join(dir, 'latest.md'), markdown);

  console.log(`Reports written to tests/eval/reports/report-${stamp}.{json,md} (and latest.{json,md})`);
}

/**
 * Compact, committable record of a full-split run (v2 plan: keep the case
 * list that produced each number in the repo). No itineraries or traces,
 * just meta + aggregate + per-run scalar metrics. tests/eval/reports/ stays
 * gitignored; tests/eval/results/ is meant to be committed.
 */
function writeCommittedResult(results: CaseResult[], stamp: string, meta: EvalMeta) {
  const dir = path.join(process.cwd(), 'tests', 'eval', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const summary = buildSummary(results);
  const file = path.join(dir, `${meta.setup}-${meta.split}-${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ meta, aggregate: summary.aggregate, runs: results.map(r => ({ ...toRunMetrics(r), attempts: r.attempts, error: r.error })) }, null, 2) + '\n',
  );
  console.log(`Committable result summary: ${path.relative(process.cwd(), file)}`);
}

/**
 * Diagnostics for Priority 2 prep. Two sections, one file, written every
 * run (even empty, so the filename `mapbox-errors-<stamp>.log` is
 * predictable and a clean run is visibly confirmed clean rather than just
 * absent):
 *   1. Tool-call diagnostics — every Mapbox-path failure and every
 *      HTTP-200-but-zero-results search_places call.
 *   2. Full outgoing requests — every search_places (Search Box "suggest")
 *      request's exact method + complete URL + query params as actually
 *      sent, success or failure, plus how many candidates `suggest` itself
 *      returned vs. how many survived the follow-up `retrieve` calls (so a
 *      "0 results" case can be told apart as "suggest itself found
 *      nothing" vs. "suggest found candidates but retrieve killed them
 *      all" before manually replaying a URL against Mapbox).
 */
function writeMapboxDiagnosticsLog(
  entries: MapboxDiagnosticEntry[],
  requests: Array<MapboxRequestLogEntry & { caseId: string; destination: string }>,
  stamp: string,
) {
  const dir = path.join(process.cwd(), 'tests', 'eval', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `mapbox-errors-${stamp}.log`);

  const lines: string[] = [];
  lines.push(`Mapbox tool-call diagnostics — ${new Date().toISOString()}`);
  lines.push(`Cases in this run: ${cases.length} × ${repeats} repeat(s)${filterIds.length ? ` (EVAL_FILTER=${filterIds.join(',')})` : ` (split=${split})`}`);
  lines.push('');

  lines.push('== 1. Tool-call diagnostics ==');
  lines.push(`Entries: ${entries.length} (${entries.filter(e => e.kind === 'error').length} error, ${entries.filter(e => e.kind === 'empty-result').length} empty-result)`);
  lines.push('');
  if (entries.length === 0) {
    lines.push('No Mapbox tool-call failures or empty results recorded in this run.');
  } else {
    for (const e of entries) {
      lines.push(`[${e.caseId}] ${e.destination} (step ${e.step}) — ${e.toolName} — ${e.kind}`);
      lines.push(`  args: ${JSON.stringify(e.args)}`);
      lines.push(`  ${e.kind === 'error' ? 'error' : 'result'}: ${e.detail}`);
      lines.push('');
    }
  }

  lines.push('== 2. Full outgoing search_places (suggest) requests ==');
  lines.push(`Requests: ${requests.length}`);
  lines.push('');
  if (requests.length === 0) {
    lines.push('No search_places (Mapbox) requests recorded in this run.');
  } else {
    for (const r of requests) {
      const counts =
        r.suggestionCount === undefined
          ? '(suggest call failed — no counts)'
          : `suggest returned ${r.suggestionCount} candidate(s), ${r.retrievedCount} survived retrieve, ${r.nearbyCount} within the geographic sanity radius`;
      lines.push(`[${r.caseId}] ${r.destination} — ${r.timestamp} — strategy=${r.strategy}`);
      lines.push(`  ${r.method} ${r.url}`);
      lines.push(`  ${counts}`);
      lines.push('');
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'));
  console.log(
    `Mapbox diagnostics written to tests/eval/reports/mapbox-errors-${stamp}.log (${entries.length} tool-call entries, ${requests.length} requests)`,
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
