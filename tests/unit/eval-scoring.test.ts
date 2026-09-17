import { describe, it, expect } from 'vitest';
import {
  isLikelyMainlandChina,
  scoreToolCallCorrectness,
  scoreConstraintSatisfaction,
  scoreHallucinationRate,
  scoreDestinationContextUsage,
  type EvalCase,
} from '../eval/scoring';
import type { ToolCallRecord } from '../../server/agent';
import type { Itinerary } from '../../src/types';

const baseCase: EvalCase = {
  id: 'test-case',
  destination: '上海',
  days: 2,
  people: 2,
  preferences: ['food'],
  groupType: 'couple',
  budget: { min: 300, max: 800 },
  specialNeeds: [],
};

function place(overrides: Partial<Itinerary['days'][number]['slots'][number]['places'][number]> = {}) {
  return {
    id: overrides.id ?? 'p1',
    name: overrides.name ?? '外滩',
    type: overrides.type ?? 'attraction',
    coordinates: overrides.coordinates ?? { lat: 31.24, lng: 121.49 },
    rating: overrides.rating,
    estimatedCost: overrides.estimatedCost ?? 100,
    duration: overrides.duration ?? 60,
    aiNote: overrides.aiNote ?? '',
    ...overrides,
  };
}

function itinerary(days: Itinerary['days']): Itinerary {
  return {
    title: 'Test trip',
    destination: '上海',
    startDate: '2026-05-20',
    endDate: '2026-05-21',
    days,
  };
}

describe('isLikelyMainlandChina', () => {
  it('recognises mainland China destinations', () => {
    expect(isLikelyMainlandChina('上海')).toBe(true);
    expect(isLikelyMainlandChina('北京朝阳区')).toBe(true);
  });

  it('does not flag international destinations', () => {
    expect(isLikelyMainlandChina('Tokyo')).toBe(false);
    expect(isLikelyMainlandChina('Paris')).toBe(false);
  });
});

