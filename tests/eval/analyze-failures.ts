/**
 * Failure analysis over one checkpoint: classifies every run that lost
 * reward and says where the loss came from, so new hard cases (and the
 * learning loop) target real failure types rather than guesses.
 *
 *   npx tsx tests/eval/analyze-failures.ts <checkpoint-dir> [--out file.md]
 *
 * Categories (a run can have several):
 *   generation-failed   no itinerary at all (JSON truncation, segmented parse, other)
 *   ungrounded          ≥ 20% of places not traceable to a search result
 *   budget              < 70% of priced places within the budget band
 *   special-needs       a stated special need not reflected anywhere
 *   day-count / schema  wrong number of days or schema errors
 *   tool-errors         tool calls that errored, or referenced unknown POI ids
 *   provider-degraded   map provider still failing after reruns
 *   judge-low           LLM-judge < 3.8 (lowest rubric dimension named)
 *
 * Reward loss is attributed per term against the reward ceiling (0.8): the
 * table shows which term costs the most in total, i.e. where headroom is.
 */
import fs from 'fs';
import path from 'path';
import { allCases, isHardCase } from './cases';
import { REWARD_WEIGHTS } from './scoring';

const dir = process.argv[2];
const outIdx = process.argv.indexOf('--out');
const out = outIdx > 0 ? process.argv[outIdx + 1] : undefined;
if (!dir || !fs.existsSync(path.join(dir, 'runs'))) {
  console.error('Usage: npx tsx tests/eval/analyze-failures.ts <checkpoint-dir> [--out file.md]');
  process.exit(1);
}

const caseById = new Map(allCases.map(c => [c.id, c]));
const runs: any[] = fs
  .readdirSync(path.join(dir, 'runs'))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(dir, 'runs', f), 'utf8')))
  .filter(r => caseById.has(r.id));

const JUDGE_LOW = 3.8;
const UNGROUNDED = 0.2;

function failureKind(err: string): string {
  if (/Unterminated string|Unexpected end of JSON/i.test(err)) return 'truncated JSON';
  if (/Segmented generation/i.test(err)) return 'segmented parse';
  if (/JSON/i.test(err)) return 'malformed JSON';
  return 'other';
}

interface Tagged {
  run: any;
  tags: string[];
  detail: string[];
  loss: Record<'tool' | 'constraint' | 'judge' | 'halluc', number>;
}

const tagged: Tagged[] = runs.map(r => {
  const tags: string[] = [];
  const detail: string[] = [];
  const loss = { tool: 0, constraint: 0, judge: 0, halluc: 0 };
  if (r.error) {
    tags.push('generation-failed');
    detail.push(`${failureKind(r.error)}: ${String(r.error).slice(0, 90)}`);
    loss.tool = REWARD_WEIGHTS.toolCorrect;
    loss.constraint = REWARD_WEIGHTS.constraint;
    loss.judge = REWARD_WEIGHTS.judge;
    loss.halluc = REWARD_WEIGHTS.hallucination;
    return { run: r, tags, detail, loss };
  }
  loss.tool = REWARD_WEIGHTS.toolCorrect * (1 - r.toolCalls.score);
  loss.constraint = REWARD_WEIGHTS.constraint * (1 - r.constraints.score);
  loss.judge = r.judge ? REWARD_WEIGHTS.judge * (1 - r.judge.weighted_total / 5) : 0;
  loss.halluc = REWARD_WEIGHTS.hallucination * r.hallucination.rate;
  if (r.hallucination.rate >= UNGROUNDED) {
    tags.push('ungrounded');
    detail.push(`${r.hallucination.unverifiedPlaceNames.length}/${r.hallucination.totalPlaces} places ungrounded (e.g. ${r.hallucination.unverifiedPlaceNames.slice(0, 3).join(', ')})`);
  }
  if (r.constraints.budgetAdherence < 0.7) { tags.push('budget'); detail.push(`budget adherence ${(r.constraints.budgetAdherence * 100).toFixed(0)}%`); }
  if (r.constraints.specialNeedsAddressed < 1) { tags.push('special-needs'); detail.push(`special needs addressed ${(r.constraints.specialNeedsAddressed * 100).toFixed(0)}%`); }
  if (!r.constraints.dayCountMatches) tags.push('day-count');
  if (!r.constraints.schemaValid) tags.push('schema');
  if (r.toolCalls.errorCalls > 0 || r.toolCalls.invalidPoiRefs > 0) {
    tags.push('tool-errors');
    detail.push(`${r.toolCalls.errorCalls}/${r.toolCalls.totalCalls} tool calls errored, ${r.toolCalls.invalidPoiRefs} unknown POI id ref(s)`);
  }
  if (r.degraded) tags.push('provider-degraded');
  if (r.judge && r.judge.weighted_total < JUDGE_LOW) {
    const dims = Object.entries(r.judge.scores as Record<string, { score: number }>).sort((a, b) => a[1].score - b[1].score);
    tags.push('judge-low');
    detail.push(`judge ${r.judge.weighted_total}, lowest: ${dims.slice(0, 2).map(([k, v]) => `${k}=${v.score}`).join(', ')}`);
  }
  return { run: r, tags, detail, loss };
});

