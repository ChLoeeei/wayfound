import React, { useEffect, useState } from 'react';
import { Plane, Loader2, ExternalLink } from 'lucide-react';
import type { Itinerary } from '../types';
import { loadPublicItinerary } from '../supabase';
import ItineraryPane from './ItineraryPane';

interface SharedItineraryViewProps {
  shareId: string;
}

export default function SharedItineraryView({ shareId }: SharedItineraryViewProps) {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loadPublicItinerary(shareId)
      .then(data => {
        if (cancelled) return;
        if (!data) setError('行程不存在或未公开');
        setItinerary(data);
      })
      .catch(e => !cancelled && setError(e.message ?? '加载失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-bg-base text-text-muted">
        <Loader2 className="animate-spin mr-2" size={18} /> 加载分享行程...
      </div>
    );
  }

  if (error || !itinerary) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-bg-base text-text-main p-8 text-center">
        <Plane size={36} className="opacity-30 mb-4" />
        <p className="font-display text-xl">{error || '未找到行程'}</p>
        <a
          href="#/"
          className="mt-4 px-4 py-2 text-sm border border-border rounded-full hover:border-accent"
        >
          返回首页
        </a>
      </div>
    );
  }

  return (
    <div className="h-screen w-full overflow-y-auto bg-bg-base">
      <div className="sticky top-0 z-30 bg-bg-base/90 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <h1 className="text-base font-display font-medium tracking-wide flex items-center gap-2">
            <Plane size={16} className="text-accent" /> WAYFOUND
            <span className="text-xs text-text-muted ml-2">分享视图 · 只读</span>
          </h1>
          <a
            href="#/"
            className="text-xs text-text-muted hover:text-accent flex items-center gap-1"
          >
            创建你的行程 <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <div className="p-6 md:p-10">
        <ItineraryPane
          itinerary={itinerary}
          selectedPlaceId={null}
          onSelectPlace={() => {}}
          onUpdateItinerary={() => {}}
          onRequestDelete={() => {}}
          onAddPlaceToSlot={() => {}}
          readOnly
        />
      </div>
    </div>
  );
}
