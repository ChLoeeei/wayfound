/**
 * Client side of partial replanning (v2 feature C): chat turns, the
 * version history behind "undo last edit", and the request bodies for the
 * two server calls. Pure; ItineraryApp owns the state.
 */
import type { Itinerary, Place, SlotPeriod } from '../types';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Colours the assistant bubble: a question to answer, an error, or a done note. */
  kind?: 'question' | 'error' | 'done' | 'status';
}

export type EditIntent = 'replace' | 'add' | 'remove' | 'move' | 'unclear';
export interface EditTarget {
  dayNumber: number;
  period: SlotPeriod;
  slotId?: string;
}
export interface EditPlan {
  intent: EditIntent;
  targetSlots: EditTarget[];
  add: Array<{ what: string; type?: Place['type'] }>;
  keep: string[];
  question?: string;
  instruction: string;
}

export type ReplanResponse =
  | { ok: true; itinerary: Itinerary; changedPlaceIds: string[]; removedPlaceIds: string[]; attempt: number; modelCalled: boolean; requestId?: string }
  | { ok: false; reason: 'locked'; lockedSlotIds: string[] }
  | { ok: false; reason: 'invalid'; issues: string[]; attempt: number }
  | { ok: false; reason: 'error'; message: string };

export const MAX_HISTORY = 10;

let turnSeq = 0;
export const newTurn = (role: ChatTurn['role'], text: string, kind?: ChatTurn['kind']): ChatTurn => ({ id: `turn-${++turnSeq}`, role, text, ...(kind ? { kind } : {}) });

/** Keeps the last MAX_HISTORY versions; the newest is last. */
export function pushHistory(history: Itinerary[], version: Itinerary): Itinerary[] {
  return [...history, version].slice(-MAX_HISTORY);
}

/** A "replace this stop" click needs no parsing: the plan is known. */
export function replacePlan(place: Place, dayNumber: number, period: SlotPeriod, instruction: string): EditPlan {
  return { intent: 'replace', targetSlots: [{ dayNumber, period, slotId: place.slotId ?? place.id }], add: [], keep: [], instruction };
}

/** Names of the stops whose slot ids are given (for the "locked" message). */
export function namesOfSlots(itinerary: Itinerary, slotIds: string[]): string[] {
  const out: string[] = [];
  for (const d of itinerary.days) for (const s of d.slots) for (const p of s.places) if (slotIds.includes(p.slotId ?? p.id)) out.push(p.name);
  return out;
}

/** Toggles `locked` on one stop without touching anything else. */
export function toggleLock(itinerary: Itinerary, placeId: string): Itinerary {
  return {
    ...itinerary,
    days: itinerary.days.map(d => ({
      ...d,
      slots: d.slots.map(s => ({ ...s, places: s.places.map(p => (p.id === placeId ? { ...p, locked: !p.locked } : p)) })),
    })),
  };
}

/** The day a replanning touched first, to switch the tabs there. */
export function firstTargetDay(plan: EditPlan): number | undefined {
  return plan.targetSlots[0]?.dayNumber;
}
