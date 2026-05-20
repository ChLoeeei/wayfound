import { describe, it, expect } from 'vitest';
import { matchRoute } from '../../src/hooks/useHashRoute';

describe('matchRoute', () => {
  it('matches a static segment', () => {
    expect(matchRoute('about', 'about')).toEqual({});
  });

  it('returns null for mismatched static', () => {
    expect(matchRoute('about', 'help')).toBeNull();
  });

  it('captures a single param', () => {
    expect(matchRoute('share/:id', 'share/abc-123')).toEqual({ id: 'abc-123' });
  });

  it('returns null when segment count differs', () => {
    expect(matchRoute('share/:id', 'share')).toBeNull();
    expect(matchRoute('share/:id', 'share/abc/extra')).toBeNull();
  });

  it('decodes URI components in params', () => {
    expect(matchRoute('share/:id', 'share/' + encodeURIComponent('a b/c'))).toEqual({ id: 'a b/c' });
  });

  it('handles multiple params', () => {
    expect(matchRoute('user/:uid/trip/:tid', 'user/u1/trip/t9')).toEqual({ uid: 'u1', tid: 't9' });
  });

  it('returns null when a literal segment differs', () => {
    expect(matchRoute('share/:id', 'public/abc')).toBeNull();
  });
});
