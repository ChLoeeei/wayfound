import { describe, expect, it } from 'vitest';
import { estimateTravel, fmtHM, haversineMeters, parseHM, structureItinerary } from '../../server/structure';
import type { Itinerary } from '../../src/types';

const place = (id: string, name: string, lat: number, lng: number, duration = 90, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  type: 'attraction' as const,
  coordinates: { lat, lng },
  estimatedCost: 0,
  duration,
  ...extra,
});

const itinerary: Itinerary = {
  title: 't',
  destination: 'Kyoto',
  startDate: '2026-01-01',
  endDate: '2026-01-01',
  days: [
    {
      dayNumber: 1,
      slots: [
        { period: 'evening', places: [place('c', 'Pontocho', 35.0053, 135.7709)] },
        { period: 'morning', places: [place('a', 'Kiyomizu-dera', 34.9949, 135.785), place('b', 'Sannenzaka', 34.9966, 135.7807, 60)] },
        { period: 'afternoon', places: [place('d', 'Arashiyama Bamboo Grove', 35.0171, 135.6717, 0)] },
      ],
    },
  ],
};

describe('structureItinerary', () => {
  it('packs estimated times per period, in period order, with travel in between', () => {
    const out = structureItinerary(itinerary);
    const byId = Object.fromEntries(out.days[0].slots.flatMap(s => s.places).map(p => [p.id, p]));
    expect(byId.a.start).toBe('09:00');
    expect(byId.a.end).toBe('10:30');
    expect(byId.a.travelFromPrev).toBeUndefined();
    expect(byId.b.travelFromPrev?.mode).toBe('walk');
    expect(parseHM(byId.b.start!)).toBe(parseHM(byId.a.end!) + byId.b.travelFromPrev!.minutes);
    // Arashiyama is far: transit, and the afternoon window starts at 12:00 at the earliest.
    expect(byId.d.travelFromPrev?.mode).toBe('transit');
    expect(parseHM(byId.d.start!)).toBeGreaterThanOrEqual(12 * 60);
    expect(byId.d.end).toBe(fmtHM(parseHM(byId.d.start!) + 90)); // default stay when duration is 0
    expect(byId.c.start).toBe('18:00');
    expect(out.version).toBe(1);
  });

  it('gives every stop a slot id and keeps existing ones, locks and poi ids', () => {
    const once = structureItinerary(itinerary);
    const ids = once.days[0].slots.flatMap(s => s.places.map(p => p.slotId));
    expect(ids.every(id => /^slot-[0-9a-f]{8}$/.test(id!))).toBe(true);
    once.days[0].slots[0].places[0].locked = true;
    once.version = 3;
    const twice = structureItinerary(once);
    expect(twice.days[0].slots.flatMap(s => s.places.map(p => p.slotId))).toEqual(ids);
    expect(twice.days[0].slots[0].places[0].locked).toBe(true);
    expect(twice.version).toBe(3);
  });

  it('attaches poi ids by name match and never mutates the input', () => {
    const out = structureItinerary(itinerary, [{ id: 'poi-1', name: 'Kiyomizu-dera' }, { id: 'poi-2', name: 'Arashiyama Bamboo Grove (竹林)' }]);
    const byId = Object.fromEntries(out.days[0].slots.flatMap(s => s.places).map(p => [p.id, p]));
    expect(byId.a.poiId).toBe('poi-1');
    expect(byId.d.poiId).toBe('poi-2');
    expect(byId.b.poiId).toBeUndefined();
    expect((itinerary.days[0].slots[1].places[0] as any).slotId).toBeUndefined();
  });
});

describe('estimateTravel', () => {
  it('is a labelled estimate in 5-minute steps, by distance band', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    const walk = estimateTravel({ lat: 34.9949, lng: 135.785 }, { lat: 34.9966, lng: 135.7807 })!;
    expect(walk.mode).toBe('walk');
    expect(walk.estimated).toBe(true);
    expect(walk.minutes % 5).toBe(0);
    const drive = estimateTravel({ lat: 35.0, lng: 135.7 }, { lat: 35.3, lng: 135.7 })!;
    expect(drive.mode).toBe('drive');
    expect(drive.minutes).toBeGreaterThan(30);
    expect(estimateTravel({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).toBeUndefined();
    expect(estimateTravel(undefined, { lat: 1, lng: 1 })).toBeUndefined();
  });
});