const lines: string[] = [];
const caseCount = new Set(runs.map(r => r.id)).size;
lines.push(`# Failure analysis: ${path.basename(dir)}`, '');
lines.push(`${runs.length} runs over ${caseCount} cases. Reward ceiling is ${(REWARD_WEIGHTS.toolCorrect + REWARD_WEIGHTS.constraint + REWARD_WEIGHTS.judge).toFixed(1)}; "loss" is how far below it a term pulled the reward.`, '');

// 1. Where the reward goes.
const sumLoss = (k: keyof Tagged['loss'], f: (t: Tagged) => boolean = () => true) => tagged.filter(f).reduce((s, t) => s + t.loss[k], 0) / Math.max(1, tagged.filter(f).length);
lines.push('## Average reward loss per run, by term', '');
lines.push('| Term | Overall | Domestic | International |', '|---|---:|---:|---:|');
for (const [label, k] of [['Hallucination (0.5 × rate)', 'halluc'], ['Tool correctness', 'tool'], ['Constraints', 'constraint'], ['Judge', 'judge']] as const) {
  lines.push(`| ${label} | ${sumLoss(k).toFixed(3)} | ${sumLoss(k, t => t.run.region === 'domestic').toFixed(3)} | ${sumLoss(k, t => t.run.region === 'international').toFixed(3)} |`);
}
lines.push('');

// 2. Category counts.
const cats = ['generation-failed', 'ungrounded', 'budget', 'special-needs', 'day-count', 'schema', 'tool-errors', 'provider-degraded', 'judge-low'];
lines.push('## Runs per failure category', '');
lines.push('| Category | Runs | Domestic | International | Cases |', '|---|---:|---:|---:|---|');
for (const c of cats) {
  const ts = tagged.filter(t => t.tags.includes(c));
  if (!ts.length) continue;
  const ids = [...new Set(ts.map(t => t.run.id))];
  lines.push(`| ${c} | ${ts.length} | ${ts.filter(t => t.run.region === 'domestic').length} | ${ts.filter(t => t.run.region === 'international').length} | ${ids.join(', ')} |`);
}
lines.push('');

// 3. Judge dimensions across all judged runs.
const dimTotals = new Map<string, number[]>();
for (const r of runs) for (const [k, v] of Object.entries((r.judge?.scores ?? {}) as Record<string, { score: number }>)) dimTotals.set(k, [...(dimTotals.get(k) ?? []), v.score]);
if (dimTotals.size) {
  lines.push('## LLM-judge dimensions (mean over judged runs, weakest first)', '');
  lines.push('| Dimension | Mean |', '|---|---:|');
  for (const [k, v] of [...dimTotals].sort((a, b) => a[1].reduce((s, x) => s + x, 0) / a[1].length - b[1].reduce((s, x) => s + x, 0) / b[1].length)) {
    lines.push(`| ${k} | ${(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2)} |`);
  }
  lines.push('');
}

// 4. Per case, worst first.
lines.push('## Per case (mean reward over repeats, worst first)', '');
lines.push('| Case | Region | Days | Rewards | Mean | Issues |', '|---|---|---:|---|---:|---|');
const byCase = new Map<string, Tagged[]>();
for (const t of tagged) byCase.set(t.run.id, [...(byCase.get(t.run.id) ?? []), t]);
const caseRows = [...byCase].map(([id, ts]) => ({ id, ts: ts.sort((a, b) => a.run.repeat - b.run.repeat), mean: ts.reduce((s, t) => s + t.run.reward.value, 0) / ts.length }));
for (const { id, ts, mean } of caseRows.sort((a, b) => a.mean - b.mean)) {
  const c = caseById.get(id)!;
  const tags = [...new Set(ts.flatMap(t => t.tags))];
  lines.push(`| ${id}${isHardCase(c) ? ' (hard)' : ''} | ${c.region} | ${c.days} | ${ts.map(t => t.run.reward.value.toFixed(2)).join(' ')} | ${mean.toFixed(3)} | ${tags.join(', ') || '—'} |`);
}
lines.push('');

// 5. Details of every tagged run.
lines.push('## Run details', '');
for (const t of tagged.filter(t => t.tags.length).sort((a, b) => a.run.reward.value - b.run.reward.value)) {
  lines.push(`- **${t.run.id} r${t.run.repeat}** (reward ${t.run.reward.value.toFixed(3)}): ${t.tags.join(', ')}${t.detail.length ? ` — ${t.detail.join('; ')}` : ''}`);
}
lines.push('');

const text = lines.join('\n');
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`Written to ${out}`);
} else {
  console.log(text);
}
