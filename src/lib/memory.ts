import type { BudgetRange, GroupType, PlaceType, PlanningInput, SpecialNeed, Vibe } from '../types';

/**
 * Client-side memory module.
 *
 * Persists a structured JSON summary of what a returning visitor has told
 * Wayfound across sessions — preferred vibes, usual group type, budget lean,
 * special needs, recently-planned destinations, and place types they tend to
 * delete from generated itineraries. It lives in localStorage (per-browser,
 * no backend/schema change) and is folded into the agent's prompt on the
 * next `generateItinerary` call via `buildMemoryPromptContext`, so tool-use
 * planning is informed by what the user has stated before, not just the
 * current form submission.
 */

const STORAGE_KEY = 'wayfound.memory.v1';
const MAX_VIBES = 6;
const MAX_DESTINATIONS = 8;
const MAX_NOTES = 6;
const MAX_SPECIAL_NEEDS = 8;

export type BudgetLean = 'budget' | 'balanced' | 'splurge';

export interface TravelMemory {
  version: 1;
  updatedAt: string | null;
  /** Vibes used across past sessions, most-recently-used first, deduped. */
  preferredVibes: Vibe[];
  /** Group type from the most recent session. */
  groupType?: GroupType;
  /** Budget lean inferred from the "budgetLean" clarification answer, if ever given. */
  budgetLean?: BudgetLean;
  /** Most recent budget range, used to prefill the form. */
  lastBudget?: BudgetRange;
  /** Special needs seen across sessions, unioned. */
  specialNeeds: SpecialNeed[];
  /** Destinations planned before, most-recent first, deduped case-insensitively. */
  visitedDestinations: string[];
  /** Counts of place types the user has deleted from a generated itinerary — a soft "avoid this" signal. */
  dislikedTypeCounts: Partial<Record<PlaceType, number>>;
  /** Free-text clarification answers that didn't match a known quick-pick option. */
  notes: string[];
}

export function emptyMemory(): TravelMemory {
  return {
    version: 1,
    updatedAt: null,
    preferredVibes: [],
    specialNeeds: [],
    visitedDestinations: [],
    dislikedTypeCounts: {},
    notes: [],
  };
}

/** True when there is nothing worth injecting into a prompt or showing in the UI yet. */
export function isMemoryEmpty(mem: TravelMemory): boolean {
  return (
    mem.preferredVibes.length === 0 &&
    !mem.groupType &&
    !mem.budgetLean &&
    mem.specialNeeds.length === 0 &&
    mem.visitedDestinations.length === 0 &&
    Object.keys(mem.dislikedTypeCounts).length === 0 &&
    mem.notes.length === 0
  );
}

export function loadMemory(): TravelMemory {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMemory();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return emptyMemory();
    // Defensive merge so a partially-corrupt blob doesn't crash the app.
    return { ...emptyMemory(), ...parsed };
  } catch {
    return emptyMemory();
  }
}

export function saveMemory(mem: TravelMemory): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mem));
  } catch {
    // localStorage unavailable (private mode, quota, SSR) — memory just
    // won't persist across reloads this session. Not fatal.
  }
}

export function clearMemory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

const BUDGET_LEAN_ANSWERS: Record<string, BudgetLean> = {
  'More budget-friendly': 'budget',
  Balanced: 'balanced',
  'More splurge-y': 'splurge',
};

// Known quick-pick answers across all clarification questions (see
// src/lib/clarifications.ts). Anything else the user typed free-form is
// treated as a note worth remembering verbatim.
const KNOWN_ANSWERS = new Set<string>([
  ...Object.keys(BUDGET_LEAN_ANSWERS),
  'Yes, kids too',
  'Adults only',
  'Stay in one city',
  'Add a nearby city or two',
]);

function dedupePrependCapped(list: string[], value: string, max: number): string[] {
  const lower = value.trim().toLowerCase();
  if (!lower) return list;
  const rest = list.filter(v => v.trim().toLowerCase() !== lower);
  return [value, ...rest].slice(0, max);
}

function mergeVibes(existing: Vibe[], used: Vibe[]): Vibe[] {
  // Most-recently-used vibes float to the front; unseen ones are appended.
  let next = existing;
  for (const v of used) {
    next = [v, ...next.filter(x => x !== v)];
  }
  return next.slice(0, MAX_VIBES);
}

function mergeSpecialNeeds(existing: SpecialNeed[], used: SpecialNeed[]): SpecialNeed[] {
  const set = new Set([...existing, ...used]);
  return Array.from(set).slice(0, MAX_SPECIAL_NEEDS);
}

