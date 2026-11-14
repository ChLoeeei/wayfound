import type { BudgetRange, GroupType, PlaceType, PlanningInput, SpecialNeed, Vibe } from '../types';
import en from '../locales/en.json';
import zh from '../locales/zh.json';

/**
 * User memory (v2 feature A, the user layer of the two-layer memory).
 *
 * A structured record of what this traveller has told Wayfound: interests,
 * group type, budget, pace, things to avoid, special needs, past
 * destinations, plus place types they keep deleting. Guests keep it in
 * localStorage; signed-in users keep it in the Supabase `user_memory` table
 * (src/lib/memoryStore.ts), migrated from localStorage on first login.
 * `buildMemoryPromptContext` folds it into the next plan's prompt as soft
 * context; the current form always wins.
 *
 * Only explicit statements get in. Form fields and quick-pick answers are
 * explicit by construction and are recorded here deterministically; free
 * text goes through the server's extraction step (server/preferences.ts),
 * which keeps an item only when it can quote the user saying it. Nothing
 * here ever reaches the shared experience library.
 */

const STORAGE_KEY = 'wayfound.memory.v1';
const MAX_VIBES = 6;
const MAX_DESTINATIONS = 8;
const MAX_NOTES = 6;
const MAX_AVOID = 8;
const MAX_SPECIAL_NEEDS = 8;

export type BudgetLean = 'budget' | 'balanced' | 'splurge';
export type Pace = 'relaxed' | 'moderate' | 'packed';
export const PACES: Pace[] = ['relaxed', 'moderate', 'packed'];
export const BUDGET_LEANS: BudgetLean[] = ['budget', 'balanced', 'splurge'];

export interface TravelMemory {
  version: 2;
  updatedAt: string | null;
  /** Vibes used across past sessions, most-recently-used first, deduped. */
  preferredVibes: Vibe[];
  /** Group type from the most recent session. */
  groupType?: GroupType;
  /** Budget lean from the "budgetLean" clarification answer, if ever given. */
  budgetLean?: BudgetLean;
  /** Most recent budget range, used to prefill the form. */
  lastBudget?: BudgetRange;
  /** Special needs seen across sessions, unioned. */
  specialNeeds: SpecialNeed[];
  /** Destinations planned before, most-recent first, deduped case-insensitively. */
  visitedDestinations: string[];
  /** Counts of place types the user has deleted from a generated itinerary — a soft "avoid this" signal. */
  dislikedTypeCounts: Partial<Record<PlaceType, number>>;
  /** Free-text clarification answers that neither matched a quick-pick option nor were extracted into a field. */
  notes: string[];
  /** Preferred pace, only when the user said so. */
  pace?: Pace;
  /** Things the user explicitly asked to avoid, in their words. */
  avoid: string[];
}

export function emptyMemory(): TravelMemory {
  return {
    version: 2,
    updatedAt: null,
    preferredVibes: [],
    specialNeeds: [],
    visitedDestinations: [],
    dislikedTypeCounts: {},
    notes: [],
    avoid: [],
  };
}

/** True when there is nothing worth injecting into a prompt or showing in the UI yet. */
export function isMemoryEmpty(mem: TravelMemory): boolean {
  return (
    mem.preferredVibes.length === 0 &&
    !mem.groupType &&
    !mem.budgetLean &&
    !mem.lastBudget &&
    !mem.pace &&
    mem.specialNeeds.length === 0 &&
    mem.visitedDestinations.length === 0 &&
    Object.keys(mem.dislikedTypeCounts).length === 0 &&
    mem.notes.length === 0 &&
    mem.avoid.length === 0
  );
}

/**
 * Turns a stored blob (localStorage or the Supabase row) into a valid
 * memory: v1 blobs gain the v2 fields, anything unusable becomes empty.
 */
