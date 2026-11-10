/**
 * Prompts for the offline learning loop (Training-Free GRPO):
 *
 *   summarize  one trajectory -> 5-8 lines (steps, tool errors, ungrounded fields)
 *   compare    best + worst summaries of a group -> 1-2 strategy lessons (the "semantic advantage")
 *   update     new lessons + current library -> item-level ADD/MODIFY/DELETE/KEEP ops (ACE rule)
 *   filter     LLM guard: rejects lessons that name a specific POI / id / address / coordinate
 *   single     ReasoningBank-style ablation: lessons from ONE run, no group comparison
 *
 * Each builder returns chat messages; the matching parse* function turns the
 * reply into data and tolerates fences / stray prose. The trajectory text
 * fed to `summarize` is rendered deterministically by `renderTrajectory`,
 * so the LLM only condenses facts the harness recorded.
 */
import type OpenAI from 'openai';
import { type Lesson, TOOL_SCOPES } from './library';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface CaseInfo {
  id: string;
  destination: string;
  region: 'domestic' | 'international';
  days: number;
  people: number;
  preferences: string[];
  groupType?: string;
  budget?: { min: number; max: number };
  specialNeeds?: string[];
}

export interface ToolCallLite {
  step: number;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  resultSummary: string;
}

/** Everything the harness knows about one scored run. */
export interface RunRecord {
  run: number;
  reward: number;
  toolCorrect: number;
  constraint: number;
  hallucinationRate: number;
  judge: number | null;
  failed?: string;
  trace: ToolCallLite[];
  unverifiedPlaces: string[];
  issues: string[];
  steps: number;
  usedLessonIds: string[];
}

const SCOPE_HELP = `Scope is one of: "domestic", "international", a tool name (${TOOL_SCOPES.join(', ')}), "<region>/<tool>" such as "international/search_places", or "general".`;

const LESSON_RULES = [
  'A lesson is ONE short imperative sentence (max ~40 words) about HOW to plan or use tools, tied to a tool or a step.',
  'It must generalize to other cities: NEVER name a specific POI, restaurant, street, district, address, id, or coordinate. Say "the core place name", not "Tanah Lot".',
  'Write lessons in English.',
  SCOPE_HELP,
].join('\n- ');

