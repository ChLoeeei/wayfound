/**
 * Partial-replanning eval (v2 feature C). Calls DeepSeek and the map
 * providers; ask before running.
 *
 *   npm run eval:edit
 *   EDIT_EVAL_FILTER=kyoto-add-matcha npm run eval:edit
 *
 * Per case: parse the message (1 small call), compare with `expect`; unless
 * the plan is unclear, replan with it (tool loop for replace/add, none for
 * remove/move) and record: the outcome, preservation of untouched stops on
 * the model's raw answer (target 100%), the applied result's checks, model
 * calls, tokens and time. For reference, the cost of regenerating the whole
 * base itinerary is read from the committed result file the fixtures came
 * from.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createDeepSeekClient } from '../../server/llm';
import { parseEdit } from '../../server/editParse';
import { replanItinerary } from '../../server/replan';
import type { AgentStepRecord, AgentUsage, ToolCallRecord } from '../../server/agent';
import { geoapifyMeterSnapshot } from '../../server/tools/geoapify';
import { editCases, evaluateEditChecks, loadFixture, planMatches, preservationRate, type EditCheckResult } from './edit-eval-lib';

const filter = (process.env.EDIT_EVAL_FILTER ?? '').split(',').map(s => s.trim()).filter(Boolean);
const cases = editCases.filter(c => filter.length === 0 || filter.includes(c.id));
const REPORTS_DIR = path.join(process.cwd(), 'tests', 'eval', 'reports');
const FULL_RUN_REFERENCE = { file: 'tests/eval/results/group-lessons-test-2026-11-12T00-44-18-991Z.json', repeat: 3, caseIds: { tokyo: 'tokyo-family-food-culture', kyoto: 'kyoto-couple-culture-nature', hefei: 'hefei-couple-leisure-food' } as const };

const emptyUsage = (): AgentUsage => ({ promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, completions: 0 });

function metered(client: ReturnType<typeof createDeepSeekClient>, acc: AgentUsage) {
  const create = client.chat.completions.create.bind(client.chat.completions);
  return {
    chat: {
      completions: {
        create: async (params: any) => {
          const res: any = await create(params);
          acc.promptTokens += res.usage?.prompt_tokens ?? 0;
          acc.completionTokens += res.usage?.completion_tokens ?? 0;
          acc.completions += 1;
          return res;
        },
      },
    },
  } as unknown as ReturnType<typeof createDeepSeekClient>;
}

async function main() {
  const client = createDeepSeekClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(REPORTS_DIR, 'itineraries'), { recursive: true });
  const reference = JSON.parse(fs.readFileSync(FULL_RUN_REFERENCE.file, 'utf8')).runs as Array<{ caseId: string; repeat: number; promptTokens: number; completionTokens: number; durationMs: number; steps: number }>;
  const records: any[] = [];
  console.log(`Edit eval: ${cases.length} case(s)\n`);

  for (const c of cases) {
    const before = loadFixture(c.fixture, c.locks);
    const usage = emptyUsage();
    const start = Date.now();
    const geoBefore = geoapifyMeterSnapshot().requests;
    process.stdout.write(`${c.id}\n  parse ... `);
    const plan = await parseEdit(metered(client, usage), before, c.message, c.language, c.activeDay);
    const match = planMatches(plan, c.expect);
    console.log(`${plan.intent} ${JSON.stringify(plan.targetSlots)} keep=${JSON.stringify(plan.keep)} → intent ${match.intent ? 'ok' : 'WRONG'}, target ${match.target ? 'ok' : 'WRONG'}${plan.question ? ` (question: ${plan.question})` : ''}`);

    const rec: any = { id: c.id, fixture: c.fixture, message: c.message, plan, parse: match, expectResult: c.expectResult };
    if (plan.intent !== 'unclear') {
      const trace: ToolCallRecord[] = [];
      const stepTrace: AgentStepRecord[] = [];
      const candidates: Array<{ attempt: number; preservation: ReturnType<typeof preservationRate>; issues: string[] }> = [];
      process.stdout.write(`  replan ... `);
      const result = await replanItinerary(
        { itinerary: before, plan, language: c.language, avoid: c.avoid ?? [], budgetCap: c.budgetCap },
        {
          client: metered(client, usage),
          trace,
          stepTrace,
          onCandidate: ({ attempt, candidate, validation }) => candidates.push({ attempt, preservation: preservationRate(before, candidate, plan.targetSlots), issues: validation.issues }),
        },
      );
      rec.result = result.ok ? { ok: true, attempt: result.attempt, modelCalled: result.modelCalled, changed: result.changedPlaceIds.length, removed: result.removedPlaceIds.length } : result;
      rec.candidates = candidates;
      rec.toolCalls = trace.length;
      rec.steps = stepTrace.length;
      if (result.ok) {
        rec.preservationApplied = preservationRate(before, result.itinerary, plan.targetSlots);
        rec.checks = evaluateEditChecks(before, result.itinerary, c.checks ?? []);
        fs.writeFileSync(path.join(REPORTS_DIR, 'itineraries', `edit-${c.id}.json`), JSON.stringify(result.itinerary, null, 2));
      }
      const outcome = 'reason' in result ? result.reason : 'ok';
      rec.outcomeMatches = outcome === c.expectResult;
      const checkText = (rec.checks as EditCheckResult[] | undefined)?.map(r => `${r.check.type}:${r.pass ? 'ok' : 'FAIL'} ${r.detail}`).join('; ');
      console.log(
        `${outcome}${rec.outcomeMatches ? '' : ' (expected ' + c.expectResult + ')'}${result.ok ? ` attempt ${result.attempt}, ${result.changedPlaceIds.length} changed` : ` ${JSON.stringify(result)}`}` +
          (candidates.length ? ` | raw preservation ${candidates.map(x => `${(x.preservation.rate * 100).toFixed(0)}%`).join(' → ')}` : '') +
          (checkText ? ` | ${checkText}` : ''),
      );
    } else {
      rec.outcomeMatches = c.expectResult === 'none';
    }
    rec.promptTokens = usage.promptTokens;
    rec.completionTokens = usage.completionTokens;
    rec.completions = usage.completions;
    rec.durationMs = Date.now() - start;
    rec.geoapifyRequests = geoapifyMeterSnapshot().requests - geoBefore;
    const ref = reference.find(r => r.caseId === FULL_RUN_REFERENCE.caseIds[c.fixture] && r.repeat === FULL_RUN_REFERENCE.repeat);
    rec.fullRegeneration = ref ? { promptTokens: ref.promptTokens, completionTokens: ref.completionTokens, durationMs: ref.durationMs, steps: ref.steps } : null;
    records.push(rec);
  }

  const withModel = records.filter(r => r.result?.ok && r.result.modelCalled);
  const rawFirst = records.flatMap(r => (r.candidates ?? []).filter((x: any) => x.attempt === 1).map((x: any) => x.preservation.rate));
  const rawLast = records.filter(r => r.candidates?.length).map(r => r.candidates[r.candidates.length - 1].preservation.rate);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const summary = {
    cases: records.length,
    parseIntentAccuracy: mean(records.map(r => (r.parse.intent ? 1 : 0))),
    parseTargetAccuracy: mean(records.map(r => (r.parse.target ? 1 : 0))),
    outcomeAccuracy: mean(records.map(r => (r.outcomeMatches ? 1 : 0))),
    editSuccess: mean(records.filter(r => r.expectResult === 'ok').map(r => (r.result?.ok ? 1 : 0))),
    checkPassRate: mean(records.flatMap(r => (r.checks ?? []).map((x: any) => (x.pass ? 1 : 0)))),
    rawPreservationFirstAttempt: mean(rawFirst),
    rawPreservationLastAttempt: mean(rawLast),
    appliedPreservation: mean(records.filter(r => r.preservationApplied).map(r => r.preservationApplied.rate)),
    meanPromptTokensWithModel: mean(withModel.map(r => r.promptTokens)),
    meanDurationMsWithModel: mean(withModel.map(r => r.durationMs)),
    meanFullRegenerationPromptTokens: mean(records.filter(r => r.fullRegeneration).map(r => r.fullRegeneration.promptTokens)),
    meanFullRegenerationDurationMs: mean(records.filter(r => r.fullRegeneration).map(r => r.fullRegeneration.durationMs)),
    geoapifyRequests: records.reduce((s, r) => s + r.geoapifyRequests, 0),
  };
  const out = path.join(REPORTS_DIR, `edit-eval-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ stamp, summary, records }, null, 2));
  console.log('\n' + JSON.stringify(summary, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
