import React, { useEffect, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import type { Itinerary } from '../types';
import { loadPublicItinerary } from '../supabase';
import ItineraryPane from './ItineraryPane';
import MapPane from './MapPane';
import { Logo } from './TopBar';
import { useT } from '../i18n';

interface SharedItineraryViewProps {
  shareId: string;
}

export default function SharedItineraryView({ shareId }: SharedItineraryViewProps) {
  const t = useT();
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeDay, setActiveDay] = useState(1);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loadPublicItinerary(shareId)
      .then(data => {
        if (cancelled) return;
        if (!data) setError(t('shared.notPublic'));
        setItinerary(data);
        setActiveDay(data?.days[0]?.dayNumber ?? 1);
      })
      .catch(e => !cancelled && setError(e.message ?? t('shared.loadFailed')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-bg-base text-text-muted">
        <Loader2 className="animate-spin mr-2" size={18} /> {t('shared.loading')}
      </div>
    );
  }

  if (error || !itinerary) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-bg-base text-text-main p-8 text-center">
        <p className="font-display text-xl">{error || t('shared.notFound')}</p>
        <a href="#/" className="mt-4 min-h-[40px] px-4 inline-flex items-center text-sm border border-border-strong rounded-full !text-text-main no-underline hover:bg-surface">
          {t('shared.backHome')}
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <header className="flex flex-wrap items-center gap-4 px-4 md:px-6 py-3 bg-surface border-b border-border">
        <Logo />
        <span className="text-text-muted">{t('shared.readOnly')}</span>
        <div className="flex-1" />
        <a href="#/" className="text-[13px] flex items-center gap-1">
          {t('shared.createOwn')} <ExternalLink size={12} />
        </a>
      </header>
      <main className="max-w-[960px] mx-auto p-4 md:p-6 flex flex-col gap-4">
        <section className="bg-surface border border-border rounded-[14px] p-3">
          <div className="h-[280px] rounded-[10px] overflow-hidden bg-[#E7ECE8]">
            <MapPane itinerary={itinerary} activeDay={activeDay} selectedPlaceId={selectedPlaceId} onSelectPlace={setSelectedPlaceId} />
          </div>
        </section>
        <section className="bg-surface border border-border rounded-[14px] p-4 md:p-[18px]">
          <ItineraryPane
            itinerary={itinerary}
            activeDay={activeDay}
            onChangeDay={setActiveDay}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={setSelectedPlaceId}
            onUpdateItinerary={() => {}}
            onRequestDelete={() => {}}
            onAddPlaceToSlot={() => {}}
            readOnly
          />
        </section>
      </main>
    </div>
  );
}
