/**
 * Paired comparison of two committed eval results (tests/eval/results/*.json).
 *
 *   npm run eval:compare -- <A.json> <B.json> [--subset core|hard|all] [--region domestic|international]
 *
 * Reports, per metric, the mean of per-case (B − A) differences with a 95%
 * t-interval over cases (see paired.ts). `--subset core` = the original 30
 * v2 test cases, `hard` = the v3 hard cases, `all` (default) = every case
 * present in both files. Use this for every setup-vs-baseline claim.
 */
import fs from 'fs';
import path from 'path';
import { allCases, isHardCase } from './cases';
import type { MetricKey, RunMetrics } from './aggregate';
import { fmtPaired, pairedComparison } from './paired';

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--') && !['core', 'hard', 'all', 'domestic', 'international'].includes(a));
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (files.length !== 2) {
  console.error('Usage: npm run eval:compare -- <A.json> <B.json> [--subset core|hard|all] [--region domestic|international]');
  process.exit(1);
}
const subset = (opt('subset') ?? 'all') as 'core' | 'hard' | 'all';
const region = opt('region') as RunMetrics['region'] | undefined;

const hardIds = new Set(allCases.filter(isHardCase).map(c => c.id));
const load = (f: string) => {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const runs: RunMetrics[] = j.runs;
  return {
    setup: j.meta?.setup ?? path.basename(f),
    commit: j.meta?.gitCommit ?? '?',
    runs: runs.filter(r => (subset === 'all' || (subset === 'hard') === hardIds.has(r.caseId)) && (!region || r.region === region)),
  };
};
const A = load(files[0]);
const B = load(files[1]);

const rows: Array<[string, MetricKey, { percent?: boolean; digits?: number }]> = [
  ['Reward', 'reward', { digits: 3 }],
  ['Hallucination rate', 'hallucinationRate', { percent: true }],
  ['Tool-call correctness', 'toolCorrect', { digits: 3 }],
  ['Constraint satisfaction', 'constraint', { digits: 3 }],
  ['LLM-judge (0-5)', 'judge', { digits: 2 }],
  ['Avg steps', 'steps', { digits: 2 }],
];

console.log(`\nPaired comparison, B − A, per case (mean over repeats), 95% t-interval over cases`);
console.log(`  A = ${A.setup} @ ${A.commit} (${A.runs.length} runs)`);
console.log(`  B = ${B.setup} @ ${B.commit} (${B.runs.length} runs)`);
console.log(`  subset = ${subset}${region ? `, region = ${region}` : ''}   (* = CI excludes 0)\n`);
let unpaired: string[] = [];
for (const [label, key, f] of rows) {
  const p = pairedComparison(A.runs, B.runs, key);
  unpaired = p.unpaired;
  console.log(`  ${label.padEnd(26)} ${fmtPaired(p, f)}`);
}
if (unpaired.length) console.log(`\n  Left out (only in one file): ${unpaired.join(', ')}`);
console.log('');
