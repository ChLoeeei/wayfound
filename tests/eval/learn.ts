/**
 * Experience-library learning loop (v2 Core 1, Training-Free GRPO). Offline;
 * the only writer of the library. TRAIN split only: refuses any test case.
 *
 *   npm run learn            # group method (best vs worst of 4 rollouts)
 *   npm run learn:single     # ReasoningBank-style ablation (1 rollout, no comparison)
 *
 * Per epoch, per training case (seeded order):
 *   1. Select lessons for the case from the current library; run the agent
 *      LEARN_ROLLOUTS times at LEARN_TEMPERATURE, each rollout getting a
 *      random half of those lessons (see learn-core lessonSubsets).
 *   2. Score each rollout with the harness reward (score-run.ts).
 *   3. Update helpful/harmful counters against the group mean.
 *   4. If all rewards are equal, skip: nothing to compare.
 *   5. Summarize the best and worst rollouts; compare them into 1-2 lessons.
 *   6. Drop lessons that name specific places (regex + LLM filter).
 *   7. Turn the rest into item-level ops (ADD/MODIFY/DELETE/KEEP) and apply.
 * After each epoch the library is snapshotted (library.<method>.epoch-N.json).
 *
 * Resumable: every scored rollout is cached under
 * tests/eval/reports/learn/<method>/, finished cases are recorded in
 * progress.json, and the same Geoapify daily budget guard as the eval
 * applies. Rerun the same command to continue. Network/API failures are
 * retried and never scored.
 *
 * Env: LEARN_METHOD (group|single), LEARN_EPOCHS (3), LEARN_MIN_GAP (0.02), LEARN_ROLLOUTS (4;
 * 1 for single), LEARN_TEMPERATURE (0.7), LEARN_FILTER (train case ids),
 * LEARN_LIBRARY (default server/experience/data/library.<method>.json),
 * EVAL_GEOAPIFY_DAILY_LIMIT (2700).
 */
import fs from 'fs';
import path from 'path';
import type OpenAI from 'openai';
import 'dotenv/config';
import { generateItinerary, type AgentStepRecord, type AgentUsage, type ToolCallRecord } from '../../server/agent';
import { createDeepSeekClient, isInfraError } from '../../server/llm';
import { geoapifyMeterSnapshot } from '../../server/tools/geoapify';
import { applyOps, loadLibrary, saveLibrary, snapshotLibrary, specificityViolation, updateCounters, type Library } from '../../server/experience/library';
import { regionOfDestination, renderLessonsBlock, selectLessons } from '../../server/experience/retrieve';
import {
  comparePrompt,
  filterPrompt,
  parseFilterVerdicts,
  parseLessons,
  parseOperations,
  singleRunPrompt,
  summarizePrompt,
  updatePrompt,
  type CaseInfo,
  type ProposedLesson,
  type RunRecord,
} from '../../server/experience/prompts';
import { allCases, type TaggedCase } from './cases';
import { scoreRun } from './score-run';
import { REWARD_VERSION } from './scoring';
import { addDailyUsage, budgetExhausted, readDailyUsage } from './progress';
import { bestAndWorst, isDegenerateGroup, lessonSubsets, seededShuffle, toRunRecord } from './learn-core';
import type { Itinerary } from '../../src/types';

const method = (process.env.LEARN_METHOD ?? 'group') as Library['method'];
if (method !== 'group' && method !== 'single') throw new Error(`LEARN_METHOD must be group or single (got ${method})`);
const epochs = Math.max(1, Number(process.env.LEARN_EPOCHS ?? 3));
const rollouts = method === 'single' ? 1 : Math.max(2, Number(process.env.LEARN_ROLLOUTS ?? 4));
const temperature = Number(process.env.LEARN_TEMPERATURE ?? 0.7);
const geoapifyDailyLimit = Math.floor(Number(process.env.EVAL_GEOAPIFY_DAILY_LIMIT ?? 2700)) || 2700;
const libraryFile = path.resolve(process.env.LEARN_LIBRARY ?? `server/experience/data/library.${method}.json`);
/**
 * Minimum best-minus-worst reward gap for a group to be learned from. The
 * plan only skips groups whose scores are all equal, but one judge point is
 * 0.004 reward, so nearly every group differs a little by noise alone; a
 * smoke run distilled two lessons from a 0.004 gap. 0.02 ≈ five judge points.
 */
const minGap = Math.max(0, Number(process.env.LEARN_MIN_GAP ?? 0.02));
const filterIds = (process.env.LEARN_FILTER ?? '').split(',').map(s => s.trim()).filter(Boolean);

