import React, { useEffect, useState } from 'react';
import { Camera, Check, Loader2, MapPin, Star, X } from 'lucide-react';
import type { SlotPeriod } from '../types';
import type { PhotoCandidate, PhotoState } from '../lib/photoTypes';
import { PERIOD_ORDER } from '../lib/itineraryOps';
import { useT } from '../i18n';

interface PhotoCandidatesCardProps {
  photo: PhotoState;
  availableDays: number[];
  defaultDay: number;
  onAdd: (candidate: PhotoCandidate, dayNumber: number, period: SlotPeriod) => void;
  onDismiss: () => void;
  busy?: boolean;
}

/**
 * Conversation card after a photo: what the model saw, up to three
 * verified candidates (search results only), and "add to day N". Nothing
 * is added until the user picks a candidate; an unverified guess is never
 * offered as a place.
 */
export default function PhotoCandidatesCard({ photo, availableDays, defaultDay, onAdd, onDismiss, busy }: PhotoCandidatesCardProps) {
  const t = useT();
  const result = photo.result;
  const [picked, setPicked] = useState<string | null>(null);
  // The card mounts while the photo is still being identified, so preselect when the result lands.
  useEffect(() => {
    setPicked(result?.confident ? (result.candidates[0]?.id ?? null) : null);
  }, [result]);
  const [day, setDay] = useState(defaultDay);
  const [period, setPeriod] = useState<SlotPeriod>('afternoon');
  const select = 'bg-surface border border-border-strong rounded-md px-2 py-1 text-text-main focus:outline-none focus:border-accent text-[13px]';

  return (
    <div className="max-w-[96%] border border-border rounded-xl p-3 flex flex-col gap-2.5" data-testid="photo-card">
      <div className="flex items-start gap-3">
        {photo.preview ? (
          <img src={photo.preview} alt="" className="w-16 h-16 rounded-lg object-cover border border-border shrink-0" data-testid="photo-preview" />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-bg-base border border-border flex items-center justify-center shrink-0">
            <Camera size={18} className="text-text-muted" />
          </div>
        )}
        <div className="min-w-0 flex-1 text-[13px]">
          {photo.status === 'preparing' && (
            <span className="inline-flex items-center gap-1.5 text-text-muted">
              <Loader2 size={13} className="animate-spin" /> {t('photo.preparing')}
            </span>
          )}
          {photo.status === 'identifying' && (
            <span className="inline-flex items-center gap-1.5 text-text-muted">
              <Loader2 size={13} className="animate-spin" /> {t('photo.identifying')}
            </span>
          )}
          {photo.status === 'failed' && (
            <span className="text-delete" data-testid="photo-error">
              {photo.error}
            </span>
          )}
          {photo.status === 'ready' && result && (
            <>
              <div className="font-medium" data-testid="photo-seen">
                {result.identified?.name
                  ? t('photo.seen', {
                      name:
                        result.identified.nameEn && result.identified.nameEn.toLowerCase() !== result.identified.name.toLowerCase()
                          ? `${result.identified.name} / ${result.identified.nameEn}`
                          : result.identified.name,
                      confidence: Math.round(result.identified.confidence * 100),
                    })
                  : t('photo.nothingSeen')}
                {result.identified?.city ? ` · ${result.identified.city}` : ''}
              </div>
              {result.identified?.visibleText && (
                <div className="text-text-muted break-words" data-testid="photo-visible-text">
                  {t('photo.visibleText')}: “{result.identified.visibleText}”
                </div>
              )}
              <div className="text-text-muted mt-0.5">
                {result.candidates.length > 0 ? (result.confident ? t('photo.matched') : t('photo.pickOne')) : t('photo.noCandidates')}
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={onDismiss} aria-label={t('search.close')} data-testid="photo-dismiss" className="w-8 h-8 rounded-lg bg-bg-base flex items-center justify-center text-text-main shrink-0">
          <X size={14} />
        </button>
      </div>

      {photo.status === 'ready' && result && result.candidates.length > 0 && (
        <>
          <ul className="m-0 p-0 list-none flex flex-col gap-1.5" role="radiogroup" aria-label={t('photo.pickOne')}>
            {result.candidates.map(c => {
              const active = picked === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPicked(c.id)}
                    data-testid={`photo-candidate-${c.id}`}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left ${active ? 'border-accent bg-accent-soft' : 'border-border hover:bg-bg-base'}`}
                  >
                    <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${active ? 'bg-accent border-accent text-white' : 'border-border-strong'}`}>{active && <Check size={12} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium truncate">{c.name}</span>
                      <span className="block text-[12px] text-text-muted truncate">
                        {c.exact ? `${t('photo.exactMatch')} · ` : ''}
                        {c.address || c.type}
                      </span>
                    </span>
                    {c.rating != null && (
                      <span className="inline-flex items-center gap-1 text-accent text-[12px] font-medium">
                        <Star size={11} className="fill-current" />
                        {c.rating}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <MapPin size={13} className="text-text-muted" />
            <select value={day} onChange={e => setDay(Number(e.target.value))} data-testid="photo-day" className={select}>
              {availableDays.map(d => (
                <option key={d} value={d}>
                  {t('itinerary.day', { n: d })}
                </option>
              ))}
            </select>
            <select value={period} onChange={e => setPeriod(e.target.value as SlotPeriod)} data-testid="photo-period" className={select}>
              {PERIOD_ORDER.map(p => (
                <option key={p} value={p}>
                  {t(`period.${p}`)}
                </option>
              ))}
            </select>
            <div className="flex-1" />
            <button
              type="button"
              disabled={!picked || busy}
              onClick={() => {
                const c = result.candidates.find(x => x.id === picked);
                if (c) onAdd(c, day, period);
              }}
              data-testid="photo-add"
              className="min-h-[34px] px-3.5 rounded-full bg-text-main text-white font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : t('photo.addToDay', { n: day })}
            </button>
          </div>
          <p className="m-0 text-[11px] text-text-muted">{t('photo.verifiedNote')}</p>
        </>
      )}
    </div>
  );
}
