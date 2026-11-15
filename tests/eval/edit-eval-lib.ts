/**
 * Pure scoring for the partial-replanning eval (tests/eval/edit-cases.json):
 * did the parser pick the right target, how much of the untouched itinerary
 * did the model's raw answer preserve (target 100%), and does the applied
 * result pass the case's checks. The runner (run-edit-eval.ts) makes the
 * calls; everything here runs offline (tests/unit/edit-cases.test.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Itinerary, SlotPeriod } from '../../src/types';
import { PERIOD_ORDER, dayCostPerPerson } from '../../src/lib/itineraryOps';
import type { EditPlan, EditTarget } from '../../server/editParse';
import casesJson from './edit-cases.json';

export interface EditExpect {
  intent: EditPlan['intent'];
  dayNumber?: number;
  period?: SlotPeriod;
  slotId?: string;
  /** For `move`: the stop that must be in `keep`. */
  keep?: string;
}
export type EditCheck =
  | { type: 'noKeyword'; keywords: string[] }
  | { type: 'noNewKeyword'; keywords: string[] }
  | { type: 'newPlaceType'; types: string[] }
  | { type: 'minNewPlaces'; value: number }
  | { type: 'maxNewPlaceCost'; value: number }
  | { type: 'maxDayCostPerPerson'; dayNumber: number; value: number }
  | { type: 'placeInPeriod'; name: string; dayNumber: number; period: SlotPeriod }
  | { type: 'placeNotInPeriod'; name: string; dayNumber: number; period: SlotPeriod };
export interface EditCase {
  id: string;
  fixture: 'tokyo' | 'kyoto' | 'hefei';
  language: 'en' | 'zh';
  message: string;
  activeDay?: number;
  locks?: string[];
  avoid?: string[];
  budgetCap?: number;
  expect: EditExpect;
  expectResult: 'ok' | 'locked' | 'none';
  checks?: EditCheck[];
}

export const editCases: EditCase[] = (casesJson as { cases: EditCase[] }).cases;

export function loadFixture(name: EditCase['fixture'], locks: string[] = []): Itinerary {
  const it: Itinerary = JSON.parse(fs.readFileSync(path.join('tests', 'eval', 'edit-fixtures', `${name}.json`), 'utf8'));
  for (const d of it.days) for (const s of d.slots) for (const p of s.places) if (locks.includes(p.slotId ?? p.id)) p.locked = true;
  return it;
}

/** Did the parser produce the expected intent and (for real intents) a matching target? */
export function planMatches(plan: EditPlan, expect: EditExpect): { intent: boolean; target: boolean } {
  const intent = plan.intent === expect.intent;
  if (expect.intent === 'unclear') return { intent, target: intent && plan.targetSlots.length === 0 };
  const target = plan.targetSlots.some(
    t => t.dayNumber === expect.dayNumber && t.period === expect.period && (!expect.slotId || !t.slotId || t.slotId === expect.slotId) && (!expect.keep || plan.keep.includes(expect.keep)),
  );
  return { intent, target: intent && target };
}

const slotOf = (p: { slotId?: string; id: string }) => p.slotId ?? p.id;
const stopKey = (p: any) => JSON.stringify({ ...p, start: undefined, end: undefined, travelFromPrev: undefined });

/**
 * Share of stops outside the targets that a candidate kept byte-identical
 * and in place. Measured on the model's raw answer, before validation
 * rejects it, so it says how often the model obeys "change only the target".
 */
export function preservationRate(before: Itinerary, candidate: Itinerary, targets: EditTarget[]): { kept: number; total: number; rate: number } {
  const isTarget = (d: number, period: SlotPeriod, slotId: string) => targets.some(t => t.dayNumber === d && t.period === period && (!t.slotId || t.slotId === slotId));
  const after = new Map<string, { key: string; d: number; period: SlotPeriod; index: number }>();
  for (const d of candidate.days) for (const s of d.slots) s.places.forEach((p, i) => after.set(slotOf(p), { key: stopKey(p), d: d.dayNumber, period: s.period, index: i }));
  let kept = 0;
  let total = 0;
  for (const d of before.days) {
    for (const s of d.slots) {
      s.places.forEach((p, i) => {
        if (isTarget(d.dayNumber, s.period, slotOf(p))) return;
        total++;
        const a = after.get(slotOf(p));
        // Same content, same period; index may shift only in a period that has a stop-level target before it.
        if (a && a.key === stopKey(p) && a.d === d.dayNumber && a.period === s.period) kept++;
      });
    }
  }
  return { kept, total, rate: total === 0 ? 1 : kept / total };
}

export interface EditCheckResult {
  check: EditCheck;
  pass: boolean;
  detail: string;
}

export function evaluateEditChecks(before: Itinerary, after: Itinerary, checks: EditCheck[]): EditCheckResult[] {
  const beforeIds = new Set<string>();
  for (const d of before.days) for (const s of d.slots) for (const p of s.places) beforeIds.add(p.id);
  const all = after.days.flatMap(d => d.slots.flatMap(s => s.places));
  const fresh = all.filter(p => !beforeIds.has(p.id));
  const text = (p: any) => `${p.name} ${p.aiNote ?? ''} ${p.type}`.toLowerCase();
  const inPeriod = (name: string, dayNumber: number, period: SlotPeriod) =>
    after.days.find(d => d.dayNumber === dayNumber)?.slots.find(s => s.period === period)?.places.some(p => p.name.toLowerCase().includes(name.toLowerCase())) ?? false;
  return checks.map(check => {
    switch (check.type) {
      case 'noKeyword': {
        const hits = all.filter(p => check.keywords.some(k => text(p).includes(k.toLowerCase()))).map(p => p.name);
        return { check, pass: hits.length === 0, detail: hits.join(', ') || 'none' };
      }
      case 'noNewKeyword': {
        const hits = fresh.filter(p => check.keywords.some(k => text(p).includes(k.toLowerCase()))).map(p => p.name);
        return { check, pass: hits.length === 0, detail: hits.join(', ') || 'none' };
      }
      case 'newPlaceType': {
        const bad = fresh.filter(p => !check.types.includes(p.type)).map(p => `${p.name} (${p.type})`);
        return { check, pass: fresh.length > 0 && bad.length === 0, detail: fresh.length ? bad.join(', ') || 'all match' : 'no new stop' };
      }
      case 'minNewPlaces':
        return { check, pass: fresh.length >= check.value, detail: `${fresh.length} new` };
      case 'maxNewPlaceCost': {
        const over = fresh.filter(p => p.estimatedCost > check.value).map(p => `${p.name} ¥${p.estimatedCost}`);
        return { check, pass: over.length === 0, detail: over.join(', ') || 'ok' };
      }
      case 'maxDayCostPerPerson': {
        const d = after.days.find(x => x.dayNumber === check.dayNumber);
        const cost = d ? Math.round(dayCostPerPerson(d)) : 0;
        return { check, pass: cost <= check.value, detail: `¥${cost}` };
      }
      case 'placeInPeriod':
        return { check, pass: inPeriod(check.name, check.dayNumber, check.period), detail: `${check.name} in day ${check.dayNumber} ${check.period}` };
      case 'placeNotInPeriod':
        return { check, pass: !inPeriod(check.name, check.dayNumber, check.period), detail: `${check.name} not in day ${check.dayNumber} ${check.period}` };
    }
  });
}

export const periodIndex = (p: SlotPeriod) => PERIOD_ORDER.indexOf(p);
