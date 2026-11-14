import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { TravelMemory } from '../lib/memory';
import { isMemoryEmpty } from '../lib/memory';
import { useT } from '../i18n';
import TraceList, { isDebugMode } from './TraceViewer';
import LessonsTab from './LessonsTab';
import type { LessonFilter } from '../lib/lessons';

export type AgentPanelTab = 'lessons' | 'preferences' | 'trace';
const TABS: AgentPanelTab[] = ['lessons', 'preferences', 'trace'];

export const PANEL_STORAGE_KEY = 'wayfound.agentPanel';

export function loadPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(PANEL_STORAGE_KEY) === 'open';
  } catch {
    return false;
  }
}

export function savePanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PANEL_STORAGE_KEY, open ? 'open' : 'closed');
  } catch {
    // not fatal
  }
}

interface AgentPanelProps {
  onClose: () => void;
  memory: TravelMemory;
  onClearMemory: () => void;
  /** Request id of the shown plan, for the Trace tab. */
  requestId?: string;
  /** Lesson ids the shown plan used; undefined before any plan. */
  usedLessonIds?: string[];
  /** Controlled tab (the "Used N lessons" chip opens the Lessons tab). Uncontrolled when omitted. */
  tab?: AgentPanelTab;
  onTabChange?: (tab: AgentPanelTab) => void;
  /** Filter the Lessons tab should start on. */
  lessonFilter?: LessonFilter;
}

/**
 * Right-hand "Agent panel": lessons the agent learned, the user's own
 * remembered preferences, and the run trace. Collapsed by default for
 * everyday users; the open state is remembered per browser.
 */
export default function AgentPanel({ onClose, memory, onClearMemory, requestId, usedLessonIds, tab: controlledTab, onTabChange, lessonFilter }: AgentPanelProps) {
  const t = useT();
  const [ownTab, setOwnTab] = useState<AgentPanelTab>('lessons');
  const tab = controlledTab ?? ownTab;
  const setTab = (next: AgentPanelTab) => {
    setOwnTab(next);
    onTabChange?.(next);
  };

  return (
    <aside
      aria-label={t('panel.title')}
      className="[flex:1.4_1_320px] min-w-0 bg-surface border border-border rounded-[14px] p-4 md:p-[18px] flex flex-col gap-3.5"
      data-testid="agent-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="m-0 font-display text-base font-semibold">{t('panel.title')}</h2>
        <button
          type="button"
          aria-label={t('panel.close')}
          onClick={onClose}
          data-testid="agent-panel-close"
          className="w-9 h-9 rounded-lg bg-bg-base flex items-center justify-center text-text-main hover:bg-border"
        >
          <X size={16} />
        </button>
      </div>

      <div role="tablist" aria-label={t('panel.sections')} className="flex gap-1 p-1 bg-bg-base rounded-[10px]">
        {TABS.map(id => {
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              data-testid={`panel-tab-${id}`}
              className={`flex-1 min-h-[36px] rounded-lg transition-colors ${active ? 'bg-surface font-semibold' : 'text-text-muted hover:text-text-main'}`}
            >
              {t(`panel.tabs.${id}`)}
            </button>
          );
        })}
      </div>

      {tab === 'lessons' && <LessonsTab usedLessonIds={usedLessonIds} initialFilter={lessonFilter} />}

      {tab === 'preferences' && <PreferencesTab memory={memory} onClearMemory={onClearMemory} />}

      {tab === 'trace' && (
        <div className="flex flex-col gap-3 flex-1" data-testid="panel-trace">
          <p className="m-0 text-text-muted text-[13px]">{t('panel.trace.intro')}</p>
          {!isDebugMode() ? (
            <p className="m-0 text-[13px] text-text-muted">{t('panel.trace.enableHint')}</p>
          ) : requestId ? (
            <TraceList requestId={requestId} />
          ) : (
            <p className="m-0 text-[13px] text-text-muted">{t('panel.trace.noPlan')}</p>
          )}
          <div className="mt-auto text-[12px] text-text-muted">{t('panel.trace.debugOnly')}</div>
        </div>
      )}
    </aside>
  );
}

function PreferencesTab({ memory, onClearMemory }: { memory: TravelMemory; onClearMemory: () => void }) {
  const t = useT();
  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (memory.preferredVibes.length > 0) {
    rows.push({ key: 'interests', label: t('panel.preferences.interests'), value: memory.preferredVibes.map(v => t(`form.vibes.${v}`)).join(', ') });
  }
  if (memory.groupType) {
    rows.push({ key: 'tripType', label: t('panel.preferences.tripType'), value: t(`form.groups.${memory.groupType}`) });
  }
  if (memory.lastBudget) {
    rows.push({
      key: 'dailyBudget',
      label: t('panel.preferences.dailyBudget'),
      value: t('panel.preferences.budgetValue', { min: memory.lastBudget.min, max: memory.lastBudget.max }),
    });
  }
  if (memory.budgetLean) {
    rows.push({ key: 'budgetLean', label: t('panel.preferences.budgetLean'), value: t(`panel.preferences.lean.${memory.budgetLean}`) });
  }
  if (memory.specialNeeds.length > 0) {
    rows.push({ key: 'specialNeeds', label: t('panel.preferences.specialNeeds'), value: memory.specialNeeds.map(n => t(`form.needs.${n}`)).join(', ') });
  }
  if (memory.visitedDestinations.length > 0) {
    rows.push({ key: 'pastTrips', label: t('panel.preferences.pastTrips'), value: memory.visitedDestinations.join(', ') });
  }
  const avoided = Object.entries(memory.dislikedTypeCounts)
    .filter(([, n]) => (n ?? 0) >= 2)
    .map(([type]) => t(`place.types.${type}`));
  if (avoided.length > 0) {
    rows.push({ key: 'avoids', label: t('panel.preferences.avoids'), value: avoided.join(', ') });
  }
  if (memory.notes.length > 0) {
    rows.push({ key: 'notes', label: t('panel.preferences.notes'), value: memory.notes.join('; ') });
  }

  return (
    <div className="flex flex-col gap-3 flex-1" data-testid="panel-preferences">
      <p className="m-0 text-text-muted text-[13px]">{t('panel.preferences.intro')}</p>
      {isMemoryEmpty(memory) ? (
        <p className="m-0 text-[13px] text-text-muted" data-testid="preferences-empty">
          {t('panel.preferences.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(r => (
            <div key={r.key} className="p-3 border border-border rounded-[10px]" data-testid={`preference-${r.key}`}>
              <div className="text-[12px] text-text-muted">{r.label}</div>
              <div className="font-medium">{r.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex-1" />
      {!isMemoryEmpty(memory) && (
        <button
          type="button"
          onClick={onClearMemory}
          data-testid="memory-clear"
          className="min-h-[40px] border border-delete-line rounded-lg bg-surface text-delete font-medium hover:bg-delete-tint"
        >
          {t('panel.preferences.clearAll')}
        </button>
      )}
      <div className="text-[12px] text-text-muted">{t('panel.preferences.signedOut')}</div>
    </div>
  );
}