/**
 * Pure merge: fold a just-submitted planning session into existing memory.
 * Called after a successful (or attempted) generation, before persisting.
 */
export function recordPlanningSession(mem: TravelMemory, input: PlanningInput): TravelMemory {
  const next: TravelMemory = {
    ...mem,
    updatedAt: new Date().toISOString(),
    preferredVibes: mergeVibes(mem.preferredVibes, input.vibes),
    groupType: input.groupType,
    lastBudget: input.budget,
    specialNeeds: mergeSpecialNeeds(mem.specialNeeds, input.specialNeeds),
    visitedDestinations: dedupePrependCapped(
      mem.visitedDestinations,
      input.destination,
      MAX_DESTINATIONS,
    ),
    notes: [...mem.notes],
  };

  for (const answer of Object.values(input.clarifications ?? {})) {
    const trimmed = answer.trim();
    if (!trimmed) continue;
    if (trimmed in BUDGET_LEAN_ANSWERS) {
      next.budgetLean = BUDGET_LEAN_ANSWERS[trimmed];
      continue;
    }
    if (KNOWN_ANSWERS.has(trimmed)) continue; // quick-pick, not a note
    next.notes = [trimmed, ...next.notes.filter(n => n !== trimmed)].slice(0, MAX_NOTES);
  }

  return next;
}

/** Record a soft "avoid this type" signal when the user deletes a place from a generated itinerary. */
export function recordPlaceDeleted(mem: TravelMemory, placeType: PlaceType): TravelMemory {
  return {
    ...mem,
    updatedAt: new Date().toISOString(),
    dislikedTypeCounts: {
      ...mem.dislikedTypeCounts,
      [placeType]: (mem.dislikedTypeCounts[placeType] ?? 0) + 1,
    },
  };
}

const BUDGET_LEAN_TEXT: Record<BudgetLean, string> = {
  budget: 'prefers budget-friendly options',
  balanced: 'prefers a balanced budget',
  splurge: 'is open to splurging',
};

/**
 * Render memory as a compact block to append to the agent's user prompt.
 * Framed explicitly as soft/secondary so the model treats the current
 * request's explicit fields as authoritative. Returns '' when there's
 * nothing worth injecting (first-time users, or after clearMemory()).
 */
export function buildMemoryPromptContext(mem: TravelMemory, currentDestination?: string): string {
  if (isMemoryEmpty(mem)) return '';

  const lines: string[] = [
    'Returning user context (from past sessions on this device — soft preferences only; the explicit fields above always take priority when they conflict):',
  ];

  if (mem.preferredVibes.length > 0) {
    lines.push(`- Frequently interested in: ${mem.preferredVibes.join(', ')}`);
  }
  if (mem.groupType) {
    lines.push(`- Usually travels as: ${mem.groupType}`);
  }
  if (mem.budgetLean) {
    lines.push(`- Budget lean: ${BUDGET_LEAN_TEXT[mem.budgetLean]}`);
  }
  if (mem.specialNeeds.length > 0) {
    lines.push(`- Special needs previously mentioned: ${mem.specialNeeds.join(', ')}`);
  }
  const pastDestinations = mem.visitedDestinations.filter(
    d => d.trim().toLowerCase() !== (currentDestination ?? '').trim().toLowerCase(),
  );
  if (pastDestinations.length > 0) {
    lines.push(`- Previously planned trips to: ${pastDestinations.slice(0, 5).join(', ')}`);
  }
  const dislikedTypes = Object.entries(mem.dislikedTypeCounts)
    .filter(([, count]) => (count ?? 0) >= 2)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([type]) => type);
  if (dislikedTypes.length > 0) {
    lines.push(`- Has repeatedly removed these place types from past itineraries: ${dislikedTypes.join(', ')}`);
  }
  if (mem.notes.length > 0) {
    lines.push(`- Notes from past clarifications: ${mem.notes.map(n => `"${n}"`).join('; ')}`);
  }

  return lines.join('\n');
}

/** Short one-line human-readable summary for a UI banner ("we remembered..."). */
export function summariseMemory(mem: TravelMemory): string | null {
  if (isMemoryEmpty(mem)) return null;
  const parts: string[] = [];
  if (mem.preferredVibes.length > 0) parts.push(mem.preferredVibes.slice(0, 3).join('/'));
  if (mem.groupType) parts.push(mem.groupType);
  if (mem.lastBudget) parts.push(`¥${mem.lastBudget.min}–${mem.lastBudget.max}`);
  if (parts.length === 0) return 'We remembered a few things from your last trip.';
  return `We remembered your preferences from last time: ${parts.join(' · ')}.`;
}
