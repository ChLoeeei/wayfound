/**
 * Client view of the experience library (GET /api/lessons): types, the
 * scope parser the Lessons panel filters with, and a small fetch cache so
 * the panel, the trace list and the compare page share one request.
 */

export interface Lesson {
  id: string;
  /** `general`, `domestic`, `international`, a tool name, or `<region>/<tool>`. */
  scope: string;
  lesson: string;
  helpful: number;
  harmful: number;
  created_epoch: number;
  source_case: string;
  updated_epoch?: number;
}

export interface LessonLibrary {
  libraryVersion: number;
  method: 'group' | 'single';
  epoch: number;
  updatedAt: string;
  lessons: Lesson[];
}

export const LESSON_REGIONS = ['domestic', 'international'] as const;
export const LESSON_TOOLS = ['search_places', 'get_poi_details', 'calculate_distance', 'get_destination_context', 'final_answer'] as const;
export type LessonRegion = (typeof LESSON_REGIONS)[number];
export type LessonTool = (typeof LESSON_TOOLS)[number];

export interface ParsedLessonScope {
  region?: LessonRegion;
  tool?: LessonTool;
}

/** Same grammar as server/experience/library.ts `parseScope`; unknown parts are ignored rather than rejected. */
export function parseLessonScope(scope: string): ParsedLessonScope {
  const out: ParsedLessonScope = {};
  for (const part of String(scope ?? '').toLowerCase().split('/')) {
    const p = part.trim();
    if ((LESSON_REGIONS as readonly string[]).includes(p)) out.region = p as LessonRegion;
    else if ((LESSON_TOOLS as readonly string[]).includes(p)) out.tool = p as LessonTool;
  }
  return out;
}

/** The panel's filter chips: everything, the lessons this plan used, or one tool scope. */
export const LESSON_FILTERS = ['all', 'used', 'search_places', 'calculate_distance', 'final_answer'] as const;
export type LessonFilter = (typeof LESSON_FILTERS)[number];

export function filterLessons(lessons: Lesson[], filter: LessonFilter, usedIds: readonly string[] = []): Lesson[] {
  if (filter === 'all') return lessons;
  if (filter === 'used') {
    const used = new Set(usedIds);
    return lessons.filter(l => used.has(l.id));
  }
  return lessons.filter(l => parseLessonScope(l.scope).tool === filter);
}

/** Lessons sorted the way the agent ranks them: net score, then id. */
export function sortLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort((a, b) => b.helpful - b.harmful - (a.helpful - a.harmful) || a.id.localeCompare(b.id));
}

let cache: Promise<LessonLibrary> | null = null;

/** Fetches the library once per page load; a failed fetch is retried on the next call. */
export function fetchLessons(): Promise<LessonLibrary> {
  if (!cache) {
    cache = fetch(`${process.env.API_BASE_URL}/api/lessons`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as LessonLibrary;
      })
      .catch(err => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

/** Tests only. */
export function resetLessonsCache(): void {
  cache = null;
}
