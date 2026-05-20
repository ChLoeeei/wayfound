import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UndoSnack from '../../src/components/UndoSnack';

describe('UndoSnack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the message', () => {
    render(<UndoSnack message="已删除「外滩」" onUndo={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('已删除「外滩」')).toBeInTheDocument();
  });

  it('fires onUndo when 撤销 is clicked', () => {
    let undone = false;
    render(
      <UndoSnack
        message="msg"
        onUndo={() => {
          undone = true;
        }}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('undo-snack-button'));
    expect(undone).toBe(true);
  });

  it('auto-dismisses after duration', () => {
    let dismissed = false;
    render(
      <UndoSnack
        message="msg"
        onUndo={() => {}}
        onDismiss={() => {
          dismissed = true;
        }}
        duration={3000}
      />,
    );
    expect(dismissed).toBe(false);
    vi.advanceTimersByTime(2999);
    expect(dismissed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(dismissed).toBe(true);
  });
});
