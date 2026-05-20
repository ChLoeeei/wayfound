import type { Itinerary, SlotPeriod } from '../types';

export interface ItineraryValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ItineraryValidationReport {
  valid: boolean;
  issues: ItineraryValidationIssue[];
}

const ALL_PERIODS: SlotPeriod[] = ['morning', 'afternoon', 'evening'];

const ALLOWED_PLACE_TYPES = new Set([
  'attraction',
  'restaurant',
  'hotel',
  'shopping',
  'cafe',
  'nightlife',
  'leisure',
]);

/**
 * Schema-level checks for an itinerary returned by the agent.
 * Used by:
 *   - Deterministic tests (Sprint 2.4) — assert the agent output stays in spec
 *   - Future server-side guard before persisting
 */
export function validateItinerary(it: Itinerary, expectedDays?: number): ItineraryValidationReport {
  const issues: ItineraryValidationIssue[] = [];

  if (!it || typeof it !== 'object') {
    return { valid: false, issues: [{ level: 'error', code: 'shape', message: 'itinerary is not an object' }] };
  }

  if (!Array.isArray(it.days)) {
    issues.push({ level: 'error', code: 'days_missing', message: 'days array missing' });
    return { valid: false, issues };
  }

  if (typeof expectedDays === 'number' && it.days.length !== expectedDays) {
    issues.push({
      level: 'error',
      code: 'days_count',
      message: `expected ${expectedDays} day(s), got ${it.days.length}`,
    });
  }

  const seenDayNumbers = new Set<number>();

  it.days.forEach((day, idx) => {
    if (typeof day.dayNumber !== 'number') {
      issues.push({ level: 'error', code: 'day_number', message: `day[${idx}] missing dayNumber` });
    } else if (seenDayNumbers.has(day.dayNumber)) {
      issues.push({ level: 'error', code: 'day_dup', message: `duplicate dayNumber ${day.dayNumber}` });
    } else {
      seenDayNumbers.add(day.dayNumber);
    }

    if (!Array.isArray(day.slots) || day.slots.length === 0) {
      issues.push({ level: 'error', code: 'slots_missing', message: `day ${day.dayNumber}: no slots` });
      return;
    }

    const periods = new Set(day.slots.map(s => s.period));
    for (const required of ALL_PERIODS) {
      if (!periods.has(required)) {
        issues.push({
          level: 'warning',
          code: 'slot_missing',
          message: `day ${day.dayNumber}: missing ${required} slot`,
        });
      }
    }

    day.slots.forEach((slot, sIdx) => {
      if (!ALL_PERIODS.includes(slot.period)) {
        issues.push({
          level: 'error',
          code: 'slot_period',
          message: `day ${day.dayNumber} slot[${sIdx}]: invalid period "${slot.period}"`,
        });
      }
      if (!Array.isArray(slot.places)) {
        issues.push({
          level: 'error',
          code: 'places_missing',
          message: `day ${day.dayNumber} ${slot.period}: places not an array`,
        });
        return;
      }

      slot.places.forEach((place, pIdx) => {
        const where = `day ${day.dayNumber} ${slot.period}[${pIdx}]`;
        if (!place.id || typeof place.id !== 'string') {
          issues.push({ level: 'error', code: 'place_id', message: `${where}: missing id` });
        }
        if (!place.name) {
          issues.push({ level: 'error', code: 'place_name', message: `${where}: missing name` });
        }
        if (place.type && !ALLOWED_PLACE_TYPES.has(place.type)) {
          issues.push({
            level: 'warning',
            code: 'place_type',
            message: `${where}: unknown place type "${place.type}"`,
          });
        }
        const c = place.coordinates;
        if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') {
          issues.push({ level: 'error', code: 'place_coords', message: `${where}: missing coordinates` });
        } else if (
          c.lat < -90 ||
          c.lat > 90 ||
          c.lng < -180 ||
          c.lng > 180 ||
          (c.lat === 0 && c.lng === 0)
        ) {
          issues.push({
            level: 'error',
            code: 'place_coords_range',
            message: `${where}: coordinates out of valid range`,
          });
        }
        if (typeof place.duration !== 'number' || place.duration <= 0) {
          issues.push({ level: 'warning', code: 'place_duration', message: `${where}: invalid duration` });
        }
      });
    });
  });

  const hasError = issues.some(i => i.level === 'error');
  return { valid: !hasError, issues };
}
