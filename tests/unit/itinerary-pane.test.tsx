import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ItineraryPane from '../../src/components/ItineraryPane';
import { dayCostPerPerson, isWithinDailyBudget } from '../../src/lib/itineraryOps';
import type { Itinerary, Place } from '../../src/types';

const place = (id: string, cost: number): Place => ({
  id,
  name: `Place ${id}`,
  type: 'attraction',
  coordinates: { lat: 35, lng: 135 },
  estimatedCost: cost,
  duration: 60,
});

const itinerary: Itinerary = {
  title: 'Kyoto trip',
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-21',
  days: [
    { dayNumber: 1, theme: 'Temples', slots: [{ period: 'morning', places: [place('a', 500), place('b', 700)] }] },
    { dayNumber: 2, slots: [{ period: 'afternoon', places: [place('c', 100)] }] },
  ],
};

function renderPane(activeDay: number, onChangeDay = (_: number) => {}, budgetCap?: number) {
  return render(
    <ItineraryPane
      itinerary={itinerary}
      activeDay={activeDay}
      onChangeDay={onChangeDay}
      selectedPlaceId={null}
      onSelectPlace={() => {}}
      onUpdateItinerary={() => {}}
      onRequestDelete={() => {}}
      onAddPlaceToSlot={() => {}}
      budgetCap={budgetCap}
    />,
  );
}

