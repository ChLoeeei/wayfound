/**
 * Experience library (v2 Core 1): written strategy lessons the agent learns
 * from groups of its own scored runs (Training-Free GRPO) and reads at plan
 * time. No weights change. Stored as one versioned JSON file; it moves to
 * Supabase with Feature A.
 *
 * Only the offline learning loop (tests/eval/learn.ts) writes the library.
 * A live plan only reads it (see retrieve.ts).
 *
 * Edits are item-level operations (ADD / MODIFY / DELETE / KEEP, the ACE
 * update rule), never a full rewrite, and every operation is validated here
 * rather than trusted from the model.
 */
import fs from 'node:fs';
import path from 'node:path';

export const LIBRARY_SCHEMA_VERSION = 1;

/** Hard cap on lessons. Past it, near-duplicates are merged, then the worst-rated are dropped. */
export const MAX_LESSONS = 40;
export const MAX_LESSON_CHARS = 280;

export const REGION_SCOPES = ['domestic', 'international'] as const;
export const TOOL_SCOPES = ['search_places', 'get_poi_details', 'calculate_distance', 'get_destination_context', 'final_answer'] as const;
export type RegionScope = (typeof REGION_SCOPES)[number];
export type ToolScope = (typeof TOOL_SCOPES)[number];

export interface Lesson {
  id: string;
  /** `domestic` | `international` | a tool name | `<region>/<tool>`, or `general`. */
  scope: string;
  lesson: string;
  helpful: number;
  harmful: number;
  created_epoch: number;
  /** Training case the lesson was distilled from (never a test case). */
  source_case: string;
  updated_epoch?: number;
}

export interface Library {
  schemaVersion: number;
  /** Increments on every saved change, so a trace can name the exact library it read. */
  libraryVersion: number;
  /** `group` = Training-Free GRPO (best vs worst of a group); `single` = ReasoningBank-style ablation. */
  method: 'group' | 'single';
  epoch: number;
  nextId: number;
  updatedAt: string;
  lessons: Lesson[];
}

export type LibraryOp =
  | { op: 'ADD'; scope: string; lesson: string; source_case?: string }
  | { op: 'MODIFY'; id: string; lesson?: string; scope?: string }
  | { op: 'DELETE'; id: string }
  | { op: 'KEEP'; id?: string };

export function emptyLibrary(method: Library['method'] = 'group'): Library {
  return { schemaVersion: LIBRARY_SCHEMA_VERSION, libraryVersion: 0, method, epoch: 0, nextId: 1, updatedAt: new Date().toISOString(), lessons: [] };
}

// ==================== Scope ====================

export interface ParsedScope {
  region?: RegionScope;
  tool?: ToolScope;
}

/** Parses a scope string, or returns null if it isn't one of the allowed forms. */
export function parseScope(scope: string): ParsedScope | null {
  const s = String(scope ?? '').trim().toLowerCase();
  if (s === 'general') return {};
  const parts = s.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  const out: ParsedScope = {};
  for (const p of parts) {
    if ((REGION_SCOPES as readonly string[]).includes(p) && !out.region) out.region = p as RegionScope;
    else if ((TOOL_SCOPES as readonly string[]).includes(p) && !out.tool) out.tool = p as ToolScope;
    else return null;
  }
  return out;
}

export function normalizeScope(scope: string): string | null {
  const p = parseScope(scope);
  if (!p) return null;
  return [p.region, p.tool].filter(Boolean).join('/') || 'general';
}

// ==================== Specificity guard (cheap, pre-LLM) ====================

/**
 * Rejects lessons that memorize answers instead of strategy: coordinates,
 * provider POI ids, street addresses, quoted place names. The learning loop
 * also runs an LLM filter (prompts.ts `filterPrompt`) for named POIs this
 * regex can't see; this is the deterministic first pass.
 */
