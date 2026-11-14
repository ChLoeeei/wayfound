/**
 * Which places in a finished itinerary never appeared in a search_places
 * result this run. The UI shows "N of M stops matched to search results"
 * and the compare page marks the rest.
 *
 * Same rule as the eval's hallucination score (tests/eval/scoring.ts
 * `scoreHallucinationRate`): a place counts as grounded when its name and a
 * returned name contain each other, case-insensitively. Kept in lockstep
 * by tests/unit/grounding.test.ts, so what the UI shows is the number the
 * eval reports.
 */
import type { ToolCallRecord } from './agent';

interface PlaceLike {
  name?: string;
}
interface ItineraryLike {
  days?: Array<{ slots?: Array<{ places?: PlaceLike[] }> }>;
}

export function searchedNames(trace: ToolCallRecord[]): Set<string> {
  const names = new Set<string>();
  for (const call of trace) {
    if (call.name !== 'search_places' || !call.ok) continue;
    const m = call.resultSummary.match(/result\(s\):\s*(.*)$/);
    if (!m) continue;
    for (const n of m[1].split(',').map(s => s.trim()).filter(Boolean)) names.add(n.toLowerCase());
  }
  return names;
}

export function isGroundedName(name: string, searched: Set<string>): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  for (const sn of searched) if (sn.includes(n) || n.includes(sn)) return true;
  return false;
}

/** Names of places (in itinerary order, duplicates kept) that matched no search result. */
export function ungroundedPlaceNames(trace: ToolCallRecord[], itinerary: ItineraryLike): string[] {
  const searched = searchedNames(trace);
  const out: string[] = [];
  for (const day of itinerary.days ?? []) {
    for (const slot of day.slots ?? []) {
      for (const p of slot.places ?? []) {
        const name = (p.name ?? '').trim();
        if (name && !isGroundedName(name, searched)) out.push(p.name!);
      }
    }
  }
  return out;
}
