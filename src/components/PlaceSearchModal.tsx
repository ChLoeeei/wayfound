import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Star, MapPin, Loader2 } from 'lucide-react';
import type { Place, SlotPeriod } from '../types';
import { PERIOD_LABEL, PERIOD_ORDER } from '../lib/itineraryOps';

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

const TYPE_TO_PLACE_TYPE: Record<string, Place['type']> = {
  '餐饮': 'restaurant',
  '风景': 'attraction',
  '住宿': 'hotel',
  '购物': 'shopping',
  '休闲': 'leisure',
};

function inferPlaceType(amapType: string): Place['type'] {
  for (const [k, v] of Object.entries(TYPE_TO_PLACE_TYPE)) {
    if (amapType.includes(k)) return v;
  }
  return 'attraction';
}

export default function PlaceSearchModal({
  destination,
  initialDayNumber,
  initialPeriod,
  availableDays,
  onClose,
  onAdd,
}: PlaceSearchModalProps) {
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
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Search failed');
        setResults(data.results ?? []);
      } catch (e: any) {
        setError(e.message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
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
    };
    onAdd(place, dayNumber, period);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 sm:pt-20"
      onClick={onClose}
      data-testid="place-search-modal"
    >
      <div
        className="bg-surface w-full max-w-xl rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-medium">Add a place</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-main"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              placeholder={`Search places / restaurants in ${destination}...`}
              value={query}
              onChange={e => setQuery(e.target.value)}
              data-testid="search-input"
              className="w-full bg-bg-base border border-border rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 text-text-muted">
              Add to
              <select
                value={dayNumber}
                onChange={e => setDayNumber(parseInt(e.target.value, 10))}
                data-testid="search-day"
                className="bg-bg-base border border-border rounded-md px-2 py-1 text-text-main focus:outline-none focus:border-accent"
              >
                {availableDays.map(d => (
                  <option key={d} value={d}>
                    Day {d}
                  </option>
                ))}
              </select>
              ·
              <select
                value={period}
                onChange={e => setPeriod(e.target.value as SlotPeriod)}
                data-testid="search-period"
                className="bg-bg-base border border-border rounded-md px-2 py-1 text-text-main focus:outline-none focus:border-accent"
              >
                {PERIOD_ORDER.map(p => (
                  <option key={p} value={p}>
                    {PERIOD_LABEL[p]}
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
              Searching...
            </div>
          )}
          {error && (
            <div className="p-6 text-center text-delete text-sm">{error}</div>
          )}
          {!loading && !error && results.length === 0 && query.trim() && (
            <div className="p-6 text-center text-text-muted text-sm">No results</div>
          )}
          {!loading && !error && !query.trim() && (
            <div className="p-6 text-center text-text-muted/70 text-sm">Type to search</div>
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
                  <MapPin size={16} className="text-border" />
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
