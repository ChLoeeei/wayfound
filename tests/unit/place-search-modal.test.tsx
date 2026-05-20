import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlaceSearchModal from '../../src/components/PlaceSearchModal';

describe('PlaceSearchModal', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function setup() {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <PlaceSearchModal
        destination="上海"
        initialDayNumber={1}
        initialPeriod="afternoon"
        availableDays={[1, 2, 3]}
        onClose={onClose}
        onAdd={onAdd}
      />,
    );
    return { onAdd, onClose };
  }

  it('shows hint while query is empty and does not call fetch', () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    setup();
    expect(screen.getByText('输入关键词开始搜索')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('debounces and renders search results', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: 'B0FF',
              name: '外滩',
              address: '中山东一路',
              lat: 31.241,
              lng: 121.49,
              type: '风景名胜',
              rating: 4.8,
            },
          ],
        }),
        { status: 200 },
      ),
    ) as any;

    setup();
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: '外滩' } });

    await waitFor(
      () => {
        expect(screen.getByTestId('search-result-B0FF')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText('外滩')).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
  });

  it('calls onAdd with selected day + period when a result is clicked', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: 'B0FF', name: '外滩', address: 'addr', lat: 31.24, lng: 121.49, type: '风景' },
          ],
        }),
        { status: 200 },
      ),
    ) as any;
    const { onAdd, onClose } = setup();
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: '外滩' } });

    await waitFor(() => screen.getByTestId('search-result-B0FF'), { timeout: 2000 });

    fireEvent.change(screen.getByTestId('search-day'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('search-period'), { target: { value: 'evening' } });

    fireEvent.click(screen.getByTestId('search-result-B0FF'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [place, dayNumber, period] = onAdd.mock.calls[0];
    expect(place.name).toBe('外滩');
    expect(place.coordinates).toEqual({ lat: 31.24, lng: 121.49 });
    expect(dayNumber).toBe(2);
    expect(period).toBe('evening');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when results array is empty', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as any;
    setup();
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'xxxx' } });
    await waitFor(
      () => {
        expect(screen.getByText('没有结果')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
