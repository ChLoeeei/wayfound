import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BottomSheet from '../../src/components/BottomSheet';
import { SNAP_HEIGHT } from '../../src/hooks/useDrawerSnap';

function setup(initialSnap: 'peek' | 'half' | 'full' = 'half', extra: any = {}) {
  const onSnapChange = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <BottomSheet
      open
      snap={initialSnap}
      onSnapChange={onSnapChange}
      onClose={extra.onClose ?? onClose}
      title="Test"
      testId="bs"
      {...extra}
    >
      <div>body</div>
    </BottomSheet>,
  );
  return { onSnapChange, onClose, ...utils };
}

describe('BottomSheet', () => {
  it('renders nothing when open=false', () => {
    const onSnapChange = vi.fn();
    render(
      <BottomSheet open={false} snap="half" onSnapChange={onSnapChange}>
        <div>hidden</div>
      </BottomSheet>,
    );
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('reflects snap as data attribute and height style', () => {
    setup('peek');
    const sheet = screen.getByTestId('bs');
    expect(sheet.getAttribute('data-snap')).toBe('peek');
    expect(sheet.style.height).toBe(`${Math.round(SNAP_HEIGHT.peek * 100)}vh`);
  });

  it('grabber click cycles snap forward', () => {
    const { onSnapChange } = setup('peek');
    fireEvent.click(screen.getByTestId('bs-grabber'));
    expect(onSnapChange).toHaveBeenCalledWith('half');
  });

  it('grabber from full cycles back to peek', () => {
    const { onSnapChange } = setup('full');
    fireEvent.click(screen.getByTestId('bs-grabber'));
    expect(onSnapChange).toHaveBeenCalledWith('peek');
  });

  it('ESC fires onClose when provided', () => {
    const { onClose } = setup('half');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('ESC collapses to peek when no onClose', () => {
    const onSnapChange = vi.fn();
    render(
      <BottomSheet open snap="full" onSnapChange={onSnapChange} testId="bs">
        body
      </BottomSheet>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSnapChange).toHaveBeenCalledWith('peek');
  });

  it('renders backdrop only in modal mode', () => {
    const { rerender, onSnapChange } = setup();
    expect(screen.queryByTestId('bs-backdrop')).toBeNull();
    rerender(
      <BottomSheet open snap="half" onSnapChange={onSnapChange} modal testId="bs">
        body
      </BottomSheet>,
    );
    expect(screen.getByTestId('bs-backdrop')).toBeInTheDocument();
  });

  it('close button fires onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId('bs-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
