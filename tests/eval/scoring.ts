import type { Itinerary } from '../../src/types';
import { validateItinerary } from '../../src/lib/validateItinerary';
import type { ToolCallRecord } from '../../server/agent';
import { isLikelyMainlandChina } from '../../server/tools/provider';

export interface EvalCase {
  id: string;
  destination: string;
  days: number;
  people: number;
  preferences: string[];
  groupType: string;
  budget: { min: number; max: number };
  specialNeeds: string[];
}

/**
 * Re-exported for backward compatibility with existing imports of this
 * module. The heuristic itself now lives in server/tools/provider.ts,
 * shared with production map-provider routing (getMapProvider) — this
 * harness used to keep its own separate copy, which risked drifting from
 * whatever routing logic the agent actually uses.
 */
export { isLikelyMainlandChina };

// ==================== 1. Tool-call correctness ====================

export interface ToolCallScore {
  /** 0-1, higher is better. */
  score: number;
  totalCalls: number;
  errorCalls: number;
  usedSearchPlaces: boolean;
  invalidPoiRefs: number;
  issues: string[];
}

export function scoreToolCallCorrectness(trace: ToolCallRecord[], destination: string): ToolCallScore {
  const issues: string[] = [];
  const totalCalls = trace.length;
  const errorCalls = trace.filter(t => !t.ok).length;
  const usedSearchPlaces = trace.some(t => t.name === 'search_places');
  const invalidPoiRefs = trace.filter(
    t =>
      (t.name === 'get_poi_details' || t.name === 'calculate_distance') &&
      !t.ok &&
      t.resultSummary.includes('Unknown POI id'),
  ).length;

  const verifiable = isLikelyMainlandChina(destination);
  if (verifiable && !usedSearchPlaces) {
    issues.push('destination has real Amap coverage but search_places was never called');
  }
  if (invalidPoiRefs > 0) {
    issues.push(`${invalidPoiRefs} call(s) referenced a POI id never returned by search_places`);
  }
  if (totalCalls === 0) {
    issues.push('agent made no tool calls at all');
  }

  // No tool calls at all isn't automatically wrong (e.g. a very short,
  // clearly non-China trip could plausibly be planned from general
  // knowledge alone), so it gets a neutral baseline rather than zero.
  let score = totalCalls > 0 ? (totalCalls - errorCalls) / totalCalls : 0.5;
  if (verifiable && !usedSearchPlaces) score -= 0.4;
  if (invalidPoiRefs > 0) score -= 0.2;
  score = Math.max(0, Math.min(1, score));

  return { score, totalCalls, errorCalls, usedSearchPlaces, invalidPoiRefs, issues };
}

// ==================== 2. Constraint satisfaction ====================

const SPECIAL_NEED_KEYWORDS: Record<string, string[]> = {
  vegetarian: ['vegetarian', 'vegan', '素'],
  accessibility: ['wheelchair', 'accessib', 'step-free', '无障碍'],
  baby: ['family-friendly', 'stroller', 'kid-friendly', 'child', '亲子', '儿童'],
  pet: ['pet-friendly', 'dog-friendly', '宠物'],
};

export interface ConstraintScore {
  /** 0-1, higher is better. */
  score: number;
  schemaValid: boolean;
  dayCountMatches: boolean;
  /** Fraction of priced places whose cost fits within a generous budget band. */
  budgetAdherence: number;
  /** Fraction of stated special needs with any textual signal found in the itinerary. */
  specialNeedsAddressed: number;
  issues: string[];
}

export function scoreConstraintSatisfaction(itinerary: Itinerary, req: EvalCase): ConstraintScore {
  const issues: string[] = [];
  const report = validateItinerary(itinerary, req.days);
  const schemaValid = report.valid;
  for (const i of report.issues.filter(i => i.level === 'error')) issues.push(i.message);

  const dayCountMatches = Array.isArray(itinerary.days) && itinerary.days.length === req.days;
  if (!dayCountMatches) {
    issues.push(`expected ${req.days} day(s), got ${itinerary.days?.length ?? 0}`);
  }

  const places = (itinerary.days ?? []).flatMap(d => (d.slots ?? []).flatMap(s => s.places ?? []));

  const priced = places.filter(p => typeof p.estimatedCost === 'number' && p.estimatedCost > 0);
  // Per-place cost vs. a per-person-per-day budget isn't a strict
  // apples-to-apples comparison (one day has several places), so the upper
  // bound is deliberately generous — this flags places that are wildly out
  // of range, not every place above the daily average.
  const hi = req.budget.max * 1.5;
  const withinBudget = priced.filter(p => p.estimatedCost <= hi);
  const budgetAdherence = priced.length > 0 ? withinBudget.length / priced.length : 1;
  if (budgetAdherence < 0.7) {
    issues.push(`only ${(budgetAdherence * 100).toFixed(0)}% of priced places fit the stated budget`);
  }

  const needsAddressed = req.specialNeeds.map(need => {
    const keywords = SPECIAL_NEED_KEYWORDS[need] ?? [need];
    return places.some(p => {
      const haystack = `${p.aiNote ?? ''} ${p.name ?? ''}`.toLowerCase();
      return keywords.some(k => haystack.includes(k.toLowerCase()));
    });
  });
  const specialNeedsAddressed =
    needsAddressed.length > 0 ? needsAddressed.filter(Boolean).length / needsAddressed.length : 1;
  if (needsAddressed.length > 0 && specialNeedsAddressed < 1) {
    issues.push(`${needsAddressed.filter(x => !x).length}/${needsAddressed.length} special need(s) not reflected anywhere in the itinerary text`);
  }

  // A schema-broken itinerary can't be trusted to satisfy anything else.
  const score = schemaValid
    ? 0.5 * (dayCountMatches ? 1 : 0) + 0.3 * budgetAdherence + 0.2 * specialNeedsAddressed
    : 0;

  return {
    score: Math.max(0, Math.min(1, score)),
    schemaValid,
    dayCountMatches,
    budgetAdherence,
    specialNeedsAddressed,
    issues,
  };
}

