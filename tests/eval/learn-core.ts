/**
 * Pure pieces of the experience-library learning loop (learn.ts), kept
 * apart so they can be unit tested without calling the live agent.
 */
import { createHash } from 'crypto';
import type { Lesson } from '../../server/experience/library';
import type { RunRecord } from '../../server/experience/prompts';
import type { ToolCallRecord } from '../../server/agent';
import type { RunScores } from './score-run';

/** Deterministic PRNG in [0, 1) from a string seed (sha256 counter mode). */
export function seededRandom(seed: string): () => number {
  let counter = 0;
  return () => {
    const h = createHash('sha256').update(`${seed}:${counter++}`).digest();
    return h.readUInt32BE(0) / 0x100000000;
  };
}

/**
 * Which of the selected lessons each rollout of a group gets. Each lesson
 * is included independently with probability `p` (seeded, reproducible).
 * Giving every rollout the same lessons would make the helpful/harmful
 * counters meaningless: within a group, runs above and below the mean
 * would all credit the same lessons, cancelling out. With random subsets,
 * a lesson is credited by runs that had it versus runs that did not.
 */
export function lessonSubsets(lessons: Pick<Lesson, 'id'>[], rollouts: number, seed: string, p = 0.5): string[][] {
  const rand = seededRandom(seed);
  return Array.from({ length: rollouts }, () => lessons.filter(() => rand() < p).map(l => l.id));
}

/** Fisher-Yates with a seeded PRNG: the per-epoch case order. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const rand = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A group carries no comparison signal when every rollout scored the same. */
export function isDegenerateGroup(rewards: number[], epsilon = 1e-6): boolean {
  return rewards.length < 2 || Math.max(...rewards) - Math.min(...rewards) <= epsilon;
}

/** Best and worst rollout by reward (first on ties). */
export function bestAndWorst<T extends { reward: number }>(runs: T[]): { best: T; worst: T } {
  let best = runs[0];
  let worst = runs[0];
  for (const r of runs) {
    if (r.reward > best.reward) best = r;
    if (r.reward < worst.reward) worst = r;
  }
  return { best, worst };
}

/** Turns a scored rollout into the record the learning prompts read. */
export function toRunRecord(args: {
  run: number;
  trace: ToolCallRecord[];
  steps: number;
  usedLessonIds: string[];
  scores?: RunScores;
  error?: string;
}): RunRecord {
  const { scores } = args;
  if (!scores) {
    return {
      run: args.run, reward: -0.5, toolCorrect: 0, constraint: 0, hallucinationRate: 1, judge: null, failed: args.error ?? 'generation failed',
      trace: args.trace, unverifiedPlaces: [], issues: [], steps: args.steps, usedLessonIds: args.usedLessonIds,
    };
  }
  return {
    run: args.run,
    reward: scores.reward.value,
    toolCorrect: scores.toolCalls.score,
    constraint: scores.constraints.score,
    hallucinationRate: scores.hallucination.rate,
    judge: scores.judge ? scores.judge.weighted_total : null,
    trace: args.trace,
    unverifiedPlaces: scores.hallucination.unverifiedPlaceNames,
    issues: [...scores.toolCalls.issues, ...scores.constraints.issues],
    steps: args.steps,
    usedLessonIds: args.usedLessonIds,
  };
}
