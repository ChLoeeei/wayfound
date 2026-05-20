import { useEffect, useState } from 'react';

/**
 * Tiny hash-router. Returns the current segment after `#/`.
 * Examples:
 *   #/             → ''
 *   #/share/abc123 → 'share/abc123'
 */
export function useHashRoute(): string {
  const [hash, setHash] = useState(() => readHash());
  useEffect(() => {
    const onChange = () => setHash(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function readHash(): string {
  if (typeof window === 'undefined') return '';
  const raw = window.location.hash || '';
  if (raw.startsWith('#/')) return raw.slice(2);
  if (raw.startsWith('#')) return raw.slice(1);
  return raw;
}

/** Match a route pattern like 'share/:id' against the current hash. */
export function matchRoute(pattern: string, hash: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const hashParts = hash.split('/').filter(Boolean);
  if (patternParts.length !== hashParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(hashParts[i]);
    } else if (p !== hashParts[i]) {
      return null;
    }
  }
  return params;
}
