import React, { useState } from 'react';
import { ShieldAlert, Loader2, RefreshCw, Plus } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Itinerary, Place, SlotPeriod } from '../types';
import {
  orderedSlots,
  PERIOD_LABEL,
  PERIOD_TIME_HINT,
  findPlace,
  movePlace,
  changeSlot,
  deletePlace,
} from '../lib/itineraryOps';
import PlaceCard from './PlaceCard';

interface ItineraryPaneProps {
  itinerary: Itinerary;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  onUpdateItinerary: (next: Itinerary) => void;
  onRequestDelete: (place: Place, dayNumber: number, period: SlotPeriod, atIndex: number) => void;
  onAddPlaceToSlot: (dayNumber: number, period: SlotPeriod) => void;
  /** Render in read-only mode (shared view). Disables editing affordances. */
  readOnly?: boolean;
  /** Optional ref so parents (export) can capture the rendered list as DOM. */
  rootRef?: React.Ref<HTMLDivElement>;
}

interface VerifyIssue {
  severity: 'low' | 'medium' | 'high';
  message: string;
  suggestion: string;
}

interface DroppableSlotProps {
  dayNumber: number;
  period: SlotPeriod;
  placeIds: string[];
  children: React.ReactNode;
}

function DroppableSlot({ dayNumber, period, placeIds, children }: DroppableSlotProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot-${dayNumber}-${period}`,
    data: { dayNumber, period, kind: 'slot' },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`slot-${dayNumber}-${period}`}
      className={`space-y-3 rounded-xl px-1 py-1 transition-colors ${
        isOver ? 'bg-accent/5 ring-1 ring-accent/40' : ''
      }`}
    >
      <SortableContext items={placeIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

export default function ItineraryPane({
  itinerary,
  selectedPlaceId,
  onSelectPlace,
  onUpdateItinerary,
  onRequestDelete,
  onAddPlaceToSlot,
  readOnly,
  rootRef,
}: ItineraryPaneProps) {
  const [verifying, setVerifying] = useState(false);
  const [issues, setIssues] = useState<VerifyIssue[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const handleDragStart = (e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;

    const placeId = String(active.id);
    const targetData = over.data.current as { dayNumber?: number; period?: SlotPeriod; kind?: string } | undefined;

    // Dropped on another card → reorder within the same slot, or move to that card's slot
    if (over.id !== active.id && !targetData?.kind) {
      const overFound = findPlace(itinerary, String(over.id));
      const fromFound = findPlace(itinerary, placeId);
      if (overFound && fromFound) {
        // If both in same slot, just splice in at over's position
        const sameSlot =
          overFound.day.dayNumber === fromFound.day.dayNumber &&
          overFound.slot.period === fromFound.slot.period;
        if (sameSlot && overFound.placeIndex === fromFound.placeIndex) return;
        const next = movePlace(
          itinerary,
          placeId,
          overFound.day.dayNumber,
          overFound.slot.period,
          overFound.placeIndex,
        );
        onUpdateItinerary(next);
      }
      return;
    }

    // Dropped on a slot container directly (empty slot or below cards)
    if (targetData?.kind === 'slot' && typeof targetData.dayNumber === 'number' && targetData.period) {
      const next = movePlace(itinerary, placeId, targetData.dayNumber, targetData.period);
      onUpdateItinerary(next);
    }
  };

  const handleDragCancel = () => setActiveDragId(null);

  const handleChangeSlot = (placeId: string, next: SlotPeriod) => {
    onUpdateItinerary(changeSlot(itinerary, placeId, next));
  };

  const handleDelete = (place: Place, dayNumber: number, period: SlotPeriod, atIndex: number) => {
    onRequestDelete(place, dayNumber, period, atIndex);
    onUpdateItinerary(deletePlace(itinerary, place.id));
  };

  const verifyItinerary = async () => {
    setVerifying(true);
    setIssues([]);
    try {
      const res = await fetch(`${process.env.API_BASE_URL}/api/verify-itinerary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary }),
      });
      const data = await res.json();
      setIssues(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setVerifying(false);
    }
  };

  const activePlace = activeDragId ? findPlace(itinerary, activeDragId)?.place : null;

  return (
    <div ref={rootRef} className="w-full max-w-2xl mx-auto pb-24" data-testid="itinerary-pane">
      <div className="mb-12 text-center md:text-left">
        <h1 className="text-4xl md:text-5xl font-display font-medium tracking-tight mb-4">
          {itinerary.title}
        </h1>
        {itinerary.summary && (
          <p className="text-text-muted text-lg font-light leading-relaxed">{itinerary.summary}</p>
        )}

        {!readOnly && (
          <div className="mt-6">
            <button
              onClick={verifyItinerary}
              disabled={verifying}
              className="inline-flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-full hover:border-accent hover:text-accent transition-colors text-sm uppercase tracking-wide font-medium disabled:opacity-50"
            >
              {verifying ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              AI 检查行程
            </button>
          </div>
        )}

        {issues.length > 0 && (
          <div className="mt-4 p-4 border border-delete/30 bg-delete/5 rounded-xl text-left">
            <h4 className="flex items-center gap-2 text-delete font-medium mb-3">
              <ShieldAlert size={18} />
              AI 检测到 {issues.length} 个问题
            </h4>
            <ul className="space-y-3">
              {issues.map((iss, i) => (
                <li key={i} className="text-sm">
                  <div className="font-semibold text-text-main">{iss.message}</div>
                  <div className="text-text-muted mt-1">{iss.suggestion}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="space-y-12">
          {itinerary.days.map(day => {
            let runningIndex = 0;
            return (
              <section key={day.dayNumber} className="relative" data-testid={`day-${day.dayNumber}`}>
                <header className="sticky top-0 z-20 bg-bg-base/90 backdrop-blur pb-4 pt-6 border-b border-border/50 mb-6 flex items-baseline gap-4">
                  <span className="font-display text-3xl text-accent italic">Day {day.dayNumber}</span>
                  {day.theme && (
                    <h3 className="text-xl font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
                      {day.theme}
                    </h3>
                  )}
                </header>

                <div className="space-y-8">
                  {orderedSlots(day).map(slot => (
                    <div key={slot.period}>
                      <div className="flex items-baseline justify-between mb-3">
                        <h4 className="font-mono text-xs uppercase tracking-widest text-text-muted">
                          {PERIOD_LABEL[slot.period]}
                        </h4>
                        <span className="font-mono text-[10px] tracking-widest text-text-muted/70">
                          {PERIOD_TIME_HINT[slot.period]}
                        </span>
                      </div>

                      <DroppableSlot
                        dayNumber={day.dayNumber}
                        period={slot.period}
                        placeIds={slot.places.map(p => p.id)}
                      >
                        {slot.places.length === 0 && (
                          <p className="text-xs text-text-muted/70 italic px-3 py-2">
                            这个时段还没有安排
                          </p>
                        )}

                        {slot.places.map((place, placeIdx) => {
                          const idx = runningIndex++;
                          return (
                            <PlaceCard
                              key={place.id}
                              place={place}
                              index={idx}
                              period={slot.period}
                              isSelected={selectedPlaceId === place.id}
                              onSelect={() => onSelectPlace(place.id)}
                              onDelete={
                                readOnly
                                  ? undefined
                                  : () => handleDelete(place, day.dayNumber, slot.period, placeIdx)
                              }
                              onChangeSlot={
                                readOnly ? undefined : next => handleChangeSlot(place.id, next)
                              }
                              disableDrag={readOnly}
                            />
                          );
                        })}

                        {!readOnly && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              onAddPlaceToSlot(day.dayNumber, slot.period);
                            }}
                            className="w-full py-3 border border-dashed border-border rounded-xl flex items-center justify-center gap-2 text-text-muted hover:text-accent hover:border-accent/50 transition-colors text-xs tracking-widest uppercase font-mono"
                            data-testid={`add-place-${day.dayNumber}-${slot.period}`}
                          >
                            <Plus size={14} />
                            添加地点
                          </button>
                        )}
                      </DroppableSlot>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <DragOverlay>
          {activePlace ? (
            <div className="opacity-90 rotate-1 scale-[1.02] shadow-xl rounded-2xl border border-accent bg-surface px-4 py-3 text-sm">
              {activePlace.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
