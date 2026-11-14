import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { TravelMemory } from '../lib/memory';
import PreferencesTab from './PreferencesTab';
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
  /** Per-item edits from the preferences tab. Rows are read-only when omitted. */
  onUpdateMemory?: (next: TravelMemory) => void;
  /** Signed-in user's email (preferences tab footer). */
  userEmail?: string | null;
  /** One-line status for the preferences tab (migrated on login, extraction result). */
  memoryNotice?: string | null;
}

/**
 * Right-hand "Agent panel": lessons the agent learned, the user's own
 * remembered preferences, and the run trace. Collapsed by default for
 * everyday users; the open state is remembered per browser.
 */
export default function AgentPanel({
  onClose,
  memory,
  onClearMemory,
  requestId,
  usedLessonIds,
  tab: controlledTab,
  onTabChange,
  lessonFilter,
  onUpdateMemory,
  userEmail,
  memoryNotice,
}: AgentPanelProps) {
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

      {tab === 'preferences' && (
        <PreferencesTab memory={memory} onChange={onUpdateMemory ?? (() => {})} onClearMemory={onClearMemory} userEmail={userEmail} notice={memoryNotice} />
      )}

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