const REPORTS_DIR = path.join(process.cwd(), 'tests', 'eval', 'reports');
const USAGE_FILE = path.join(REPORTS_DIR, 'geoapify-usage.json');
const learnDir = path.join(REPORTS_DIR, 'learn', path.basename(libraryFile, '.json'));
const rolloutDir = path.join(learnDir, 'rollouts');
const progressFile = path.join(learnDir, 'progress.json');
const logFile = path.join(learnDir, 'log.jsonl');

const RETRY_WAIT_MS = Math.max(0, Number(process.env.EVAL_LIMIT_RETRY_WAIT_MS ?? 60000));

// ---- Train split only ----
const trainCases = allCases.filter(c => c.split === 'train');
const cases: TaggedCase[] = filterIds.length ? allCases.filter(c => filterIds.includes(c.id)) : trainCases;
const leaked = cases.filter(c => c.split !== 'train');
if (leaked.length) {
  console.error(`Refusing to learn from non-train cases: ${leaked.map(c => c.id).join(', ')}. The library must never see the test split.`);
  process.exit(1);
}

interface Progress {
  method: Library['method'];
  rewardVersion: number;
  rollouts: number;
  temperature: number;
  minGap: number;
  /** epoch -> case ids whose learning step is done. */
  done: Record<string, string[]>;
}

interface StoredRollout {
  epoch: number;
  caseId: string;
  index: number;
  usedLessonIds: string[];
  record: RunRecord;
  usage: AgentUsage;
  judgeUsage: AgentUsage;
  geoapifyRequests: number;
  durationMs: number;
}

class StopError extends Error {}

const emptyUsage = (): AgentUsage => ({ promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, completions: 0 });
const llmUsage = emptyUsage();
let meterSeen = geoapifyMeterSnapshot().requests;
const flushUsage = () => {
  const now = geoapifyMeterSnapshot().requests;
  const u = addDailyUsage(USAGE_FILE, now - meterSeen);
  meterSeen = now;
  return u;
};
const limitEvents = () => {
  const m = geoapifyMeterSnapshot();
  return m.rateLimited + m.quotaErrors;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : fallback;
}
function writeJsonAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

function caseInfo(c: TaggedCase): CaseInfo {
  return {
    id: c.id,
    destination: c.destination,
    region: regionOfDestination(c.destination),
    days: c.days,
    people: c.people,
    preferences: c.preferences,
    groupType: c.groupType,
    budget: c.budget,
    specialNeeds: c.specialNeeds,
  };
}

/** One rollout: run + score. Network/API failures and Geoapify limits are retried, then stop the session (never scored). */
async function rollout(client: OpenAI, c: TaggedCase, lib: Library, usedIds: string[], epoch: number, index: number): Promise<StoredRollout> {
  const lessons = lib.lessons.filter(l => usedIds.includes(l.id));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const usage = flushUsage();
    if (budgetExhausted(usage, geoapifyDailyLimit)) throw new StopError(`Geoapify daily budget reached (${usage.requests}/${geoapifyDailyLimit} on ${usage.date} UTC)`);
    const trace: ToolCallRecord[] = [];
    const stepTrace: AgentStepRecord[] = [];
    const agentUsage = emptyUsage();
    const judgeUsage = emptyUsage();
    const geoBefore = geoapifyMeterSnapshot().requests;
    const limitBefore = limitEvents();
    const start = Date.now();
    let infra: string | null = null;
    let record: RunRecord;
    try {
      const itinerary = (await generateItinerary(
        { destination: c.destination, days: c.days, people: c.people, preferences: c.preferences, groupType: c.groupType, budget: c.budget, specialNeeds: c.specialNeeds },
        { client, trace, stepTrace, usage: agentUsage, temperature, lessons: lessons.length ? { block: renderLessonsBlock(lessons), ids: usedIds } : undefined },
      )) as Itinerary;
      const scores = await scoreRun({ c, trace, itinerary, client, judgeUsage });
      if (scores.judgeInfraError) infra = scores.judgeInfraError;
      record = toRunRecord({ run: index, trace, steps: stepTrace.filter(s => !s.segment).length, usedLessonIds: usedIds, scores });
    } catch (err: any) {
      if (isInfraError(err)) infra = err.message ?? String(err);
      record = toRunRecord({ run: index, trace, steps: stepTrace.filter(s => !s.segment).length, usedLessonIds: usedIds, error: err?.message ?? String(err) });
    }
    flushUsage();
    const limited = limitEvents() > limitBefore;
    if (!infra && !limited) {
      return { epoch, caseId: c.id, index, usedLessonIds: usedIds, record, usage: agentUsage, judgeUsage, geoapifyRequests: geoapifyMeterSnapshot().requests - geoBefore, durationMs: Date.now() - start };
    }
    const why = limited ? 'Geoapify 429/quota error' : `network/API error: ${infra!.slice(0, 100)}`;
    if (attempt === 3) throw new StopError(`${c.id} rollout ${index}: ${why} on 3 attempts`);
    console.log(`    ✗ INVALID (${why}) — discarded, retrying in ${Math.round((RETRY_WAIT_MS * attempt) / 1000)}s`);
    await sleep(RETRY_WAIT_MS * attempt);
  }
  throw new StopError('unreachable');
}

