/**
 * Acceptance checks for a partial replanning result (v2 feature C). Pure.
 *
 * A result is applied only if:
 *  1. every stop outside the targets is unchanged (deep-equal, same order);
 *  2. every new stop carries the id of a POI this replanning searched (`poiId`), not just a matching name;
 *  3. no new stop violates the user's `avoid` list;
 *  4. estimated travel between a new stop and its neighbours is reasonable;
 *  5. the day's per-person total stays within the budget cap (+10%).
 */
import type { Itinerary, Place, SlotPeriod } from '../src/types';
import { DAILY_BUDGET_TOLERANCE, PERIOD_ORDER, dayCostPerPerson } from '../src/lib/itineraryOps';
import en from '../src/locales/en.json';
import zh from '../src/locales/zh.json';
import { estimateTravel } from './structure';
import type { EditTarget } from './editParse';

export const MAX_TRAVEL_MINUTES = 60;

export interface ValidateContext {
  /** Ids of every POI the replanning run searched; a new stop must carry one of them as `poiId`. */
  poiIds: string[];
  avoid: string[];
  budgetCap?: number;
  maxTravelMinutes?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
  /** Ids of stops that are new or changed. */
  changedPlaceIds: string[];
  /** Ids of stops the user already had that are no longer there. */
  removedPlaceIds: string[];
}

const TYPE_LABELS: Record<string, string[]> = Object.fromEntries(
  Object.keys(en.place.types).map(t => [t, [t, (en.place.types as any)[t], (zh.place.types as any)[t]].map(s => String(s).toLowerCase())]),
);

/** The first `avoid` phrase a stop violates, or null. Matches name, note, search query and the type's labels in both languages. */
export function violatesAvoid(place: Pick<Place, 'name' | 'aiNote' | 'type' | 'searchQuery'>, avoid: string[]): string | null {
  const hay = `${place.name} ${place.aiNote ?? ''} ${place.searchQuery ?? ''}`.toLowerCase();
  const typeLabels = TYPE_LABELS[place.type] ?? [place.type];
  for (const raw of avoid) {
    const a = raw.trim().toLowerCase();
    if (!a) continue;
    if (hay.includes(a)) return raw;
    if (typeLabels.some(l => l === a || (a.length >= 2 && l.includes(a)))) return raw;
  }
  return null;
}

const placeKey = (p: Place) => JSON.stringify({ ...p, start: undefined, end: undefined, travelFromPrev: undefined });
const slotOf = (p: Place) => p.slotId ?? p.id;

