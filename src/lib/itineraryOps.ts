import type { Itinerary, Day, Place, SlotPeriod, TimeSlot } from '../types';

export const PERIOD_ORDER: SlotPeriod[] = ['morning', 'afternoon', 'evening'];

export const PERIOD_LABEL: Record<SlotPeriod, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

export const PERIOD_TIME_HINT: Record<SlotPeriod, string> = {
  morning: '09:00 – 12:00',
  afternoon: '12:00 – 18:00',
  evening: '18:00 – 22:00',
};

/**
 * Return slots in canonical morning → afternoon → evening order,
 * regardless of how the agent emitted them.
 */
export function orderedSlots(day: Day): TimeSlot[] {
  return [...day.slots].sort((a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period));
}

/** Flatten all places of a day in display order. */
export function placesOfDay(day: Day): Place[] {
  return orderedSlots(day).flatMap(s => s.places);
}

/** Flatten all places across all days in display order. */
export function allPlaces(itinerary: Itinerary): Place[] {
  return itinerary.days.flatMap(placesOfDay);
}

/** Locate a place by id along with its day & slot. */
export function findPlace(
  itinerary: Itinerary,
  placeId: string,
):
  | {
      place: Place;
      day: Day;
      dayIndex: number;
      slot: TimeSlot;
      slotIndex: number;
      placeIndex: number;
    }
  | null {
  for (let dayIndex = 0; dayIndex < itinerary.days.length; dayIndex++) {
    const day = itinerary.days[dayIndex];
    for (let slotIndex = 0; slotIndex < day.slots.length; slotIndex++) {
      const slot = day.slots[slotIndex];
      const placeIndex = slot.places.findIndex(p => p.id === placeId);
      if (placeIndex >= 0) {
        return {
          place: slot.places[placeIndex],
          day,
          dayIndex,
          slot,
          slotIndex,
          placeIndex,
        };
      }
    }
  }
  return null;
}

/** Return the dayNumber that owns the given placeId, or null. */
export function dayOfPlace(itinerary: Itinerary, placeId: string): number | null {
  const found = findPlace(itinerary, placeId);
  return found ? found.day.dayNumber : null;
}

// -------- Mutating operations (immutable copies) --------------

/** Delete a place by id. No-op if not found. */
export function deletePlace(itinerary: Itinerary, placeId: string): Itinerary {
  return {
    ...itinerary,
    days: itinerary.days.map(day => ({
      ...day,
      slots: day.slots.map(slot => ({
        ...slot,
        places: slot.places.filter(p => p.id !== placeId),
      })),
    })),
  };
}

/**
 * Insert a place into a target day + slot at the given index (or append).
 * If the place already exists elsewhere, this only inserts; combine with
 * deletePlace for moves, or use movePlace.
 */
export function insertPlace(
  itinerary: Itinerary,
  place: Place,
  targetDayNumber: number,
  targetPeriod: SlotPeriod,
  atIndex?: number,
): Itinerary {
  return {
    ...itinerary,
    days: itinerary.days.map(day => {
      if (day.dayNumber !== targetDayNumber) return day;
      const slots = ensureSlot(day.slots, targetPeriod);
      return {
        ...day,
        slots: slots.map(slot => {
          if (slot.period !== targetPeriod) return slot;
          const places = [...slot.places];
          const idx = atIndex ?? places.length;
          places.splice(Math.max(0, Math.min(idx, places.length)), 0, place);
          return { ...slot, places };
        }),
      };
    }),
  };
}

/**
 * Move an existing place to a new day + slot (and optionally specific index).
 * Same-position moves are a no-op.
 */
export function movePlace(
  itinerary: Itinerary,
  placeId: string,
  targetDayNumber: number,
  targetPeriod: SlotPeriod,
  atIndex?: number,
): Itinerary {
  const found = findPlace(itinerary, placeId);
  if (!found) return itinerary;

  const sameDay = found.day.dayNumber === targetDayNumber;
  const samePeriod = found.slot.period === targetPeriod;
  if (sameDay && samePeriod && (atIndex == null || atIndex === found.placeIndex)) {
    return itinerary;
  }

  const without = deletePlace(itinerary, placeId);
  return insertPlace(without, found.place, targetDayNumber, targetPeriod, atIndex);
}

/** Move a place to a different period within the SAME day. */
export function changeSlot(
  itinerary: Itinerary,
  placeId: string,
  newPeriod: SlotPeriod,
): Itinerary {
  const found = findPlace(itinerary, placeId);
  if (!found) return itinerary;
  return movePlace(itinerary, placeId, found.day.dayNumber, newPeriod);
}

/** Ensure a slot for the given period exists; insert it in canonical order. */
function ensureSlot(slots: TimeSlot[], period: SlotPeriod): TimeSlot[] {
  if (slots.some(s => s.period === period)) return slots;
  const next = [...slots, { period, places: [] as Place[] }];
  return next.sort(
    (a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period),
  );
}

/**
 * Rewrite an Amap CDN image URL to go through our local proxy so html-to-image
 * can fetch it (the upstream lacks CORS headers).
 */
export function proxyImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/api/image-proxy')) return url;
  try {
    const u = new URL(url, window.location.origin);
    if (/(?:^|\.)(autonavi|amap)\.com$/.test(u.host)) {
      return `${process.env.API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }
  return url;
}
