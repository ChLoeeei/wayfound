import { describe, it, expect } from 'vitest';
import { allCases, caseSetVersion, selectCases, parseSplit } from '../eval/cases';
import { getMapProvider } from '../../server/tools/provider';

// Guards the frozen train/test split (cases.json v2). If one of these
// fails, do not "fix" it by moving cases between splits: that silently
// invalidates every number already reported on the test set.
describe('eval case set (cases.json)', () => {
  it('is v2 with 60 cases and unique ids', () => {
    expect(caseSetVersion).toBe(2);
    expect(allCases).toHaveLength(60);
    expect(new Set(allCases.map(c => c.id)).size).toBe(60);
  });

  it('assigns every case to train or test, 15 domestic + 15 international on each side', () => {
    for (const split of ['train', 'test'] as const) {
      const cs = allCases.filter(c => c.split === split);
      expect(cs.filter(c => c.region === 'domestic')).toHaveLength(15);
      expect(cs.filter(c => c.region === 'international')).toHaveLength(15);
    }
    expect(allCases.every(c => c.split === 'train' || c.split === 'test')).toBe(true);
  });

  it("labels region consistently with the agent's own map-provider routing", () => {
    for (const c of allCases) {
      expect(getMapProvider(c.destination), c.id).toBe(c.region === 'domestic' ? 'amap' : 'mapbox');
    }
  });

  it('never puts the same destination in both splits', () => {
    const train = new Set(allCases.filter(c => c.split === 'train').map(c => c.destination.toLowerCase()));
    const leaked = allCases.filter(c => c.split === 'test' && train.has(c.destination.toLowerCase()));
    expect(leaked.map(c => c.id)).toEqual([]);
  });

  it('keeps the cases behind the README before/after numbers on the held-out side', () => {
    for (const id of ['beijing-solo-history', 'tokyo-family-food-culture', 'paris-couple-culture-food']) {
      expect(allCases.find(c => c.id === id)?.split, id).toBe('test');
    }
  });

  it('has well-formed trip parameters', () => {
    for (const c of allCases) {
      expect(c.days, c.id).toBeGreaterThanOrEqual(1);
      expect(c.people, c.id).toBeGreaterThanOrEqual(1);
      expect(c.preferences.length, c.id).toBeGreaterThan(0);
      expect(c.budget.min, c.id).toBeLessThan(c.budget.max);
      expect(['solo', 'couple', 'friends', 'family'], c.id).toContain(c.groupType);
    }
  });
});

describe('selectCases / parseSplit', () => {
  it('defaults to the test split', () => {
    expect(parseSplit(undefined)).toBe('test');
    expect(() => parseSplit('dev')).toThrow();
  });

  it('selects by split, and lets explicit ids override the split', () => {
    expect(selectCases(allCases, { split: 'test' })).toHaveLength(30);
    expect(selectCases(allCases, { split: 'all' })).toHaveLength(60);
    const trainId = allCases.find(c => c.split === 'train')!.id;
    expect(selectCases(allCases, { split: 'test', filterIds: [trainId] }).map(c => c.id)).toEqual([trainId]);
  });
});
