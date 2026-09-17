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
 * Usage:
 *   npm run eval                                    # all 25 cases, with LLM-judge
 *   EVAL_FILTER=tokyo-family-food-culture npm run eval             # one case
 *   EVAL_FILTER=tokyo-family-food-culture,paris-couple-culture-food npm run eval  # a few
 *   EVAL_SKIP_JUDGE=1 npm run eval      # skip the judge call (faster/cheaper)
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
import casesJson from './cases.json';
import { generateItinerary, type ToolCallRecord } from '../../server/agent';
import { judgeItinerary, type RubricResult } from '../fuzzy/judge';
import { getMapProvider } from '../../server/tools/provider';
import { computeSourceAttributions, computeGroundingWarning } from '../../server/tools/attributions';
import { drainMapboxRequestLog, type MapboxRequestLogEntry } from '../../server/tools/mapbox';
import {
  scoreToolCallCorrectness,
  scoreConstraintSatisfaction,
  scoreHallucinationRate,
  scoreDestinationContextUsage,
  type EvalCase,
  type ToolCallScore,
  type ConstraintScore,
  type HallucinationScore,
  type DestinationContextScore,
} from './scoring';
import type { Itinerary } from '../../src/types';

const allCases: EvalCase[] = (casesJson as { cases: EvalCase[] }).cases;
const filterIds = (process.env.EVAL_FILTER ?? '').split(',').map(s => s.trim()).filter(Boolean);
const cases = filterIds.length ? allCases.filter(c => filterIds.includes(c.id)) : allCases;
const skipJudge = process.env.EVAL_SKIP_JUDGE === '1';

interface CaseResult {
  id: string;
  destination: string;
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

function failedResult(id: string, destination: string, durationMs: number, message: string): CaseResult {
  return {
    id,
    destination,
    durationMs,
    error: message,
    toolCalls: { score: 0, totalCalls: 0, errorCalls: 0, usedSearchPlaces: false, invalidPoiRefs: 0, issues: ['generation failed'] },
    constraints: { score: 0, schemaValid: false, dayCountMatches: false, budgetAdherence: 0, specialNeedsAddressed: 0, issues: ['generation failed'] },
    hallucination: { rate: 1, verifiable: false, totalPlaces: 0, unverifiedPlaceNames: [] },
    destinationContext: { called: false, calledCount: 0, successCount: 0, attributionConsistent: true, score: 1, issues: [] },
  };
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

  console.log(`\nRunning eval harness: ${cases.length} case(s)${skipJudge ? ' (LLM-judge skipped)' : ''}\n`);

  // Computed once up front (not after the loop, like the report stamp used
  // to be) so per-case itinerary files can be named with it as they're
  // generated, not only once every case is done.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const itinerariesDir = path.join(process.cwd(), 'tests', 'eval', 'reports', 'itineraries');
  fs.mkdirSync(itinerariesDir, { recursive: true });

  const results: CaseResult[] = [];
  const mapboxDiagnostics: MapboxDiagnosticEntry[] = [];
  const mapboxRequests: Array<MapboxRequestLogEntry & { caseId: string; destination: string }> = [];

  for (const c of cases) {
    const trace: ToolCallRecord[] = [];
    const start = Date.now();
    process.stdout.write(`  ${c.id} — ${c.destination} ${c.days}d ${c.people}p ... `);
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
        { client, trace },
      )) as Itinerary;
      const durationMs = Date.now() - start;

      // server.ts's /api/generate-itinerary computes this from the trace
      // after generateItinerary() returns — replicated here via the same
      // shared function so scoreDestinationContextUsage's attribution
      // check reflects real production wiring, not an eval-harness gap
      // (generateItinerary() itself never sets this field; only the route
      // handler does).
      itinerary.sourceAttributions = computeSourceAttributions(trace, c.destination);
      // Same honesty-disclaimer flag server.ts's route computes — see
      // computeGroundingWarning's docstring. Attached here too so a saved
      // itinerary file reads exactly like a real API response, and so a
      // reviewer scanning itinerariesDir can immediately spot which cases
      // ran into the Overpass-outage scenario without cross-referencing
      // the trace separately.
      itinerary.groundingWarning = computeGroundingWarning(trace) || undefined;

      const toolCalls = scoreToolCallCorrectness(trace, c.destination);
      const constraints = scoreConstraintSatisfaction(itinerary, c);
      const hallucination = scoreHallucinationRate(trace, itinerary, c.destination);
      const destinationContext = scoreDestinationContextUsage(trace, itinerary);
      const judge = skipJudge ? undefined : await judgeItinerary({ userProfile: c, itinerary }, client);

      const itineraryFileName = `${stamp}-${c.id}.json`;
      fs.writeFileSync(path.join(itinerariesDir, itineraryFileName), JSON.stringify(itinerary, null, 2));

