import { describe, expect, it } from 'vitest';
import { validateReplan, violatesAvoid } from '../../server/replanValidate';
import type { Itinerary, Place } from '../../src/types';

const place = (id: string, name: string, lat: number, lng: number, extra: Partial<Place> = {}): Place => ({
  id,
  slotId: `slot-${id}`,
  name,
  type: 'attraction',
  coordinates: { lat, lng },
  estimatedCost: 100,
  duration: 60,
  ...extra,
});

const base: Itinerary = {
  title: 't',
  destination: 'Kyoto',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  days: [
    {
      dayNumber: 1,
      slots: [
        { period: 'morning', places: [place('a', 'Kiyomizu-dera', 34.9949, 135.785), place('b', 'Sannenzaka', 34.9966, 135.7807)] },
        { period: 'afternoon', places: [place('c', 'Kyoto National Museum', 34.9898, 135.7729)] },
        { period: 'evening', places: [place('d', 'Pontocho dinner', 35.0053, 135.7709, { type: 'restaurant', estimatedCost: 300 })] },
      ],
    },
    { dayNumber: 2, slots: [{ period: 'morning', places: [place('e', 'Bamboo Grove', 35.0171, 135.6717)] }] },
  ],
};
const clone = (x: Itinerary): Itinerary => JSON.parse(JSON.stringify(x));
const ctx = { poiIds: ['poi-nishiki', 'poi-karyo', 'poi-inari'], avoid: [] as string[], budgetCap: 1000 };

describe('violatesAvoid', () => {
  it('matches names, notes and type labels in both languages', () => {
    expect(violatesAvoid({ name: 'Nishiki Market', type: 'shopping' }, ['购物'])).toBe('购物');
    expect(violatesAvoid({ name: 'Nishiki Market', type: 'shopping' }, ['shopping'])).toBe('shopping');
    expect(violatesAvoid({ name: 'Cervejaria Ramiro', type: 'restaurant', searchQuery: 'seafood restaurant Lisbon' }, ['seafood'])).toBe('seafood');
    // The note is not evidence: a stop near a temple is not a temple.
    expect(violatesAvoid({ name: 'Togetsu Bridge', type: 'attraction', aiNote: 'A short walk from Tenryu-ji temple' }, ['temple'])).toBeNull();
    expect(violatesAvoid({ name: 'Rijksmuseum', type: 'attraction' }, ['museum'])).toBe('museum');
    expect(violatesAvoid({ name: 'Vondelpark', type: 'leisure' }, ['museum', 'seafood'])).toBeNull();
  });
});

