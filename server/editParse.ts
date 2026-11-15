/**
 * Edit parsing (v2 feature C): one small model call that turns what the
 * user typed into a plan `{ intent, targetSlots, add, keep, question }`
 * against an outline of the current itinerary. When the message is not
 * clear enough to name a target, the plan is `unclear` and carries a
 * question for the user; nothing is replanned.
 *
 * The parser only decides WHAT to change. Whether it may (locked stops) and
 * whether the result is acceptable is decided in replan.ts / replanValidate.ts.
 */
import type OpenAI from 'openai';
import type { Itinerary, PlaceType, SlotPeriod } from '../src/types';
import { PERIOD_ORDER } from '../src/lib/itineraryOps';

export type EditIntent = 'replace' | 'add' | 'remove' | 'move' | 'unclear';
export interface EditTarget {
  dayNumber: number;
  period: SlotPeriod;
  /** When set, only this stop is replanned; the rest of the period is fixed context. */
  slotId?: string;
}
export interface EditPlan {
  intent: EditIntent;
  targetSlots: EditTarget[];
  /** What to add or replace with, in the user's words (e.g. "a ramen place", "something indoors"). */
  add: Array<{ what: string; type?: PlaceType }>;
  /** Slot ids the user explicitly asked to keep. */
  keep: string[];
  /** Set with intent `unclear`: the one question to ask before doing anything. */
  question?: string;
  /** The original message, passed on to the replanner. */
  instruction: string;
}

const PLACE_TYPES = new Set<PlaceType>(['attraction', 'restaurant', 'hotel', 'shopping', 'cafe', 'nightlife', 'leisure']);

/** Compact, line-per-stop view of the itinerary for the parser prompt. */
export function itineraryOutline(itinerary: Itinerary): string {
  const lines: string[] = [];
  for (const day of itinerary.days) {
    lines.push(`Day ${day.dayNumber}${day.theme ? ` (${day.theme})` : ''}:`);
    for (const period of PERIOD_ORDER) {
      const slot = day.slots.find(s => s.period === period);
      const places = slot?.places ?? [];
      if (places.length === 0) {
        lines.push(`  ${period}: (empty)`);
        continue;
      }
      for (const p of places) {
        const time = p.start && p.end ? `${p.start}-${p.end}` : '';
        lines.push(`  ${period}: [${p.slotId ?? p.id}] ${p.name} (${p.type}${time ? `, ${time}` : ''}${p.locked ? ', LOCKED' : ''})`);
      }
    }
  }
  return lines.join('\n');
}

export const EDIT_PARSE_SYSTEM_PROMPT = `You turn a traveller's edit request into a structured plan against their current itinerary. You do not plan places yourself.

Return JSON: {"intent": "replace" | "add" | "remove" | "move" | "unclear", "targetSlots": [{"dayNumber": n, "period": "morning"|"afternoon"|"evening", "slotId": "..." }], "add": [{"what": "...", "type": "attraction|restaurant|hotel|shopping|cafe|nightlife|leisure"}], "keep": ["slotId", ...], "question": "..."}

Rules:
- "targetSlots" names the stops or periods to change. Use "slotId" (from the outline, in square brackets) when the user means one specific stop; leave it out when they mean a whole period (e.g. "the afternoon of day 2").
- "replace": swap the target stop(s) for something else; "add": put a new stop into the target period; "remove": drop the target stop(s); "move": the user wants a stop at a different time or day (put the destination period in targetSlots and the stop's slotId in "keep").
- "add" (the array) describes what the user asked for, in their words; include "type" only when it is clear.
- "keep": slot ids the user said to keep as they are.
- If the message does not identify a day, period or stop well enough (or asks for something that is not an itinerary edit), set intent "unclear", leave targetSlots empty and put ONE short question in "question", in the user's language.
- If the user names a day without a period, choose the period that fits the request (a lunch → afternoon, dinner → evening); if it still cannot be decided, ask.
- Never invent slot ids. Only use ids from the outline.`;

