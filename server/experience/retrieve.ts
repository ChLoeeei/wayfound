/**
 * Plan-time lesson selection: filter the experience library by scope
 * (destination region + tools in play), rank by helpful − harmful, cap at
 * ~12 lessons / ~1.5k tokens, and render the "Lessons from past runs" block
 * for the ReAct system prompt.
 */
import { isLikelyMainlandChina } from '../tools/provider';
import { type Lesson, type Library, type RegionScope, type ToolScope, TOOL_SCOPES, netScore, parseScope } from './library';

export const MAX_INJECTED_LESSONS = 12;
export const MAX_INJECTED_TOKENS = 1500;

/** Lessons proven harmful (at least this many net-negative outcomes) are no longer injected. */
export const HARMFUL_CUTOFF = -2;

export function regionOfDestination(destination: string): RegionScope {
  return isLikelyMainlandChina(destination) ? 'domestic' : 'international';
}

/** Rough token estimate: CJK characters ≈ 1 token each, other text ≈ 4 chars per token. */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[　-鿿＀-￯]/g) ?? []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

export interface RetrieveOptions {
  region: RegionScope;
  /** Tools available this run. Defaults to all of them (every tool is offered on every plan today). */
  tools?: readonly ToolScope[];
  maxLessons?: number;
  maxTokens?: number;
}

export function lessonMatches(l: Lesson, region: RegionScope, tools: readonly ToolScope[]): boolean {
  const p = parseScope(l.scope);
  if (!p) return false;
  if (p.region && p.region !== region) return false;
  if (p.tool && p.tool !== 'final_answer' && !tools.includes(p.tool)) return false;
  return true;
}

export function selectLessons(lib: Library, opts: RetrieveOptions): Lesson[] {
  const tools = opts.tools ?? TOOL_SCOPES;
  const maxLessons = opts.maxLessons ?? MAX_INJECTED_LESSONS;
  const maxTokens = opts.maxTokens ?? MAX_INJECTED_TOKENS;
  const ranked = lib.lessons
    .filter(l => lessonMatches(l, opts.region, tools) && netScore(l) > HARMFUL_CUTOFF)
    .sort(
      (a, b) =>
        netScore(b) - netScore(a) ||
        // More specific scope first (region/tool beats region or tool beats general), then newer.
        specificity(b) - specificity(a) ||
        b.created_epoch - a.created_epoch ||
        a.id.localeCompare(b.id),
    );
  const out: Lesson[] = [];
  let tokens = estimateTokens(HEADER);
  for (const l of ranked) {
    if (out.length >= maxLessons) break;
    const t = estimateTokens(renderLine(l));
    if (tokens + t > maxTokens) continue;
    out.push(l);
    tokens += t;
  }
  return out;
}

function specificity(l: Lesson): number {
  const p = parseScope(l.scope) ?? {};
  return (p.region ? 1 : 0) + (p.tool ? 1 : 0);
}

const HEADER =
  'Lessons from past runs (strategy learned from earlier scored plans; apply them when relevant, they never name specific places to copy):';

const renderLine = (l: Lesson) => `- [${l.id}] (${l.scope}) ${l.lesson}`;

export function renderLessonsBlock(lessons: Lesson[]): string {
  if (lessons.length === 0) return '';
  return [HEADER, ...lessons.map(renderLine)].join('\n');
}
