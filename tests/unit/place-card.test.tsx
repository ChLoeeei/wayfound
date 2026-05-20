import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import PlaceCard from '../../src/components/PlaceCard';
import type { Place } from '../../src/types';

const samplePlace: Place = {
  id: 'p1',
  name: 'Fushimi Inari',
  type: 'attraction',
  coordinates: { lat: 34.967, lng: 135.772 },
  rating: 4.8,
  estimatedCost: 0,
  duration: 120,
  imageUrl: 'https://example.com/img.jpg',
  aiNote: '千本鸟居超出片',
};

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <DndContext>
      <SortableContext items={[samplePlace.id]}>{children}</SortableContext>
    </DndContext>
  );
}

const baseProps = {
  place: samplePlace,
  index: 0,
  period: 'morning' as const,
  isSelected: false,
  onSelect: () => {},
};

describe('PlaceCard', () => {
  it('renders the place name and meta', () => {
    render(
      <Wrap>
        <PlaceCard {...baseProps} />
      </Wrap>,
    );
    expect(screen.getByText('Fushimi Inari')).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByText('景点')).toBeInTheDocument();
  });

  it('shows the running index +1', () => {
    render(
      <Wrap>
        <PlaceCard {...baseProps} index={2} />
      </Wrap>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('fires onSelect when clicked', () => {
    let clicked = false;
    render(
      <Wrap>
        <PlaceCard
          {...baseProps}
          onSelect={() => {
            clicked = true;
          }}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('place-card-p1'));
    expect(clicked).toBe(true);
  });

  it('shows the selected style class when isSelected', () => {
    const { rerender } = render(
      <Wrap>
        <PlaceCard {...baseProps} />
      </Wrap>,
    );
    expect(screen.getByTestId('place-card-p1').className).not.toContain('border-accent');
    rerender(
      <Wrap>
        <PlaceCard {...baseProps} isSelected={true} />
      </Wrap>,
    );
    expect(screen.getByTestId('place-card-p1').className).toContain('border-accent');
  });

  it('renders delete button only when onDelete is supplied', () => {
    const { rerender } = render(
      <Wrap>
        <PlaceCard {...baseProps} />
      </Wrap>,
    );
    expect(screen.queryByTestId('place-delete-p1')).toBeNull();
    rerender(
      <Wrap>
        <PlaceCard {...baseProps} onDelete={() => {}} />
      </Wrap>,
    );
    expect(screen.getByTestId('place-delete-p1')).toBeInTheDocument();
  });

  it('does not bubble click when delete is pressed', () => {
    let cardClicks = 0;
    let deleteClicks = 0;
    render(
      <Wrap>
        <PlaceCard
          {...baseProps}
          onSelect={() => {
            cardClicks++;
          }}
          onDelete={() => {
            deleteClicks++;
          }}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('place-delete-p1'));
    expect(deleteClicks).toBe(1);
    expect(cardClicks).toBe(0);
  });

  it('shows slot picker when onChangeSlot is provided and selecting changes period', () => {
    let nextPeriod: string | null = null;
    render(
      <Wrap>
        <PlaceCard
          {...baseProps}
          period="morning"
          onChangeSlot={p => {
            nextPeriod = p;
          }}
        />
      </Wrap>,
    );
    // Expand to surface the slot picker
    fireEvent.click(screen.getByLabelText('展开'));
    const picker = screen.getByTestId('place-slot-p1') as HTMLSelectElement;
    expect(picker.value).toBe('morning');
    fireEvent.change(picker, { target: { value: 'afternoon' } });
    expect(nextPeriod).toBe('afternoon');
  });
});