describe('scoreToolCallCorrectness', () => {
  const searchCall: ToolCallRecord = {
    step: 0,
    name: 'search_places',
    args: { keywords: '外滩' },
    ok: true,
    resultSummary: '1 result(s): 外滩',
  };

  it('scores well when search_places succeeds for a verifiable destination', () => {
    const result = scoreToolCallCorrectness([searchCall], '上海');
    expect(result.usedSearchPlaces).toBe(true);
    expect(result.score).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('penalises a mainland China case that never calls search_places', () => {
    const result = scoreToolCallCorrectness([], '上海');
    expect(result.score).toBeLessThan(0.5);
    expect(result.issues.some(i => i.includes('search_places'))).toBe(true);
  });

  it('gives a neutral score when no tools are called for a non-China destination', () => {
    const result = scoreToolCallCorrectness([], 'Paris');
    expect(result.score).toBe(0.5);
  });

  it('penalises invalid POI references', () => {
    const badCall: ToolCallRecord = {
      step: 1,
      name: 'calculate_distance',
      args: { originPoiId: 'a', destinationPoiId: 'b' },
      ok: false,
      resultSummary: 'error: Unknown POI id. Call search_places first.',
    };
    const result = scoreToolCallCorrectness([searchCall, badCall], '上海');
    expect(result.invalidPoiRefs).toBe(1);
    expect(result.score).toBeLessThan(1);
    expect(result.issues.some(i => i.includes('never returned by search_places'))).toBe(true);
  });

  it('reduces score in proportion to the error rate', () => {
    const ok = scoreToolCallCorrectness([searchCall], '上海');
    const errCall: ToolCallRecord = { ...searchCall, ok: false, resultSummary: 'error: boom' };
    const mixed = scoreToolCallCorrectness([searchCall, errCall], '上海');
    expect(mixed.score).toBeLessThan(ok.score);
  });
});

describe('scoreConstraintSatisfaction', () => {
  it('scores a well-formed, in-budget itinerary highly', () => {
    const it = itinerary([
      { dayNumber: 1, slots: [{ period: 'morning', places: [place()] }, { period: 'afternoon', places: [] }, { period: 'evening', places: [] }] },
      { dayNumber: 2, slots: [{ period: 'morning', places: [] }, { period: 'afternoon', places: [] }, { period: 'evening', places: [] }] },
    ]);
    const result = scoreConstraintSatisfaction(it, baseCase);
    expect(result.schemaValid).toBe(true);
    expect(result.dayCountMatches).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('penalises a day-count mismatch', () => {
    const it = itinerary([
      { dayNumber: 1, slots: [{ period: 'morning', places: [place()] }] },
    ]);
    const result = scoreConstraintSatisfaction(it, baseCase); // baseCase expects 2 days
    expect(result.dayCountMatches).toBe(false);
    expect(result.issues.some(i => i.includes('expected 2 day'))).toBe(true);
  });

  it('zeroes the score when the itinerary fails schema validation', () => {
    const broken = itinerary([{ dayNumber: 1, slots: [] as any }]);
    const result = scoreConstraintSatisfaction(broken, baseCase);
    expect(result.schemaValid).toBe(false);
    expect(result.score).toBe(0);
  });

  it('flags places priced well outside the stated budget', () => {
    const it = itinerary([
      {
        dayNumber: 1,
        slots: [
          { period: 'morning', places: [place({ id: 'p1', estimatedCost: 5000 })] },
          { period: 'afternoon', places: [] },
          { period: 'evening', places: [] },
        ],
      },
      { dayNumber: 2, slots: [{ period: 'morning', places: [] }, { period: 'afternoon', places: [] }, { period: 'evening', places: [] }] },
    ]);
    const result = scoreConstraintSatisfaction(it, baseCase); // budget max 800
    expect(result.budgetAdherence).toBeLessThan(1);
  });

  it('credits special needs mentioned in a place aiNote', () => {
    const vegCase: EvalCase = { ...baseCase, specialNeeds: ['vegetarian'] };
    const it = itinerary([
      {
        dayNumber: 1,
        slots: [
          { period: 'morning', places: [place({ id: 'p1', aiNote: 'Great vegetarian options here.' })] },
          { period: 'afternoon', places: [] },
          { period: 'evening', places: [] },
        ],
      },
      { dayNumber: 2, slots: [{ period: 'morning', places: [] }, { period: 'afternoon', places: [] }, { period: 'evening', places: [] }] },
    ]);
    const result = scoreConstraintSatisfaction(it, vegCase);
    expect(result.specialNeedsAddressed).toBe(1);
  });

  it('flags special needs that are never mentioned anywhere', () => {
    const vegCase: EvalCase = { ...baseCase, specialNeeds: ['vegetarian'] };
    const it = itinerary([
      { dayNumber: 1, slots: [{ period: 'morning', places: [place()] }, { period: 'afternoon', places: [] }, { period: 'evening', places: [] }] },
      { dayNumber: 2, slots: [{ period: 'morning', places: [] }, { period: 'afternoon', places: [] }, { period: 'evening', places: [] }] },
    ]);
    const result = scoreConstraintSatisfaction(it, vegCase);
    expect(result.specialNeedsAddressed).toBe(0);
    expect(result.issues.some(i => i.includes('special need'))).toBe(true);
  });
});

describe('scoreHallucinationRate', () => {
  const searchCall: ToolCallRecord = {
    step: 0,
    name: 'search_places',
    args: { keywords: '外滩' },
    ok: true,
    resultSummary: '1 result(s): 外滩',
  };

  it('treats a place found via search_places as grounded', () => {
    const it = itinerary([
      { dayNumber: 1, slots: [{ period: 'morning', places: [place({ name: '外滩' })] }] },
    ]);
    const result = scoreHallucinationRate([searchCall], it, '上海');
    expect(result.verifiable).toBe(true);
    expect(result.rate).toBe(0);
    expect(result.unverifiedPlaceNames).toEqual([]);
  });

  it('flags a place never returned by search_places', () => {
    const it = itinerary([
      { dayNumber: 1, slots: [{ period: 'morning', places: [place({ name: '田子坊' })] }] },
    ]);
    const result = scoreHallucinationRate([searchCall], it, '上海');
    expect(result.rate).toBe(1);
    expect(result.unverifiedPlaceNames).toContain('田子坊');
  });

  it('is verifiable for international destinations too, now that Mapbox grounds them', () => {
    const it = itinerary([
      { dayNumber: 1, slots: [{ period: 'morning', places: [place({ name: 'Eiffel Tower' })] }] },
    ]);
    const result = scoreHallucinationRate([], it, 'Paris');
    expect(result.verifiable).toBe(true);
  });

  it('treats a Mapbox-sourced search_places result as grounding too', () => {
    const mapboxSearchCall: ToolCallRecord = {
      step: 0,
      name: 'search_places',
      args: { keywords: 'Eiffel Tower' },
      ok: true,
      resultSummary: '1 result(s): Eiffel Tower',
    };
    const it = itinerary([
      { dayNumber: 1, slots: [{ period: 'morning', places: [place({ name: 'Eiffel Tower' })] }] },
    ]);
    const result = scoreHallucinationRate([mapboxSearchCall], it, 'Paris');
    expect(result.rate).toBe(0);
    expect(result.unverifiedPlaceNames).toEqual([]);
  });

  it('reports a real (non-hidden) 100% rate when an international destination has no grounded search results at all', () => {
    const it = itinerary([
      { dayNumber: 1, slots: [{ period: 'morning', places: [place({ name: 'Eiffel Tower' })] }] },
    ]);
    const result = scoreHallucinationRate([], it, 'Paris');
    expect(result.rate).toBe(1);
    expect(result.unverifiedPlaceNames).toEqual(['Eiffel Tower']);
  });
});

describe('scoreDestinationContextUsage', () => {
  const successfulCall: ToolCallRecord = {
    step: 0,
    name: 'get_destination_context',
    args: { destination: 'Kyoto', topic: 'temples' },
    ok: true,
    resultSummary: 'Kyoto — Temples: Kyoto was the imperial capital...',
  };
  const noArticleCall: ToolCallRecord = {
    step: 0,
    name: 'get_destination_context',
    args: { destination: 'Nowheresville' },
    ok: false,
    resultSummary: 'error: No Wikivoyage article found for this destination.',
  };

  it('is not penalized for simply not being called — that is the model\'s own judgment call', () => {
    const it = itinerary([{ dayNumber: 1, slots: [] }]);
    const result = scoreDestinationContextUsage([], it);
    expect(result.called).toBe(false);
    expect(result.attributionConsistent).toBe(true);
    expect(result.score).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('scores 1.0 when a successful call is correctly credited in sourceAttributions', () => {
    const it = { ...itinerary([{ dayNumber: 1, slots: [] }]), sourceAttributions: ['Destination context from Wikivoyage, CC BY-SA 4.0'] };
    const result = scoreDestinationContextUsage([successfulCall], it);
    expect(result.called).toBe(true);
    expect(result.successCount).toBe(1);
    expect(result.attributionConsistent).toBe(true);
    expect(result.score).toBe(1);
  });

  it('scores 1.0 for a call that found no article (a legitimate negative result), as long as no attribution was added', () => {
    const it = itinerary([{ dayNumber: 1, slots: [] }]);
    const result = scoreDestinationContextUsage([noArticleCall], it);
    expect(result.called).toBe(true);
    expect(result.successCount).toBe(0);
    expect(result.attributionConsistent).toBe(true);
    expect(result.score).toBe(1);
  });

  it('flags a wiring bug: attribution present but no successful call in the trace', () => {
    const it = { ...itinerary([{ dayNumber: 1, slots: [] }]), sourceAttributions: ['Destination context from Wikivoyage, CC BY-SA 4.0'] };
    const result = scoreDestinationContextUsage([], it);
    expect(result.attributionConsistent).toBe(false);
    expect(result.score).toBeLessThan(1);
    expect(result.issues[0]).toMatch(/no successful get_destination_context call/);
  });

  it('flags a wiring bug: successful call but attribution missing', () => {
    const it = itinerary([{ dayNumber: 1, slots: [] }]); // no sourceAttributions
    const result = scoreDestinationContextUsage([successfulCall], it);
    expect(result.attributionConsistent).toBe(false);
    expect(result.score).toBeLessThan(1);
    expect(result.issues[0]).toMatch(/missing the Wikivoyage credit/);
  });
});