// ==================== 3. Hallucination rate ====================

export interface HallucinationScore {
  /** Fraction of places NOT traceable to a real search_places result. 0 = fully grounded. */
  rate: number;
  /**
   * Whether grounding is expected to be possible for this destination.
   * Always true now — Amap covers mainland China and Mapbox covers
   * everywhere else (see getMapProvider), so search_places has a real
   * provider behind it for every destination. Kept as a field (rather than
   * dropped) for backward compatibility with existing report/consumer code
   * that branches on it; a destination that genuinely gets zero grounded
   * search_places results now shows up as a real 100% rate instead of
   * being hidden behind `verifiable: false`.
   */
  verifiable: boolean;
  totalPlaces: number;
  unverifiedPlaceNames: string[];
}

function extractSearchedNames(trace: ToolCallRecord[]): Set<string> {
  const names = new Set<string>();
  for (const call of trace) {
    if (call.name !== 'search_places' || !call.ok) continue;
    const m = call.resultSummary.match(/result\(s\):\s*(.*)$/);
    if (!m) continue;
    for (const n of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      names.add(n.toLowerCase());
    }
  }
  return names;
}

export function scoreHallucinationRate(
  trace: ToolCallRecord[],
  itinerary: Itinerary,
  destination: string,
): HallucinationScore {
  const verifiable = true;
  const places = (itinerary.days ?? []).flatMap(d => (d.slots ?? []).flatMap(s => s.places ?? []));
  const searched = extractSearchedNames(trace);

  const unverifiedPlaceNames: string[] = [];
  for (const p of places) {
    const name = (p.name ?? '').trim().toLowerCase();
    if (!name) continue;
    const matched = [...searched].some(sn => sn.includes(name) || name.includes(sn));
    if (!matched) unverifiedPlaceNames.push(p.name);
  }

  const totalPlaces = places.length;
  const rate = totalPlaces > 0 ? unverifiedPlaceNames.length / totalPlaces : 0;
  return { rate, verifiable, totalPlaces, unverifiedPlaceNames };
}

// ==================== 4. Destination-context grounding (get_destination_context / Wikivoyage) ====================
//
// Unlike the other three dimensions, WHETHER the agent calls
// get_destination_context is the model's own judgment call (the system
// prompt suggests it, doesn't require it — see server/agent.ts), so this
// score does not penalize a case for not calling it. What it actually
// checks is the WIRING: when the tool is called and succeeds, does
// server.ts's sourceAttributions correctly credit Wikivoyage, and vice
// versa — a regression here would mean the CC BY-SA 4.0 attribution is
// silently wrong (missing when it should show, or shown when nothing was
// actually retrieved), which is a licensing-adjacent bug, not a taste
// judgment. usageRate/successRate below are informational, meant to be
// read as trends across a report's cases, not as a per-case pass/fail.

export interface DestinationContextScore {
  /** Whether get_destination_context was called at all this run. */
  called: boolean;
  calledCount: number;
  /** Calls that came back with real article content (ok:true in the trace) rather than "no article found" or an error. */
  successCount: number;
  /** True iff itinerary.sourceAttributions' Wikivoyage credit is present exactly when successCount > 0 — a wiring check, not a quality judgment. */
  attributionConsistent: boolean;
  /** 1.0 unless the attribution wiring is inconsistent with the trace. */
  score: number;
  issues: string[];
}

export function scoreDestinationContextUsage(
  trace: ToolCallRecord[],
  itinerary: Itinerary,
): DestinationContextScore {
  const issues: string[] = [];
  const calls = trace.filter(t => t.name === 'get_destination_context');
  const called = calls.length > 0;
  const successCount = calls.filter(t => t.ok).length;
  const hasWikivoyageCredit = (itinerary.sourceAttributions ?? []).some(a => a.toLowerCase().includes('wikivoyage'));
  const attributionConsistent = hasWikivoyageCredit === successCount > 0;

  if (!attributionConsistent) {
    issues.push(
      hasWikivoyageCredit
        ? 'sourceAttributions credits Wikivoyage but no successful get_destination_context call is in the trace.'
        : 'get_destination_context succeeded at least once but sourceAttributions is missing the Wikivoyage credit.',
    );
  }

  const score = attributionConsistent ? 1 : 0.4;
  return { called, calledCount: calls.length, successCount, attributionConsistent, score, issues };
}
