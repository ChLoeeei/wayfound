import { describe, it, expect } from 'vitest';
import {
  deletePlace,
  insertPlace,
  movePlace,
  changeSlot,
  placesOfDay,
  findPlace,
} from '../../src/lib/itineraryOps';
import type { Itinerary, Place, TimeSlot, Day } from '../../src/types';

const makePlace = (id: string): Place => ({
  id,
  name: id,
  type: 'attraction',
  coordinates: { lat: 30, lng: 120 },
  estimatedCost: 0,
  duration: 60,
});

const slot = (period: TimeSlot['period'], ids: string[]): TimeSlot => ({
  period,
  places: ids.map(makePlace),
});

const day = (n: number, slots: TimeSlot[]): Day => ({
  dayNumber: n,
  theme: '',
  slots,
});

const sample = (): Itinerary => ({
  title: 'Test',
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-21',
  days: [
    day(1, [
      slot('morning', ['m1', 'm2']),
      slot('afternoon', ['a1']),
      slot('evening', ['e1']),
    ]),
    day(2, [slot('morning', ['m3']), slot('afternoon', ['a2'])]),
  ],
});

describe('deletePlace', () => {
  it('removes a place from its slot', () => {
    const next = deletePlace(sample(), 'a1');
    expect(findPlace(next, 'a1')).toBeNull();
    expect(placesOfDay(next.days[0]).map(p => p.id)).toEqual(['m1', 'm2', 'e1']);
  });

  it('is a no-op for unknown id', () => {
    const orig = sample();
    const next = deletePlace(orig, 'xxx');
    expect(next).not.toBe(orig); // returns new object
    expect(placesOfDay(next.days[0]).map(p => p.id)).toEqual(
      placesOfDay(orig.days[0]).map(p => p.id),
    );
  });

  it('does not mutate the input', () => {
    const orig = sample();
    deletePlace(orig, 'a1');
    expect(orig.days[0].slots[1].places.map(p => p.id)).toEqual(['a1']);
  });
});

describe('insertPlace', () => {
  it('appends to the target slot by default', () => {
    const next = insertPlace(sample(), makePlace('new'), 1, 'morning');
    expect(next.days[0].slots[0].places.map(p => p.id)).toEqual(['m1', 'm2', 'new']);
  });

  it('inserts at the given index', () => {
    const next = insertPlace(sample(), makePlace('new'), 1, 'morning', 1);
    expect(next.days[0].slots[0].places.map(p => p.id)).toEqual(['m1', 'new', 'm2']);
  });

  it('clamps out-of-range index', () => {
    const next = insertPlace(sample(), makePlace('new'), 1, 'morning', 999);
    expect(next.days[0].slots[0].places.map(p => p.id)).toEqual(['m1', 'm2', 'new']);
  });

  it('creates a slot if it did not exist', () => {
    const it: Itinerary = {
      ...sample(),
      days: [day(1, [slot('morning', ['m1'])])],
    };
    const next = insertPlace(it, makePlace('new'), 1, 'evening');
    expect(next.days[0].slots.map(s => s.period)).toEqual(['morning', 'evening']);
    expect(next.days[0].slots[1].places.map(p => p.id)).toEqual(['new']);
  });

  it('inserted slot keeps canonical order', () => {
    const it: Itinerary = {
      ...sample(),
      days: [day(1, [slot('morning', ['m1']), slot('evening', ['e1'])])],
    };
    const next = insertPlace(it, makePlace('new'), 1, 'afternoon');
    expect(next.days[0].slots.map(s => s.period)).toEqual([
      'morning',
      'afternoon',
      'evening',
    ]);
  });

  it('is a no-op when target day not found', () => {
    const orig = sample();
    const next = insertPlace(orig, makePlace('new'), 99, 'morning');
    // Day 1 / 2 unchanged
    expect(placesOfDay(next.days[0]).map(p => p.id)).toEqual(['m1', 'm2', 'a1', 'e1']);
    expect(placesOfDay(next.days[1]).map(p => p.id)).toEqual(['m3', 'a2']);
  });
});

describe('movePlace', () => {
  it('moves across days', () => {
    const next = movePlace(sample(), 'a1', 2, 'evening');
    expect(findPlace(next, 'a1')?.day.dayNumber).toBe(2);
    expect(findPlace(next, 'a1')?.slot.period).toBe('evening');
    expect(placesOfDay(next.days[0]).map(p => p.id)).toEqual(['m1', 'm2', 'e1']);
    expect(placesOfDay(next.days[1]).map(p => p.id)).toEqual(['m3', 'a2', 'a1']);
  });

  it('moves across periods within the same day', () => {
    const next = movePlace(sample(), 'm1', 1, 'evening');
    expect(findPlace(next, 'm1')?.slot.period).toBe('evening');
    expect(next.days[0].slots[0].places.map(p => p.id)).toEqual(['m2']);
    expect(next.days[0].slots[2].places.map(p => p.id)).toEqual(['e1', 'm1']);
  });

  it('inserts at given index when moving', () => {
    const next = movePlace(sample(), 'a1', 1, 'morning', 0);
    expect(next.days[0].slots[0].places.map(p => p.id)).toEqual(['a1', 'm1', 'm2']);
  });

  it('is a no-op for same position', () => {
    const orig = sample();
    const next = movePlace(orig, 'm1', 1, 'morning', 0);
    expect(next).toBe(orig);
  });

  it('returns input unchanged when place id not found', () => {
    const orig = sample();
    const next = movePlace(orig, 'xxx', 2, 'morning');
    expect(next).toBe(orig);
  });
});

describe('changeSlot', () => {
  it('moves a place to a different period in the same day', () => {
    const next = changeSlot(sample(), 'm1', 'afternoon');
    expect(findPlace(next, 'm1')?.day.dayNumber).toBe(1);
    expect(findPlace(next, 'm1')?.slot.period).toBe('afternoon');
    expect(next.days[0].slots[1].places.map(p => p.id)).toEqual(['a1', 'm1']);
  });

  it('does not move across days', () => {
    const before = findPlace(sample(), 'm3')?.day.dayNumber;
    const next = changeSlot(sample(), 'm3', 'afternoon');
    expect(findPlace(next, 'm3')?.day.dayNumber).toBe(before);
  });

  it('is a no-op when place not found', () => {
    const orig = sample();
    const next = changeSlot(orig, 'xxx', 'morning');
    expect(next).toBe(orig);
  });
});
