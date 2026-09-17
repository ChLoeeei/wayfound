import { describe, it, expect, beforeEach } from 'vitest';
import {
  emptyMemory,
  isMemoryEmpty,
  loadMemory,
  saveMemory,
  clearMemory,
  recordPlanningSession,
  recordPlaceDeleted,
  buildMemoryPromptContext,
  summariseMemory,
} from '../../src/lib/memory';
import type { PlanningInput } from '../../src/types';

const baseInput = (overrides: Partial<PlanningInput> = {}): PlanningInput => ({
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-24',
  people: 2,
  groupType: 'couple',
  vibes: ['food', 'culture'],
  budget: { min: 300, max: 1500 },
  specialNeeds: [],
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('emptyMemory / isMemoryEmpty', () => {
  it('a fresh memory is empty', () => {
    expect(isMemoryEmpty(emptyMemory())).toBe(true);
  });

  it('a memory with any signal is not empty', () => {
    const mem = recordPlanningSession(emptyMemory(), baseInput());
    expect(isMemoryEmpty(mem)).toBe(false);
  });
});

describe('loadMemory / saveMemory / clearMemory', () => {
  it('returns empty memory when nothing stored', () => {
    expect(loadMemory()).toEqual(emptyMemory());
  });

  it('returns empty memory when the stored blob is corrupt JSON', () => {
    window.localStorage.setItem('wayfound.memory.v1', '{not json');
    expect(loadMemory()).toEqual(emptyMemory());
  });

  it('returns empty memory when the stored blob has the wrong version', () => {
    window.localStorage.setItem('wayfound.memory.v1', JSON.stringify({ version: 2 }));
    expect(loadMemory()).toEqual(emptyMemory());
  });

  it('round-trips through save/load', () => {
    const mem = recordPlanningSession(emptyMemory(), baseInput());
    saveMemory(mem);
    expect(loadMemory()).toEqual(mem);
  });

  it('clearMemory removes the stored blob', () => {
    saveMemory(recordPlanningSession(emptyMemory(), baseInput()));
    clearMemory();
    expect(loadMemory()).toEqual(emptyMemory());
  });
});

describe('recordPlanningSession', () => {
  it('records vibes, group type, budget, and destination', () => {
    const mem = recordPlanningSession(emptyMemory(), baseInput());
    expect(mem.preferredVibes).toEqual(['culture', 'food']);
    expect(mem.groupType).toBe('couple');
    expect(mem.lastBudget).toEqual({ min: 300, max: 1500 });
    expect(mem.visitedDestinations).toEqual(['Kyoto']);
  });

  it('moves recently-used vibes to the front without duplicating', () => {
    let mem = recordPlanningSession(emptyMemory(), baseInput({ vibes: ['food', 'culture'] }));
    mem = recordPlanningSession(mem, baseInput({ vibes: ['adventure'] }));
    mem = recordPlanningSession(mem, baseInput({ vibes: ['food'] }));
    expect(mem.preferredVibes).toEqual(['food', 'adventure', 'culture']);
  });

  it('caps preferredVibes length', () => {
    let mem = emptyMemory();
    const all: PlanningInput['vibes'][number][] = ['food', 'culture', 'nature', 'shopping', 'leisure', 'adventure'];
    for (const v of all) {
      mem = recordPlanningSession(mem, baseInput({ vibes: [v] }));
    }
    expect(mem.preferredVibes.length).toBeLessThanOrEqual(6);
  });

  it('unions special needs across sessions', () => {
    let mem = recordPlanningSession(emptyMemory(), baseInput({ specialNeeds: ['vegetarian'] }));
    mem = recordPlanningSession(mem, baseInput({ specialNeeds: ['pet'] }));
    expect(mem.specialNeeds.sort()).toEqual(['pet', 'vegetarian']);
  });

  it('dedupes destinations case-insensitively and moves them to the front', () => {
    let mem = recordPlanningSession(emptyMemory(), baseInput({ destination: 'Kyoto' }));
    mem = recordPlanningSession(mem, baseInput({ destination: 'Tokyo' }));
    mem = recordPlanningSession(mem, baseInput({ destination: 'kyoto' }));
    expect(mem.visitedDestinations).toEqual(['kyoto', 'Tokyo']);
  });

  it('derives budgetLean from the known clarification answer', () => {
    const mem = recordPlanningSession(
      emptyMemory(),
      baseInput({ clarifications: { budgetLean: 'More budget-friendly' } }),
    );
    expect(mem.budgetLean).toBe('budget');
  });

  it('does not treat a known quick-pick answer as a free-text note', () => {
    const mem = recordPlanningSession(
      emptyMemory(),
      baseInput({ clarifications: { kidsOnBoard: 'Yes, kids too' } }),
    );
    expect(mem.notes).toEqual([]);
  });

  it('captures an unrecognised free-text clarification answer as a note', () => {
    const mem = recordPlanningSession(
      emptyMemory(),
      baseInput({ clarifications: { destinationFocus: 'Mostly the old town, skip the suburbs' } }),
    );
    expect(mem.notes).toEqual(['Mostly the old town, skip the suburbs']);
  });

  it('caps notes and keeps the most recent first', () => {
    let mem = emptyMemory();
    for (let i = 0; i < 8; i++) {
      mem = recordPlanningSession(mem, baseInput({ clarifications: { destinationFocus: `note ${i}` } }));
    }
    expect(mem.notes.length).toBeLessThanOrEqual(6);
    expect(mem.notes[0]).toBe('note 7');
  });
});

describe('recordPlaceDeleted', () => {
  it('increments the count for the deleted place type', () => {
    let mem = recordPlaceDeleted(emptyMemory(), 'shopping');
    mem = recordPlaceDeleted(mem, 'shopping');
    mem = recordPlaceDeleted(mem, 'cafe');
    expect(mem.dislikedTypeCounts).toEqual({ shopping: 2, cafe: 1 });
  });
});

describe('buildMemoryPromptContext', () => {
  it('returns empty string for empty memory', () => {
    expect(buildMemoryPromptContext(emptyMemory())).toBe('');
  });

  it('includes vibes, group type, budget lean, needs, past destinations and notes', () => {
    let mem = recordPlanningSession(emptyMemory(), baseInput({ destination: 'Kyoto', specialNeeds: ['vegetarian'] }));
    mem = recordPlanningSession(
      mem,
      baseInput({ destination: 'Tokyo', clarifications: { budgetLean: 'Balanced', destinationFocus: 'Loves ramen' } }),
    );
    const ctx = buildMemoryPromptContext(mem, 'Osaka');
    expect(ctx).toContain('food');
    expect(ctx).toContain('couple');
    expect(ctx).toContain('balanced budget');
    expect(ctx).toContain('vegetarian');
    expect(ctx).toContain('Tokyo');
    expect(ctx).toContain('Kyoto');
    expect(ctx).toContain('Loves ramen');
  });

  it('excludes the current destination from the "previously planned" list', () => {
    const mem = recordPlanningSession(emptyMemory(), baseInput({ destination: 'Kyoto' }));
    const ctx = buildMemoryPromptContext(mem, 'Kyoto');
    expect(ctx).not.toContain('Previously planned trips to');
  });

  it('only surfaces disliked types once they recur at least twice', () => {
    let mem = recordPlaceDeleted(emptyMemory(), 'shopping');
    expect(buildMemoryPromptContext(mem)).not.toContain('removed');
    mem = recordPlaceDeleted(mem, 'shopping');
    expect(buildMemoryPromptContext(mem)).toContain('shopping');
  });
});

describe('summariseMemory', () => {
  it('returns null for empty memory', () => {
    expect(summariseMemory(emptyMemory())).toBeNull();
  });

  it('returns a short human-readable summary otherwise', () => {
    const mem = recordPlanningSession(emptyMemory(), baseInput());
    const summary = summariseMemory(mem);
    expect(summary).toContain('food');
    expect(summary).toContain('couple');
  });
});
