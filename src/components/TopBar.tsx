import React from 'react';
import { MapPin, Columns2, PanelRight } from 'lucide-react';
import type { Itinerary } from '../types';
import { monthName, useLang, useT } from '../i18n';
import LanguageToggle from './LanguageToggle';

interface TopBarProps {
  itinerary: Itinerary | null;
  libraryOn: boolean;
  onToggleLibrary: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

/** Logo, current trip title, language switch, library toggle, compare link and the agent-panel button. */
export default function TopBar({ itinerary, libraryOn, onToggleLibrary, panelOpen, onTogglePanel }: TopBarProps) {
  const t = useT();
  const [lang] = useLang();

  const tripTitle = itinerary
    ? t('topbar.tripTitle', {
        destination: itinerary.destination,
        days: t('topbar.days', { count: itinerary.days.length }),
        month: monthName(itinerary.startDate, lang),
      })
    : '';

  return (
    <header className="flex flex-wrap items-center gap-3 md:gap-4 px-4 md:px-6 py-3 bg-surface border-b border-border">
      <Logo />
      {tripTitle && (
        <div className="text-text-muted truncate max-w-full" data-testid="trip-title">
          {tripTitle}
        </div>
      )}
      <div className="flex-1" />
      <LanguageToggle />
      <button
        type="button"
        aria-pressed={libraryOn}
        onClick={onToggleLibrary}
        data-testid="library-toggle"
        className={`flex items-center gap-2.5 min-h-[40px] px-3 rounded-full border font-medium transition-colors ${
          libraryOn
            ? 'border-accent-line bg-accent-tint text-accent-deep'
            : 'border-border-strong bg-surface text-text-muted'
        }`}
      >
        <span
          className={`relative inline-block w-8 h-[18px] rounded-full transition-colors ${libraryOn ? 'bg-accent' : 'bg-border-strong'}`}
        >
          <span
            className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${libraryOn ? 'right-[2px]' : 'left-[2px]'}`}
          />
        </span>
        {libraryOn ? t('topbar.libraryOn') : t('topbar.libraryOff')}
      </button>
      <a
        href="#/compare"
        className="flex items-center gap-2 min-h-[40px] px-3.5 rounded-full border border-border-strong bg-surface !text-text-main no-underline font-medium hover:bg-bg-base transition-colors"
        data-testid="compare-link"
      >
        <Columns2 size={16} />
        {t('topbar.compare')}
      </a>
      <button
        type="button"
        aria-expanded={panelOpen}
        onClick={onTogglePanel}
        data-testid="agent-panel-toggle"
        className={`flex items-center gap-2 min-h-[40px] px-3.5 rounded-full border font-medium transition-colors ${
          panelOpen ? 'border-text-main bg-text-main text-white' : 'border-border-strong bg-surface text-text-main hover:bg-bg-base'
        }`}
      >
        <PanelRight size={16} />
        {t('topbar.agentPanel')}
      </button>
    </header>
  );
}

export function Logo() {
  const t = useT();
  return (
    <a href="#/" className="flex items-center gap-2.5 no-underline !text-text-main">
      <span className="w-[30px] h-[30px] rounded-lg bg-accent flex items-center justify-center">
        <MapPin size={16} color="#FFFFFF" strokeWidth={2} />
      </span>
      <span className="font-display font-semibold text-lg">{t('app.name')}</span>
    </a>
  );
}
