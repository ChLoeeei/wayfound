/**
 * Two-stage memory eval (v2 feature A). Calls the live DeepSeek API and the
 * real map providers, so it costs tokens and Geoapify requests; ask before
 * running it.
 *
 *   npm run eval:memory                      # all cases
 *   MEMORY_EVAL_FILTER=en-packed-pace npm run eval:memory
 *   MEMORY_EVAL_SKIP_CONTROL=1 npm run eval:memory   # no library-of-nothing control run
 *
 * Per case:
 *   stage 1  the user's free text -> POST-equivalent extractPreferences()
 *            scored for recall of the expected statements and for inferred
 *            items (target 0).
 *   stage 2  (when present) a later trip planned twice: with the memory
 *            built from stage 1 folded into the prompt (buildMemoryPromptContext,
 *            same path as the UI) and, as a control, without it. The case's
 *            deterministic checks give an adherence rate for each.
 *
 * Writes tests/eval/reports/memory-eval-<stamp>.json and prints a table.
 * The agent itself is unchanged: memory only adds the same user-prompt block
 * the UI adds, and the eval harness in run-eval.ts never sets it.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createDeepSeekClient } from '../../server/llm';
import { extractPreferences } from '../../server/preferences';
import { generateItinerary, type ToolCallRecord, type AgentStepRecord, type AgentUsage } from '../../server/agent';
import { geoapifyMeterSnapshot } from '../../server/tools/geoapify';
import { applyExtractedPreferences, buildMemoryPromptContext, emptyMemory } from '../../src/lib/memory';
import type { Itinerary, Vibe } from '../../src/types';
import { adherence, evaluateChecks, memoryCases, scoreExtraction, type CheckResult, type ExtractionScore, type MemoryCase } from './memory-eval-lib';
import { ungroundedPlaceNames } from '../../server/grounding';

const filter = (process.env.MEMORY_EVAL_FILTER ?? '').split(',').map(s => s.trim()).filter(Boolean);
const skipControl = process.env.MEMORY_EVAL_SKIP_CONTROL === '1';
const cases = memoryCases.filter(c => filter.length === 0 || filter.includes(c.id));
const REPORTS_DIR = path.join(process.cwd(), 'tests', 'eval', 'reports');

interface RunRecord {
  memoryContext: string | null;
  steps: number;
  promptTokens: number;
  completionTokens: number;
  geoapifyRequests: number;
  durationMs: number;
  places: number;
  ungrounded: number;
  checks: CheckResult[];
  adherence: number;
  error?: string;
}
interface CaseRecord {
  id: string;
  extraction: { items: unknown[]; dropped: number; score: ExtractionScore; promptTokens: number; completionTokens: number };
  memoryContext: string;
  withMemory?: RunRecord;
  withoutMemory?: RunRecord;
}

const emptyUsage = (): AgentUsage => ({ promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, completions: 0 });

async function planOnce(c: MemoryCase, client: ReturnType<typeof createDeepSeekClient>, memoryContext: string | null): Promise<RunRecord> {
  const trace: ToolCallRecord[] = [];
  const stepTrace: AgentStepRecord[] = [];
  const usage = emptyUsage();
  const before = geoapifyMeterSnapshot().requests;
  const start = Date.now();
  const s2 = c.stage2!;
  try {
    const itinerary = (await generateItinerary(
      {
        destination: s2.destination,
        days: s2.days,
        people: s2.people,
        preferences: s2.preferences,
        groupType: s2.groupType,
        budget: s2.budget,
        specialNeeds: s2.specialNeeds,
        ...(memoryContext ? { memoryContext } : {}),
      },
      { client, trace, stepTrace, usage },
    )) as Itinerary;
    const checks = evaluateChecks(itinerary, c.checks ?? []);
    const places = itinerary.days.flatMap(d => d.slots.flatMap(s => s.places)).length;
    fs.writeFileSync(path.join(REPORTS_DIR, 'itineraries', `memory-${c.id}-${memoryContext ? 'with' : 'without'}.json`), JSON.stringify(itinerary, null, 2));
    return {
      memoryContext,
      steps: stepTrace.filter(s => !s.segment).length,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      geoapifyRequests: geoapifyMeterSnapshot().requests - before,
      durationMs: Date.now() - start,
      places,
      ungrounded: ungroundedPlaceNames(trace, itinerary).length,
      checks,
      adherence: adherence(checks),
    };
  } catch (err: any) {
    return {
      memoryContext,
      steps: stepTrace.length,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      geoapifyRequests: geoapifyMeterSnapshot().requests - before,
      durationMs: Date.now() - start,
      places: 0,
      ungrounded: 0,
      checks: [],
      adherence: 0,
      error: err?.message ?? String(err),
    };
  }
}

async function main() {
  const client = createDeepSeekClient();
  fs.mkdirSync(path.join(REPORTS_DIR, 'itineraries'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const records: CaseRecord[] = [];
  console.log(`Memory eval: ${cases.length} case(s), ${cases.filter(c => c.stage2).length} with a stage 2${skipControl ? ' (no control runs)' : ''}\n`);

  for (const c of cases) {
    process.stdout.write(`${c.id}\n  stage 1 ... `);
    const usageBefore = emptyUsage();
    const extraction = await extractPreferences(
      wrapUsage(client, usageBefore),
      c.stage1.texts,
      c.stage1.language,
    );
    const score = scoreExtraction(extraction, c.stage1);
    console.log(`found ${score.found}/${score.expected}, inferred ${score.inferred}${score.missing.length ? ` (missing: ${score.missing.join(', ')})` : ''}${score.inferredItems.length ? ` (inferred: ${score.inferredItems.join(', ')})` : ''}`);
    const memory = applyExtractedPreferences(emptyMemory(), { ...extraction.preferences, interests: extraction.preferences.interests as Vibe[] | undefined });
    const memoryContext = buildMemoryPromptContext(memory, c.stage2?.destination);
    const rec: CaseRecord = {
      id: c.id,
      extraction: { items: extraction.items, dropped: extraction.dropped, score, promptTokens: usageBefore.promptTokens, completionTokens: usageBefore.completionTokens },
      memoryContext,
    };
    if (c.stage2) {
      process.stdout.write(`  stage 2 with memory ... `);
      rec.withMemory = await planOnce(c, client, memoryContext || null);
      console.log(rec.withMemory.error ? `ERROR ${rec.withMemory.error}` : `adherence ${(rec.withMemory.adherence * 100).toFixed(0)}% (${rec.withMemory.checks.map(r => `${r.check.type}:${r.pass ? 'ok' : 'FAIL'} ${r.detail}`).join('; ')})`);
      if (!skipControl) {
        process.stdout.write(`  stage 2 without memory ... `);
        rec.withoutMemory = await planOnce(c, client, null);
        console.log(rec.withoutMemory.error ? `ERROR ${rec.withoutMemory.error}` : `adherence ${(rec.withoutMemory.adherence * 100).toFixed(0)}% (${rec.withoutMemory.checks.map(r => `${r.check.type}:${r.pass ? 'ok' : 'FAIL'} ${r.detail}`).join('; ')})`);
      }
    }
    records.push(rec);
  }

  const ex = records.map(r => r.extraction.score);
  const expected = ex.reduce((s, x) => s + x.expected, 0);
  const found = ex.reduce((s, x) => s + x.found, 0);
  const inferred = ex.reduce((s, x) => s + x.inferred, 0);
  const withRuns = records.map(r => r.withMemory).filter((r): r is RunRecord => !!r && !r.error);
  const withoutRuns = records.map(r => r.withoutMemory).filter((r): r is RunRecord => !!r && !r.error);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const summary = {
    cases: records.length,
    extraction: { expected, found, recall: expected ? found / expected : 1, inferred },
    adherenceWithMemory: mean(withRuns.map(r => r.adherence)),
    adherenceWithoutMemory: mean(withoutRuns.map(r => r.adherence)),
    runs: { withMemory: withRuns.length, withoutMemory: withoutRuns.length },
    promptTokens: records.reduce((s, r) => s + (r.withMemory?.promptTokens ?? 0) + (r.withoutMemory?.promptTokens ?? 0) + r.extraction.promptTokens, 0),
    geoapifyRequests: records.reduce((s, r) => s + (r.withMemory?.geoapifyRequests ?? 0) + (r.withoutMemory?.geoapifyRequests ?? 0), 0),
  };
  const out = path.join(REPORTS_DIR, `memory-eval-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ stamp, summary, records }, null, 2));
  console.log(`\nExtraction recall ${found}/${expected}, inferred items ${inferred} (target 0)`);
  console.log(`Adherence with memory ${(summary.adherenceWithMemory * 100).toFixed(0)}% vs without ${(summary.adherenceWithoutMemory * 100).toFixed(0)}% (${withRuns.length} / ${withoutRuns.length} runs)`);
  console.log(`Prompt tokens ${summary.promptTokens}, Geoapify requests ${summary.geoapifyRequests}`);
  console.log(`Wrote ${out}`);
}

/** Counts the extraction call's tokens without touching the shared client. */
function wrapUsage(client: ReturnType<typeof createDeepSeekClient>, acc: AgentUsage) {
  const create = client.chat.completions.create.bind(client.chat.completions);
  return {
    chat: {
      completions: {
        create: async (params: any) => {
          const res: any = await create(params);
          acc.promptTokens += res.usage?.prompt_tokens ?? 0;
          acc.completionTokens += res.usage?.completion_tokens ?? 0;
          return res;
        },
      },
    },
  } as unknown as ReturnType<typeof createDeepSeekClient>;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
