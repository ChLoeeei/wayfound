/**
 * Offline rescoring of a checkpoint under the current reward (REWARD_VERSION).
 * No API calls: every successful run's saved itinerary is re-scored for
 * constraints; tool correctness, hallucination and the judge score are
 * reused as recorded (none of them changed between reward v1 and v2).
 *
 *   npx tsx tests/eval/rescore.ts <src-checkpoint> <dst-checkpoint> [--results out.json]
 *
 * The destination is a normal checkpoint (get its path with
 * EVAL_PRINT_CHECKPOINT=1 and the original command), so the eval harness
 * can report from it or extend it. Each run keeps its old reward under
 * `rescoredFrom`. `--results` also writes a committable result file, for
 * checkpoints whose case set is no longer the full split.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { allCases, isHardCase } from './cases';
import { REWARD_VERSION, scoreConstraintSatisfaction } from './scoring';
import { SCORING_SOURCES, rewardOf } from './score-run';
import { codeFingerprint } from './progress';
import { summarizeRuns, toRunMetrics } from './aggregate';

const [src, dst] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const resultsIdx = process.argv.indexOf('--results');
const resultsOut = resultsIdx > 0 ? process.argv[resultsIdx + 1] : undefined;
if (!src || !dst || !fs.existsSync(path.join(src, 'runs'))) {
  console.error('Usage: npx tsx tests/eval/rescore.ts <src-checkpoint> <dst-checkpoint> [--results out.json]');
  process.exit(1);
}
if (fs.existsSync(dst)) {
  console.error(`Destination ${dst} already exists; refusing to overwrite.`);
  process.exit(1);
}

const REPORTS_DIR = path.join(process.cwd(), 'tests', 'eval', 'reports');
const byId = new Map(allCases.map(c => [c.id, c]));
const srcManifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const fromVersion = srcManifest.config?.rewardVersion;
if (fromVersion === REWARD_VERSION) {
  console.error(`Source is already reward v${REWARD_VERSION}.`);
  process.exit(1);
}

fs.mkdirSync(path.join(dst, 'runs'), { recursive: true });
const runs: any[] = [];
let changed = 0;
for (const f of fs.readdirSync(path.join(src, 'runs')).filter(f => f.endsWith('.json')).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(src, 'runs', f), 'utf8'));
  const c = byId.get(r.id);
  if (!c) throw new Error(`${f}: case ${r.id} is not in cases.json`);
  const old = { rewardVersion: fromVersion, reward: r.reward, constraints: r.constraints };
  if (!r.error) {
    if (!r.itineraryFile) throw new Error(`${f}: successful run has no saved itinerary; cannot rescore offline`);
    const itinerary = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, r.itineraryFile), 'utf8'));
    r.constraints = scoreConstraintSatisfaction(itinerary, c);
    r.reward = rewardOf(r.toolCalls, r.constraints, r.hallucination, r.judge);
    if (Math.abs(r.reward.value - old.reward.value) > 1e-9) changed++;
  }
  r.rescoredFrom = old;
  fs.writeFileSync(path.join(dst, 'runs', f), JSON.stringify(r, null, 2));
  runs.push(r);
}

const fingerprint = codeFingerprint(process.cwd(), SCORING_SOURCES);
const note = `Rescored offline from ${path.basename(src)} (reward v${fromVersion} -> v${REWARD_VERSION}: per-day budget check, day total <= cap + 10%). No new runs: constraints recomputed from each saved itinerary; tool, hallucination and judge scores reused. ${changed}/${runs.length} run rewards changed.`;
const manifest = {
  ...srcManifest,
  config: { ...srcManifest.config, rewardVersion: REWARD_VERSION },
  codeFingerprint: fingerprint,
  acceptedCodeChanges: [
    ...(srcManifest.acceptedCodeChanges ?? []),
    { from: srcManifest.codeFingerprint, to: fingerprint, at: new Date().toISOString(), completedRunsBefore: runs.length, note },
  ],
  migrations: [...(srcManifest.migrations ?? []), { at: new Date().toISOString(), from: path.basename(src), note }],
};
fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${runs.length} run(s) rescored into ${dst}; ${changed} reward(s) changed.`);

if (resultsOut) {
  let gitCommit: string | null = null;
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // not a git checkout
  }
  const metrics = runs.map(r => toRunMetrics(r));
  const hard = new Set(allCases.filter(isHardCase).map(c => c.id));
  const hasHard = runs.some(r => hard.has(r.id));
  const out = {
    meta: {
      ...manifest.config,
      gitCommit,
      rescoredOffline: true,
      acceptedCodeChanges: manifest.acceptedCodeChanges,
      checkpointMigrations: manifest.migrations,
      caseIds: [...new Set(runs.map(r => r.id))],
    },
    aggregate: summarizeRuns(metrics),
    aggregateCore: hasHard ? summarizeRuns(metrics.filter(m => !hard.has(m.caseId))) : null,
    runs: runs.map(r => ({ ...toRunMetrics(r), attempts: r.attempts, error: r.error, judgeError: r.judgeError })),
  };
  fs.mkdirSync(path.dirname(resultsOut), { recursive: true });
  fs.writeFileSync(resultsOut, JSON.stringify(out, null, 2) + '\n');
  console.log(`Result written to ${resultsOut}`);
}
