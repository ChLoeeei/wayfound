import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_LIBRARY_FILE, getLiveLibrary, lessonsForRequest, liveLibraryFile, resetLiveLibraryCache, wantsLibrary } from '../../server/experience/live';
import { emptyLibrary, saveLibrary } from '../../server/experience/library';

const ORIGINAL = process.env.EXPERIENCE_LIBRARY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPERIENCE_LIBRARY;
  else process.env.EXPERIENCE_LIBRARY = ORIGINAL;
  resetLiveLibraryCache();
});

describe('live experience library', () => {
  it('is on unless the request says false', () => {
    expect(wantsLibrary(undefined)).toBe(true);
    expect(wantsLibrary(true)).toBe(true);
    expect(wantsLibrary('yes')).toBe(true);
    expect(wantsLibrary(false)).toBe(false);
    expect(wantsLibrary('false')).toBe(false);
  });

  it('reads the committed group library by default', () => {
    delete process.env.EXPERIENCE_LIBRARY;
    expect(liveLibraryFile()).toBe(path.resolve(DEFAULT_LIBRARY_FILE));
    const lib = getLiveLibrary();
    expect(lib.lessons.length).toBeGreaterThan(0);
    expect(lib.libraryVersion).toBeGreaterThan(0);
  });

  it('injects nothing for useLibrary: false and a selection otherwise', () => {
    delete process.env.EXPERIENCE_LIBRARY;
    expect(lessonsForRequest(false, 'Kyoto')).toBeUndefined();
    const intl = lessonsForRequest(undefined, 'Kyoto');
    const dom = lessonsForRequest(true, '北京');
    expect(intl?.ids.length).toBeGreaterThan(0);
    expect(dom?.ids.length).toBeGreaterThan(0);
    expect(intl?.block).toContain(intl!.ids[0]);
    expect(intl?.libraryVersion).toBe(getLiveLibrary().libraryVersion);
  });

  it('can be switched off or pointed at another file, and follows file changes', () => {
    process.env.EXPERIENCE_LIBRARY = 'off';
    expect(liveLibraryFile()).toBeNull();
    expect(lessonsForRequest(true, 'Kyoto')).toBeUndefined();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfound-lib-'));
    const file = path.join(dir, 'library.json');
    process.env.EXPERIENCE_LIBRARY = file;
    resetLiveLibraryCache();
    expect(getLiveLibrary().lessons).toEqual([]);

    const lib = emptyLibrary();
    lib.lessons.push({ id: 'L01', scope: 'general', lesson: 'Check each day against the budget cap before answering.', helpful: 1, harmful: 0, created_epoch: 1, source_case: 'x' });
    saveLibrary(file, lib);
    // Force a visible mtime change on coarse filesystems.
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);
    expect(getLiveLibrary().lessons.map(l => l.id)).toEqual(['L01']);
    expect(lessonsForRequest(true, 'Kyoto')?.ids).toEqual(['L01']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
