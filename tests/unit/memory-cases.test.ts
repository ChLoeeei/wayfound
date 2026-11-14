import { describe, expect, it } from 'vitest';
import { adherence, evaluateChecks, memoryCases, scoreExtraction } from '../../tests/eval/memory-eval-lib';
import { allCases } from '../../tests/eval/cases';
import type { Itinerary } from '../../src/types';

describe('memory-cases.json', () => {
  it('has 6–8 well-formed cases whose destinations are outside the main case set', () => {
    expect(memoryCases.length).toBeGreaterThanOrEqual(6);
    expect(memoryCases.length).toBeLessThanOrEqual(8);
    const mainDestinations = new Set(allCases.map(c => c.destination.toLowerCase()));
    const ids = new Set<string>();
    for (const c of memoryCases) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(c.stage1.texts.length).toBeGreaterThan(0);
      expect(['en', 'zh']).toContain(c.stage1.language);
      if (c.stage2) {
        expect(mainDestinations.has(c.stage2.destination.toLowerCase()), c.stage2.destination).toBe(false);
        expect(c.checks?.length ?? 0).toBeGreaterThan(0);
      }
    }
    // At least two cases where nothing should be remembered (precision traps).
    expect(memoryCases.filter(c => Object.keys(c.stage1.expect).length === 0).length).toBeGreaterThanOrEqual(2);
  });
});

describe('scoreExtraction', () => {
  const stage1 = memoryCases.find(c => c.id === 'en-no-seafood-no-early')!.stage1;
  it('counts found statements and flags everything else as inferred', () => {
    const r = scoreExtraction(
      {
        preferences: { avoid: ['seafood'], pace: 'relaxed' },
        items: [
          { field: 'avoid', value: 'seafood', quote: "I don't eat seafood" },
          { field: 'pace', value: 'relaxed', quote: 'I really hate early mornings' },
        ],
        dropped: 0,
      },
      stage1,
    );
    expect(r.expected).toBe(2);
    expect(r.found).toBe(1);
    expect(r.missing).toEqual(['avoid~early morning']);
    expect(r.inferred).toBe(1);
    expect(r.inferredItems).toEqual(['pace=relaxed']);
  });

  it('an empty result on a trap case is perfect', () => {
    const trap = memoryCases.find(c => c.id === 'en-trip-only-statement')!.stage1;
    const r = scoreExtraction({ preferences: {}, items: [], dropped: 0 }, trap);
    expect(r).toMatchObject({ expected: 0, found: 0, inferred: 0 });
  });
});

describe('evaluateChecks', () => {
  const place = (name: string, type: any, cost: number, aiNote = '') => ({ id: name, name, type, coordinates: { lat: 0, lng: 0 }, estimatedCost: cost, duration: 60, aiNote });
  const itinerary: Itinerary = {
    title: 't',
    destination: 'Lisbon',
    startDate: '2026-01-01',
    endDate: '2026-01-02',
    days: [
      {
        dayNumber: 1,
        slots: [
          { period: 'morning', places: [place('Castle', 'attraction', 50)] },
          { period: 'afternoon', places: [place('Market', 'shopping', 20), place('Cafe', 'cafe', 30)] },
          { period: 'evening', places: [place('Cervejaria', 'restaurant', 200, 'Famous for grilled fish and seafood platters')] },
        ],
      },
      { dayNumber: 2, slots: [{ period: 'morning', places: [place('Park', 'leisure', 0), place('Trail', 'attraction', 0)] }] },
    ],
  };

  it('runs each check type', () => {
    const results = evaluateChecks(itinerary, [
      { type: 'noKeyword', keywords: ['seafood'] },
      { type: 'minKeyword', keywords: ['park', 'trail'], value: 2 },
      { type: 'maxPlacesPerDay', value: 3 },
      { type: 'minPlacesPerDay', value: 2 },
      { type: 'maxMorningPlaces', value: 1 },
      { type: 'maxPlaceType', types: ['shopping'], value: 0 },
      { type: 'maxDayCostPerPerson', value: 250 },
    ]);
    expect(results.map(r => r.pass)).toEqual([false, true, false, true, false, false, false]);
    expect(results[0].detail).toContain('Cervejaria');
    expect(adherence(results)).toBeCloseTo(2 / 7);
    expect(adherence([])).toBe(1);
  });
});
