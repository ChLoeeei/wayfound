import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MAX_UPLOAD_BYTES, fitWithin, inferPlaceType, placeFromCandidate, validatePhotoFile } from '../../src/lib/photo';
import PhotoCandidatesCard from '../../src/components/PhotoCandidatesCard';
import type { PhotoCandidate, PhotoState } from '../../src/lib/photoTypes';

describe('photo client helpers', () => {
  it('validates type and size before anything is read', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(validatePhotoFile({ type: 'image/gif', size: 1000 })).toBe('type');
    expect(validatePhotoFile({ type: 'image/heic', size: 1000 })).toBe('type');
    expect(validatePhotoFile({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toBe('size');
  });

  it('downscales to the long edge only', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1000, 5000)).toEqual({ width: 320, height: 1600 });
  });

  it('maps provider types and builds a grounded place from a candidate', () => {
    expect(inferPlaceType('餐饮服务;中餐厅')).toBe('restaurant');
    expect(inferPlaceType('catering.cafe')).toBe('cafe');
    expect(inferPlaceType('tourism.sights', 'leisure')).toBe('leisure');
    const c: PhotoCandidate = { id: 'geoapify:abc', name: 'Kinkaku-ji', address: 'Kyoto', lat: 35.04, lng: 135.73, type: 'tourism.sights', rating: 4.7, exact: true };
    const p = placeFromCandidate(c, 'attraction');
    expect(p).toMatchObject({ name: 'Kinkaku-ji', type: 'attraction', coordinates: { lat: 35.04, lng: 135.73 }, rating: 4.7, poiId: 'geoapify:abc', estimatedCost: 0, duration: 90 });
    expect(p.id).toMatch(/^photo-/);
    expect(p.unverified).toBeUndefined();
  });
});

describe('PhotoCandidatesCard', () => {
  const candidates: PhotoCandidate[] = [
    { id: 'a', name: 'Kinkaku-ji', address: '1 Kinkakujicho', lat: 35, lng: 135, type: 'temple', exact: true },
    { id: 'b', name: 'Kinkaku-ji Shop', address: '', lat: 35, lng: 135, type: 'shop', exact: true },
    { id: 'c', name: 'Ryoan-ji', address: '', lat: 35, lng: 135, type: 'temple', exact: false },
  ];
  const ready = (over: Partial<PhotoState['result']> = {}): PhotoState => ({
    status: 'ready',
    preview: 'data:image/jpeg;base64,xx',
    result: { identified: { name: 'Kinkaku-ji', city: 'Kyoto', placeType: 'attraction', visibleText: '金閣寺', confidence: 0.92 }, candidates, confident: true, ...over },
  });

  it('preselects the top candidate when confident and adds to the chosen day and period', () => {
    const added: any[] = [];
    render(<PhotoCandidatesCard photo={ready()} availableDays={[1, 2, 3]} defaultDay={2} onAdd={(c, d, p) => added.push([c.id, d, p])} onDismiss={() => {}} />);
    expect(screen.getByTestId('photo-seen')).toHaveTextContent('Kinkaku-ji (92% sure) · Kyoto');
    expect(screen.getByTestId('photo-visible-text')).toHaveTextContent('金閣寺');
    expect(screen.getByTestId('photo-candidate-a')).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByTestId('photo-day'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('photo-period'), { target: { value: 'morning' } });
    fireEvent.click(screen.getByTestId('photo-add'));
    expect(added).toEqual([['a', 3, 'morning']]);
  });

  it('requires a choice when not confident and offers nothing when no result was verified', () => {
    const { unmount } = render(<PhotoCandidatesCard photo={ready({ confident: false })} availableDays={[1]} defaultDay={1} onAdd={() => {}} onDismiss={() => {}} />);
    expect(screen.getByTestId('photo-add')).toBeDisabled();
    fireEvent.click(screen.getByTestId('photo-candidate-c'));
    expect(screen.getByTestId('photo-add')).not.toBeDisabled();
    unmount();
    render(<PhotoCandidatesCard photo={ready({ candidates: [], confident: false })} availableDays={[1]} defaultDay={1} onAdd={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByTestId('photo-add')).toBeNull();
    expect(screen.getByTestId('photo-seen').parentElement).toHaveTextContent('No map search result confirms this place');
  });

  it('shows errors and progress states', () => {
    let dismissed = false;
    const { rerender } = render(<PhotoCandidatesCard photo={{ status: 'identifying', preview: 'x' }} availableDays={[1]} defaultDay={1} onAdd={() => {}} onDismiss={() => (dismissed = true)} />);
    expect(screen.getByTestId('photo-card')).toHaveTextContent('Looking at the photo');
    rerender(<PhotoCandidatesCard photo={{ status: 'failed', error: 'That image is over 8 MB.' }} availableDays={[1]} defaultDay={1} onAdd={() => {}} onDismiss={() => (dismissed = true)} />);
    expect(screen.getByTestId('photo-error')).toHaveTextContent('over 8 MB');
    fireEvent.click(screen.getByTestId('photo-dismiss'));
    expect(dismissed).toBe(true);
  });
});
