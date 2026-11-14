import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { resetLessonsCache } from '../../src/lib/lessons';
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

const library = {
  libraryVersion: 19,
  method: 'group',
  epoch: 1,
  updatedAt: '',
  lessons: [
    { id: 'L01', scope: 'final_answer', lesson: 'Tally each day against the budget cap before answering.', helpful: 8, harmful: 6, created_epoch: 1, source_case: 'a' },
    { id: 'L02', scope: 'international/search_places', lesson: 'Search with the plain place name first.', helpful: 3, harmful: 0, created_epoch: 1, source_case: 'b' },
    { id: 'L03', scope: 'calculate_distance', lesson: 'Only measure distances between ids a search returned.', helpful: 1, harmful: 1, created_epoch: 1, source_case: 'c' },
  ],
};

describe('AgentPanel', () => {
  beforeEach(() => {
    window.localStorage.removeItem(PANEL_STORAGE_KEY);
    window.localStorage.removeItem('wayfound_debug');
    resetLessonsCache();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => library }));
  });
  afterEach(() => vi.unstubAllGlobals());

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

  it('lists the library with id, scope, text and counts, ranked by net score', async () => {
    render(<AgentPanel onClose={() => {}} memory={emptyMemory()} onClearMemory={() => {}} />);
    const list = await screen.findByTestId('lesson-list');
    const ids = Array.from(list.querySelectorAll('li')).map(li => li.getAttribute('data-testid'));
    expect(ids).toEqual(['lesson-L02', 'lesson-L01', 'lesson-L03']);
    expect(screen.getByTestId('lesson-L02')).toHaveTextContent('International · Searching places');
    expect(screen.getByTestId('lesson-L02')).toHaveTextContent('Search with the plain place name first.');
    expect(screen.getByTestId('lesson-L01')).toHaveTextContent('8 helpful');
    expect(screen.getByTestId('lesson-L01')).toHaveTextContent('6 harmful');
    expect(screen.getByTestId('library-version')).toHaveTextContent('Library v19 · 3 lessons');
    // No plan yet: the "this run" filter is disabled.
    expect(screen.getByTestId('lesson-filter-used')).toBeDisabled();
  });

  it('marks the lessons this plan used and filters by run or tool', async () => {
    render(<AgentPanel onClose={() => {}} memory={emptyMemory()} onClearMemory={() => {}} usedLessonIds={['L01', 'L03']} />);
    await screen.findByTestId('lesson-list');
    expect(screen.getByTestId('lesson-L01')).toHaveAttribute('data-used', 'true');
    expect(screen.getByTestId('lesson-L02')).not.toHaveAttribute('data-used');
    fireEvent.click(screen.getByTestId('lesson-filter-used'));
    expect(screen.queryByTestId('lesson-L02')).toBeNull();
    expect(screen.getByTestId('lesson-L01')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lesson-filter-search_places'));
    expect(screen.getByTestId('lesson-L02')).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-L01')).toBeNull();
    fireEvent.click(screen.getByTestId('lesson-filter-calculate_distance'));
    expect(screen.getByTestId('lesson-L03')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lesson-filter-final_answer'));
    expect(screen.getByTestId('lesson-L01')).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-L03')).toBeNull();
  });

  it('can open straight on the "this run" filter and be controlled from outside', async () => {
    let tab = 'lessons';
    render(
      <AgentPanel onClose={() => {}} memory={emptyMemory()} onClearMemory={() => {}} usedLessonIds={['L02']} lessonFilter="used" tab="lessons" onTabChange={next => (tab = next)} />,
    );
    await screen.findByTestId('lesson-list');
    expect(screen.getByTestId('lesson-filter-used')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('lesson-L02')).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-L01')).toBeNull();
    fireEvent.click(screen.getByTestId('panel-tab-trace'));
    expect(tab).toBe('trace');
  });

  it('shows an error when the library cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<AgentPanel onClose={() => {}} memory={emptyMemory()} onClearMemory={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('lessons-failed')).toBeInTheDocument());
  });

  it('renders remembered preferences as rows and offers to clear them', () => {
    const memory = recordPlanningSession(emptyMemory(), input);
    let cleared = false;
    render(<AgentPanel onClose={() => {}} memory={memory} onClearMemory={() => (cleared = true)} />);
    fireEvent.click(screen.getByTestId('panel-tab-preferences'));
    // Memory keeps the most recently used vibe first; each interest is its own removable chip.
    const chips = Array.from(screen.getByTestId('preference-interests').querySelectorAll('[data-testid^="preference-item-interests-"]')).map(c => c.textContent);
    expect(chips).toEqual(['Culture', 'Food']);
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
