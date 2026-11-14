import { describe, expect, it } from 'vitest';
import { searchedNames, ungroundedPlaceNames } from '../../server/grounding';
import { scoreHallucinationRate } from '../../tests/eval/scoring';
import type { ToolCallRecord } from '../../server/agent';
import type { Itinerary } from '../../src/types';

const trace: ToolCallRecord[] = [
  { step: 0, name: 'search_places', args: { keywords: 'temple' }, ok: true, resultSummary: '3 result(s): Kiyomizu-dera, Fushimi Inari-taisha, Kinkaku-ji' },
  { step: 0, name: 'search_places', args: { keywords: 'ramen' }, ok: true, resultSummary: '2 result(s): Kyoto Gion Ramen Muraji, Ramen Factory' },
  { step: 1, name: 'search_places', args: { keywords: 'nothing' }, ok: false, resultSummary: 'error: timeout' },
  { step: 1, name: 'get_poi_details', args: { id: 'x' }, ok: true, resultSummary: '1 result(s): Should Not Count' },
];

const place = (name: string) => ({ id: name, name, type: 'attraction' as const, coordinates: { lat: 35, lng: 135 }, estimatedCost: 0, duration: 60 });
const itinerary: Itinerary = {
  title: 't',
  destination: 'Kyoto',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  days: [
    { dayNumber: 1, slots: [{ period: 'morning', places: [place('Kiyomizu-dera'), place('Ramen Factory')] }] },
    { dayNumber: 2, slots: [{ period: 'evening', places: [place('Pontocho dinner'), place('fushimi inari'), place('Should Not Count')] }] },
  ],
};

describe('server/grounding', () => {
  it('collects names only from successful search_places calls', () => {
    expect([...searchedNames(trace)]).toEqual(['kiyomizu-dera', 'fushimi inari-taisha', 'kinkaku-ji', 'kyoto gion ramen muraji', 'ramen factory']);
  });

  it('flags places that match no search result, with the same rule as the eval score', () => {
    const ungrounded = ungroundedPlaceNames(trace, itinerary);
    expect(ungrounded).toEqual(['Pontocho dinner', 'Should Not Count']);
    const h = scoreHallucinationRate(trace, itinerary, 'Kyoto');
    expect(h.unverifiedPlaceNames).toEqual(ungrounded);
    expect(h.totalPlaces).toBe(5);
  });

  it('returns nothing when there were no searches at all and no places', () => {
    expect(ungroundedPlaceNames([], { days: [] })).toEqual([]);
  });
});
