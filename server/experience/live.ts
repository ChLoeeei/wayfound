/**
 * The experience library the live server reads (v2 Core 2).
 *
 * Read-only: only the offline learning loop (tests/eval/learn.ts) writes
 * the file. The server loads it once and re-reads it when the file's
 * mtime changes, so a library produced by a later learning run is picked
 * up without a restart.
 *
 * `EXPERIENCE_LIBRARY=<path>` points the server at a different file;
 * `EXPERIENCE_LIBRARY=off` runs with no library at all (every plan then
 * behaves as `useLibrary: false`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { type Library, emptyLibrary, loadLibrary } from './library';
import { type InjectedLessons, lessonsForDestination } from './retrieve';

export const DEFAULT_LIBRARY_FILE = 'server/experience/data/library.group.json';

export function liveLibraryFile(): string | null {
  const raw = process.env.EXPERIENCE_LIBRARY?.trim();
  if (raw && raw.toLowerCase() === 'off') return null;
  return path.resolve(raw || DEFAULT_LIBRARY_FILE);
}

let cached: { file: string; mtimeMs: number; lib: Library } | null = null;

/** The current library (empty when disabled or missing). Cached by file mtime. */
export function getLiveLibrary(): Library {
  const file = liveLibraryFile();
  if (!file) return emptyLibrary();
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return emptyLibrary();
  }
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.lib;
  const lib = loadLibrary(file);
  cached = { file, mtimeMs, lib };
  return lib;
}

/** Forget the cached library (tests). */
export function resetLiveLibraryCache(): void {
  cached = null;
}

/**
 * Reads the request's `useLibrary` flag. Anything but an explicit `false`
 * (or the string "false") means on, which is the documented default.
 */
export function wantsLibrary(raw: unknown): boolean {
  return !(raw === false || raw === 'false' || raw === 0 || raw === '0');
}

/**
 * Lessons to inject for one live plan, or undefined when the library is
 * off for this request (then the agent's prompt is byte-identical to a
 * library-less run).
 */
export function lessonsForRequest(useLibrary: unknown, destination: string): InjectedLessons | undefined {
  if (!wantsLibrary(useLibrary)) return undefined;
  const lib = getLiveLibrary();
  const picked = lessonsForDestination(lib, destination);
  return picked.ids.length > 0 ? picked : undefined;
}