describe('validateReplan', () => {
  it('accepts a stop-level replacement from the search results and reports the change', () => {
    const after = clone(base);
    after.days[0].slots[1].places = [place('n1', 'Nishiki Market', 35.005, 135.7649, { type: 'attraction', slotId: undefined, poiId: 'poi-nishiki' })];
    const v = validateReplan(base, after, [{ dayNumber: 1, period: 'afternoon', slotId: 'slot-c' }], ctx);
    expect(v.ok).toBe(true);
    expect(v.changedPlaceIds).toEqual(['n1']);
    expect(v.removedPlaceIds).toEqual(['c']);
  });

  it('rejects any change outside the targets, including removals and reorders', () => {
    const touched = clone(base);
    touched.days[0].slots[1].places = [place('n1', 'Nishiki Market', 35.005, 135.7649, { poiId: 'poi-nishiki' })];
    touched.days[1].slots[0].places[0].estimatedCost = 5;
    expect(validateReplan(base, touched, [{ dayNumber: 1, period: 'afternoon' }], ctx).issues).toEqual(['day 2 changed although it was not a target']);

    const dropped = clone(base);
    dropped.days[0].slots[1].places = [place('n1', 'Nishiki Market', 35.005, 135.7649, { poiId: 'poi-nishiki' })];
    dropped.days[0].slots[0].places.pop();
    const v = validateReplan(base, dropped, [{ dayNumber: 1, period: 'afternoon' }], ctx);
    expect(v.ok).toBe(false);
    expect(v.issues.join(' ')).toContain('morning changed');

    const reordered = clone(base);
    reordered.days[0].slots[0].places.reverse();
    reordered.days[0].slots[1].places = [place('n1', 'Nishiki Market', 35.005, 135.7649, { poiId: 'poi-nishiki' })];
    expect(validateReplan(base, reordered, [{ dayNumber: 1, period: 'afternoon' }], ctx).ok).toBe(false);

    const sibling = clone(base);
    sibling.days[0].slots[0].places = [place('a', 'Kiyomizu-dera', 34.9949, 135.785), place('n2', 'Fushimi Inari-taisha', 34.9671, 135.7727, { poiId: 'poi-inari' })];
    sibling.days[0].slots[0].places[0].duration = 999;
    const v2 = validateReplan(base, sibling, [{ dayNumber: 1, period: 'morning', slotId: 'slot-b' }], ctx);
    expect(v2.issues.join(' ')).toContain('outside the target changed');
  });

  it('rejects ungrounded, avoided, far and over-budget new stops', () => {
    const after = clone(base);
    after.days[0].slots[1].places = [place('x', 'Imaginary Palace', 34.99, 135.77)];
    expect(validateReplan(base, after, [{ dayNumber: 1, period: 'afternoon' }], ctx).issues[0]).toContain('poiId missing or unknown');
    // A name that matches a result is not enough without the id; an id outside this run's results is rejected too.
    const nameOnly = clone(base);
    nameOnly.days[0].slots[1].places = [place('x', 'Nishiki Market', 35.005, 135.7649)];
    expect(validateReplan(base, nameOnly, [{ dayNumber: 1, period: 'afternoon' }], ctx).ok).toBe(false);
    const foreignId = clone(base);
    foreignId.days[0].slots[1].places = [place('x', 'Nishiki Market', 35.005, 135.7649, { poiId: 'poi-from-last-week' })];
    expect(validateReplan(base, foreignId, [{ dayNumber: 1, period: 'afternoon' }], ctx).ok).toBe(false);

    const avoided = clone(base);
    avoided.days[0].slots[1].places = [place('x', 'Nishiki Market', 35.005, 135.7649, { type: 'shopping', poiId: 'poi-nishiki' })];
    expect(validateReplan(base, avoided, [{ dayNumber: 1, period: 'afternoon' }], { ...ctx, avoid: ['购物'] }).issues[0]).toContain('avoid preference "购物"');

    const far = clone(base);
    far.days[0].slots[1].places = [place('x', 'Fushimi Inari-taisha', 35.3, 135.7727, { poiId: 'poi-inari' })];
    expect(validateReplan(base, far, [{ dayNumber: 1, period: 'afternoon' }], ctx).issues.some(i => i.includes('min from'))).toBe(true);

    const pricey = clone(base);
    pricey.days[0].slots[1].places = [place('x', 'Gion Karyo Kaiseki', 34.99, 135.77, { estimatedCost: 900, poiId: 'poi-karyo' })];
    expect(validateReplan(base, pricey, [{ dayNumber: 1, period: 'afternoon' }], ctx).issues.some(i => i.includes('over the ¥1000 cap'))).toBe(true);
    expect(validateReplan(base, pricey, [{ dayNumber: 1, period: 'afternoon' }], { ...ctx, budgetCap: undefined }).ok).toBe(true);
  });

  it('ignores the derived time and travel fields when comparing fixed stops', () => {
    const after = clone(base);
    for (const d of after.days) for (const s of d.slots) for (const p of s.places) Object.assign(p, { start: '10:00', end: '11:00', travelFromPrev: { mode: 'walk', minutes: 5, distanceM: 300, estimated: true } });
    after.days[0].slots[1].places = [place('n1', 'Nishiki Market', 35.005, 135.7649, { poiId: 'poi-nishiki' })];
    expect(validateReplan(base, after, [{ dayNumber: 1, period: 'afternoon' }], ctx).ok).toBe(true);
  });
});

describe('validateReplan budget rule', () => {
  it('does not blame the replanning for a day that was already over the cap, unless it got worse', () => {
    const over: Itinerary = JSON.parse(JSON.stringify(base));
    over.days[0].slots[0].places[0].estimatedCost = 2000; // day 1 already ¥2500 before the edit
    const same: Itinerary = JSON.parse(JSON.stringify(over));
    same.days[0].slots[1].places = [{ ...place('n1', 'Nishiki Market', 35.005, 135.7649, { poiId: 'poi-nishiki' }), estimatedCost: 100 }];
    expect(validateReplan(over, same, [{ dayNumber: 1, period: 'afternoon' }], ctx).ok).toBe(true);
    const worse: Itinerary = JSON.parse(JSON.stringify(over));
    worse.days[0].slots[1].places = [{ ...place('n1', 'Nishiki Market', 35.005, 135.7649, { poiId: 'poi-nishiki' }), estimatedCost: 900 }];
    expect(validateReplan(over, worse, [{ dayNumber: 1, period: 'afternoon' }], ctx).issues.some(i => i.includes('over the'))).toBe(true);
  });
});