      results.push({
        id: c.id,
        destination: c.destination,
        durationMs,
        toolCalls,
        constraints,
        hallucination,
        destinationContext,
        judge,
        itineraryFile: `itineraries/${itineraryFileName}`,
      });
      console.log(
        `tools=${toolCalls.score.toFixed(2)} constraints=${constraints.score.toFixed(2)} halluc=${(hallucination.rate * 100).toFixed(0)}% wikivoyage=${destinationContext.called ? `used(${destinationContext.successCount}/${destinationContext.calledCount})` : 'not used'}${judge ? ` judge=${judge.weighted_total}` : ''} [${durationMs}ms]`,
      );
    } catch (err: any) {
      const durationMs = Date.now() - start;
      results.push(failedResult(c.id, c.destination, durationMs, err.message ?? String(err)));
      console.log(`FAILED: ${err.message ?? err}`);
    } finally {
      // Trace is populated up to whatever point generation reached, even
      // when the case as a whole failed — collect it either way.
      mapboxDiagnostics.push(...collectMapboxDiagnostics(c, trace));
      // Every search_places call this case made, exact outgoing URL
      // included, success or failure — drained regardless of provider
      // (empty for China cases, since mapbox.searchPlaces() is never
      // invoked for them at all).
      for (const r of drainMapboxRequestLog()) {
        mapboxRequests.push({ caseId: c.id, destination: c.destination, ...r });
      }
    }
  }

  writeReports(results, stamp);
  writeMapboxDiagnosticsLog(mapboxDiagnostics, mapboxRequests, stamp);
  printSummary(results);
  console.log(`Full itinerary JSON for each generated case: tests/eval/reports/itineraries/${stamp}-<case-id>.json`);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function buildSummary(results: CaseResult[]) {
  const ok = results.filter(r => !r.error);
  const verifiable = ok.filter(r => r.hallucination.verifiable);
  const judged = ok.filter((r): r is CaseResult & { judge: RubricResult } => !!r.judge);
  return {
    generatedAt: new Date().toISOString(),
    caseCount: results.length,
    failedCount: results.length - ok.length,
    toolCallCorrectnessAvg: avg(ok.map(r => r.toolCalls.score)),
    constraintSatisfactionAvg: avg(ok.map(r => r.constraints.score)),
    hallucinationRateAvgVerifiable: avg(verifiable.map(r => r.hallucination.rate)),
    verifiableCaseCount: verifiable.length,
    // Informational, not a pass/fail average — see scoring.ts's
    // scoreDestinationContextUsage docstring for why usage itself isn't
    // graded. attributionWiringOkRate should be 1.0 barring a real bug.
    destinationContextUsageRate: ok.length > 0 ? ok.filter(r => r.destinationContext.called).length / ok.length : 0,
    destinationContextSuccessRate:
      ok.filter(r => r.destinationContext.called).length > 0
        ? avg(ok.filter(r => r.destinationContext.called).map(r => (r.destinationContext.successCount > 0 ? 1 : 0)))
        : null,
    destinationContextAttributionWiringOkRate: ok.length > 0 ? avg(ok.map(r => r.destinationContext.score)) : 1,
    judgeAvg: judged.length > 0 ? avg(judged.map(r => r.judge.weighted_total)) : null,
    judgePassRate: judged.length > 0 ? judged.filter(r => r.judge.pass).length / judged.length : null,
  };
}

function printSummary(results: CaseResult[]) {
  const s = buildSummary(results);
  console.log('\n=== Eval summary ===');
  console.log(`  cases: ${s.caseCount} (${s.failedCount} failed to generate)`);
  console.log(`  tool-call correctness (avg):   ${s.toolCallCorrectnessAvg.toFixed(2)} / 1.00`);
  console.log(`  constraint satisfaction (avg): ${s.constraintSatisfactionAvg.toFixed(2)} / 1.00`);
  console.log(
    `  hallucination rate (avg, ${s.verifiableCaseCount} case(s), grounded via Amap/Mapbox): ${(s.hallucinationRateAvgVerifiable * 100).toFixed(1)}%`,
  );
  console.log(
    `  get_destination_context (Wikivoyage) usage: ${(s.destinationContextUsageRate * 100).toFixed(0)}% of cases called it${
      s.destinationContextSuccessRate !== null ? `, ${(s.destinationContextSuccessRate * 100).toFixed(0)}% of those found an article` : ''
    } — attribution wiring OK in ${(s.destinationContextAttributionWiringOkRate * 100).toFixed(0)}% of cases`,
  );
  if (s.judgeAvg !== null) {
    console.log(`  LLM-judge itinerary quality (avg): ${s.judgeAvg.toFixed(2)} / 5.00, pass rate ${(s.judgePassRate! * 100).toFixed(1)}%`);
  }
  console.log('====================\n');
}

