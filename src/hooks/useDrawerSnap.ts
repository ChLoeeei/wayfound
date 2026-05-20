import { useState, useCallback } from 'react';

/** Drawer snap point. peek = mostly closed; half = midway; full = mostly open. */
export type Snap = 'peek' | 'half' | 'full';

export const SNAP_ORDER: Snap[] = ['peek', 'half', 'full'];

/** Map each snap to a height ratio (of viewport). */
export const SNAP_HEIGHT: Record<Snap, number> = {
  peek: 0.12,
  half: 0.5,
  full: 0.9,
};

/** Cycle to the next snap. peek → half → full → peek. */
export function nextSnap(current: Snap): Snap {
  const i = SNAP_ORDER.indexOf(current);
  return SNAP_ORDER[(i + 1) % SNAP_ORDER.length];
}

/** Cycle to the previous snap. */
export function prevSnap(current: Snap): Snap {
  const i = SNAP_ORDER.indexOf(current);
  return SNAP_ORDER[(i - 1 + SNAP_ORDER.length) % SNAP_ORDER.length];
}

export function useDrawerSnap(initial: Snap = 'half') {
  const [snap, setSnap] = useState<Snap>(initial);
  const expand = useCallback(() => setSnap(s => nextSnap(s)), []);
  const collapse = useCallback(() => setSnap(s => prevSnap(s)), []);
  return { snap, setSnap, expand, collapse };
}
