import React, { useEffect, useRef, useState } from 'react';
import { apiErrorFrom, describeApiError } from '../lib/apiError';
import { Search, X, Star, MapPin, Loader2 } from 'lucide-react';
import type { Place, SlotPeriod } from '../types';
import { PERIOD_ORDER } from '../lib/itineraryOps';
import { inferPlaceType } from '../lib/photo';
import { useT } from '../i18n';

interface SearchResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  type: string;
  rating?: number;
  photoUrl?: string;
}

interface PlaceSearchModalProps {
  destination: string;
  initialDayNumber: number;
  initialPeriod: SlotPeriod;
  availableDays: number[];
  onClose: () => void;
  onAdd: (place: Place, dayNumber: number, period: SlotPeriod) => void;
}

export default function PlaceSearchModal({
  destination,
  initialDayNumber,
  initialPeriod,
  availableDays,
  onClose,
  onAdd,
}: PlaceSearchModalProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dayNumber, setDayNumber] = useState(initialDayNumber);
  const [period, setPeriod] = useState<SlotPeriod>(initialPeriod);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ q: query, region: destination, limit: '10' });
        const res = await fetch(`${process.env.API_BASE_URL}/api/search-places?${params.toString()}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw apiErrorFrom(res, data, t('search.failed'));
        setResults(data.results ?? []);
      } catch (e: any) {
        setError(describeApiError(e, t));
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, destination]);

  const handlePick = (r: SearchResult) => {
    const place: Place = {
      id: `local-${r.id}-${Math.random().toString(36).slice(2, 8)}`,
      name: r.name,
      type: inferPlaceType(r.type),
      coordinates: { lat: r.lat, lng: r.lng },
      rating: r.rating,
      estimatedCost: 0,
      duration: 90,
      imageUrl: r.photoUrl,
      aiNote: '',
      externalUrl: `https://ditu.amap.com/search?query=${encodeURIComponent(r.name)}`,
      searchQuery: r.name,
      poiId: r.id,
    };
    onAdd(place, dayNumber, period);
    onClose();
  };

  const select = 'bg-surface border border-border-strong rounded-md px-2 py-1 text-text-main focus:outline-none focus:border-accent';

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 sm:pt-20"
      onClick={onClose}
      data-testid="place-search-modal"
    >
      <div
        className="bg-surface w-full max-w-xl rounded-[14px] border border-border shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="m-0 font-display font-semibold">{t('search.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-bg-base flex items-center justify-center text-text-main"
            aria-label={t('search.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              placeholder={t('search.placeholder', { destination })}
              value={query}
              onChange={e => setQuery(e.target.value)}
              data-testid="search-input"
              className="w-full bg-surface border border-border-strong rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 text-text-muted">
              {t('search.addTo')}
              <select value={dayNumber} onChange={e => setDayNumber(parseInt(e.target.value, 10))} data-testid="search-day" className={select}>
                {availableDays.map(d => (
                  <option key={d} value={d}>
                    {t('itinerary.day', { n: d })}
                  </option>
                ))}
              </select>
              ·
              <select value={period} onChange={e => setPeriod(e.target.value as SlotPeriod)} data-testid="search-period" className={select}>
                {PERIOD_ORDER.map(p => (
                  <option key={p} value={p}>
                    {t(`period.${p}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[50vh] divide-y divide-border">
          {loading && (
            <div className="p-6 flex items-center justify-center text-text-muted text-sm">
              <Loader2 size={16} className="animate-spin mr-2" />
              {t('search.searching')}
            </div>
          )}
          {error && <div className="p-6 text-center text-delete text-sm">{error}</div>}
          {!loading && !error && results.length === 0 && query.trim() && (
            <div className="p-6 text-center text-text-muted text-sm">{t('search.noResults')}</div>
          )}
          {!loading && !error && !query.trim() && (
            <div className="p-6 text-center text-text-muted/70 text-sm">{t('search.typeToSearch')}</div>
          )}
          {results.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => handlePick(r)}
              data-testid={`search-result-${r.id}`}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-base text-left transition-colors"
            >
              <div className="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-bg-base border border-border flex items-center justify-center">
                {r.photoUrl ? (
                  <img src={r.photoUrl} alt={r.name} className="w-full h-full object-cover" />
                ) : (
                  <MapPin size={16} className="text-border-strong" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="text-xs text-text-muted truncate">{r.address || r.type}</div>
              </div>
              {r.rating != null && (
                <div className="flex items-center gap-1 text-accent text-xs font-medium">
                  <Star size={11} className="fill-current" />
                  <span>{r.rating}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
