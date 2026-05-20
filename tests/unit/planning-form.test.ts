import { describe, it, expect } from 'vitest';
import { diffDays, isBudgetValid, isPlanningInputValid } from '../../src/components/PlanningForm';
import type { PlanningInput } from '../../src/types';

const validInput = (overrides: Partial<PlanningInput> = {}): PlanningInput => ({
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

describe('diffDays', () => {
  // PRD §7.2: deterministic — 行程天数与输入一致 / 100% 匹配
  it('5/20 to 5/24 inclusive is 5 days', () => {
    expect(diffDays('2026-05-20', '2026-05-24')).toBe(5);
  });

  it('same day is 1 day', () => {
    expect(diffDays('2026-05-20', '2026-05-20')).toBe(1);
  });

  it('end before start returns 0', () => {
    expect(diffDays('2026-05-24', '2026-05-20')).toBe(0);
  });

  it('crossing month boundaries works', () => {
    expect(diffDays('2026-05-30', '2026-06-02')).toBe(4);
  });

  it('empty inputs return 0', () => {
    expect(diffDays('', '2026-05-24')).toBe(0);
    expect(diffDays('2026-05-20', '')).toBe(0);
  });
});

describe('isBudgetValid', () => {
  it('accepts min ≤ max', () => {
    expect(isBudgetValid({ min: 100, max: 500 })).toBe(true);
    expect(isBudgetValid({ min: 500, max: 500 })).toBe(true);
  });

  it('rejects min > max', () => {
    expect(isBudgetValid({ min: 800, max: 500 })).toBe(false);
  });

  it('rejects negative', () => {
    expect(isBudgetValid({ min: -1, max: 500 })).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isBudgetValid({ min: NaN, max: 500 })).toBe(false);
  });
});

describe('isPlanningInputValid', () => {
  it('accepts a fully filled input', () => {
    expect(isPlanningInputValid(validInput())).toBe(true);
  });

  it('rejects empty destination', () => {
    expect(isPlanningInputValid(validInput({ destination: '   ' }))).toBe(false);
  });

  it('rejects missing dates', () => {
    expect(isPlanningInputValid(validInput({ startDate: '' }))).toBe(false);
    expect(isPlanningInputValid(validInput({ endDate: '' }))).toBe(false);
  });

  it('rejects end before start', () => {
    expect(
      isPlanningInputValid(validInput({ startDate: '2026-05-24', endDate: '2026-05-20' })),
    ).toBe(false);
  });

  it('requires at least one vibe', () => {
    expect(isPlanningInputValid(validInput({ vibes: [] }))).toBe(false);
  });

  it('rejects 0 people', () => {
    expect(isPlanningInputValid(validInput({ people: 0 }))).toBe(false);
  });
});
