import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PreferencesTab from '../../src/components/PreferencesTab';
import { type TravelMemory, applyExtractedPreferences, emptyMemory, recordPlaceDeleted, recordPlanningSession } from '../../src/lib/memory';
import type { PlanningInput } from '../../src/types';

const input: PlanningInput = {
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-24',
  people: 2,
  groupType: 'couple',
  vibes: ['food', 'culture'],
  budget: { min: 300, max: 1500 },
  specialNeeds: ['vegetarian'],
  clarifications: { budgetLean: 'More budget-friendly' },
};

function full(): TravelMemory {
  let m = recordPlanningSession(emptyMemory(), input);
  m = applyExtractedPreferences(m, { pace: 'relaxed', avoid: ['seafood'], notes: ['likes rooftop bars'] });
  m = recordPlaceDeleted(recordPlaceDeleted(m, 'nightlife'), 'nightlife');
  return m;
}

function Harness({ initial, email }: { initial: TravelMemory; email?: string | null }) {
  const [mem, setMem] = useState(initial);
  return (
    <>
      <PreferencesTab memory={mem} onChange={setMem} onClearMemory={() => setMem(emptyMemory())} userEmail={email} />
      <pre data-testid="state">{JSON.stringify(mem)}</pre>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId('state').textContent!) as TravelMemory;

describe('PreferencesTab', () => {
  it('shows every field group, including pace and avoid', () => {
    render(<Harness initial={full()} />);
    for (const id of ['interests', 'tripType', 'dailyBudget', 'budgetLean', 'pace', 'specialNeeds', 'avoid', 'pastTrips', 'avoids', 'notes']) {
      expect(screen.getByTestId(`preference-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('preference-pace')).toHaveTextContent('Relaxed');
    expect(screen.getByTestId('preference-avoid')).toHaveTextContent('seafood');
    expect(screen.getByTestId('memory-scope')).toHaveTextContent('Signed out');
  });

  it('removes single chips and scalar rows', () => {
    render(<Harness initial={full()} />);
    fireEvent.click(screen.getByTestId('preference-remove-interests-food'));
    expect(state().preferredVibes).toEqual(['culture']);
    fireEvent.click(screen.getByTestId('preference-pace-delete'));
    expect(state().pace).toBeUndefined();
    expect(screen.queryByTestId('preference-pace')).toBeNull();
    fireEvent.click(screen.getByTestId('preference-remove-avoids-nightlife'));
    expect(state().dislikedTypeCounts.nightlife).toBeUndefined();
    fireEvent.click(screen.getByTestId('preference-remove-specialNeeds-vegetarian'));
    expect(state().specialNeeds).toEqual([]);
  });

  it('edits text items inline and scalar rows through selects', () => {
    render(<Harness initial={full()} />);
    fireEvent.click(screen.getByTestId('preference-edit-avoid-0'));
    const box = screen.getByTestId('preference-edit-input-avoid-0') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'raw seafood' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(state().avoid).toEqual(['raw seafood']);

    fireEvent.click(screen.getByTestId('preference-tripType-edit'));
    fireEvent.change(screen.getByTestId('preference-tripType-select'), { target: { value: 'family' } });
    expect(state().groupType).toBe('family');

    fireEvent.click(screen.getByTestId('preference-dailyBudget-edit'));
    fireEvent.change(screen.getByTestId('preference-budget-min'), { target: { value: '200' } });
    fireEvent.change(screen.getByTestId('preference-budget-max'), { target: { value: '800' } });
    fireEvent.click(screen.getByTestId('preference-dailyBudget-save'));
    expect(state().lastBudget).toEqual({ min: 200, max: 800 });

    fireEvent.click(screen.getByTestId('preference-delete-notes-0'));
    expect(state().notes).toEqual([]);
  });

  it('clears everything and shows the account footer when signed in', () => {
    render(<Harness initial={full()} email="me@example.com" />);
    expect(screen.getByTestId('memory-scope')).toHaveTextContent('me@example.com');
    fireEvent.click(screen.getByTestId('memory-clear'));
    expect(screen.getByTestId('preferences-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('memory-clear')).toBeNull();
  });
});
