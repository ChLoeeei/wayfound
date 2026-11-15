/**
 * Structured itinerary state (v2 feature C), added after generation and
 * after every replanning, never inside the agent loop:
 *
 *  - every place gets a stable `slotId`;
 *  - `start` / `end` are packed from the period window and the stays, with
 *    the estimated travel in between (the UI shows them as approximate);
 *  - `travelFromPrev` is a straight-line estimate with a speed heuristic,
 *    no routing call (so it costs nothing and is labelled `estimated`);
 *  - `poiId` is attached when the name matches a POI the run searched.
 *
 * Pure and deterministic apart from new slot ids. The eval harness never
 * calls it, so eval itineraries are unchanged.
 */
import { randomBytes } from 'node:crypto';
import type { Itinerary, Place, PlaceCoordinates, SlotPeriod, TravelEstimate } from '../src/types';
import { PERIOD_ORDER } from '../src/lib/itineraryOps';
import { nameMatches } from './agent';

export interface PoiLike {
  id: string;
  name: string;
}

/** Minutes after midnight for each period's window. */
export const PERIOD_WINDOWS: Record<SlotPeriod, [number, number]> = {
  morning: [9 * 60, 12 * 60],
  afternoon: [12 * 60, 18 * 60],
  evening: [18 * 60, 22 * 60],
};

export const DEFAULT_STAY_MINUTES = 90;
export const WALK_MAX_METERS = 1200;
export const TRANSIT_MAX_METERS = 15000;

export function haversineMeters(a: PlaceCoordinates, b: PlaceCoordinates): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const validCoord = (c: PlaceCoordinates | undefined): c is PlaceCoordinates =>
  !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && !(c.lat === 0 && c.lng === 0) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;

/** Straight-line distance → mode and minutes, rounded up to 5 minutes. Always `estimated`. */
export function estimateTravel(from: PlaceCoordinates | undefined, to: PlaceCoordinates | undefined): TravelEstimate | undefined {
  if (!validCoord(from) || !validCoord(to)) return undefined;
  const distanceM = Math.round(haversineMeters(from, to) * 1.3); // street detour factor
  let mode: TravelEstimate['mode'];
  let minutes: number;
  if (distanceM <= WALK_MAX_METERS) {
    mode = 'walk';
    minutes = distanceM / 75 + 2; // 4.5 km/h
  } else if (distanceM <= TRANSIT_MAX_METERS) {
    mode = 'transit';
    minutes = distanceM / 333 + 10; // 20 km/h plus waiting and walking at both ends
  } else {
    mode = 'drive';
    minutes = distanceM / 667 + 10; // 40 km/h plus overhead
  }
  return { mode, minutes: Math.max(5, Math.ceil(minutes / 5) * 5), distanceM, estimated: true };
}

export function newSlotId(): string {
  return `slot-${randomBytes(4).toString('hex')}`;
}

export const fmtHM = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
export const parseHM = (hm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/**
 * Fills slot ids, estimated times, travel estimates and poi ids on a copy
 * of the itinerary. Existing slot ids, locks and poi ids are kept, so
 * running it again after an edit only re-packs the times.
 */
export function structureItinerary<T extends Itinerary>(itinerary: T, pois: PoiLike[] = []): T {
  const out: T = JSON.parse(JSON.stringify(itinerary));
  out.version = out.version ?? 1;
  for (const day of out.days ?? []) {
    let prev: Place | undefined;
    const slots = [...(day.slots ?? [])].sort((a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period));
    for (const slot of slots) {
      const window = PERIOD_WINDOWS[slot.period] ?? PERIOD_WINDOWS.afternoon;
      let cursor = window[0];
      for (const place of slot.places ?? []) {
        if (!place.slotId) place.slotId = newSlotId();
        const travel = prev ? estimateTravel(prev.coordinates, place.coordinates) : undefined;
        if (travel) place.travelFromPrev = travel;
        else delete place.travelFromPrev;
        const prevEnd = prev?.end ? parseHM(prev.end) : NaN;
        const earliest = Number.isFinite(prevEnd) ? prevEnd + (travel?.minutes ?? 0) : cursor;
        const start = Math.max(cursor, earliest);
        const stay = place.duration > 0 ? place.duration : DEFAULT_STAY_MINUTES;
        place.start = fmtHM(start);
        place.end = fmtHM(start + stay);
        cursor = start + stay;
        if (!place.poiId && pois.length > 0) {
          const hit = pois.find(p => nameMatches(p.name, place.name));
          if (hit) place.poiId = hit.id;
        }
        prev = place;
      }
    }
  }
  return out;
}
