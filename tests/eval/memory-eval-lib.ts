/**
 * Pure scoring for the two-stage memory eval (tests/eval/memory-cases.json):
 * how well the extraction step recovers explicit statements without
 * inventing any, and whether a later itinerary respects them. The runner
 * (run-memory-eval.ts) does the API calls; everything here is testable
 * offline (tests/unit/memory-cases.test.ts).
 */
import type { ExtractionItem, ExtractionResult } from '../../server/preferences';
import type { Itinerary } from '../../src/types';
import { dayCostPerPerson } from '../../src/lib/itineraryOps';
import casesJson from './memory-cases.json';

export interface MemoryStage1 {
  language: 'en' | 'zh';
  texts: string[];
  expect: { pace?: string; interests?: string[]; avoid?: string[]; budget?: { min: number; max: number }; notes?: string[] };
  forbid?: Array<ExtractionItem['field']>;
}
export interface MemoryStage2 {
  destination: string;
  days: number;
  people: number;
  preferences: string[];
  groupType: string;
  budget: { min: number; max: number };
  specialNeeds: string[];
}
export type MemoryCheck =
  | { type: 'noKeyword'; keywords: string[] }
  | { type: 'minKeyword'; keywords: string[]; value: number }
  | { type: 'maxPlacesPerDay'; value: number }
  | { type: 'minPlacesPerDay'; value: number }
  | { type: 'maxMorningPlaces'; value: number }
  | { type: 'maxPlaceType'; types: string[]; value: number }
  | { type: 'maxDayCostPerPerson'; value: number };
export interface MemoryCase {
  id: string;
  stage1: MemoryStage1;
  stage2?: MemoryStage2;
  checks?: MemoryCheck[];
}

export const memoryCases: MemoryCase[] = (casesJson as { cases: MemoryCase[] }).cases;

export interface ExtractionScore {
  /** Expected statements the extractor found. */
  expected: number;
  found: number;
  /** Items of a forbidden field, or of a field the case did not expect: the inference count. */
  inferred: number;
  missing: string[];
  inferredItems: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** Recall of the expected statements and the number of items that should not be there. */
export function scoreExtraction(result: ExtractionResult, stage1: MemoryStage1): ExtractionScore {
  const exp = stage1.expect;
  const missing: string[] = [];
  let expected = 0;
  let found = 0;
  const has = (pred: (it: ExtractionItem) => boolean) => result.items.some(pred);

  if (exp.pace) {
    expected++;
    if (result.preferences.pace === exp.pace) found++;
    else missing.push(`pace=${exp.pace}`);
  }
  for (const v of exp.interests ?? []) {
    expected++;
    if (result.preferences.interests?.includes(v)) found++;
    else missing.push(`interest=${v}`);
  }
  for (const kw of exp.avoid ?? []) {
    expected++;
    if ((result.preferences.avoid ?? []).some(a => norm(a).includes(norm(kw)) || norm(kw).includes(norm(a)))) found++;
    else missing.push(`avoid~${kw}`);
  }
  if (exp.budget) {
    expected++;
    const b = result.preferences.budget;
    if (b && b.min === exp.budget.min && b.max === exp.budget.max) found++;
    else missing.push(`budget=${exp.budget.min}-${exp.budget.max}`);
  }
  for (const n of exp.notes ?? []) {
    expected++;
    if (has(it => it.field === 'note' && norm(String(it.value)).includes(norm(n)))) found++;
    else missing.push(`note~${n}`);
  }

  const expectedFields = new Set<ExtractionItem['field']>();
  if (exp.pace) expectedFields.add('pace');
  if (exp.interests?.length) expectedFields.add('interest');
  if (exp.avoid?.length) expectedFields.add('avoid');
  if (exp.budget) expectedFields.add('budget');
  if (exp.notes?.length) expectedFields.add('note');
  const forbidden = new Set(stage1.forbid ?? []);
  const inferredItems = result.items
    .filter(it => forbidden.has(it.field) || !expectedFields.has(it.field))
    .map(it => `${it.field}=${typeof it.value === 'string' ? it.value : JSON.stringify(it.value)}`);
  return { expected, found, inferred: inferredItems.length, missing, inferredItems };
}

export interface CheckResult {
  check: MemoryCheck;
  pass: boolean;
  detail: string;
}

const placeText = (p: { name?: string; aiNote?: string; type?: string }) => `${p.name ?? ''} ${p.aiNote ?? ''} ${p.type ?? ''}`.toLowerCase();

/** Deterministic checks on a stage-2 itinerary. */
export function evaluateChecks(itinerary: Itinerary, checks: MemoryCheck[]): CheckResult[] {
  const days = itinerary.days ?? [];
  const places = days.flatMap(d => d.slots.flatMap(s => s.places));
  return checks.map(check => {
    switch (check.type) {
      case 'noKeyword': {
        const hits = places.filter(p => check.keywords.some(k => placeText(p).includes(k.toLowerCase()))).map(p => p.name);
        return { check, pass: hits.length === 0, detail: hits.length ? `mentions: ${hits.join(', ')}` : 'none' };
      }
      case 'minKeyword': {
        const hits = places.filter(p => check.keywords.some(k => placeText(p).includes(k.toLowerCase())));
        return { check, pass: hits.length >= check.value, detail: `${hits.length} matching stop(s)` };
      }
      case 'maxPlacesPerDay': {
        const counts = days.map(d => d.slots.reduce((n, s) => n + s.places.length, 0));
        return { check, pass: counts.every(c => c <= check.value), detail: `per day: ${counts.join('/')}` };
      }
      case 'minPlacesPerDay': {
        const counts = days.map(d => d.slots.reduce((n, s) => n + s.places.length, 0));
        return { check, pass: counts.every(c => c >= check.value), detail: `per day: ${counts.join('/')}` };
      }
      case 'maxMorningPlaces': {
        const counts = days.map(d => d.slots.filter(s => s.period === 'morning').reduce((n, s) => n + s.places.length, 0));
        return { check, pass: counts.every(c => c <= check.value), detail: `morning stops per day: ${counts.join('/')}` };
      }
      case 'maxPlaceType': {
        const n = places.filter(p => check.types.includes(p.type)).length;
        return { check, pass: n <= check.value, detail: `${n} of type ${check.types.join('|')}` };
      }
      case 'maxDayCostPerPerson': {
        const costs = days.map(d => Math.round(dayCostPerPerson(d)));
        return { check, pass: costs.every(c => c <= check.value), detail: `per day ¥${costs.join('/')}` };
      }
    }
  });
}

export const adherence = (results: CheckResult[]) => (results.length === 0 ? 1 : results.filter(r => r.pass).length / results.length);
