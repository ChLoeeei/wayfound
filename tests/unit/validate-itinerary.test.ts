import { describe, it, expect } from 'vitest';
import { validateItinerary } from '../../src/lib/validateItinerary';
import type { Itinerary } from '../../src/types';

const validItinerary = (overrides: Partial<Itinerary> = {}): Itinerary => ({
  title: 'Test Trip',
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-22',
  days: [
    {
      dayNumber: 1,
      theme: 'Arrival',
      slots: [
        {
          period: 'morning',
          places: [
            {
              id: 'p1',
              name: 'Fushimi Inari',
              type: 'attraction',
              coordinates: { lat: 34.967, lng: 135.772 },
              estimatedCost: 0,
              duration: 120,
            },
          ],
        },
        {
          period: 'afternoon',
          places: [
            {
              id: 'p2',
              name: 'Nishiki Market',
              type: 'shopping',
              coordinates: { lat: 35.005, lng: 135.764 },
              estimatedCost: 200,
              duration: 90,
            },
          ],
        },
        {
          period: 'evening',
          places: [
            {
              id: 'p3',
              name: 'Pontocho Alley',
              type: 'restaurant',
              coordinates: { lat: 35.005, lng: 135.770 },
              estimatedCost: 600,
              duration: 90,
            },
          ],
        },
      ],
    },
  ],
  ...overrides,
});

describe('validateItinerary — PRD §7.2 deterministic checks', () => {
  it('accepts a clean itinerary', () => {
    const r = validateItinerary(validItinerary(), 1);
    expect(r.valid).toBe(true);
    expect(r.issues.filter(i => i.level === 'error')).toHaveLength(0);
  });

  it('flags day count mismatch', () => {
    const r = validateItinerary(validItinerary(), 3);
    expect(r.valid).toBe(false);
    expect(r.issues.some(i => i.code === 'days_count')).toBe(true);
  });

  it('warns when a slot is missing (PRD §7.2 coverage ≥ 95%)', () => {
    const it = validItinerary();
    it.days[0].slots = it.days[0].slots.filter(s => s.period !== 'evening');
    const r = validateItinerary(it);
    expect(r.issues.some(i => i.code === 'slot_missing' && i.message.includes('evening'))).toBe(true);
    // Missing slot is a warning, not an error — still valid at the schema level
    expect(r.valid).toBe(true);
  });

  it('rejects coordinates outside Earth range', () => {
    const it = validItinerary();
    it.days[0].slots[0].places[0].coordinates = { lat: 999, lng: -300 };
    const r = validateItinerary(it);
    expect(r.valid).toBe(false);
    expect(r.issues.some(i => i.code === 'place_coords_range')).toBe(true);
  });

  it('rejects placeholder (0,0) coordinates', () => {
    const it = validItinerary();
    it.days[0].slots[0].places[0].coordinates = { lat: 0, lng: 0 };
    const r = validateItinerary(it);
    expect(r.valid).toBe(false);
    expect(r.issues.some(i => i.code === 'place_coords_range')).toBe(true);
  });

  it('rejects missing place id', () => {
    const it = validItinerary();
    it.days[0].slots[0].places[0].id = '';
    const r = validateItinerary(it);
    expect(r.valid).toBe(false);
    expect(r.issues.some(i => i.code === 'place_id')).toBe(true);
  });

  it('rejects duplicate dayNumber', () => {
    const it = validItinerary();
    it.days = [it.days[0], { ...it.days[0], dayNumber: 1 }];
    const r = validateItinerary(it);
    expect(r.issues.some(i => i.code === 'day_dup')).toBe(true);
    expect(r.valid).toBe(false);
  });

  it('rejects invalid slot period', () => {
    const it = validItinerary();
    // @ts-expect-error force invalid
    it.days[0].slots[0].period = 'midnight';
    const r = validateItinerary(it);
    expect(r.issues.some(i => i.code === 'slot_period')).toBe(true);
    expect(r.valid).toBe(false);
  });

  it('warns on unknown place type but does not fail validity', () => {
    const it = validItinerary();
    (it.days[0].slots[0].places[0] as any).type = 'casino';
    const r = validateItinerary(it);
    expect(r.issues.some(i => i.code === 'place_type' && i.level === 'warning')).toBe(true);
    expect(r.valid).toBe(true);
  });
});
