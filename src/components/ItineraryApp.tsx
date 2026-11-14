import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Loader2, Share2, Download, FileImage, Cloud, LogOut } from 'lucide-react';
import { PlanningInput, ClarificationQuestion, Itinerary, Place, SlotPeriod } from '../types';
import MapPane from './MapPane';
import ItineraryPane from './ItineraryPane';
import TopBar from './TopBar';
import ConversationPane, { type Stage } from './ConversationPane';
import AgentPanel, { loadPanelOpen, savePanelOpen } from './AgentPanel';
import UndoSnack from './UndoSnack';
import PlaceSearchModal from './PlaceSearchModal';
import { diffDays } from './PlanningForm';
import { insertPlace } from '../lib/itineraryOps';
import { downloadAsPng } from '../lib/export';
import { loginWithGoogle, logout, saveItinerary, shareItinerary, onAuthStateChanged } from '../supabase';
import type { User } from '@supabase/supabase-js';
import {
  loadMemory,
  saveMemory,
  clearMemory,
  recordPlanningSession,
  recordPlaceDeleted,
  buildMemoryPromptContext,
  type TravelMemory,
} from '../lib/memory';
import { useLang, useT } from '../i18n';

/**
 * The plan view: top bar, conversation (left), map + itinerary (middle),
 * agent panel (right, collapsed by default). Columns are flex items with a
 * basis, so at phone width they wrap into one stacked column.
 */
