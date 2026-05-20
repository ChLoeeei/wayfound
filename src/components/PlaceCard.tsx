import React, { useState } from 'react';
import { Star, Clock, MapPin, ExternalLink, Trash2, ChevronDown, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Place, SlotPeriod } from '../types';
import { PERIOD_LABEL, PERIOD_ORDER, proxyImageUrl } from '../lib/itineraryOps';

interface PlaceCardProps {
  place: Place;
  index: number;
  /** Period the card currently lives in. Used by the slot picker. */
  period: SlotPeriod;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onChangeSlot?: (next: SlotPeriod) => void;
  /** Disable drag-and-drop (e.g. on mobile). */
  disableDrag?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  attraction: '景点',
  restaurant: '餐厅',
  hotel: '住宿',
  shopping: '购物',
  cafe: '咖啡',
  nightlife: '夜生活',
  leisure: '休闲',
};

export default function PlaceCard({
  place,
  index,
  period,
  isSelected,
  onSelect,
  onDelete,
  onChangeSlot,
  disableDrag,
}: PlaceCardProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      data-testid={`place-card-${place.id}`}
      className={`relative group bg-surface border rounded-2xl overflow-hidden transition-shadow cursor-pointer ${
        isSelected
          ? 'border-accent shadow-md'
          : 'border-border hover:border-text-muted hover:shadow-sm'
      }`}
      onClick={onSelect}
    >
      <div className="absolute top-3 left-3 z-10 w-6 h-6 rounded-full bg-bg-base border border-border flex items-center justify-center text-xs font-bold shadow-sm">
        {index + 1}
      </div>

      {/* Drag handle (desktop) */}
      {!disableDrag && (
        <button
          type="button"
          aria-label="拖拽"
          data-testid={`place-drag-${place.id}`}
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-text-muted hover:text-text-main"
        >
          <GripVertical size={14} />
        </button>
      )}

      {onDelete && (
        <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            data-testid={`place-delete-${place.id}`}
            className="w-8 h-8 rounded-full bg-bg-base/80 backdrop-blur border border-border flex items-center justify-center text-delete hover:bg-delete hover:text-white transition-colors"
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      <div className="flex">
        <div className="w-[60px] h-[60px] m-3 shrink-0 rounded-lg overflow-hidden bg-bg-base border border-border relative">
          {place.imageUrl ? (
            <img
              src={proxyImageUrl(place.imageUrl)}
              alt={place.name}
              className="w-full h-full object-cover"
              crossOrigin="anonymous"
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-border">
              <MapPin size={20} />
            </div>
          )}
        </div>

        <div className="flex-1 py-3 pr-3 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <h4 className="text-base font-display font-medium leading-tight truncate">{place.name}</h4>
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                setExpanded(v => !v);
              }}
              className="text-text-muted hover:text-text-main"
              aria-label="展开"
            >
              <ChevronDown
                size={16}
                className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-text-muted">
            {place.rating != null && (
              <div className="flex items-center gap-1 text-accent font-medium">
                <Star size={11} className="fill-current" />
                <span>{place.rating}</span>
              </div>
            )}
            {place.estimatedCost > 0 && <div className="font-mono">¥{place.estimatedCost}</div>}
            <div className="text-text-muted/80">{TYPE_LABEL[place.type] ?? place.type}</div>
            {place.duration > 0 && (
              <div className="flex items-center gap-1">
                <Clock size={11} />
                <span>{Math.round((place.duration / 60) * 10) / 10}h</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 px-3 py-3 text-sm bg-bg-base/40 space-y-3">
          {place.aiNote && <p className="text-text-main/90 leading-relaxed">{place.aiNote}</p>}

          {/* Slot picker */}
          {onChangeSlot && (
            <label className="flex items-center gap-2 text-xs text-text-muted">
              移到
              <select
                data-testid={`place-slot-${place.id}`}
                value={period}
                onChange={e => {
                  e.stopPropagation();
                  const next = e.target.value as SlotPeriod;
                  if (next !== period) onChangeSlot(next);
                }}
                onClick={e => e.stopPropagation()}
                className="bg-bg-base border border-border rounded-md px-2 py-1 text-text-main focus:outline-none focus:border-accent"
              >
                {PERIOD_ORDER.map(p => (
                  <option key={p} value={p}>
                    {PERIOD_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex items-center gap-3 text-xs text-text-muted">
            {place.externalUrl && (
              <a
                href={place.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-accent hover:text-text-main"
              >
                查看详情 <ExternalLink size={11} />
              </a>
            )}
            <a
              href={`https://ditu.amap.com/search?query=${encodeURIComponent(place.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-accent hover:text-text-main"
            >
              在高德打开 <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