function renderMarkdown(summary: ReturnType<typeof buildSummary>, results: CaseResult[]): string {
  const lines: string[] = [];
  lines.push('# Wayfound agent eval report');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push(`- Cases run: ${summary.caseCount} (${summary.failedCount} failed to generate)`);
  lines.push(
    `- Full generated itinerary JSON (coordinates, aiNote text, full day-by-day plan) for each case is saved under \`itineraries/\` — click a case id in the table below to open its file.`,
  );
  lines.push(`- Tool-call correctness (avg): **${summary.toolCallCorrectnessAvg.toFixed(2)} / 1.00**`);
  lines.push(`- Constraint satisfaction (avg): **${summary.constraintSatisfactionAvg.toFixed(2)} / 1.00**`);
  lines.push(
    `- Hallucination rate, ${summary.verifiableCaseCount} case(s), grounded via Amap/Mapbox (avg): **${(summary.hallucinationRateAvgVerifiable * 100).toFixed(1)}%**`,
  );
  lines.push(
    `- get_destination_context (Wikivoyage) usage: **${(summary.destinationContextUsageRate * 100).toFixed(0)}%** of cases called it${
      summary.destinationContextSuccessRate !== null
        ? `, **${(summary.destinationContextSuccessRate * 100).toFixed(0)}%** of those found an article`
        : ''
    } — CC BY-SA attribution wiring OK in **${(summary.destinationContextAttributionWiringOkRate * 100).toFixed(0)}%** of cases (calling the tool at all is the model's own judgment call, not graded — this only checks that the attribution badge matches what the trace actually shows)`,
  );
  if (summary.judgeAvg !== null) {
    lines.push(`- LLM-as-judge itinerary quality (avg): **${summary.judgeAvg.toFixed(2)} / 5.00**, pass rate **${(summary.judgePassRate! * 100).toFixed(1)}%**`);
  }
  lines.push('');
  lines.push('| Case | Destination | Tools | Constraints | Halluc. | Wikivoyage | Judge | Time |');
  lines.push('|---|---|---:|---:|---:|---|---:|---:|');
  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.id} | ${r.destination} | — | — | — | — | — | FAILED: ${r.error} |`);
      continue;
    }
    const halluc = r.hallucination.verifiable ? `${(r.hallucination.rate * 100).toFixed(0)}%` : 'n/a';
    const wikivoyage = r.destinationContext.called
      ? `used (${r.destinationContext.successCount}/${r.destinationContext.calledCount} ok)`
      : 'not used';
    // Link straight to the full saved itinerary (coordinates, aiNote text,
    // full day plan) for manual review, not just the scores in this row.
    const caseLabel = r.itineraryFile ? `[${r.id}](${r.itineraryFile})` : r.id;
    lines.push(
      `| ${caseLabel} | ${r.destination} | ${r.toolCalls.score.toFixed(2)} | ${r.constraints.score.toFixed(2)} | ${halluc} | ${wikivoyage} | ${r.judge ? r.judge.weighted_total.toFixed(2) : '—'} | ${r.durationMs}ms |`,
    );
  }
  lines.push('');
  lines.push('## Issues by case');
  lines.push('');
  let anyIssues = false;
  for (const r of results) {
    const allIssues = [...r.toolCalls.issues, ...r.constraints.issues, ...r.destinationContext.issues];
    if (r.error) allIssues.push(`generation error: ${r.error}`);
    if (allIssues.length === 0) continue;
    anyIssues = true;
    lines.push(`**${r.id}**`);
    for (const issue of allIssues) lines.push(`- ${issue}`);
    lines.push('');
  }
  if (!anyIssues) lines.push('None.');
  return lines.join('\n');
}

function writeReports(results: CaseResult[], stamp: string) {
  const dir = path.join(process.cwd(), 'tests', 'eval', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const summary = buildSummary(results);
  const payload = JSON.stringify({ summary, results }, null, 2);
  const markdown = renderMarkdown(summary, results);

  fs.writeFileSync(path.join(dir, `report-${stamp}.json`), payload);
  fs.writeFileSync(path.join(dir, `report-${stamp}.md`), markdown);
  fs.writeFileSync(path.join(dir, 'latest.json'), payload);
  fs.writeFileSync(path.join(dir, 'latest.md'), markdown);

  console.log(`Reports written to tests/eval/reports/report-${stamp}.{json,md} (and latest.{json,md})`);
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
  lines.push(`Cases in this run: ${cases.length}${filterIds.length ? ` (EVAL_FILTER=${filterIds.join(',')})` : ''}`);
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