/** A learning-side LLM call (summarize / compare / filter / update), retried on network errors. */
async function chat(client: OpenAI, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], json: boolean): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages,
        temperature: 0.3,
        max_tokens: 2000,
        ...(json ? { response_format: { type: 'json_object' as const } } : {}),
      });
      llmUsage.completions++;
      llmUsage.promptTokens += r.usage?.prompt_tokens ?? 0;
      llmUsage.cachedPromptTokens = (llmUsage.cachedPromptTokens ?? 0) + ((r.usage as any)?.prompt_cache_hit_tokens ?? 0);
      llmUsage.completionTokens += r.usage?.completion_tokens ?? 0;
      return r.choices[0]?.message?.content ?? '';
    } catch (err: any) {
      if (!isInfraError(err) || attempt === 3) {
        if (isInfraError(err)) throw new StopError(`learning LLM call failed 3 times: ${err.message}`);
        throw err;
      }
      await sleep(RETRY_WAIT_MS * attempt);
    }
  }
  return '';
}

/** Regex guard first, then the LLM filter; returns kept lessons and rejections with reasons. */
async function filterSpecific(client: OpenAI, proposed: ProposedLesson[]) {
  const rejected: Array<{ lesson: string; reason: string }> = [];
  const pre = proposed.filter(l => {
    const v = specificityViolation(l.lesson);
    if (v) rejected.push({ lesson: l.lesson, reason: `regex: ${v}` });
    return !v;
  });
  if (pre.length === 0) return { kept: [], rejected };
  const specific = parseFilterVerdicts(await chat(client, filterPrompt(pre.map(l => l.lesson)), true), pre.length);
  const kept = pre.filter((l, i) => {
    if (specific.has(i)) rejected.push({ lesson: l.lesson, reason: 'LLM filter: names something specific' });
    return !specific.has(i);
  });
  return { kept, rejected };
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY is not set.');
    process.exit(1);
  }
  const client = createDeepSeekClient();
  fs.mkdirSync(rolloutDir, { recursive: true });

  const progress = readJson<Progress>(progressFile, { method, rewardVersion: REWARD_VERSION, rollouts, temperature, minGap, done: {} });
  if (progress.method !== method || progress.rewardVersion !== REWARD_VERSION || progress.rollouts !== rollouts || progress.temperature !== temperature || progress.minGap !== minGap) {
    console.error(`Refusing to resume ${learnDir}: it was started with method=${progress.method} reward v${progress.rewardVersion} rollouts=${progress.rollouts} temperature=${progress.temperature} minGap=${progress.minGap}. Use a different LEARN_LIBRARY to start a separate run.`);
    process.exit(1);
  }
  let lib = loadLibrary(libraryFile, method);
  if (lib.method !== method) throw new Error(`${libraryFile} is a ${lib.method}-method library`);

  const total = epochs * cases.length;
  const doneCount = Object.values(progress.done).reduce((n, ids) => n + ids.filter(id => cases.some(c => c.id === id)).length, 0);
  console.log(`\nLearning (${method}): ${cases.length} train case(s) × ${rollouts} rollout(s) × ${epochs} epoch(s), temperature ${temperature}, reward v${REWARD_VERSION}`);
  console.log(`Library: ${path.relative(process.cwd(), libraryFile)} (v${lib.libraryVersion}, ${lib.lessons.length} lesson(s)); ${doneCount}/${total} case-epoch(s) already done`);
  console.log(`Geoapify today: ${readDailyUsage(USAGE_FILE).requests}/${geoapifyDailyLimit}\n`);

  try {
    for (let epoch = 1; epoch <= epochs; epoch++) {
      const doneIds = new Set(progress.done[String(epoch)] ?? []);
      if (cases.every(c => doneIds.has(c.id))) {
        if (lib.epoch < epoch) lib = { ...lib, epoch };
        continue;
      }
      console.log(`--- epoch ${epoch}/${epochs} ---`);
      lib = { ...lib, epoch };
      for (const c of seededShuffle(cases, `epoch-${epoch}`)) {
        if (doneIds.has(c.id)) continue;
        const region = regionOfDestination(c.destination);
        const candidates = selectLessons(lib, { region });
        const subsets = method === 'single' ? [candidates.map(l => l.id)] : lessonSubsets(candidates, rollouts, `${epoch}:${c.id}`);
        process.stdout.write(`  ${c.id} (${c.destination} ${c.days}d) — ${candidates.length} candidate lesson(s): `);

        const runs: StoredRollout[] = [];
        for (let i = 0; i < rollouts; i++) {
          const file = path.join(rolloutDir, `e${epoch}-${c.id}-${i}.json`);
          let r = readJson<StoredRollout | null>(file, null);
          if (!r) {
            r = await rollout(client, c, lib, subsets[i], epoch, i);
            writeJsonAtomic(file, r);
          }
          runs.push(r);
          process.stdout.write(`${r.record.failed ? 'FAIL' : r.record.reward.toFixed(3)} `);
        }
        const rewards = runs.map(r => r.record.reward);
        const groupMean = rewards.reduce((s, x) => s + x, 0) / rewards.length;
        const entry: Record<string, unknown> = { at: new Date().toISOString(), epoch, caseId: c.id, region, rewards, groupMean, lessonsPerRollout: runs.map(r => r.usedLessonIds) };

        // 3. Counters (group method only).
        if (method === 'group') for (const r of runs) lib = updateCounters(lib, r.usedLessonIds, r.record.reward, groupMean);

        // 4-7. Distil and apply.
        const info = caseInfo(c);
        let proposed: ProposedLesson[] = [];
        if (method === 'group') {
          if (isDegenerateGroup(rewards, minGap)) {
            entry.skipped = `best - worst reward gap <= ${minGap} (noise)`;
          } else {
            const { best, worst } = bestAndWorst(runs.map(r => r.record));
            const [bestSummary, worstSummary] = [await chat(client, summarizePrompt(info, best), false), await chat(client, summarizePrompt(info, worst), false)];
            proposed = parseLessons(await chat(client, comparePrompt(info, { summary: bestSummary, reward: best.reward }, { summary: worstSummary, reward: worst.reward }, lib.lessons), true));
            entry.best = { run: best.run, reward: best.reward, summary: bestSummary };
            entry.worst = { run: worst.run, reward: worst.reward, summary: worstSummary };
          }
        } else {
          const only = runs[0].record;
          const summary = await chat(client, summarizePrompt(info, only), false);
          proposed = parseLessons(await chat(client, singleRunPrompt(info, { summary, reward: only.reward }, lib.lessons), true));
          entry.summary = summary;
        }
        entry.proposed = proposed;
        if (proposed.length) {
          const { kept, rejected } = await filterSpecific(client, proposed);
          entry.filteredOut = rejected;
          if (kept.length) {
            const ops = parseOperations(await chat(client, updatePrompt(kept, lib.lessons), true));
            const result = applyOps(lib, ops, { epoch, sourceCase: c.id });
            lib = result.library;
            entry.applied = result.applied;
            entry.rejected = result.rejected;
          }
        }

        // Mark done before saving the library: a crash in between loses one update rather than applying it twice.
        progress.done[String(epoch)] = [...(progress.done[String(epoch)] ?? []), c.id];
        writeJsonAtomic(progressFile, progress);
        lib = saveLibrary(libraryFile, lib);
        entry.libraryVersion = lib.libraryVersion;
        entry.lessonCount = lib.lessons.length;
        fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
        const applied = ((entry.applied as unknown[]) ?? []).filter((o: any) => o.op !== 'KEEP').length;
        console.log(`| mean ${groupMean.toFixed(3)}${entry.skipped ? ' (no signal, skipped)' : ''} | +${applied} op(s) → ${lib.lessons.length} lesson(s)`);
      }
      const snap = snapshotLibrary(libraryFile, lib, `epoch-${epoch}`);
      console.log(`Epoch ${epoch} done: ${lib.lessons.length} lesson(s); snapshot ${path.relative(process.cwd(), snap)}\n`);
    }
    console.log('Learning complete.');
  } catch (err) {
    if (!(err instanceof StopError)) throw err;
    console.log(`\nSTOPPED: ${err.message}. Progress saved; rerun the same command to continue.`);
    process.exitCode = 2;
  } finally {
    const g = geoapifyMeterSnapshot();
    console.log(`Learning-side LLM calls: ${llmUsage.completions} (${llmUsage.promptTokens} prompt / ${llmUsage.completionTokens} completion tokens). Geoapify this session: ${g.requests}; today ${readDailyUsage(USAGE_FILE).requests}/${geoapifyDailyLimit}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
