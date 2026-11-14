/**
 * User memory never reaches the shared experience library, and the live
 * server never writes that library. These are source-level checks on the
 * few files where such a link could be added by mistake.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (f: string) => fs.readFileSync(f, 'utf8');

describe('user memory stays out of the experience library', () => {
  it('the learning loop and the eval harness never see memory', () => {
    for (const f of ['tests/eval/learn.ts', 'tests/eval/run-eval.ts', 'server/experience/prompts.ts', 'server/experience/library.ts', 'server/experience/retrieve.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/memoryContext|user_memory|TravelMemory|memoryStore|extract-preferences/);
    }
  });

  it('the live server only reads the library', () => {
    for (const f of ['server.ts', 'server/experience/live.ts', 'server/preferences.ts', 'server/grounding.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/saveLibrary|applyLibraryOps|applyOps\(/);
    }
  });

  it('the server never touches the user_memory table (it belongs to the browser session under RLS)', () => {
    for (const f of ['server.ts', 'server/preferences.ts']) {
      expect(read(f), f).not.toMatch(/user_memory|from\(['"]user_memory/i);
    }
  });
});
