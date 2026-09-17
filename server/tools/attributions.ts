import type { ToolCallRecord } from '../agent';
import { getMapProvider } from './provider';

/**
 * Trace-derived signals for honest UI messaging about a generation run:
 * third-party attribution credits (computeSourceAttributions) and a
 * data-quality warning (computeGroundingWarning) for when search tools
 * mostly failed to find anything real. Both are pure functions of the
 * tool-call trace, computed here once so server.ts and
 * tests/eval/run-eval.ts stay in sync (see computeSourceAttributions'
 * docstring for why that matters).
 */

/**
 * Human-readable third-party attribution strings for a generation run,
 * computed from its tool-call trace — the single source of truth for this
 * logic. Extracted out of server.ts (which was the only caller) so
 * tests/eval/run-eval.ts can compute the same thing: the eval harness
 * calls generateItinerary() directly, bypassing the /api/generate-itinerary
 * route entirely, so without this shared function itinerary.sourceAttributions
 * would always come back empty there regardless of what actually happened —
 * not a real bug in the app, just a gap in the harness having its own copy
 * of this logic (found via tests/eval/scoring.ts's scoreDestinationContextUsage
 * flagging every eval case as "attribution wiring inconsistent").
 *
 * - "Place data © OpenStreetMap contributors, ODbL" — only for
 *   international destinations (search_places/get_poi_details routed to
 *   Mapbox/OSM, not Amap) where at least one of those calls actually
 *   succeeded.
 * - "Destination context from Wikivoyage, CC BY-SA 4.0" — whenever
 *   get_destination_context found a real article (any destination).
 */
export function computeSourceAttributions(trace: ToolCallRecord[], destination: string): string[] {
  const attributions: string[] = [];
  if (
    getMapProvider(destination) === 'mapbox' &&
    trace.some(t => (t.name === 'search_places' || t.name === 'get_poi_details') && t.ok)
  ) {
    attributions.push('Place data © OpenStreetMap contributors, ODbL');
  }
  if (trace.some(t => t.name === 'get_destination_context' && t.ok)) {
    attributions.push('Destination context from Wikivoyage, CC BY-SA 4.0');
  }
  return attributions;
}

/**
 * True when this run's search_places calls mostly or entirely failed to
 * find anything real (an error, or a 0-result search) — signals that a
 * meaningful share of this itinerary's places likely came from the
 * model's general knowledge rather than a verified search hit (confirmed
 * live: a public Overpass outage once made every single search_places
 * call in a run fail, and the agent's documented fallback — keep going
 * with plausible general-knowledge places rather than abandon the
 * itinerary — kicked in for all of them). Lets the UI show an honesty
 * disclaimer (src/components/ItineraryPane.tsx) instead of presenting
 * every place with the same implied confidence.
 *
 * Threshold: >=50% of this run's search_places calls were unhelpful.
 * Returns false when search_places was never called at all — that's not
 * evidence of a problem, just nothing to judge either way.
 */
export function computeGroundingWarning(trace: ToolCallRecord[]): boolean {
  const searchCalls = trace.filter(t => t.name === 'search_places');
  if (searchCalls.length === 0) return false;
  const unhelpful = searchCalls.filter(t => !t.ok || /^0 result/.test(t.resultSummary)).length;
  return unhelpful / searchCalls.length >= 0.5;
}