export default function ItineraryApp() {
  const t = useT();
  const [lang] = useLang();
  const [stage, setStage] = useState<Stage>('idle');
  const [pendingInput, setPendingInput] = useState<PlanningInput | null>(null);
  const [clarifyQuestions, setClarifyQuestions] = useState<ClarificationQuestion[]>([]);
  const [formOpen, setFormOpen] = useState(true);

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [error, setError] = useState('');

  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [memory, setMemory] = useState<TravelMemory>(() => loadMemory());
  const [user, setUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [panelOpen, setPanelOpen] = useState<boolean>(() => loadPanelOpen());
  // Local state only until the Lessons panel wires it to the request (v2 step 2).
  const [libraryOn, setLibraryOn] = useState(true);

  const [undo, setUndo] = useState<
    | { place: Place; dayNumber: number; period: SlotPeriod; atIndex: number }
    | null
  >(null);
  const [searchTarget, setSearchTarget] = useState<
    { dayNumber: number; period: SlotPeriod } | null
  >(null);

  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const itineraryPaneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(u => setUser(u));
    return unsub;
  }, []);

  const togglePanel = () => {
    setPanelOpen(open => {
      savePanelOpen(!open);
      return !open;
    });
  };

  const runGeneration = async (input: PlanningInput) => {
    setStage('generating');
    setError('');
    setSavedSuccess(false);
    setItinerary(null);
    setSelectedPlaceId(null);

    try {
      const days = diffDays(input.startDate, input.endDate);
      const memoryContext = buildMemoryPromptContext(memory, input.destination);
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
          memoryContext: memoryContext || undefined,
          language: lang,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('actions.generateFailed'));

      const it = data as Itinerary;
      ensurePlaceIds(it);
      sanitiseItinerary(it);
      setItinerary(it);
      setActiveDay(it.days[0]?.dayNumber ?? 1);
      setStage('ready');
      setFormOpen(false);

      const updatedMemory = recordPlanningSession(memory, input);
      saveMemory(updatedMemory);
      setMemory(updatedMemory);
    } catch (err: any) {
      setError(err.message);
      setStage('idle');
    }
  };

  const handleFormSubmit = async (input: PlanningInput) => {
    setPendingInput(input);
    setStage('clarifying');
    setClarifyQuestions([]);
    setFormOpen(false);

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
    setPendingInput(merged);
    await runGeneration(merged);
  };

  const handleRequestDelete = (place: Place, dayNumber: number, period: SlotPeriod, atIndex: number) => {
    setUndo({ place, dayNumber, period, atIndex });
    const updatedMemory = recordPlaceDeleted(memory, place.type);
    saveMemory(updatedMemory);
    setMemory(updatedMemory);
  };

  const handleClearMemory = () => {
    clearMemory();
    setMemory(loadMemory());
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
      setError(t('actions.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleExportPng = async () => {
    if (!itinerary) return;
    if (!itineraryPaneRef.current) {
      setError(t('actions.exportNotMounted'));
      console.error('[export] itineraryPaneRef.current is null');
      return;
    }
    setExporting(true);
    setError('');
    try {
      await downloadAsPng(itineraryPaneRef.current, itinerary.title);
    } catch (e: any) {
      setError(e.message ?? t('actions.exportFailed'));
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
      if (!id) throw new Error(t('actions.shareFailed'));
      const url = `${window.location.origin}${window.location.pathname}#/share/${id}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // clipboard may be denied; URL is still rendered for the user to copy.
      }
      setTimeout(() => setShareUrl(null), 8000);
    } catch (e: any) {
      setError(e.message ?? t('actions.shareFailed'));
    } finally {
      setSharing(false);
    }
  };

  const onSelectPlace = useCallback((id: string) => setSelectedPlaceId(id), []);

  const menuItem = 'flex items-center gap-2.5 w-full min-h-[40px] px-3 text-left text-sm hover:bg-bg-base disabled:opacity-50 rounded-lg';
  const moreMenu = itinerary ? (
    <div className="relative print:hidden">
      <button
        type="button"
        aria-label={t('itinerary.more')}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(v => !v)}
        data-testid="more-menu"
        className="w-9 h-9 rounded-lg border border-border-strong bg-surface flex items-center justify-center hover:bg-bg-base"
      >
        <MoreHorizontal size={16} />
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-30 w-60 bg-surface border border-border rounded-xl shadow-lg p-1.5 flex flex-col"
          onClick={() => setMenuOpen(false)}
        >
          <button type="button" onClick={handleSaveToCloud} disabled={saving} className={menuItem} data-testid="save-btn">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
            {user ? (savedSuccess ? t('actions.saved') : t('actions.saveToCloud')) : t('actions.loginToSave')}
          </button>
          <button type="button" onClick={handleExportPng} disabled={exporting} className={menuItem} data-testid="export-png-btn">
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileImage size={16} />}
            {t('actions.exportImage')}
          </button>
          <button type="button" onClick={handleExportPdf} disabled={exporting} className={menuItem} data-testid="export-pdf-btn">
            <Download size={16} />
            {t('actions.exportPdf')}
          </button>
          <button type="button" onClick={handleShare} disabled={sharing} className={menuItem} data-testid="share-btn">
            {sharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
            {shareUrl ? t('actions.shareCopied') : t('actions.share')}
          </button>
          {user && (
            <button type="button" onClick={logout} className={`${menuItem} text-delete`}>
              <LogOut size={16} /> {t('actions.logout', { email: user.email ?? '' })}
            </button>
          )}
          <div className="px-3 py-1.5 text-[11px] text-text-muted">{t('itinerary.exportNote')}</div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="min-h-screen flex flex-col bg-bg-base">
      <TopBar
        itinerary={itinerary}
        libraryOn={libraryOn}
        onToggleLibrary={() => setLibraryOn(v => !v)}
        panelOpen={panelOpen}
        onTogglePanel={togglePanel}
      />

      <main className="w-full max-w-[1440px] mx-auto p-4 md:p-6 flex flex-wrap gap-4 items-stretch print:block print:p-0" data-testid="app-shell">
        <ConversationPane
          stage={stage}
          input={pendingInput}
          itinerary={itinerary}
          error={error}
          clarifyQuestions={clarifyQuestions}
          onClarifyResolve={handleClarifyResolve}
          onSubmit={handleFormSubmit}
          memory={memory}
          formOpen={formOpen}
          onToggleForm={() => setFormOpen(v => !v)}
        />

        <div className="[flex:2.6_1_520px] min-w-0 flex flex-col gap-4 print:block">
          <section aria-label={t('map.title')} className="bg-surface border border-border rounded-[14px] p-3 flex flex-col gap-2.5 print:hidden">
            <div className="relative h-[280px] md:h-[320px] rounded-[10px] overflow-hidden bg-[#E7ECE8]" data-testid="map-container">
              <MapPane itinerary={itinerary} activeDay={activeDay} selectedPlaceId={selectedPlaceId} onSelectPlace={onSelectPlace} />
              {!itinerary && (
                <div className="absolute inset-0 flex items-center justify-center text-text-muted text-[13px] pointer-events-none">
                  {t('map.empty')}
                </div>
              )}
              <div className="absolute left-3 bottom-3 bg-surface rounded-lg px-2.5 py-1.5 text-[12px] text-text-muted pointer-events-none z-[400]">
                {t('map.tiles')}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-[12px] text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-text-main" />
                {t('map.legendUnchanged')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-accent" />
                {t('map.legendSelected')}
              </span>
            </div>
          </section>

          <section aria-label={t('itinerary.title')} className="bg-surface border border-border rounded-[14px] p-4 md:p-[18px] flex-1">
            {itinerary ? (
              <ItineraryPane
                itinerary={itinerary}
                activeDay={activeDay}
                onChangeDay={day => {
                  setActiveDay(day);
                  setSelectedPlaceId(null);
                }}
                selectedPlaceId={selectedPlaceId}
                onSelectPlace={onSelectPlace}
                onUpdateItinerary={setItinerary}
                onRequestDelete={handleRequestDelete}
                onAddPlaceToSlot={(dayNumber, period) => setSearchTarget({ dayNumber, period })}
                rootRef={itineraryPaneRef}
                budgetCap={pendingInput?.budget.max}
                headerActions={moreMenu}
              />
            ) : (
              <div className="min-h-[240px] h-full flex flex-col items-center justify-center text-center" data-testid="itinerary-empty">
                <p className="m-0 font-display text-xl font-semibold">{t('itinerary.empty')}</p>
                <p className="m-0 mt-1 text-[13px] text-text-muted">{t('itinerary.emptyHint')}</p>
              </div>
            )}
            {shareUrl && (
              <p className="mt-3 text-[11px] text-text-muted break-all" data-testid="share-url-display">
                {shareUrl}
              </p>
            )}
          </section>
        </div>

        {panelOpen && (
          <AgentPanel onClose={togglePanel} memory={memory} onClearMemory={handleClearMemory} requestId={itinerary?.requestId} />
        )}
      </main>

      {undo && itinerary && (
        <UndoSnack
          message={t('undo.deleted', { name: undo.place.name })}
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
