import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ConversationPane from '../../src/components/ConversationPane';
import { emptyMemory } from '../../src/lib/memory';
import { newTurn } from '../../src/lib/editFlow';
import type { Itinerary, PlanningInput } from '../../src/types';

const input: PlanningInput = {
  destination: 'Kyoto',
  startDate: '2026-05-20',
  endDate: '2026-05-22',
  people: 2,
  groupType: 'couple',
  vibes: ['food'],
  budget: { min: 300, max: 1500 },
  specialNeeds: [],
};
const itinerary: Itinerary = { title: 'Kyoto trip', destination: 'Kyoto', startDate: '2026-05-20', endDate: '2026-05-22', days: [] };

function renderPane(over: Partial<React.ComponentProps<typeof ConversationPane>> = {}) {
  return render(
    <ConversationPane
      stage="ready"
      input={input}
      itinerary={itinerary}
      error=""
      clarifyQuestions={[]}
      onClarifyResolve={() => {}}
      onSubmit={() => {}}
      memory={emptyMemory()}
      formOpen={false}
      onToggleForm={() => {}}
      {...over}
    />,
  );
}

describe('ConversationPane edits', () => {
  it('keeps the message box disabled before a plan exists', () => {
    renderPane({ stage: 'idle', input: null, itinerary: null, onSendMessage: () => {} });
    expect(screen.getByTestId('message-input')).toBeDisabled();
    expect(screen.getByTestId('send-button')).toBeDisabled();
    expect(screen.getByTestId('photo-button')).toBeDisabled();
  });

  it('sends a trimmed message and clears the box once a plan is ready', () => {
    const sent: string[] = [];
    renderPane({ onSendMessage: text => sent.push(text) });
    const box = screen.getByTestId('message-input') as HTMLInputElement;
    expect(box).not.toBeDisabled();
    expect(screen.getByTestId('send-button')).toBeDisabled();
    fireEvent.change(box, { target: { value: '  swap the museum for ramen  ' } });
    expect(screen.getByTestId('send-button')).not.toBeDisabled();
    fireEvent.submit(box.closest('form')!);
    expect(sent).toEqual(['swap the museum for ramen']);
    expect(box.value).toBe('');
    // The photo button is still feature D's job.
    expect(screen.getByTestId('photo-button')).toBeDisabled();
  });

  it('renders the edit turns with their kind and a busy bubble', () => {
    renderPane({
      onSendMessage: () => {},
      editBusy: true,
      messages: [newTurn('user', 'make day 2 easier'), newTurn('assistant', 'Which period?', 'question'), newTurn('assistant', 'Done: 1 stop changed', 'done')],
    });
    const turns = screen.getAllByTestId(/^turn-/);
    expect(turns.map(el => el.getAttribute('data-kind'))).toEqual([null, 'question', 'done']);
    expect(screen.getByTestId('edit-busy')).toBeInTheDocument();
    expect(screen.getByTestId('message-input')).toBeDisabled();
  });

  it('enables the photo button only once a plan exists and a handler is given, and forwards the file', () => {
    const files: string[] = [];
    renderPane({ onSendMessage: () => {}, onPhotoFile: f => files.push(f.name) });
    const button = screen.getByTestId('photo-button');
    expect(button).not.toBeDisabled();
    const input = screen.getByTestId('photo-input') as HTMLInputElement;
    expect(input.accept).toContain('image/jpeg');
    const file = new File(['x'], 'temple.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(files).toEqual(['temple.jpg']);
  });

  it('renders the photo card when a photo is in progress', () => {
    renderPane({ onSendMessage: () => {}, onPhotoFile: () => {}, photo: { status: 'identifying', preview: 'x' } });
    expect(screen.getByTestId('photo-card')).toBeInTheDocument();
  });
});
