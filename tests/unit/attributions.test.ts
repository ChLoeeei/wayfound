import { describe, it, expect } from 'vitest';
import { computeSourceAttributions, computeGroundingWarning } from '../../server/tools/attributions';
import type { ToolCallRecord } from '../../server/agent';

function call(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    step: 0,
    name: 'search_places',
    args: {},
    ok: true,
    resultSummary: '1 result(s): Eiffel Tower',
    ...overrides,
  };
}

describe('computeSourceAttributions', () => {
  it('credits OpenStreetMap for an international destination with a successful search', () => {
    const trace = [call({ name: 'search_places', ok: true, resultSummary: '1 result(s): Eiffel Tower' })];
    expect(computeSourceAttributions(trace, 'Paris')).toEqual(['Place data © OpenStreetMap contributors, ODbL']);
  });

  it('does not credit OpenStreetMap for a mainland China destination (Amap-routed)', () => {
    const trace = [call({ name: 'search_places', ok: true })];
    expect(computeSourceAttributions(trace, '上海')).toEqual([]);
  });

  it('does not credit OpenStreetMap for an international destination when every search_places call failed', () => {
    const trace = [call({ name: 'search_places', ok: false, resultSummary: '0 result(s): ' })];
    expect(computeSourceAttributions(trace, 'Paris')).toEqual([]);
  });

  it('credits Wikivoyage whenever get_destination_context succeeded, regardless of destination', () => {
    const trace = [call({ name: 'get_destination_context', ok: true, resultSummary: 'Paris — Overview: ...' })];
    expect(computeSourceAttributions(trace, '上海')).toEqual(['Destination context from Wikivoyage, CC BY-SA 4.0']);
  });

  it('credits both when applicable', () => {
    const trace = [
      call({ name: 'search_places', ok: true }),
      call({ name: 'get_destination_context', ok: true }),
    ];
    expect(computeSourceAttributions(trace, 'Paris')).toEqual([
      'Place data © OpenStreetMap contributors, ODbL',
      'Destination context from Wikivoyage, CC BY-SA 4.0',
    ]);
  });

  it('returns an empty array for an empty trace', () => {
    expect(computeSourceAttributions([], 'Paris')).toEqual([]);
  });
});

describe('computeGroundingWarning', () => {
  it('is false when search_places was never called', () => {
    expect(computeGroundingWarning([])).toBe(false);
    expect(computeGroundingWarning([call({ name: 'get_destination_context', ok: true })])).toBe(false);
  });

  it('is false when most search_places calls succeeded with real results', () => {
    const trace = [
      call({ resultSummary: '1 result(s): A' }),
      call({ resultSummary: '1 result(s): B' }),
      call({ ok: false, resultSummary: '0 result(s): ' }),
    ];
    expect(computeGroundingWarning(trace)).toBe(false);
  });

  it('is true when exactly half of the search_places calls were unhelpful (>=50% threshold)', () => {
    const trace = [call({ resultSummary: '1 result(s): A' }), call({ ok: false, resultSummary: '0 result(s): ' })];
    expect(computeGroundingWarning(trace)).toBe(true);
  });

  it('is true when every search_places call returned 0 results (the confirmed Overpass-outage case)', () => {
    const trace = Array.from({ length: 5 }, () => call({ resultSummary: '0 result(s): ' }));
    expect(computeGroundingWarning(trace)).toBe(true);
  });

  it('is true when every search_places call errored outright', () => {
    const trace = Array.from({ length: 3 }, () => call({ ok: false, resultSummary: 'error: network failure' }));
    expect(computeGroundingWarning(trace)).toBe(true);
  });

  it('ignores calls to other tools when computing the ratio', () => {
    const trace = [
      call({ name: 'get_destination_context', ok: true, resultSummary: 'ok' }),
      call({ name: 'calculate_distance', ok: true, resultSummary: '100m / 60s' }),
      call({ name: 'search_places', ok: true, resultSummary: '1 result(s): A' }),
    ];
    expect(computeGroundingWarning(trace)).toBe(false);
  });
});
