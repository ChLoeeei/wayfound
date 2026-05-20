import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDrawerSnap,
  nextSnap,
  prevSnap,
  SNAP_HEIGHT,
  SNAP_ORDER,
} from '../../src/hooks/useDrawerSnap';

describe('SNAP_HEIGHT / SNAP_ORDER', () => {
  it('three snap points in canonical order', () => {
    expect(SNAP_ORDER).toEqual(['peek', 'half', 'full']);
  });
  it('heights are within 0..1 and increasing', () => {
    expect(SNAP_HEIGHT.peek).toBeGreaterThan(0);
    expect(SNAP_HEIGHT.peek).toBeLessThan(SNAP_HEIGHT.half);
    expect(SNAP_HEIGHT.half).toBeLessThan(SNAP_HEIGHT.full);
    expect(SNAP_HEIGHT.full).toBeLessThanOrEqual(1);
  });
});

describe('nextSnap / prevSnap', () => {
  it('cycles forward', () => {
    expect(nextSnap('peek')).toBe('half');
    expect(nextSnap('half')).toBe('full');
    expect(nextSnap('full')).toBe('peek');
  });
  it('cycles backward', () => {
    expect(prevSnap('peek')).toBe('full');
    expect(prevSnap('half')).toBe('peek');
    expect(prevSnap('full')).toBe('half');
  });
});

describe('useDrawerSnap', () => {
  it('defaults to half', () => {
    const { result } = renderHook(() => useDrawerSnap());
    expect(result.current.snap).toBe('half');
  });

  it('honours initial snap', () => {
    const { result } = renderHook(() => useDrawerSnap('peek'));
    expect(result.current.snap).toBe('peek');
  });

  it('expand cycles forward', () => {
    const { result } = renderHook(() => useDrawerSnap('peek'));
    act(() => result.current.expand());
    expect(result.current.snap).toBe('half');
    act(() => result.current.expand());
    expect(result.current.snap).toBe('full');
    act(() => result.current.expand());
    expect(result.current.snap).toBe('peek');
  });

  it('collapse cycles backward', () => {
    const { result } = renderHook(() => useDrawerSnap('full'));
    act(() => result.current.collapse());
    expect(result.current.snap).toBe('half');
    act(() => result.current.collapse());
    expect(result.current.snap).toBe('peek');
  });

  it('setSnap jumps to a specific position', () => {
    const { result } = renderHook(() => useDrawerSnap('peek'));
    act(() => result.current.setSnap('full'));
    expect(result.current.snap).toBe('full');
  });
});
