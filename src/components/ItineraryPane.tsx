import React, { useState } from 'react';
import { ShieldAlert, Loader2, RefreshCw, Plus, Info, Check, AlertTriangle } from 'lucide-react';
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
  PERIOD_TIME_HINT,
  findPlace,
  movePlace,
  changeSlot,
  deletePlace,
  dayCostPerPerson,
  isWithinDailyBudget,
} from '../lib/itineraryOps';
import PlaceCard from './PlaceCard';
import { useT } from '../i18n';

interface ItineraryPaneProps {
  itinerary: Itinerary;
  /** Day shown; the pane renders one day at a time (day tabs). */
  activeDay: number;
  onChangeDay: (dayNumber: number) => void;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  onUpdateItinerary: (next: Itinerary) => void;
  onRequestDelete: (place: Place, dayNumber: number, period: SlotPeriod, atIndex: number) => void;
  onAddPlaceToSlot: (dayNumber: number, period: SlotPeriod) => void;
  /** Render in read-only mode (shared view). Disables editing affordances. */
  readOnly?: boolean;
  /** Optional ref so parents (export) can capture the rendered list as DOM. */
  rootRef?: React.Ref<HTMLDivElement>;
  /** Per-person daily budget cap from the request, for the day summary row. */
  budgetCap?: number;
  /** Extra controls for the day header row (the "more" menu). */
  headerActions?: React.ReactNode;
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
      className={`flex flex-col gap-2.5 rounded-xl transition-colors ${isOver ? 'bg-accent-soft ring-1 ring-accent-line' : ''}`}
    >
      <SortableContext items={placeIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

/**
 * The itinerary section of the plan view: day tabs, one day's stops as
 * cards grouped by period, and the day summary. Drag-and-drop moves stops
 * between periods of the shown day; moving a stop to another day goes
 * through the card's expand menu (slot picker) or the search modal.
 */
export default function ItineraryPane({
  itinerary,
  activeDay,
  onChangeDay,
  selectedPlaceId,
  onSelectPlace,
  onUpdateItinerary,
  onRequestDelete,
  onAddPlaceToSlot,
  readOnly,
  rootRef,
  budgetCap,
  headerActions,
}: ItineraryPaneProps) {
  const t = useT();
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
  const day = itinerary.days.find(d => d.dayNumber === activeDay) ?? itinerary.days[0];
  const dayTotal = day ? Math.round(dayCostPerPerson(day)) : 0;
  const withinBudget = budgetCap != null ? isWithinDailyBudget(dayTotal, budgetCap) : null;
  let runningIndex = 0;

  return (
    <div ref={rootRef} className="flex flex-col gap-3.5" data-testid="itinerary-pane">
      <nav aria-label={t('itinerary.days')} className="flex flex-wrap gap-1.5 print:hidden" data-testid="day-tabs">
        {itinerary.days.map(d => {
          const active = d.dayNumber === day?.dayNumber;
          return (
            <button
              key={d.dayNumber}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onChangeDay(d.dayNumber)}
              data-testid={`day-tab-${d.dayNumber}`}
              className={`min-h-[36px] px-3.5 rounded-full border transition-colors ${
                active ? 'bg-text-main text-white border-text-main font-medium' : 'bg-surface text-text-main border-border hover:bg-bg-base'
              }`}
            >
              {t('itinerary.day', { n: d.dayNumber })}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 font-display text-2xl font-semibold min-w-0">
          {day
            ? day.theme
              ? t('itinerary.dayHeading', { n: day.dayNumber, theme: day.theme })
              : t('itinerary.day', { n: day.dayNumber })
            : itinerary.title}
        </h1>
        <div className="flex-1" />
        {!readOnly && (
          <button
            type="button"
            onClick={verifyItinerary}
            disabled={verifying}
            className="flex items-center gap-1.5 min-h-[34px] px-3 border border-border-strong rounded-full bg-surface text-[13px] hover:bg-bg-base disabled:opacity-50 print:hidden"
            data-testid="ai-check"
          >
            {verifying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('itinerary.aiCheck')}
          </button>
        )}
        {headerActions}
      </div>

      {itinerary.summary && <p className="m-0 text-text-muted text-[13px]">{itinerary.summary}</p>}

      {itinerary.groundingWarning && (
        <p className="m-0 flex items-start gap-1.5 text-[12px] text-updated-text" data-testid="grounding-warning">
          <Info size={14} className="mt-[1px] shrink-0" />
          {t('itinerary.groundingWarning')}
        </p>
      )}

      {issues.length > 0 && (
        <div className="p-3.5 border border-delete-line bg-delete-tint rounded-xl" data-testid="ai-issues">
          <h4 className="m-0 mb-2 flex items-center gap-2 text-delete font-medium">
            <ShieldAlert size={16} />
            {t('itinerary.issuesFound', { count: issues.length })}
          </h4>
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {issues.map((iss, i) => (
              <li key={i} className="text-sm">
                <div className="font-semibold text-text-main">{iss.message}</div>
                <div className="text-text-muted mt-0.5">{iss.suggestion}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {day && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <section className="flex flex-col gap-4" data-testid={`day-${day.dayNumber}`}>
            {orderedSlots(day).map(slot => (
              <div key={slot.period} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <h4 className="m-0 text-[13px] font-medium text-text-muted">{t(`period.${slot.period}`)}</h4>
                  <span className="text-[12px] text-text-muted tabular-nums">{PERIOD_TIME_HINT[slot.period]}</span>
                </div>

                <DroppableSlot dayNumber={day.dayNumber} period={slot.period} placeIds={slot.places.map(p => p.id)}>
                  {slot.places.length === 0 && (
                    <p className="m-0 text-xs text-text-muted px-3 py-2">{t('itinerary.emptySlot')}</p>
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
                        onDelete={readOnly ? undefined : () => handleDelete(place, day.dayNumber, slot.period, placeIdx)}
                        onChangeSlot={readOnly ? undefined : next => handleChangeSlot(place.id, next)}
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
                      className="w-full min-h-[40px] border border-dashed border-border-strong rounded-xl flex items-center justify-center gap-2 text-text-muted hover:text-accent hover:border-accent-line transition-colors text-[13px] print:hidden"
                      data-testid={`add-place-${day.dayNumber}-${slot.period}`}
                    >
                      <Plus size={14} />
                      {t('itinerary.addPlace')}
                    </button>
                  )}
                </DroppableSlot>
              </div>
            ))}
          </section>

          <DragOverlay>
            {activePlace ? (
              <div className="opacity-90 rotate-1 scale-[1.02] shadow-xl rounded-xl border border-accent bg-surface px-4 py-3 text-sm">
                {activePlace.name}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <div className="flex flex-wrap gap-2.5 pt-2 border-t border-border text-[13px]" data-testid="day-summary">
        {withinBudget != null && budgetCap != null && (
          <div className="flex items-center gap-1.5" data-testid="day-budget">
            {withinBudget ? (
              <Check size={16} className="text-accent shrink-0" strokeWidth={2.2} />
            ) : (
              <AlertTriangle size={16} className="text-updated shrink-0" strokeWidth={2.2} />
            )}
            {t(withinBudget ? 'itinerary.dayTotalUnder' : 'itinerary.dayTotalOver', { total: dayTotal, cap: budgetCap })}
          </div>
        )}
        {itinerary.sourceAttributions && itinerary.sourceAttributions.length > 0 && (
          <div className="text-[12px] text-text-muted w-full" data-testid="source-attributions">
            {itinerary.sourceAttributions.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
