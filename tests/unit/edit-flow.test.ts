import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, firstTargetDay, namesOfSlots, newTurn, pushHistory, replacePlan, toggleLock } from '../../src/lib/editFlow';
import type { Itinerary } from '../../src/types';

const itinerary: Itinerary = {
  title: 't',
  destination: 'Kyoto',
  startDate: '2026-01-01',
  endDate: '2026-01-01',
  days: [
    {
      dayNumber: 1,
      slots: [
        { period: 'morning', places: [{ id: 'a', slotId: 'slot-a', name: 'Kiyomizu-dera', type: 'attraction', coordinates: { lat: 1, lng: 1 }, estimatedCost: 0, duration: 60 }] },
        { period: 'evening', places: [{ id: 'b', name: 'Pontocho', type: 'restaurant', coordinates: { lat: 1, lng: 1 }, estimatedCost: 0, duration: 60 }] },
      ],
    },
  ],
};

describe('editFlow helpers', () => {
  it('builds a replace plan for one stop, by slot id or place id', () => {
    const a = replacePlan(itinerary.days[0].slots[0].places[0], 1, 'morning', 'swap it');
    expect(a).toEqual({ intent: 'replace', targetSlots: [{ dayNumber: 1, period: 'morning', slotId: 'slot-a' }], add: [], keep: [], instruction: 'swap it' });
    const b = replacePlan(itinerary.days[0].slots[1].places[0], 1, 'evening', 'x');
    expect(b.targetSlots[0].slotId).toBe('b');
    expect(firstTargetDay(a)).toBe(1);
  });

  it('toggles a lock immutably and names locked stops', () => {
    const locked = toggleLock(itinerary, 'a');
    expect(locked.days[0].slots[0].places[0].locked).toBe(true);
    expect(itinerary.days[0].slots[0].places[0].locked).toBeUndefined();
    expect(toggleLock(locked, 'a').days[0].slots[0].places[0].locked).toBe(false);
    expect(namesOfSlots(locked, ['slot-a', 'b'])).toEqual(['Kiyomizu-dera', 'Pontocho']);
  });

  it('keeps a bounded history and numbers turns', () => {
    let h: Itinerary[] = [];
    for (let i = 0; i < MAX_HISTORY + 3; i++) h = pushHistory(h, { ...itinerary, version: i });
    expect(h).toHaveLength(MAX_HISTORY);
    expect(h[h.length - 1].version).toBe(MAX_HISTORY + 2);
    const t1 = newTurn('user', 'hi');
    const t2 = newTurn('assistant', 'yo', 'done');
    expect(t1.id).not.toBe(t2.id);
    expect(t2.kind).toBe('done');
  });
});