export function specificityViolation(lesson: string): string | null {
  const t = lesson;
  if (/-?\d{1,3}\.\d{3,}/.test(t)) return 'contains a coordinate-like number';
  if (/\b(B0[0-9A-Z]{6,}|osm[:_-]?\w+|node\/\d+|way\/\d+|poi[_-]\w+)\b/i.test(t)) return 'contains a provider POI id';
  if (/\d+\s*(号|弄|街道?\d)|\b\d+\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd)\b/.test(t)) return 'contains a street address';
  if (/[「『“"][^」』”"]{2,}[」』”"]/.test(t)) return 'quotes a specific name';
  return null;
}

// ==================== Load / save ====================

export function loadLibrary(file: string, method: Library['method'] = 'group'): Library {
  if (!fs.existsSync(file)) return emptyLibrary(method);
  const lib = JSON.parse(fs.readFileSync(file, 'utf8')) as Library;
  if (lib.schemaVersion !== LIBRARY_SCHEMA_VERSION) {
    throw new Error(`Experience library ${file} has schemaVersion ${lib.schemaVersion}, expected ${LIBRARY_SCHEMA_VERSION}`);
  }
  return lib;
}

/** Atomic write; bumps libraryVersion. */
export function saveLibrary(file: string, lib: Library): Library {
  const next = { ...lib, libraryVersion: lib.libraryVersion + 1, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return next;
}

/** Writes an immutable copy next to the library, e.g. library.epoch-2.json. */
export function snapshotLibrary(file: string, lib: Library, label: string): string {
  const dest = file.replace(/\.json$/, `.${label}.json`);
  fs.writeFileSync(dest, JSON.stringify(lib, null, 2) + '\n');
  return dest;
}

// ==================== Operations ====================

export interface ApplyResult {
  library: Library;
  applied: LibraryOp[];
  rejected: Array<{ op: unknown; reason: string }>;
}

/** Max ops accepted from one update call: keeps edits item-level, never a rewrite. */
export const MAX_OPS_PER_UPDATE = 4;

/**
 * Applies model-proposed operations, validating each. Pure: returns a new
 * library and never mutates the input.
 */
export function applyOps(lib: Library, ops: unknown[], ctx: { epoch: number; sourceCase: string }): ApplyResult {
  const library: Library = { ...lib, lessons: lib.lessons.map(l => ({ ...l })) };
  const applied: LibraryOp[] = [];
  const rejected: ApplyResult['rejected'] = [];
  const list = Array.isArray(ops) ? ops : [];
  const meaningful = list.filter(o => (o as any)?.op !== 'KEEP');
  if (meaningful.length > MAX_OPS_PER_UPDATE) {
    for (const op of meaningful.slice(MAX_OPS_PER_UPDATE)) rejected.push({ op, reason: `more than ${MAX_OPS_PER_UPDATE} edits in one update` });
  }
  const accepted = new Set(meaningful.slice(0, MAX_OPS_PER_UPDATE));

  for (const raw of list) {
    const o = raw as any;
    const kind = String(o?.op ?? '').toUpperCase();
    if (kind === 'KEEP') {
      applied.push({ op: 'KEEP', id: o.id });
      continue;
    }
    if (!accepted.has(raw)) continue;
    const reject = (reason: string) => rejected.push({ op: raw, reason });

    if (kind === 'ADD') {
      const scope = normalizeScope(o.scope);
      const text = String(o.lesson ?? '').trim();
      if (!scope) { reject(`invalid scope "${o.scope}"`); continue; }
      const bad = checkLessonText(text);
      if (bad) { reject(bad); continue; }
      const lesson: Lesson = {
        id: `L${String(library.nextId).padStart(2, '0')}`,
        scope,
        lesson: text,
        helpful: 0,
        harmful: 0,
        created_epoch: ctx.epoch,
        source_case: ctx.sourceCase,
      };
      library.nextId++;
      library.lessons.push(lesson);
      applied.push({ op: 'ADD', scope, lesson: text, source_case: ctx.sourceCase });
    } else if (kind === 'MODIFY' || kind === 'DELETE') {
      const idx = library.lessons.findIndex(l => l.id === o.id);
      if (idx < 0) { reject(`unknown lesson id "${o.id}"`); continue; }
      if (kind === 'DELETE') {
        library.lessons.splice(idx, 1);
        applied.push({ op: 'DELETE', id: o.id });
        continue;
      }
      const current = library.lessons[idx];
      const scope = o.scope !== undefined ? normalizeScope(o.scope) : current.scope;
      if (!scope) { reject(`invalid scope "${o.scope}"`); continue; }
      const text = o.lesson !== undefined ? String(o.lesson).trim() : current.lesson;
      const bad = checkLessonText(text);
      if (bad) { reject(bad); continue; }
      library.lessons[idx] = { ...current, scope, lesson: text, updated_epoch: ctx.epoch };
      applied.push({ op: 'MODIFY', id: o.id, scope, lesson: text });
    } else {
      reject(`unknown op "${o?.op}"`);
    }
  }
  return { library: enforceCap(library), applied, rejected };
}

function checkLessonText(text: string): string | null {
  if (!text) return 'empty lesson';
  if (text.length > MAX_LESSON_CHARS) return `lesson longer than ${MAX_LESSON_CHARS} chars`;
  return specificityViolation(text);
}

// ==================== Counters ====================

/**
 * A run that used a lesson and scored above its group mean credits the
 * lesson as helpful; below the mean, harmful. `epsilon` keeps ties neutral.
 */
export function updateCounters(lib: Library, usedIds: string[], reward: number, groupMean: number, epsilon = 0.01): Library {
  const delta = reward - groupMean;
  if (Math.abs(delta) <= epsilon || usedIds.length === 0) return lib;
  const used = new Set(usedIds);
  return {
    ...lib,
    lessons: lib.lessons.map(l =>
      used.has(l.id) ? { ...l, helpful: l.helpful + (delta > 0 ? 1 : 0), harmful: l.harmful + (delta < 0 ? 1 : 0) } : l,
    ),
  };
}

export const netScore = (l: Lesson) => l.helpful - l.harmful;

// ==================== Cap: merge near-duplicates ====================

/**
 * Character-bigram cosine similarity. The plan calls for embedding
 * similarity, but DeepSeek has no embedding endpoint and adding a second
 * provider just for this isn't worth it at 40 lessons; bigrams work for
 * both Chinese and English text and are deterministic.
 */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/\s+/g, ' ');
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let dot = 0;
  for (const [g, n] of ga) dot += n * (gb.get(g) ?? 0);
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  const d = norm(ga) * norm(gb);
  return d === 0 ? 0 : dot / d;
}

