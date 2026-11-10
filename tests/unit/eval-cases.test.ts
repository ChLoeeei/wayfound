import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { allCases, caseHash, caseSetVersion, isHardCase, selectCases, parseSplit } from '../eval/cases';
import { getMapProvider } from '../../server/tools/provider';

// Guards the frozen train/test split (cases.json v2 + the v3 hard cases).
// If one of these fails, do not "fix" it by moving or editing cases: that
// silently invalidates every number already reported on the test set.
const v2Cases = allCases.filter(c => !c.addedIn);
const hardCases = allCases.filter(isHardCase);

describe('eval case set (cases.json)', () => {
  it('is v3: the 60 v2 cases plus 10 hard cases, unique ids', () => {
    expect(caseSetVersion).toBe(3);
    expect(allCases).toHaveLength(70);
    expect(v2Cases).toHaveLength(60);
    expect(hardCases).toHaveLength(10);
    expect(new Set(allCases.map(c => c.id)).size).toBe(70);
  });

  it('keeps the 60 v2 cases byte-for-byte frozen', () => {
    expect(createHash('sha256').update(v2Cases.map(caseHash).join(',')).digest('hex').slice(0, 16)).toBe('1013cf723ff6e570');
  });

  it('v2 cases: every case in train or test, 15 domestic + 15 international on each side', () => {
    for (const split of ['train', 'test'] as const) {
      const cs = v2Cases.filter(c => c.split === split);
      expect(cs.filter(c => c.region === 'domestic')).toHaveLength(15);
      expect(cs.filter(c => c.region === 'international')).toHaveLength(15);
    }
    expect(allCases.every(c => c.split === 'train' || c.split === 'test')).toBe(true);
  });

  it('hard cases: tagged, added in v3, 2 domestic + 3 international per split', () => {
    for (const c of hardCases) expect(c.addedIn, c.id).toBe(3);
    expect(allCases.filter(c => c.addedIn && !isHardCase(c))).toEqual([]);
    for (const split of ['train', 'test'] as const) {
      const cs = hardCases.filter(c => c.split === split);
      expect(cs.filter(c => c.region === 'domestic'), split).toHaveLength(2);
      expect(cs.filter(c => c.region === 'international'), split).toHaveLength(3);
    }
  });

  it('every hard-case type appears in both splits, so train lessons can transfer', () => {
    const types = (split: string) => new Set(hardCases.filter(c => c.split === split).flatMap(c => c.tags!.filter(t => t !== 'hard' && t !== 'long')));
    expect([...types('test')].sort()).toEqual([...types('train')].sort());
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
    expect(selectCases(allCases, { split: 'test' })).toHaveLength(35);
    expect(selectCases(allCases, { split: 'all' })).toHaveLength(70);
    const trainId = allCases.find(c => c.split === 'train')!.id;
    expect(selectCases(allCases, { split: 'test', filterIds: [trainId] }).map(c => c.id)).toEqual([trainId]);
  });
});