describe('ItineraryPane day tabs', () => {
  it('renders one tab per day and only the active day', () => {
    renderPane(1);
    expect(screen.getByTestId('day-tab-1')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('day-tab-2')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('day-1')).toBeInTheDocument();
    expect(screen.queryByTestId('day-2')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Day 1 · Temples');
  });

  it('switches days through the tabs', () => {
    let chosen = 0;
    renderPane(1, d => (chosen = d));
    fireEvent.click(screen.getByTestId('day-tab-2'));
    expect(chosen).toBe(2);
  });

  it('reports the day total against the budget cap with the 10% tolerance', () => {
    const { unmount } = renderPane(1, undefined, 1200);
    expect(screen.getByTestId('day-budget')).toHaveTextContent('¥1200 per person · under the ¥1200 cap');
    unmount();
    renderPane(1, undefined, 1000);
    expect(screen.getByTestId('day-budget')).toHaveTextContent('over the ¥1000 cap');
  });

  it('shows no budget row without a cap (shared view)', () => {
    renderPane(1);
    expect(screen.queryByTestId('day-budget')).toBeNull();
  });
});

describe('day budget helpers', () => {
  it('sums per-person costs across the day', () => {
    expect(dayCostPerPerson(itinerary.days[0])).toBe(1200);
  });

  it('allows up to cap × 1.1', () => {
    expect(isWithinDailyBudget(1100, 1000)).toBe(true);
    expect(isWithinDailyBudget(1101, 1000)).toBe(false);
  });
});

describe('ItineraryPane whole-trip mode (export / print)', () => {
  it('renders every day with its own heading and budget line, and no tabs', () => {
    render(
      <ItineraryPane
        itinerary={itinerary}
        activeDay={1}
        onChangeDay={() => {}}
        selectedPlaceId={null}
        onSelectPlace={() => {}}
        onUpdateItinerary={() => {}}
        onRequestDelete={() => {}}
        onAddPlaceToSlot={() => {}}
        budgetCap={1000}
        allDays
      />,
    );
    expect(screen.queryByTestId('day-tabs')).toBeNull();
    expect(screen.getByTestId('day-1')).toBeInTheDocument();
    expect(screen.getByTestId('day-2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Kyoto trip');
    expect(screen.getByRole('heading', { level: 2, name: 'Day 1 · Temples' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Day 2' })).toBeInTheDocument();
    expect(screen.getByTestId('day-budget-1')).toHaveTextContent('over');
    expect(screen.getByTestId('day-budget-2')).toHaveTextContent('under');
  });
});

describe('ItineraryPane lessons chip and grounding line', () => {
  const withMeta: Itinerary = {
    ...itinerary,
    usedLessonIds: ['L01', 'L04'],
    ungroundedPlaceNames: ['Place b'],
  };
  const renderWith = (it: Itinerary, onShowLessons?: () => void, activeDay = 1) =>
    render(
      <ItineraryPane
        itinerary={it}
        activeDay={activeDay}
        onChangeDay={() => {}}
        selectedPlaceId={null}
        onSelectPlace={() => {}}
        onUpdateItinerary={() => {}}
        onRequestDelete={() => {}}
        onAddPlaceToSlot={() => {}}
        onShowLessons={onShowLessons}
      />,
    );

  it('shows how many lessons the plan used and opens them on click', () => {
    let opened = false;
    renderWith(withMeta, () => (opened = true));
    const chip = screen.getByTestId('used-lessons');
    expect(chip).toHaveTextContent('Used 2 lessons');
    fireEvent.click(chip);
    expect(opened).toBe(true);
  });

  it('says when no lessons were used, and shows nothing for older itineraries', () => {
    renderWith({ ...itinerary, usedLessonIds: [] });
    expect(screen.getByTestId('used-lessons')).toHaveTextContent('No lessons used');
  });

  it('hides the chip and grounding line when the fields are absent', () => {
    renderWith(itinerary);
    expect(screen.queryByTestId('used-lessons')).toBeNull();
    expect(screen.queryByTestId('day-grounding')).toBeNull();
  });

  it('counts the shown day\'s stops that matched search results', () => {
    const { unmount } = renderWith(withMeta);
    expect(screen.getByTestId('day-grounding')).toHaveTextContent('1 of 2 stops matched search results');
    unmount();
    renderWith(withMeta, undefined, 2);
    expect(screen.getByTestId('day-grounding')).toHaveTextContent('All 1 stops matched search results');
  });

  it('translates the server attribution strings', () => {
    renderWith({ ...itinerary, sourceAttributions: ['Place data © OpenStreetMap contributors, ODbL', 'Something custom'] });
    expect(screen.getByTestId('source-attributions')).toHaveTextContent('Place data © OpenStreetMap contributors, ODbL · Something custom');
  });
});

describe('ItineraryPane partial replanning controls', () => {
  const structured: Itinerary = {
    ...itinerary,
    days: [
      {
        dayNumber: 1,
        theme: 'Temples',
        slots: [
          {
            period: 'morning',
            places: [
              { ...place('a', 500), slotId: 'slot-a', start: '09:00', end: '10:00' },
              { ...place('b', 700), slotId: 'slot-b', start: '10:15', end: '11:15', locked: true, travelFromPrev: { mode: 'walk', minutes: 15, distanceM: 1100, estimated: true } },
            ],
          },
        ],
      },
    ],
  };
  const renderWith = (over: Partial<React.ComponentProps<typeof ItineraryPane>> = {}) =>
    render(
      <ItineraryPane
        itinerary={structured}
        activeDay={1}
        onChangeDay={() => {}}
        selectedPlaceId={null}
        onSelectPlace={() => {}}
        onUpdateItinerary={() => {}}
        onRequestDelete={() => {}}
        onAddPlaceToSlot={() => {}}
        {...over}
      />,
    );

  it('shows estimated times and travel rows labelled as estimates', () => {
    renderWith();
    expect(screen.getByTestId('place-time-a')).toHaveTextContent('approx. 09:00–10:00');
    expect(screen.getByTestId('travel-b')).toHaveTextContent('Walk about 15 min · 1.1 km · estimate');
    expect(screen.queryByTestId('travel-a')).toBeNull();
  });

  it('wires lock, replace and undo, and marks changed stops', () => {
    const calls: string[] = [];
    renderWith({
      changedPlaceIds: ['a'],
      onToggleLock: id => calls.push(`lock:${id}`),
      onReplace: (p, d, period) => calls.push(`replace:${p.id}:${d}:${period}`),
      onUndoEdit: () => calls.push('undo'),
      canUndoEdit: true,
    });
    expect(screen.getByTestId('place-card-a')).toHaveAttribute('data-changed', 'true');
    expect(screen.getByTestId('place-updated-a')).toHaveTextContent('Updated');
    expect(screen.getByTestId('place-locked-b')).toBeInTheDocument();
    expect(screen.getByTestId('place-replace-b')).toBeDisabled();
    fireEvent.click(screen.getByTestId('place-lock-a'));
    fireEvent.click(screen.getByTestId('place-replace-a'));
    fireEvent.click(screen.getByTestId('undo-edit'));
    expect(calls).toEqual(['lock:a', 'replace:a:1:morning', 'undo']);
  });

  it('hides edit controls in read-only and whole-trip modes', () => {
    renderWith({ readOnly: true, onToggleLock: () => {}, onReplace: () => {}, onUndoEdit: () => {}, canUndoEdit: true });
    expect(screen.queryByTestId('place-lock-a')).toBeNull();
    expect(screen.queryByTestId('undo-edit')).toBeNull();
  });
});