export function normalizeMemory(raw: unknown): TravelMemory {
  if (!raw || typeof raw !== 'object') return emptyMemory();
  const parsed = raw as Partial<Omit<TravelMemory, 'version'>> & { version?: number };
  if (parsed.version !== 1 && parsed.version !== 2) return emptyMemory();
  const base = emptyMemory();
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter(x => typeof x === 'string') as T[]) : []);
  return {
    ...base,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    preferredVibes: list<Vibe>(parsed.preferredVibes).slice(0, MAX_VIBES),
    ...(parsed.groupType ? { groupType: parsed.groupType } : {}),
    ...(parsed.budgetLean && BUDGET_LEANS.includes(parsed.budgetLean) ? { budgetLean: parsed.budgetLean } : {}),
    ...(parsed.lastBudget && typeof parsed.lastBudget.min === 'number' && typeof parsed.lastBudget.max === 'number'
      ? { lastBudget: { min: parsed.lastBudget.min, max: parsed.lastBudget.max } }
      : {}),
    specialNeeds: list<SpecialNeed>(parsed.specialNeeds).slice(0, MAX_SPECIAL_NEEDS),
    visitedDestinations: list<string>(parsed.visitedDestinations).slice(0, MAX_DESTINATIONS),
    dislikedTypeCounts: parsed.dislikedTypeCounts && typeof parsed.dislikedTypeCounts === 'object' ? { ...parsed.dislikedTypeCounts } : {},
    notes: list<string>(parsed.notes).slice(0, MAX_NOTES),
    ...(parsed.pace && PACES.includes(parsed.pace) ? { pace: parsed.pace } : {}),
    avoid: list<string>(parsed.avoid).slice(0, MAX_AVOID),
  };
}

