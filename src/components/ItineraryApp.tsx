import React, { useState, useEffect, useRef } from 'react';
import { Plane, Moon, Sun, SlidersHorizontal } from 'lucide-react';
import { PlanningInput, ClarificationQuestion, Itinerary, Place, SlotPeriod } from '../types';
import MapPane from './MapPane';
import ItineraryPane from './ItineraryPane';
import PlanningForm, { diffDays } from './PlanningForm';
import AIClarification from './AIClarification';
import UndoSnack from './UndoSnack';
import PlaceSearchModal from './PlaceSearchModal';
import SidePanel from './SidePanel';
import BottomSheet from './BottomSheet';
import { useDrawerSnap } from '../hooks/useDrawerSnap';
import { insertPlace } from '../lib/itineraryOps';
import { downloadAsPng, downloadAsPdf } from '../lib/export';
import { loginWithGoogle, logout, saveItinerary, shareItinerary, onAuthStateChanged } from '../supabase';
import type { User } from '@supabase/supabase-js';

interface ItineraryAppProps {
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
}

type Stage = 'idle' | 'clarifying' | 'generating' | 'ready';

export default function ItineraryApp({ darkMode, setDarkMode }: ItineraryAppProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [pendingInput, setPendingInput] = useState<PlanningInput | null>(null);
  const [clarifyQuestions, setClarifyQuestions] = useState<ClarificationQuestion[]>([]);

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [error, setError] = useState('');

  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [undo, setUndo] = useState<
    | { place: Place; dayNumber: number; period: SlotPeriod; atIndex: number }
    | null
  >(null);
  const [searchTarget, setSearchTarget] = useState<
    { dayNumber: number; period: SlotPeriod } | null
  >(null);

  // Mobile drawers (visible only at < md). Itinerary drawer is always-on after a plan exists.
  const itineraryDrawer = useDrawerSnap('half');
  const [planFormOpen, setPlanFormOpen] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const itineraryPaneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(u => setUser(u));
    return unsub;
  }, []);

  const runGeneration = async (input: PlanningInput) => {
    setStage('generating');
    setError('');
    setSavedSuccess(false);
    setItinerary(null);
    setSelectedPlaceId(null);

    try {
      const days = diffDays(input.startDate, input.endDate);
      const res = await fetch(`${process.env.API_BASE_URL}/api/generate-itinerary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: input.destination,
          days,
          people: input.people,
          preferences: input.vibes,
          groupType: input.groupType,
          budget: input.budget,
          specialNeeds: input.specialNeeds,
          startDate: input.startDate,
          endDate: input.endDate,
          clarifications: input.clarifications,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate');

      const it = data as Itinerary;
      ensurePlaceIds(it);
      sanitiseItinerary(it);
      setItinerary(it);
      setStage('ready');
      itineraryDrawer.setSnap('half');
    } catch (err: any) {
      setError(err.message);
      setStage('idle');
    }
  };

  const handleFormSubmit = async (input: PlanningInput) => {
    setPendingInput(input);
    setStage('clarifying');
    setClarifyQuestions([]);
    setPlanFormOpen(false);

    try {
      const res = await fetch(`${process.env.API_BASE_URL}/api/clarify-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      const questions: ClarificationQuestion[] = data.questions ?? [];

      if (questions.length === 0) {
        await runGeneration(input);
      } else {
        setClarifyQuestions(questions);
      }
    } catch {
      await runGeneration(input);
    }
  };

  const handleClarifyResolve = async (answers: Record<string, string>, skipped: boolean) => {
    if (!pendingInput) return;
    const merged: PlanningInput = skipped
      ? pendingInput
      : { ...pendingInput, clarifications: { ...(pendingInput.clarifications ?? {}), ...answers } };
    setClarifyQuestions([]);
    await runGeneration(merged);
  };

  const handleSaveToCloud = async () => {
    if (!user) {
      await loginWithGoogle();
      return;
    }
    if (!itinerary) return;
    setSaving(true);
    try {
      await saveItinerary(itinerary);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch {
      setError('Failed to save to cloud.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportPng = async () => {
    if (!itinerary) return;
    if (!itineraryPaneRef.current) {
      setError('导出失败：行程容器未挂载');
      console.error('[export] itineraryPaneRef.current is null');
      return;
    }
    setExporting(true);
    setError('');
    try {
      await downloadAsPng(itineraryPaneRef.current, itinerary.title);
    } catch (e: any) {
      setError(e.message ?? '导出失败');
      console.error('[export] PNG failed:', e);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = () => {
    if (!itinerary) return;
    window.print();
  };

  const handleShare = async () => {
    if (!itinerary) return;
    setSharing(true);
    setShareUrl(null);
    try {
      const id = await shareItinerary(itinerary);
      if (!id) throw new Error('分享失败');
      const url = `${window.location.origin}${window.location.pathname}#/share/${id}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // clipboard may be denied; URL is still rendered for the user to copy.
      }
      setTimeout(() => setShareUrl(null), 8000);
    } catch (e: any) {
      setError(e.message ?? '分享失败');
    } finally {
      setSharing(false);
    }
  };

  const generating = stage === 'generating' || stage === 'clarifying';
  const sidePanelProps = {
    generating,
    hasItinerary: !!itinerary,
    user,
    saving,
    savedSuccess,
    exporting,
    sharing,
    shareUrl,
    error,
    darkMode,
    onSubmit: handleFormSubmit,
    onSaveToCloud: handleSaveToCloud,
    onLogout: logout,
    onExportPng: handleExportPng,
    onExportPdf: handleExportPdf,
    onShare: handleShare,
    onToggleDark: () => setDarkMode(!darkMode),
  };

  const itineraryContent = (
    <>
      {clarifyQuestions.length > 0 && (
        <AIClarification questions={clarifyQuestions} onResolve={handleClarifyResolve} />
      )}

      {itinerary ? (
        <ItineraryPane
          itinerary={itinerary}
          selectedPlaceId={selectedPlaceId}
          onSelectPlace={setSelectedPlaceId}
          onUpdateItinerary={setItinerary}
          onRequestDelete={(place, dayNumber, period, atIndex) =>
            setUndo({ place, dayNumber, period, atIndex })
          }
          onAddPlaceToSlot={(dayNumber, period) => setSearchTarget({ dayNumber, period })}
          rootRef={itineraryPaneRef}
        />
      ) : (
        clarifyQuestions.length === 0 && (
          <div className="h-full min-h-[40vh] flex flex-col items-center justify-center text-center opacity-60">
            <Plane size={40} className="mb-4 opacity-30" />
            <p className="font-display text-xl">Your journey awaits.</p>
            <p className="font-sans text-xs mt-2 text-text-muted">填写信息以开始规划</p>
          </div>
        )
      )}
    </>
  );

  return (
    <div className="h-screen w-full overflow-hidden relative print:h-auto print:overflow-visible">
      {/* DESKTOP: left form + right column (map on top, list below) */}
      <div className="hidden md:flex h-full w-full overflow-hidden print:block print:h-auto print:overflow-visible">
        <aside className="w-[320px] lg:w-[400px] shrink-0 border-r border-border bg-surface flex flex-col z-20 h-full overflow-y-auto print:hidden">
          <SidePanel variant="desktop" {...sidePanelProps} />
        </aside>

        <div className="flex-1 flex flex-col min-w-[300px] h-full overflow-hidden print:block print:h-auto print:overflow-visible">
          <div className="h-[45%] shrink-0 border-b border-border bg-surface relative print:hidden">
            <MapPane
              itinerary={itinerary}
              selectedPlaceId={selectedPlaceId}
              onSelectPlace={setSelectedPlaceId}
              darkMode={darkMode}
            />
          </div>
          <main className="flex-1 overflow-y-auto bg-bg-base p-6 lg:p-10 print:overflow-visible print:p-0">
            {itineraryContent}
          </main>
        </div>
      </div>

      {/* MOBILE: full-bleed map + bottom drawer + plan-form sheet */}
      <div className="md:hidden absolute inset-0 flex flex-col print:hidden">
        <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-4 py-3 bg-bg-base/80 backdrop-blur border-b border-border/40">
          <h1 className="text-lg font-display font-medium tracking-wide flex items-center gap-2">
            <Plane size={18} className="text-accent" /> WAYFOUND
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-full border border-border text-text-muted bg-surface/60 backdrop-blur"
              aria-label="Toggle theme"
            >
              {darkMode ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              onClick={() => setPlanFormOpen(true)}
              data-testid="open-plan-form"
              className="px-3 py-2 text-xs uppercase tracking-widest font-medium bg-accent text-white rounded-full inline-flex items-center gap-1"
            >
              <SlidersHorizontal size={12} /> 规划
            </button>
          </div>
        </header>

        <div className="absolute inset-0 pt-12">
          <MapPane
            itinerary={itinerary}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={setSelectedPlaceId}
            darkMode={darkMode}
          />
        </div>

        <BottomSheet
          open={true}
          snap={itineraryDrawer.snap}
          onSnapChange={itineraryDrawer.setSnap}
          title={itinerary ? itinerary.title : '行程'}
          testId="itinerary-sheet"
        >
          <div className="p-4">{itineraryContent}</div>
        </BottomSheet>

        <BottomSheet
          open={planFormOpen}
          snap="full"
          onSnapChange={s => {
            if (s === 'peek') setPlanFormOpen(false);
          }}
          onClose={() => setPlanFormOpen(false)}
          title="规划行程"
          modal
          testId="plan-sheet"
        >
          <SidePanel variant="sheet" {...sidePanelProps} />
        </BottomSheet>
      </div>

      {undo && itinerary && (
        <UndoSnack
          message={`已删除「${undo.place.name}」`}
          onUndo={() => {
            const restored = insertPlace(itinerary, undo.place, undo.dayNumber, undo.period, undo.atIndex);
            setItinerary(restored);
            setUndo(null);
          }}
          onDismiss={() => setUndo(null)}
        />
      )}

      {searchTarget && itinerary && (
        <PlaceSearchModal
          destination={itinerary.destination}
          initialDayNumber={searchTarget.dayNumber}
          initialPeriod={searchTarget.period}
          availableDays={itinerary.days.map(d => d.dayNumber)}
          onClose={() => setSearchTarget(null)}
          onAdd={(place, dayNumber, period) => {
            setItinerary(insertPlace(itinerary, place, dayNumber, period));
          }}
        />
      )}
    </div>
  );
}

function ensurePlaceIds(it: Itinerary) {
  it.days?.forEach(day => {
    day.slots?.forEach(slot => {
      slot.places?.forEach(place => {
        if (!place.id) place.id = Math.random().toString(36).slice(2, 10);
      });
    });
  });
}

/**
 * Defensive normalisation of agent output before it hits the renderer.
 * The model occasionally:
 *   - omits required arrays (slots / places)
 *   - emits unrecognised slot periods (e.g. "night", "lunch")
 *   - drops coordinates on a place
 * Without this, missing arrays crash itineraryOps' .map calls and blank
 * the page.
 */
function sanitiseItinerary(it: Itinerary) {
  if (!Array.isArray(it.days)) it.days = [];
  it.days.forEach((day, idx) => {
    if (typeof day.dayNumber !== 'number') day.dayNumber = idx + 1;
    if (!Array.isArray(day.slots)) day.slots = [];

    day.slots = day.slots
      .map(slot => {
        const period = normalisePeriod((slot as any)?.period);
        return {
          period,
          places: Array.isArray(slot?.places)
            ? slot.places.filter(p => p && p.id && p.name).map(p => ({
                ...p,
                coordinates:
                  p.coordinates && typeof p.coordinates.lat === 'number' && typeof p.coordinates.lng === 'number'
                    ? p.coordinates
                    : { lat: 0, lng: 0 },
                duration: typeof p.duration === 'number' ? p.duration : 60,
                estimatedCost: typeof p.estimatedCost === 'number' ? p.estimatedCost : 0,
                type: (p.type ?? 'attraction') as Itinerary['days'][number]['slots'][number]['places'][number]['type'],
              }))
            : [],
        };
      })
      .filter(s => s.period !== null) as Itinerary['days'][number]['slots'];
  });
}

function normalisePeriod(raw: unknown): 'morning' | 'afternoon' | 'evening' | null {
  if (raw === 'morning' || raw === 'afternoon' || raw === 'evening') return raw;
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('morn') || s.includes('上午') || s.includes('早')) return 'morning';
  if (s.includes('after') || s.includes('下午') || s.includes('lunch') || s.includes('午')) return 'afternoon';
  if (s.includes('even') || s.includes('night') || s.includes('晚') || s.includes('dinner') || s.includes('夜')) return 'evening';
  return 'afternoon';
}
