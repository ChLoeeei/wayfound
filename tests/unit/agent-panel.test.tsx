import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentPanel, { loadPanelOpen, savePanelOpen, PANEL_STORAGE_KEY } from '../../src/components/AgentPanel';
import { emptyMemory, recordPlanningSession } from '../../src/lib/memory';
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
};

describe('AgentPanel', () => {
  beforeEach(() => {
    window.localStorage.removeItem(PANEL_STORAGE_KEY);
    window.localStorage.removeItem('wayfound_debug');
  });

  it('is collapsed by default and remembers being opened', () => {
    expect(loadPanelOpen()).toBe(false);
    savePanelOpen(true);
    expect(loadPanelOpen()).toBe(true);
    savePanelOpen(false);
    expect(loadPanelOpen()).toBe(false);
  });

  it('shows three tabs and starts on Lessons', () => {
    render(<AgentPanel onClose={() => {}} memory={emptyMemory()} onClearMemory={() => {}} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByTestId('panel-tab-lessons')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('panel-lessons')).toBeInTheDocument();
  });

  it('renders remembered preferences as rows and offers to clear them', () => {
    const memory = recordPlanningSession(emptyMemory(), input);
    let cleared = false;
    render(<AgentPanel onClose={() => {}} memory={memory} onClearMemory={() => (cleared = true)} />);
    fireEvent.click(screen.getByTestId('panel-tab-preferences'));
    // Memory keeps the most recently used vibe first.
    expect(screen.getByTestId('preference-interests')).toHaveTextContent('Culture, Food');
    expect(screen.getByTestId('preference-tripType')).toHaveTextContent('Couple');
    expect(screen.getByTestId('preference-pastTrips')).toHaveTextContent('Kyoto');
    expect(screen.getByTestId('preference-specialNeeds')).toHaveTextContent('Vegetarian');
    fireEvent.click(screen.getByTestId('memory-clear'));
    expect(cleared).toBe(true);
  });

  it('shows an empty state when nothing is remembered', () => {
    render(<AgentPanel onClose={() => {}} memory={emptyMemory()} onClearMemory={() => {}} />);
    fireEvent.click(screen.getByTestId('panel-tab-preferences'));
    expect(screen.getByTestId('preferences-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('memory-clear')).toBeNull();
  });

  it('keeps the trace behind debug mode', () => {
    render(<AgentPanel onClose={() => {}} memory={emptyMemory()} onClearMemory={() => {}} requestId="abc" />);
    fireEvent.click(screen.getByTestId('panel-tab-trace'));
    expect(screen.queryByTestId('trace-viewer')).toBeNull();
    expect(screen.getByTestId('panel-trace')).toHaveTextContent('?debug=1');
  });

  it('calls onClose from the close button', () => {
    let closed = false;
    render(<AgentPanel onClose={() => (closed = true)} memory={emptyMemory()} onClearMemory={() => {}} />);
    fireEvent.click(screen.getByTestId('agent-panel-close'));
    expect(closed).toBe(true);
  });
});
