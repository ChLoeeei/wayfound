import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import PlaceCard from '../../src/components/PlaceCard';
import type { Place } from '../../src/types';

const place: Place = {
  id: 'p1',
  name: '外滩',
  type: 'attraction',
  coordinates: { lat: 31.241, lng: 121.49 },
  rating: 4.7,
  estimatedCost: 0,
  duration: 90,
};

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <DndContext>
      <SortableContext items={[place.id]}>{children}</SortableContext>
    </DndContext>
  );
}

describe('PlaceCard read-only behaviour (Sprint 6 share view)', () => {
  it('hides drag handle when disableDrag', () => {
    render(
      <Wrap>
        <PlaceCard
          place={place}
          index={0}
          period="morning"
          isSelected={false}
          onSelect={() => {}}
          disableDrag
        />
      </Wrap>,
    );
    expect(screen.queryByTestId('place-drag-p1')).toBeNull();
  });

  it('hides delete button when onDelete is omitted (read-only)', () => {
    render(
      <Wrap>
        <PlaceCard
          place={place}
          index={0}
          period="morning"
          isSelected={false}
          onSelect={() => {}}
          disableDrag
        />
      </Wrap>,
    );
    expect(screen.queryByTestId('place-delete-p1')).toBeNull();
  });
});
