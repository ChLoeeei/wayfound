import { describe, it, expect } from 'vitest';
import { buildClarifications } from '../../src/lib/clarifications';
import type { PlanningInput } from '../../src/types';

const baseInput = (overrides: Partial<PlanningInput> = {}): PlanningInput => ({
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-24',
  people: 2,
  groupType: 'couple',
  vibes: ['food'],
  budget: { min: 300, max: 1500 },
  specialNeeds: [],
  ...overrides,
});

describe('buildClarifications', () => {
  // PRD §3.1: at most 2 questions
  it('never returns more than 2 questions', () => {
    const out = buildClarifications(
      baseInput({
        destination: '京都, 大阪, 神户',
        vibes: ['food', 'culture', 'nature', 'shopping', 'leisure'],
        groupType: 'family',
        people: 5,
        budget: { min: 100, max: 5000 },
        startDate: '2026-05-20',
        endDate: '2026-05-30',
      }),
    );
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('returns no questions for a clean input', () => {
    expect(buildClarifications(baseInput())).toEqual([]);
  });

  it('asks about primary vibe when ≥ 4 vibes selected', () => {
    const out = buildClarifications(baseInput({ vibes: ['food', 'culture', 'nature', 'shopping'] }));
    expect(out.some(q => q.id === 'primaryVibe')).toBe(true);
  });

  it('asks about kids when family + ≥ 3 people without baby flag', () => {
    const out = buildClarifications(
      baseInput({ groupType: 'family', people: 4, specialNeeds: [] }),
    );
    expect(out.some(q => q.id === 'kidsOnBoard')).toBe(true);
  });

  it('does not ask about kids if baby flag is already set', () => {
    const out = buildClarifications(
      baseInput({ groupType: 'family', people: 4, specialNeeds: ['baby'] }),
    );
    expect(out.some(q => q.id === 'kidsOnBoard')).toBe(false);
  });

  it('asks about budget lean when range spans > 5x', () => {
    const out = buildClarifications(baseInput({ budget: { min: 200, max: 2000 } }));
    expect(out.some(q => q.id === 'budgetLean')).toBe(true);
  });

  it('does not ask about budget lean for normal ranges', () => {
    const out = buildClarifications(baseInput({ budget: { min: 300, max: 800 } }));
    expect(out.some(q => q.id === 'budgetLean')).toBe(false);
  });

  it('asks about multi-city when trip ≥ 8 days', () => {
    const out = buildClarifications(
      baseInput({ startDate: '2026-05-20', endDate: '2026-05-30' }),
    );
    expect(out.some(q => q.id === 'multiCity')).toBe(true);
  });

  it('asks for destination focus when destination contains separators', () => {
    const out = buildClarifications(baseInput({ destination: '京都, 大阪' }));
    expect(out.some(q => q.id === 'destinationFocus')).toBe(true);
  });

  it('every returned question has a non-empty question string and id', () => {
    const out = buildClarifications(
      baseInput({
        vibes: ['food', 'culture', 'nature', 'shopping'],
        budget: { min: 200, max: 1500 },
      }),
    );
    for (const q of out) {
      expect(q.id.length).toBeGreaterThan(0);
      expect(q.question.length).toBeGreaterThan(0);
    }
  });
});
