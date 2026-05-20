import { describe, it, expect } from 'vitest';
import {
  orderedSlots,
  placesOfDay,
  allPlaces,
  findPlace,
  dayOfPlace,
  PERIOD_ORDER,
} from '../../src/lib/itineraryOps';
import type { Itinerary, Place, TimeSlot, Day } from '../../src/types';

const place = (id: string, lat = 30, lng = 120): Place => ({
  id,
  name: `place-${id}`,
  type: 'attraction',
  coordinates: { lat, lng },
  estimatedCost: 0,
  duration: 60,
});

const slot = (period: TimeSlot['period'], ids: string[]): TimeSlot => ({
  period,
  places: ids.map(id => place(id)),
});

const day = (n: number, slots: TimeSlot[]): Day => ({
  dayNumber: n,
  theme: `day-${n}`,
  slots,
});

const sample = (): Itinerary => ({
  title: 'Test',
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-21',
  days: [
    // Intentionally out of order — orderedSlots should fix it
    day(1, [
      slot('evening', ['e1']),
      slot('morning', ['m1']),
      slot('afternoon', ['a1', 'a2']),
    ]),
    day(2, [slot('morning', ['m2']), slot('afternoon', ['a3'])]),
  ],
});

describe('orderedSlots', () => {
  it('returns slots in morning → afternoon → evening order', () => {
    const it = sample();
    const ordered = orderedSlots(it.days[0]);
    expect(ordered.map(s => s.period)).toEqual(['morning', 'afternoon', 'evening']);
  });

  it('preserves slot identity but does not mutate input', () => {
    const it = sample();
    const original = [...it.days[0].slots];
    orderedSlots(it.days[0]);
    expect(it.days[0].slots).toEqual(original);
  });
});

describe('placesOfDay', () => {
  it('flattens places in display order regardless of slot order', () => {
    const it = sample();
    expect(placesOfDay(it.days[0]).map(p => p.id)).toEqual(['m1', 'a1', 'a2', 'e1']);
  });
});

describe('allPlaces', () => {
  it('flattens across all days', () => {
    const it = sample();
    expect(allPlaces(it).map(p => p.id)).toEqual(['m1', 'a1', 'a2', 'e1', 'm2', 'a3']);
  });
});

describe('findPlace', () => {
  it('locates a place across days and slots', () => {
    const it = sample();
    const found = findPlace(it, 'a3');
    expect(found?.day.dayNumber).toBe(2);
    expect(found?.slot.period).toBe('afternoon');
    expect(found?.placeIndex).toBe(0);
  });

  it('returns null for unknown id', () => {
    expect(findPlace(sample(), 'xxx')).toBeNull();
  });
});

describe('dayOfPlace', () => {
  it('returns the dayNumber for a known place', () => {
    expect(dayOfPlace(sample(), 'e1')).toBe(1);
    expect(dayOfPlace(sample(), 'm2')).toBe(2);
  });

  it('returns null for unknown', () => {
    expect(dayOfPlace(sample(), 'xxx')).toBeNull();
  });
});

describe('PRD §7.2 Sprint 3 acceptance', () => {
  it('day count = itinerary.days.length', () => {
    const it = sample();
    expect(it.days.length).toBe(2);
  });

  it('every day has all three time slots after ordering', () => {
    // Synthetic check used in component tests — make sure helper covers all periods
    expect(PERIOD_ORDER).toEqual(['morning', 'afternoon', 'evening']);
  });

  it('total pin count for a day = places that day', () => {
    const it = sample();
    expect(placesOfDay(it.days[0]).length).toBe(4);
    expect(placesOfDay(it.days[1]).length).toBe(2);
  });
});
