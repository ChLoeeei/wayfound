import { describe, it, expect } from 'vitest';
import { safeFilename } from '../../src/lib/export';

describe('safeFilename', () => {
  it('strips spaces and unsafe characters', () => {
    expect(safeFilename('Kyoto / Osaka 5天')).toBe('Kyoto-Osaka-5天');
  });

  it('collapses repeated dashes', () => {
    expect(safeFilename('a   b/// c')).toBe('a-b-c');
  });

  it('trims leading and trailing dashes', () => {
    expect(safeFilename('---trip---')).toBe('trip');
  });

  it('falls back to "wayfound" for empty input', () => {
    expect(safeFilename('')).toBe('wayfound');
    expect(safeFilename('   ')).toBe('wayfound');
  });

  it('truncates to ≤ 60 chars', () => {
    const long = 'a'.repeat(120);
    expect(safeFilename(long).length).toBe(60);
  });
});
