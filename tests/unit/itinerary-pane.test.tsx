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
