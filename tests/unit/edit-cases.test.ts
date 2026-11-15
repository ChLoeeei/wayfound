import { describe, expect, it } from 'vitest';
import { editCases, evaluateEditChecks, loadFixture, planMatches, preservationRate } from '../../tests/eval/edit-eval-lib';
import type { EditPlan } from '../../server/editParse';
import type { Itinerary } from '../../src/types';

describe('edit-cases.json and fixtures', () => {
  it('has 8–10 cases whose fixtures, slot ids and expectations line up', () => {
    expect(editCases.length).toBeGreaterThanOrEqual(8);
    expect(editCases.length).toBeLessThanOrEqual(10);
    const ids = new Set<string>();
    for (const c of editCases) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      const it = loadFixture(c.fixture, c.locks);
      const slotIds = new Set(it.days.flatMap(d => d.slots.flatMap(s => s.places.map(p => p.slotId!))));
      expect(it.version).toBe(1);
      for (const sid of [c.expect.slotId, c.expect.keep, ...(c.locks ?? [])].filter(Boolean) as string[]) expect(slotIds.has(sid), `${c.id}: ${sid}`).toBe(true);
      if (c.expect.intent !== 'unclear') {
        expect(it.days.some(d => d.dayNumber === c.expect.dayNumber), c.id).toBe(true);
        expect(c.expectResult).not.toBe('none');
      }
      if (c.locks?.length) {
        const locked = it.days.flatMap(d => d.slots.flatMap(s => s.places.filter(p => p.locked)));
        expect(locked.map(p => p.slotId)).toEqual(c.locks);
      }
    }
    expect(editCases.filter(c => c.expectResult === 'locked').length).toBeGreaterThanOrEqual(1);
    expect(editCases.filter(c => c.expect.intent === 'unclear').length).toBeGreaterThanOrEqual(1);
    expect(editCases.filter(c => c.avoid?.length).length).toBeGreaterThanOrEqual(1);
  });

  it('every fixture is structured: slot ids, times, travel estimates', () => {
    for (const name of ['tokyo', 'kyoto', 'hefei'] as const) {
      const it = loadFixture(name);
      const places = it.days.flatMap(d => d.slots.flatMap(s => s.places));
      expect(places.length).toBeGreaterThan(5);
      for (const p of places) {
        expect(p.slotId).toMatch(new RegExp(`^slot-${name}-\\d+$`));
        expect(p.start).toMatch(/^\d{2}:\d{2}$/);
      }
      expect(places.filter(p => p.travelFromPrev?.estimated).length).toBeGreaterThan(0);
    }
  });
});

describe('planMatches', () => {
  const plan = (over: Partial<EditPlan>): EditPlan => ({ intent: 'replace', targetSlots: [], add: [], keep: [], instruction: '', ...over });
  it('accepts a stop-level or whole-period target for an expected stop, and checks keep for moves', () => {
    const expect1 = { intent: 'replace' as const, dayNumber: 1, period: 'afternoon' as const, slotId: 'slot-x' };
    expect(planMatches(plan({ targetSlots: [{ dayNumber: 1, period: 'afternoon', slotId: 'slot-x' }] }), expect1)).toEqual({ intent: true, target: true });
    expect(planMatches(plan({ targetSlots: [{ dayNumber: 1, period: 'afternoon' }] }), expect1)).toEqual({ intent: true, target: true });
    expect(planMatches(plan({ targetSlots: [{ dayNumber: 1, period: 'afternoon', slotId: 'slot-y' }] }), expect1)).toEqual({ intent: true, target: false });
    expect(planMatches(plan({ intent: 'remove', targetSlots: [{ dayNumber: 1, period: 'afternoon', slotId: 'slot-x' }] }), expect1)).toEqual({ intent: false, target: false });
    const mv = { intent: 'move' as const, dayNumber: 2, period: 'evening' as const, keep: 'slot-k' };
    expect(planMatches(plan({ intent: 'move', targetSlots: [{ dayNumber: 2, period: 'evening' }], keep: ['slot-k'] }), mv).target).toBe(true);
    expect(planMatches(plan({ intent: 'move', targetSlots: [{ dayNumber: 2, period: 'evening' }] }), mv).target).toBe(false);
    expect(planMatches(plan({ intent: 'unclear' }), { intent: 'unclear' })).toEqual({ intent: true, target: true });
  });
});

describe('preservationRate and checks', () => {
  const base = loadFixture('hefei');
  const clone = (): Itinerary => JSON.parse(JSON.stringify(base));
  const targets = [{ dayNumber: 2, period: 'evening' as const, slotId: 'slot-hefei-14' }];

  it('is 100% when only the target changed and drops when anything else moves', () => {
    const good = clone();
    good.days[1].slots.find(s => s.period === 'evening')!.places = [{ id: 'new', name: '清淡菜馆', type: 'restaurant', coordinates: { lat: 31.8, lng: 117.2 }, estimatedCost: 60, duration: 90 }];
    expect(preservationRate(base, good, targets).rate).toBe(1);
    const bad = clone();
    bad.days[0].slots[0].places[0].estimatedCost += 1;
    bad.days[0].slots[1].places.reverse();
    const r = preservationRate(base, bad, targets);
    expect(r.total).toBe(13);
    expect(r.kept).toBe(12);
  });

  it('runs every check type', () => {
    const after = clone();
    after.days[1].slots.find(s => s.period === 'evening')!.places = [{ id: 'new', name: '清淡菜馆', type: 'restaurant', coordinates: { lat: 31.8, lng: 117.2 }, estimatedCost: 60, duration: 90, aiNote: '清淡徽菜' }];
    const results = evaluateEditChecks(base, after, [
      { type: 'noKeyword', keywords: ['木桶记'] },
      { type: 'noNewKeyword', keywords: ['徽菜'] },
      { type: 'newPlaceType', types: ['restaurant'] },
      { type: 'minNewPlaces', value: 1 },
      { type: 'maxNewPlaceCost', value: 50 },
      { type: 'maxDayCostPerPerson', dayNumber: 2, value: 100000 },
      { type: 'placeInPeriod', name: '清淡菜馆', dayNumber: 2, period: 'evening' },
      { type: 'placeNotInPeriod', name: '臭鳜鱼', dayNumber: 2, period: 'evening' },
    ]);
    expect(results.map(r => r.pass)).toEqual([true, false, true, true, false, true, true, true]);
  });
});
