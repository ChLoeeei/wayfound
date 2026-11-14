import React, { useEffect } from 'react';
import { Undo2 } from 'lucide-react';
import { useT } from '../i18n';

interface UndoSnackProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** ms before auto dismiss; default 5000 */
  duration?: number;
}

export default function UndoSnack({ message, onUndo, onDismiss, duration = 5000 }: UndoSnackProps) {
  const t = useT();
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div
      role="status"
      data-testid="undo-snack"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-text-main text-white shadow-xl rounded-full px-4 py-2 text-sm"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        data-testid="undo-snack-button"
        className="inline-flex items-center gap-1 font-medium text-accent-line hover:text-white transition-colors min-h-[32px]"
      >
        <Undo2 size={14} />
        {t('undo.undo')}
      </button>
    </div>
  );
}
