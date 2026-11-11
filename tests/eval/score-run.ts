/**
 * Scores one generated itinerary: the single place where a run's metrics
 * and reward are computed. Used by the eval harness (run-eval.ts), offline
 * rescoring (rescore.ts) and the experience-library learning loop
 * (learn.ts), so a reward means the same thing everywhere.
 */
import type OpenAI from 'openai';
import { addUsage, type AgentUsage, type ToolCallRecord } from '../../server/agent';
import { computeSourceAttributions, computeGroundingWarning } from '../../server/tools/attributions';
import { isInfraError } from '../../server/llm';
import { judgeItinerary, type RubricResult } from '../fuzzy/judge';
import type { Itinerary } from '../../src/types';
import type { TaggedCase } from './cases';
import {
  computeReward,
  scoreConstraintSatisfaction,
  scoreDestinationContextUsage,
  scoreHallucinationRate,
  scoreToolCallCorrectness,
  type ConstraintScore,
  type DestinationContextScore,
  type HallucinationScore,
  type Reward,
  type ToolCallScore,
} from './scoring';

/**
 * Source files whose changes would change scores; hashed into every
 * checkpoint (progress.ts codeFingerprint). cases.json is deliberately not
 * here: each run stores its own caseHash.
 */
export const SCORING_SOURCES = ['server/agent.ts', 'server/tools', 'server/experience', 'tests/eval/scoring.ts', 'tests/eval/score-run.ts', 'tests/fuzzy/judge.ts'];

export interface RunScores {
  toolCalls: ToolCallScore;
  constraints: ConstraintScore;
  hallucination: HallucinationScore;
  destinationContext: DestinationContextScore;
  judge?: RubricResult;
  /** The judge call failed for a non-network reason: other scores still count, reward omits the judge term. */
  judgeError?: string;
  /** The judge call failed because of the network/API service: the whole run must be discarded and redone. */
  judgeInfraError?: string;
  reward: Reward;
}

/** Wraps the client so every chat completion made through it is added to `acc` (used to meter the judge). */
export function meteredClient(client: OpenAI, acc: AgentUsage): OpenAI {
  return {
    chat: {
      completions: {
        create: async (...args: Parameters<OpenAI['chat']['completions']['create']>) => {
          const r = (await (client.chat.completions.create as any)(...args)) as OpenAI.Chat.Completions.ChatCompletion;
          addUsage(acc, r);
          return r;
        },
      },
    },
  } as unknown as OpenAI;
}

/**
 * Mirrors server.ts's post-processing (attributions, grounding warning) so
 * the itinerary reads like a real API response, then scores it. Mutates
 * `itinerary` by adding those two fields.
 */
export async function scoreRun(args: {
  c: TaggedCase;
  trace: ToolCallRecord[];
  itinerary: Itinerary;
  client: OpenAI;
  judgeUsage: AgentUsage;
  skipJudge?: boolean;
}): Promise<RunScores> {
  const { c, trace, itinerary } = args;
  itinerary.sourceAttributions = computeSourceAttributions(trace, c.destination);
  itinerary.groundingWarning = computeGroundingWarning(trace) || undefined;

  const toolCalls = scoreToolCallCorrectness(trace, c.destination);
  const constraints = scoreConstraintSatisfaction(itinerary, c);
  const hallucination = scoreHallucinationRate(trace, itinerary, c.destination);
  const destinationContext = scoreDestinationContextUsage(trace, itinerary);

  let judge: RubricResult | undefined;
  let judgeError: string | undefined;
  let judgeInfraError: string | undefined;
  if (!args.skipJudge) {
    try {
      judge = await judgeItinerary({ userProfile: judgeProfile(c), itinerary }, meteredClient(args.client, args.judgeUsage));
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (isInfraError(err)) judgeInfraError = message;
      else judgeError = message;
    }
  }
  const reward = rewardOf(toolCalls, constraints, hallucination, judge);
  return { toolCalls, constraints, hallucination, destinationContext, judge, judgeError, judgeInfraError, reward };
}

/** Only the trip request goes to the judge, never eval bookkeeping (id, split, region, tags). */
export function judgeProfile(c: TaggedCase) {
  const { id: _id, split: _split, region: _region, tags: _tags, addedIn: _added, ...userProfile } = c;
  return userProfile;
}

export function rewardOf(toolCalls: ToolCallScore, constraints: ConstraintScore, hallucination: HallucinationScore, judge?: RubricResult): Reward {
  return computeReward({
    toolCorrect: toolCalls.score,
    constraint: constraints.score,
    judgeOutOf5: judge ? judge.weighted_total : null,
    hallucinationRate: hallucination.rate,
  });
}