export const MERGE_SIMILARITY = 0.8;

/**
 * Under the cap: unchanged. Over it: merge the most similar same-scope pair
 * (keep the better-rated text, sum the counters) until under the cap or no
 * pair reaches MERGE_SIMILARITY; then drop the lowest-net lessons.
 */
export function enforceCap(lib: Library, cap = MAX_LESSONS): Library {
  if (lib.lessons.length <= cap) return lib;
  const lessons = lib.lessons.map(l => ({ ...l }));
  while (lessons.length > cap) {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < lessons.length; i++) {
      for (let j = i + 1; j < lessons.length; j++) {
        if (lessons[i].scope !== lessons[j].scope) continue;
        const s = similarity(lessons[i].lesson, lessons[j].lesson);
        if (s >= MERGE_SIMILARITY && (!best || s > best[2])) best = [i, j, s];
      }
    }
    if (!best) break;
    const [i, j] = best;
    const [keep, drop] = netScore(lessons[i]) >= netScore(lessons[j]) ? [i, j] : [j, i];
    lessons[keep] = { ...lessons[keep], helpful: lessons[keep].helpful + lessons[drop].helpful, harmful: lessons[keep].harmful + lessons[drop].harmful };
    lessons.splice(drop, 1);
  }
  if (lessons.length > cap) {
    const ranked = [...lessons].sort((a, b) => netScore(a) - netScore(b) || a.created_epoch - b.created_epoch);
    const dropIds = new Set(ranked.slice(0, lessons.length - cap).map(l => l.id));
    return { ...lib, lessons: lessons.filter(l => !dropIds.has(l.id)) };
  }
  return { ...lib, lessons };
}
