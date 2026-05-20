import React, { useEffect } from 'react';
import { ChevronUp, X } from 'lucide-react';
import { Snap, SNAP_HEIGHT, SNAP_ORDER, nextSnap } from '../hooks/useDrawerSnap';

interface BottomSheetProps {
  open: boolean;
  /** Current snap point. */
  snap: Snap;
  onSnapChange: (next: Snap) => void;
  /** Optional close handler — when omitted, sheet is non-dismissable (just collapsible). */
  onClose?: () => void;
  /** Sheet title shown in the grabber bar. */
  title?: React.ReactNode;
  children: React.ReactNode;
  /** When true the sheet has a backdrop and consumes background clicks. */
  modal?: boolean;
  testId?: string;
}

export default function BottomSheet({
  open,
  snap,
  onSnapChange,
  onClose,
  title,
  children,
  modal = false,
  testId = 'bottom-sheet',
}: BottomSheetProps) {
  // ESC closes (or collapses to peek)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (onClose) onClose();
      else onSnapChange('peek');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onSnapChange]);

  if (!open) return null;

  const heightPct = Math.round(SNAP_HEIGHT[snap] * 100);

  const cycle = () => onSnapChange(nextSnap(snap));

  return (
    <>
      {modal && (
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px]"
          data-testid={`${testId}-backdrop`}
        />
      )}
      <div
        role="dialog"
        aria-modal={modal}
        data-testid={testId}
        data-snap={snap}
        className="fixed inset-x-0 bottom-0 z-40 bg-surface border-t border-border rounded-t-2xl shadow-2xl flex flex-col transition-[height] duration-300 ease-out"
        style={{ height: `${heightPct}vh` }}
      >
        <button
          type="button"
          onClick={cycle}
          aria-label="展开/收起"
          data-testid={`${testId}-grabber`}
          className="w-full pt-2 pb-1 flex items-center justify-center cursor-pointer"
        >
          <span className="block w-12 h-1.5 rounded-full bg-border" />
        </button>

        {(title || onClose) && (
          <div className="flex items-center justify-between px-5 pb-2 pt-1">
            <div className="text-sm font-medium tracking-wide">{title}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cycle}
                aria-label="切换高度"
                className="p-1 text-text-muted hover:text-text-main transition-colors"
              >
                <ChevronUp
                  size={16}
                  className={`transition-transform ${
                    snap === 'full' ? 'rotate-180' : snap === 'peek' ? 'rotate-0' : 'rotate-90'
                  }`}
                />
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭"
                  data-testid={`${testId}-close`}
                  className="p-1 text-text-muted hover:text-text-main transition-colors"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </>
  );
}

export { SNAP_ORDER };
