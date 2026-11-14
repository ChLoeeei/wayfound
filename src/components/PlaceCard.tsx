import React, { useState } from 'react';
import { Star, ExternalLink, Trash2, ChevronDown, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Place, SlotPeriod } from '../types';
import { PERIOD_ORDER, proxyImageUrl } from '../lib/itineraryOps';
import { useT } from '../i18n';

interface PlaceCardProps {
  place: Place;
  index: number;
  /** Period the card currently lives in. Used by the slot picker. */
  period: SlotPeriod;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onChangeSlot?: (next: SlotPeriod) => void;
  /** Disable drag-and-drop (read-only views). */
  disableDrag?: boolean;
  /** Hide the button column (whole-trip export / print). */
  hideActions?: boolean;
}

/**
 * One stop in the day's list, laid out like the design's slot card: time
 * column, name + `type · cost` line, action buttons. Lock / replace arrive
 * with partial replanning (v2 feature C); until then the actions are the
 * existing delete and the expand toggle (note, slot picker, links).
 */
export default function PlaceCard({
  place,
  index,
  period,
  isSelected,
  onSelect,
  onDelete,
  onChangeSlot,
  disableDrag,
  hideActions,
}: PlaceCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: place.id,
    disabled: disableDrag,
  });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const meta = [t(`place.types.${place.type}`), place.estimatedCost > 0 ? `¥${place.estimatedCost}` : t('place.free')];
  if (place.duration > 0) meta.push(t('place.hours', { hours: Math.round((place.duration / 60) * 10) / 10 }));

  return (
    <article
      ref={setNodeRef}
      style={dragStyle}
      data-testid={`place-card-${place.id}`}
      aria-selected={isSelected}
      className={`group flex gap-3 p-3 md:p-3.5 border rounded-xl bg-surface cursor-pointer transition-colors ${
        isSelected ? 'border-accent shadow-sm' : 'border-border hover:border-border-strong'
      }`}
      onClick={onSelect}
    >
      <div className="flex-none pt-0.5">
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-semibold ${isSelected ? 'bg-accent' : 'bg-text-main'}`}
          aria-hidden="true"
        >
          {index + 1}
        </span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {place.imageUrl && (
            <img
              src={proxyImageUrl(place.imageUrl)}
              alt=""
              className="w-7 h-7 rounded-md object-cover border border-border"
              crossOrigin="anonymous"
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <h4 className="m-0 font-semibold leading-tight break-words min-w-0">{place.name}</h4>
          {place.unverified && (
            <span
              className="text-xs font-semibold text-updated-text bg-updated-chip px-2 py-0.5 rounded-full"
              title={t('itinerary.unverifiedHint')}
              data-testid={`place-unverified-${place.id}`}
            >
              {t('itinerary.unverified')}
            </span>
          )}
        </div>
        <div className="text-text-muted text-[13px] flex flex-wrap items-center gap-x-1.5">
          {place.rating != null && (
            <span className="inline-flex items-center gap-1 text-accent font-medium">
              <Star size={11} className="fill-current" />
              {place.rating}
            </span>
          )}
          <span>{meta.join(' · ')}</span>
        </div>

        {expanded && (
          <div className="mt-2 pt-2 border-t border-border text-sm flex flex-col gap-2">
            {place.aiNote && <p className="m-0 text-text-main/90 leading-relaxed">{place.aiNote}</p>}

            {onChangeSlot && (
              <label className="flex items-center gap-2 text-xs text-text-muted">
                {t('place.moveTo')}
                <select
                  data-testid={`place-slot-${place.id}`}
                  value={period}
                  onChange={e => {
                    e.stopPropagation();
                    const next = e.target.value as SlotPeriod;
                    if (next !== period) onChangeSlot(next);
                  }}
                  onClick={e => e.stopPropagation()}
                  className="bg-surface border border-border-strong rounded-md px-2 py-1 text-text-main focus:outline-none focus:border-accent"
                >
                  {PERIOD_ORDER.map(p => (
                    <option key={p} value={p}>
                      {t(`period.${p}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex items-center gap-3 text-xs">
              {place.externalUrl && (
                <a
                  href={place.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1"
                >
                  {t('place.viewDetails')} <ExternalLink size={11} />
                </a>
              )}
              <a
                href={`https://ditu.amap.com/search?query=${encodeURIComponent(place.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1"
              >
                {t('place.openInAmap')} <ExternalLink size={11} />
              </a>
            </div>
          </div>
        )}
      </div>

      <div className={`flex gap-1.5 self-start ${hideActions ? 'hidden' : ''}`}>
        {!disableDrag && (
          <button
            type="button"
            aria-label={t('place.drag')}
            data-testid={`place-drag-${place.id}`}
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
            className="w-9 h-9 rounded-lg border border-border-strong bg-surface flex items-center justify-center cursor-grab active:cursor-grabbing text-text-muted hover:text-text-main"
          >
            <GripVertical size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            setExpanded(v => !v);
          }}
          aria-label={t('place.expand')}
          aria-expanded={expanded}
          className="w-9 h-9 rounded-lg border border-border-strong bg-surface flex items-center justify-center text-text-main hover:bg-bg-base"
        >
          <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {onDelete && (
          <button
            type="button"
            data-testid={`place-delete-${place.id}`}
            aria-label={t('place.delete')}
            title={t('place.delete')}
            className="w-9 h-9 rounded-lg border border-border-strong bg-surface flex items-center justify-center text-delete hover:bg-delete-tint hover:border-delete-line"
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </article>
  );
}