function caseLine(c: CaseInfo): string {
  const parts = [
    `${c.destination} (${c.region}), ${c.days} days, ${c.people} people`,
    c.groupType ? `group: ${c.groupType}` : '',
    c.preferences.length ? `vibes: ${c.preferences.join(', ')}` : '',
    c.budget ? `budget ¥${c.budget.min}-${c.budget.max}/person/day` : '',
    c.specialNeeds?.length ? `special needs: ${c.specialNeeds.join(', ')}` : '',
  ];
  return parts.filter(Boolean).join('; ');
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Deterministic, compact rendering of a run for the summarize prompt. */
export function renderTrajectory(r: RunRecord): string {
  const lines = [
    `Scores: reward=${r.reward.toFixed(3)} tool_correct=${r.toolCorrect.toFixed(2)} constraint=${r.constraint.toFixed(2)} hallucination=${(r.hallucinationRate * 100).toFixed(0)}% judge=${r.judge ?? 'n/a'} steps=${r.steps}`,
  ];
  if (r.failed) lines.push(`RUN FAILED: ${clip(r.failed, 200)}`);
  lines.push(`Tool calls (${r.trace.length}):`);
  for (const t of r.trace) {
    lines.push(`  [step ${t.step}] ${t.name}(${clip(JSON.stringify(t.args), 140)}) -> ${t.ok ? 'ok' : 'ERROR'}: ${clip(t.resultSummary, 160)}`);
  }
  if (r.unverifiedPlaces.length) {
    lines.push(`Places in the final plan NOT found in any search result (${r.unverifiedPlaces.length}): ${clip(r.unverifiedPlaces.join(', '), 400)}`);
  }
  if (r.issues.length) lines.push(`Scorer issues: ${r.issues.join('; ')}`);
  return lines.join('\n');
}

// ==================== summarize ====================

export function summarizePrompt(c: CaseInfo, r: RunRecord): Msg[] {
  return [
    {
      role: 'system',
      content:
        'You analyze one run of a travel-planning agent that uses map tools (search_places, get_poi_details, calculate_distance, get_destination_context) and then writes an itinerary JSON. ' +
        'Summarize the run in 5 to 8 short lines: what it searched for and how (query style, region, ordering), which tool calls failed or returned nothing and what it did next, which final places were ungrounded (not from a search result) and why that likely happened, and anything that hurt the score. Facts only, no advice. Plain text, no JSON.',
    },
    { role: 'user', content: `Trip: ${caseLine(c)}\n\n${renderTrajectory(r)}` },
  ];
}

// ==================== compare (semantic advantage) ====================

export interface ProposedLesson {
  scope: string;
  lesson: string;
  evidence?: string;
}

function libraryListing(lessons: Lesson[]): string {
  if (lessons.length === 0) return '(empty)';
  return lessons.map(l => `[${l.id}] (${l.scope}) ${l.lesson}  (helpful ${l.helpful}, harmful ${l.harmful})`).join('\n');
}

export function comparePrompt(
  c: CaseInfo,
  best: { summary: string; reward: number },
  worst: { summary: string; reward: number },
  library: Lesson[],
): Msg[] {
  return [
    {
      role: 'system',
      content: [
        'You improve a travel-planning agent by comparing its BEST and WORST runs on the same trip request (same tools, same prompt, different sampling).',
        'Find what the better run DID differently in its process (tool use, query wording, ordering, grounding, final JSON) that explains the score gap, and write 1 or 2 strategy lessons that would make future runs on OTHER trips behave like the better run.',
        'Do not repeat a lesson the library already has; if an existing lesson is close, refine the idea instead.',
        `Rules:\n- ${LESSON_RULES}`,
        'Reply with ONLY JSON: {"lessons": [{"scope": string, "lesson": string, "evidence": string}]}. "evidence" is one line citing what in the runs shows this. Return {"lessons": []} if the gap is just noise.',
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        `Trip: ${caseLine(c)}`,
        `BEST run (reward ${best.reward.toFixed(3)}):\n${best.summary}`,
        `WORST run (reward ${worst.reward.toFixed(3)}):\n${worst.summary}`,
        `Current library:\n${libraryListing(library)}`,
      ].join('\n\n'),
    },
  ];
}

// ==================== single-run (ReasoningBank-style ablation) ====================

export function singleRunPrompt(c: CaseInfo, run: { summary: string; reward: number }, library: Lesson[]): Msg[] {
  return [
    {
      role: 'system',
      content: [
        'You improve a travel-planning agent from ONE of its runs. Reward ranges from -0.5 (bad) to 0.8 (perfect): a high reward means the run shows a strategy worth keeping; a low one shows a pitfall to avoid.',
        'Write 1 or 2 strategy lessons from this run alone.',
        'Do not repeat a lesson the library already has.',
        `Rules:\n- ${LESSON_RULES}`,
        'Reply with ONLY JSON: {"lessons": [{"scope": string, "lesson": string, "evidence": string}]}.',
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [`Trip: ${caseLine(c)}`, `Run (reward ${run.reward.toFixed(3)}):\n${run.summary}`, `Current library:\n${libraryListing(library)}`].join('\n\n'),
    },
  ];
}

// ==================== update (ACE item-level ops) ====================

export function updatePrompt(newLessons: ProposedLesson[], library: Lesson[]): Msg[] {
  return [
    {
      role: 'system',
      content: [
        'You maintain a library of strategy lessons for a travel-planning agent. Integrate the NEW lessons with item-level operations; never rewrite the whole library.',
        'Operations:',
        '- {"op": "ADD", "scope": string, "lesson": string}  a genuinely new idea',
        '- {"op": "MODIFY", "id": "Lxx", "lesson"?: string, "scope"?: string}  an existing lesson says nearly the same thing: merge the new insight into it (keep it one sentence)',
        '- {"op": "DELETE", "id": "Lxx"}  an existing lesson is contradicted by the new evidence or is now redundant',
        '- {"op": "KEEP", "id": "Lxx"}  optional, no change',
        'MODIFY and DELETE must name an existing id from the library. At most 4 non-KEEP operations.',
        `Rules for any lesson text you write:\n- ${LESSON_RULES}`,
        'Reply with ONLY JSON: {"operations": [ ... ]}.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `NEW lessons:\n${newLessons.map(l => `(${l.scope}) ${l.lesson}${l.evidence ? `  [evidence: ${l.evidence}]` : ''}`).join('\n')}\n\nCurrent library:\n${libraryListing(library)}`,
    },
  ];
}

// ==================== filter (no answer memorizing) ====================

export function filterPrompt(lessons: string[]): Msg[] {
  return [
    {
      role: 'system',
      content:
        'You check strategy lessons for a travel-planning agent. A lesson is SPECIFIC (reject it) if it names a particular POI, attraction, restaurant, hotel, street, neighbourhood or district, gives an address, an id, or coordinates, or otherwise only helps for one city. Generic categories are fine ("night market", "the core place name", "Wikivoyage", "the destination city"). ' +
        'Reply with ONLY JSON: {"verdicts": [{"index": number, "specific": boolean, "reason": string}]}, one per lesson, index from 0.',
    },
    { role: 'user', content: lessons.map((l, i) => `${i}. ${l}`).join('\n') },
  ];
}

// ==================== parsing ====================

function parseJson(text: string): any | null {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

export function parseLessons(text: string): ProposedLesson[] {
  const v = parseJson(text);
  const arr = Array.isArray(v?.lessons) ? v.lessons : [];
  return arr
    .filter((l: any) => l && typeof l.lesson === 'string' && l.lesson.trim())
    .slice(0, 2)
    .map((l: any) => ({ scope: String(l.scope ?? 'general'), lesson: l.lesson.trim(), evidence: typeof l.evidence === 'string' ? l.evidence : undefined }));
}

export function parseOperations(text: string): unknown[] {
  const v = parseJson(text);
  return Array.isArray(v?.operations) ? v.operations : [];
}

/** Indexes the filter marked specific. A missing or unparseable verdict counts as specific (fail closed). */
export function parseFilterVerdicts(text: string, count: number): Set<number> {
  const v = parseJson(text);
  const verdicts = Array.isArray(v?.verdicts) ? v.verdicts : [];
  const specific = new Set<number>();
  for (let i = 0; i < count; i++) {
    const verdict = verdicts.find((x: any) => Number(x?.index) === i);
    if (!verdict || verdict.specific !== false) specific.add(i);
  }
  return specific;
}
