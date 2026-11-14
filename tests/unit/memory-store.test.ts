import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the Supabase `user_memory` table.
const rows = new Map<string, any>();
let failNext: string | null = null;
vi.mock('../../src/supabase', () => {
  const fail = () => {
    if (!failNext) return null;
    const e = { message: failNext };
    failNext = null;
    return e;
  };
  return {
    supabase: {
      from: (_table: string) => ({
        select: () => ({
          eq: (_c: string, id: string) => ({
            maybeSingle: async () => ({ data: rows.has(id) ? { memory: rows.get(id) } : null, error: fail() }),
          }),
        }),
        upsert: async (row: { user_id: string; memory: any }) => {
          const error = fail();
          if (!error) rows.set(row.user_id, row.memory);
          return { error };
        },
        delete: () => ({
          eq: async (_c: string, id: string) => {
            const error = fail();
            if (!error) rows.delete(id);
            return { error };
          },
        }),
      }),
    },
  };
});

import { emptyMemory, loadMemory, recordPlanningSession, saveMemory } from '../../src/lib/memory';
import { loadRemoteMemory, persistMemory, resolveMemoryOnLogin, saveRemoteMemory, wipeMemory } from '../../src/lib/memoryStore';
import type { PlanningInput } from '../../src/types';

const input: PlanningInput = {
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-24',
  people: 2,
  groupType: 'couple',
  vibes: ['food'],
  budget: { min: 300, max: 1500 },
  specialNeeds: [],
};

beforeEach(() => {
  rows.clear();
  failNext = null;
  window.localStorage.clear();
});

describe('memoryStore', () => {
  it('first login with guest memory: uploads it to the account and clears the browser copy', async () => {
    const local = recordPlanningSession(emptyMemory(), input);
    saveMemory(local);
    const r = await resolveMemoryOnLogin('u1', loadMemory());
    expect(r.migrated).toBe(true);
    expect(r.memory.visitedDestinations).toEqual(['Kyoto']);
    expect(rows.get('u1').visitedDestinations).toEqual(['Kyoto']);
    expect(loadMemory().visitedDestinations).toEqual([]);
  });

  it('first login with nothing local: no row is created', async () => {
    const r = await resolveMemoryOnLogin('u1', emptyMemory());
    expect(r.migrated).toBe(false);
    expect(rows.has('u1')).toBe(false);
  });

  it('later logins: the account row wins and the guest copy is untouched', async () => {
    await saveRemoteMemory('u1', { ...emptyMemory(), visitedDestinations: ['Lisbon'] });
    const local = recordPlanningSession(emptyMemory(), input);
    saveMemory(local);
    const r = await resolveMemoryOnLogin('u1', local);
    expect(r.migrated).toBe(false);
    expect(r.memory.visitedDestinations).toEqual(['Lisbon']);
    expect(loadMemory().visitedDestinations).toEqual(['Kyoto']);
  });

  it('normalises whatever is in the row (a v1 blob gains the v2 fields)', async () => {
    rows.set('u1', { version: 1, updatedAt: null, preferredVibes: ['food'], specialNeeds: [], visitedDestinations: [], dislikedTypeCounts: {}, notes: [] });
    const m = await loadRemoteMemory('u1');
    expect(m?.version).toBe(2);
    expect(m?.avoid).toEqual([]);
    expect(m?.preferredVibes).toEqual(['food']);
  });

  it('persistMemory writes locally for guests and remotely for users, falling back to local on failure', async () => {
    const mem = recordPlanningSession(emptyMemory(), input);
    await persistMemory(null, mem);
    expect(loadMemory().visitedDestinations).toEqual(['Kyoto']);
    window.localStorage.clear();
    await persistMemory('u2', mem);
    expect(rows.get('u2').visitedDestinations).toEqual(['Kyoto']);
    expect(loadMemory().visitedDestinations).toEqual([]);
    failNext = 'network down';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await persistMemory('u3', mem);
    spy.mockRestore();
    expect(rows.has('u3')).toBe(false);
    expect(loadMemory().visitedDestinations).toEqual(['Kyoto']);
  });

  it('wipeMemory clears both copies', async () => {
    saveMemory(recordPlanningSession(emptyMemory(), input));
    await saveRemoteMemory('u1', recordPlanningSession(emptyMemory(), input));
    await wipeMemory('u1');
    expect(rows.has('u1')).toBe(false);
    expect(loadMemory().visitedDestinations).toEqual([]);
  });
});
