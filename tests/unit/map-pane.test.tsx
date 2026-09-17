import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Itinerary } from '../../src/types';

// MapPane's job here is purely the routing decision (which map engine to
// mount) — the engines' own rendering (Amap SDK calls, Leaflet DOM/tile
// setup) isn't exercised under jsdom, same as before this routing layer
// existed (there was no MapPane test at all). Stub both so this test
// stays fast and only asserts what MapPane itself is responsible for.
vi.mock('../../src/components/AmapMapPane', () => ({
  default: () => <div data-testid="amap-map-pane" />,
}));
vi.mock('../../src/components/LeafletMapPane', () => ({
  default: () => <div data-testid="leaflet-map-pane" />,
}));

const { default: MapPane } = await import('../../src/components/MapPane');

function itinerary(destination: string): Itinerary {
  return {
    title: 'Test trip',
    destination,
    startDate: '2026-05-20',
    endDate: '2026-05-21',
    days: [],
  };
}

describe('MapPane routing', () => {
  it('routes a mainland China destination to AmapMapPane', () => {
    render(
      <MapPane itinerary={itinerary('北京')} selectedPlaceId={null} onSelectPlace={() => {}} darkMode={false} />,
    );
    expect(screen.getByTestId('amap-map-pane')).toBeTruthy();
    expect(screen.queryByTestId('leaflet-map-pane')).toBeNull();
  });

  it('routes an English-name mainland China destination to AmapMapPane too', () => {
    render(
      <MapPane itinerary={itinerary('Shanghai')} selectedPlaceId={null} onSelectPlace={() => {}} darkMode={false} />,
    );
    expect(screen.getByTestId('amap-map-pane')).toBeTruthy();
  });

  it('routes an international destination to LeafletMapPane', () => {
    render(
      <MapPane itinerary={itinerary('Tokyo')} selectedPlaceId={null} onSelectPlace={() => {}} darkMode={false} />,
    );
    expect(screen.getByTestId('leaflet-map-pane')).toBeTruthy();
    expect(screen.queryByTestId('amap-map-pane')).toBeNull();
  });

  it('defaults to AmapMapPane when there is no itinerary yet', () => {
    render(<MapPane itinerary={null} selectedPlaceId={null} onSelectPlace={() => {}} darkMode={false} />);
    expect(screen.getByTestId('amap-map-pane')).toBeTruthy();
  });
});