export function validateReplan(before: Itinerary, after: Itinerary, targets: EditTarget[], ctx: ValidateContext): ValidationResult {
  const issues: string[] = [];
  const maxTravel = ctx.maxTravelMinutes ?? MAX_TRAVEL_MINUTES;
  const targetDays = new Set(targets.map(t => t.dayNumber));
  const isTargetPeriod = (d: number, period: SlotPeriod) => targets.some(t => t.dayNumber === d && t.period === period && !t.slotId);
  const targetSlotIds = new Set(targets.filter(t => t.slotId).map(t => t.slotId!));

  const beforePlaces = new Map<string, Place>();
  for (const d of before.days) for (const s of d.slots) for (const p of s.places) beforePlaces.set(slotOf(p), p);
  const afterIds = new Set<string>();
  const changedPlaceIds: string[] = [];

  if (after.days.length !== before.days.length) issues.push('day count changed');

  for (const bd of before.days) {
    const ad = after.days.find(d => d.dayNumber === bd.dayNumber);
    if (!ad) {
      issues.push(`day ${bd.dayNumber} missing`);
      continue;
    }
    if (!targetDays.has(bd.dayNumber)) {
      if (JSON.stringify(bd.slots.map(s => ({ period: s.period, places: s.places.map(placeKey) }))) !== JSON.stringify(ad.slots.map(s => ({ period: s.period, places: s.places.map(placeKey) })))) {
        issues.push(`day ${bd.dayNumber} changed although it was not a target`);
      }
      for (const s of ad.slots) for (const p of s.places) afterIds.add(slotOf(p));
      continue;
    }
    for (const period of PERIOD_ORDER) {
      const bp = bd.slots.find(s => s.period === period)?.places ?? [];
      const ap = ad.slots.find(s => s.period === period)?.places ?? [];
      for (const p of ap) afterIds.add(slotOf(p));
      if (isTargetPeriod(bd.dayNumber, period)) {
        for (const p of ap) {
          const old = beforePlaces.get(slotOf(p));
          if (!old || placeKey(old) !== placeKey(p)) changedPlaceIds.push(p.id);
        }
        continue;
      }
      const targetedHere = bp.filter(p => targetSlotIds.has(slotOf(p)));
      if (targetedHere.length === 0) {
        if (JSON.stringify(bp.map(placeKey)) !== JSON.stringify(ap.map(placeKey))) issues.push(`day ${bd.dayNumber} ${period} changed although it was not a target`);
        continue;
      }
      // Stop-level target: every other stop in the period must be identical and in place.
      const fixedBefore = bp.filter(p => !targetSlotIds.has(slotOf(p)));
      const fixedAfter = ap.filter(p => beforePlaces.has(slotOf(p)) && !targetSlotIds.has(slotOf(p)));
      if (JSON.stringify(fixedBefore.map(placeKey)) !== JSON.stringify(fixedAfter.map(placeKey))) {
        issues.push(`day ${bd.dayNumber} ${period}: a stop outside the target changed`);
      }
      for (const p of ap) {
        const old = beforePlaces.get(slotOf(p));
        if (!old || placeKey(old) !== placeKey(p)) changedPlaceIds.push(p.id);
      }
    }
  }

  const removedPlaceIds = [...beforePlaces.keys()].filter(id => !afterIds.has(id)).map(id => beforePlaces.get(id)!.id);
  const removedOutsideTargets = [...beforePlaces.entries()].filter(([id]) => !afterIds.has(id)).filter(([id, p]) => {
    const where = before.days.find(d => d.slots.some(s => s.places.includes(p)))!;
    const period = where.slots.find(s => s.places.includes(p))!.period;
    return !(isTargetPeriod(where.dayNumber, period) || targetSlotIds.has(id));
  });
  if (removedOutsideTargets.length) issues.push(`removed stop(s) outside the targets: ${removedOutsideTargets.map(([, p]) => p.name).join(', ')}`);

  // New stops: grounded, allowed, reachable; day within budget.
  for (const d of after.days.filter(d => targetDays.has(d.dayNumber))) {
    const ordered = [...d.slots].sort((a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period)).flatMap(s => s.places);
    ordered.forEach((p, i) => {
      if (!changedPlaceIds.includes(p.id)) return;
      if (!p.poiId || !ctx.poiIds.includes(p.poiId)) issues.push(`"${p.name}" does not carry the id of a search_places result from this replanning (poiId missing or unknown)`);
      const hit = violatesAvoid(p, ctx.avoid);
      if (hit) issues.push(`"${p.name}" goes against the user's avoid preference "${hit}"`);
      for (const nb of [ordered[i - 1], ordered[i + 1]]) {
        if (!nb) continue;
        const t = estimateTravel(nb.coordinates, p.coordinates);
        if (t && t.minutes > maxTravel) issues.push(`"${p.name}" is about ${t.minutes} min from "${nb.name}" (limit ${maxTravel})`);
      }
    });
    if (ctx.budgetCap != null) {
      const total = Math.round(dayCostPerPerson(d));
      if (total > ctx.budgetCap * (1 + DAILY_BUDGET_TOLERANCE)) issues.push(`day ${d.dayNumber} totals ¥${total} per person, over the ¥${ctx.budgetCap} cap`);
    }
  }

  return { ok: issues.length === 0, issues, changedPlaceIds: [...new Set(changedPlaceIds)], removedPlaceIds };
}