export function loadMemory(): TravelMemory {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMemory();
    return normalizeMemory(JSON.parse(raw));
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

// Quick-pick answers are stored as their rendered text in the active UI
// language (see src/lib/clarifyText.ts), so recognising them means checking
// every locale's option texts, not one hard-coded English list.
const LOCALES = [en, zh] as const;

function optionTexts(questionId: string, optionKey: string): string[] {
  return LOCALES.map(l => (l.clarify as any)[questionId]?.options?.[optionKey]).filter((v): v is string => typeof v === 'string');
}

const BUDGET_LEAN_ANSWERS: Record<string, BudgetLean> = Object.fromEntries(
  BUDGET_LEANS.flatMap(lean => optionTexts('budgetLean', lean).map(text => [text, lean])),
);

const VIBE_KEYS: Vibe[] = ['nature', 'culture', 'food', 'shopping', 'leisure', 'adventure'];
// primaryVibe stores the rendered vibe label, in either language.
const VIBE_ANSWERS = new Set<string>(LOCALES.flatMap(l => VIBE_KEYS.map(v => (l.form.vibes as any)[v] as string)));

// Known quick-pick answers across all clarification questions (see
// src/lib/clarifications.ts). Anything else the user typed free-form is
// free text: it becomes a note, and goes through the extraction step.
const KNOWN_ANSWERS = new Set<string>([
  ...Object.keys(BUDGET_LEAN_ANSWERS),
  ...optionTexts('kidsOnBoard', 'kids'),
  ...optionTexts('kidsOnBoard', 'adults'),
  ...optionTexts('multiCity', 'one'),
  ...optionTexts('multiCity', 'multi'),
  ...VIBE_ANSWERS,
]);

/** Free-text answers in a session: what the extraction step gets to read. */
export function freeTextAnswers(input: Pick<PlanningInput, 'clarifications'>): string[] {
  return Object.values(input.clarifications ?? {})
    .map(a => a.trim())
    .filter(a => a && !KNOWN_ANSWERS.has(a));
}

function dedupePrependCapped(list: string[], value: string, max: number): string[] {
  const lower = value.trim().toLowerCase();
  if (!lower) return list;
  const rest = list.filter(v => v.trim().toLowerCase() !== lower);
  return [value.trim(), ...rest].slice(0, max);
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
 * Everything recorded here was chosen or typed by the user on the form.
 */
export function recordPlanningSession(mem: TravelMemory, input: PlanningInput): TravelMemory {
  const next: TravelMemory = {
    ...mem,
    updatedAt: new Date().toISOString(),
    preferredVibes: mergeVibes(mem.preferredVibes, input.vibes),
    groupType: input.groupType,
    lastBudget: input.budget,
    specialNeeds: mergeSpecialNeeds(mem.specialNeeds, input.specialNeeds),
    visitedDestinations: dedupePrependCapped(mem.visitedDestinations, input.destination, MAX_DESTINATIONS),
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

// ==================== Extraction results ====================

/** What the server's extraction step returns (server/preferences.ts): only quoted, explicit statements. */
export interface ExtractedPreferences {
  pace?: Pace;
  interests?: Vibe[];
  avoid?: string[];
  budget?: BudgetRange;
  notes?: string[];
}

/**
 * Merge extracted preferences. The free texts the extractor read are
 * removed from `notes` (their content now lives in fields); anything the
 * extractor returned as a note is kept verbatim.
 */
export function applyExtractedPreferences(mem: TravelMemory, extracted: ExtractedPreferences, consumedTexts: string[] = []): TravelMemory {
  const consumed = new Set(consumedTexts.map(s => s.trim()));
  let notes = mem.notes.filter(n => !consumed.has(n.trim()));
  for (const n of [...(extracted.notes ?? [])].reverse()) notes = dedupePrependCapped(notes, n, MAX_NOTES);
  let avoid = mem.avoid;
  for (const a of [...(extracted.avoid ?? [])].reverse()) avoid = dedupePrependCapped(avoid, a, MAX_AVOID);
  return {
    ...mem,
    updatedAt: new Date().toISOString(),
    ...(extracted.pace ? { pace: extracted.pace } : {}),
    ...(extracted.budget ? { lastBudget: extracted.budget } : {}),
    preferredVibes: extracted.interests?.length ? mergeVibes(mem.preferredVibes, extracted.interests) : mem.preferredVibes,
    avoid,
    notes,
  };
}

// ==================== Per-item editing (the "My preferences" tab) ====================

export type MemoryListField = 'preferredVibes' | 'specialNeeds' | 'visitedDestinations' | 'avoid' | 'notes';
export type MemoryTextField = 'visitedDestinations' | 'avoid' | 'notes';
export type MemoryScalarField = 'groupType' | 'budgetLean' | 'lastBudget' | 'pace';

const touched = (mem: TravelMemory): TravelMemory => ({ ...mem, updatedAt: new Date().toISOString() });

export function removeListItem(mem: TravelMemory, field: MemoryListField, value: string): TravelMemory {
  return touched({ ...mem, [field]: (mem[field] as string[]).filter(v => v !== value) } as TravelMemory);
}

export function editListItem(mem: TravelMemory, field: MemoryTextField, oldValue: string, newValue: string): TravelMemory {
  const next = newValue.trim();
  if (!next) return removeListItem(mem, field, oldValue);
  const list = mem[field].map(v => (v === oldValue ? next : v));
  // Keep one copy if the edit made a duplicate.
  const seen = new Set<string>();
  return touched({ ...mem, [field]: list.filter(v => (seen.has(v.toLowerCase()) ? false : (seen.add(v.toLowerCase()), true))) });
}

export function clearScalar(mem: TravelMemory, field: MemoryScalarField): TravelMemory {
  const next = { ...mem } as TravelMemory;
  delete next[field];
  return touched(next);
}

export function setScalar(mem: TravelMemory, patch: Partial<Pick<TravelMemory, MemoryScalarField>>): TravelMemory {
  return touched({ ...mem, ...patch });
}

export function removeDislikedType(mem: TravelMemory, type: PlaceType): TravelMemory {
  const counts = { ...mem.dislikedTypeCounts };
  delete counts[type];
  return touched({ ...mem, dislikedTypeCounts: counts });
}

// ==================== Prompt context ====================

const BUDGET_LEAN_TEXT: Record<BudgetLean, string> = {
  budget: 'prefers budget-friendly options',
  balanced: 'prefers a balanced budget',
  splurge: 'is open to splurging',
};

const PACE_TEXT: Record<Pace, string> = {
  relaxed: 'relaxed (fewer stops per day, no early starts, time to linger)',
  moderate: 'moderate',
  packed: 'packed (happy to start early and fit in more stops)',
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
    'Returning user context (from past sessions — soft preferences only; the explicit fields above always take priority when they conflict):',
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
  if (mem.pace) {
    lines.push(`- Preferred pace: ${PACE_TEXT[mem.pace]}`);
  }
  if (mem.avoid.length > 0) {
    lines.push(`- Asked to avoid: ${mem.avoid.map(a => `"${a}"`).join('; ')}`);
  }
  if (mem.specialNeeds.length > 0) {
    lines.push(`- Special needs previously mentioned: ${mem.specialNeeds.join(', ')}`);
  }
  const pastDestinations = mem.visitedDestinations.filter(d => d.trim().toLowerCase() !== (currentDestination ?? '').trim().toLowerCase());
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
