import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ComparePage from '../../src/components/ComparePage';
import data from '../../src/data/compare-examples.json';

describe('ComparePage', () => {
  beforeEach(() => {
    window.localStorage.removeItem('wayfound_debug');
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the saved examples side by side without calling the API', () => {
    render(<ComparePage />);
    const first = data.examples[0];
    expect(screen.getByTestId('compare-precomputed')).toHaveTextContent(first.caseId);
    expect(screen.getByTestId('compare-request')).toHaveTextContent(first.request.destination);
    expect(screen.getByTestId('compare-lessons-off')).toHaveTextContent('0 lessons');
    expect(screen.getByTestId('compare-lessons-on')).toHaveTextContent(`${first.on.usedLessonIds.length} lessons used`);
    expect(screen.getByTestId('compare-metrics-on')).toHaveTextContent(first.on.reward.toFixed(3));
    expect(screen.queryByTestId('compare-live')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks places that matched no search result', () => {
    render(<ComparePage />);
    // Pick the example with the most ungrounded places on the library-off side and open its first affected day.
    const example = [...data.examples].sort((a, b) => b.off.ungroundedPlaceNames.length - a.off.ungroundedPlaceNames.length)[0];
    fireEvent.click(screen.getByTestId(`compare-example-${example.caseId}`));
    const bad = new Set(example.off.ungroundedPlaceNames);
    const day = example.off.itinerary.days.find(d => d.slots.some(s => s.places.some(p => bad.has(p.name))))!;
    fireEvent.click(screen.getByTestId(`compare-day-${day.dayNumber}`));
    const flagged = document.querySelectorAll('[data-testid^="compare-place-off-"][data-grounded="false"]');
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged[0]).toHaveTextContent('Not in search results');
    const expected = day.slots.flatMap(s => s.places).filter(p => bad.has(p.name)).length;
    expect(flagged.length).toBe(expected);
  });

  it('renders every held-out tile from the data file', () => {
    render(<ComparePage />);
    for (const tile of data.heldOut.tiles) expect(screen.getByTestId(`held-out-${tile.key}`)).toBeInTheDocument();
    expect(screen.getByTestId('compare-held-out')).toHaveTextContent(data.baseline.file.split('/').pop()!);
  });

  it('shows the live controls only in debug mode, with the double-run warning', () => {
    window.localStorage.setItem('wayfound_debug', '1');
    render(<ComparePage />);
    expect(screen.getByTestId('compare-live')).toHaveTextContent('twice');
    expect(screen.getByTestId('compare-run-both')).toBeInTheDocument();
  });
});