export function buildEditParseUserPrompt(itinerary: Itinerary, message: string, language?: string, activeDay?: number): string {
  return [
    `Destination: ${itinerary.destination}`,
    activeDay ? `The user is currently looking at day ${activeDay}.` : '',
    'Current itinerary:',
    itineraryOutline(itinerary),
    '',
    `User message (${language === 'zh' ? 'Chinese' : 'English'}): ${message.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function stripFences(text: string): string {
  const t = text.trim();
  return t.startsWith('```') ? t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : t;
}

/** Validates the model's plan against the itinerary; anything unusable becomes `unclear`. */
export function parseEditPlan(raw: string, itinerary: Itinerary, instruction: string): EditPlan {
  const unclear = (question?: string): EditPlan => ({ intent: 'unclear', targetSlots: [], add: [], keep: [], instruction, ...(question ? { question } : {}) });
  let parsed: any;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return unclear();
  }
  const intent: EditIntent = ['replace', 'add', 'remove', 'move', 'unclear'].includes(parsed?.intent) ? parsed.intent : 'unclear';
  const question = typeof parsed?.question === 'string' && parsed.question.trim() ? parsed.question.trim().slice(0, 300) : undefined;
  if (intent === 'unclear') return unclear(question);

  const slotIds = new Map<string, { dayNumber: number; period: SlotPeriod }>();
  for (const d of itinerary.days) for (const s of d.slots) for (const p of s.places) slotIds.set(p.slotId ?? p.id, { dayNumber: d.dayNumber, period: s.period });
  const days = new Set(itinerary.days.map(d => d.dayNumber));

  const targets: EditTarget[] = [];
  for (const t of Array.isArray(parsed.targetSlots) ? parsed.targetSlots : []) {
    const slotId = typeof t?.slotId === 'string' ? t.slotId : undefined;
    if (slotId) {
      const where = slotIds.get(slotId);
      if (!where) continue; // invented id
      targets.push({ ...where, slotId });
      continue;
    }
    const dayNumber = Number(t?.dayNumber);
    const period = t?.period as SlotPeriod;
    if (days.has(dayNumber) && PERIOD_ORDER.includes(period)) targets.push({ dayNumber, period });
  }
  const seen = new Set<string>();
  const uniqueTargets = targets.filter(t => {
    const k = `${t.dayNumber}:${t.period}:${t.slotId ?? ''}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  if (uniqueTargets.length === 0) return unclear(question);

  const add = (Array.isArray(parsed.add) ? parsed.add : [])
    .filter((a: any) => typeof a?.what === 'string' && a.what.trim())
    .map((a: any) => ({ what: String(a.what).trim().slice(0, 200), ...(PLACE_TYPES.has(a.type) ? { type: a.type as PlaceType } : {}) }));
  const keep = (Array.isArray(parsed.keep) ? parsed.keep : []).filter((k: any) => typeof k === 'string' && slotIds.has(k));
  return { intent, targetSlots: uniqueTargets, add, keep, instruction };
}

/** Slot ids of locked stops that a plan would touch (whole-period targets include every locked stop in that period). */
export function lockedTargets(itinerary: Itinerary, plan: EditPlan): string[] {
  const out: string[] = [];
  for (const t of plan.targetSlots) {
    const day = itinerary.days.find(d => d.dayNumber === t.dayNumber);
    const slot = day?.slots.find(s => s.period === t.period);
    for (const p of slot?.places ?? []) {
      const id = p.slotId ?? p.id;
      if (p.locked && (!t.slotId || t.slotId === id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export async function parseEdit(
  client: OpenAI,
  itinerary: Itinerary,
  message: string,
  language?: string,
  activeDay?: number,
  model = 'deepseek-chat',
): Promise<EditPlan> {
  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 600,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EDIT_PARSE_SYSTEM_PROMPT },
      { role: 'user', content: buildEditParseUserPrompt(itinerary, message, language, activeDay) },
    ],
  });
  return parseEditPlan(res.choices[0]?.message?.content ?? '', itinerary, message.trim());
}
