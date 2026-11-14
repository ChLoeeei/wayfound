import React, { useState } from 'react';
import { AlertTriangle, BookOpen, Loader2, Play, Radio } from 'lucide-react';
import { useLang, useT } from '../i18n';
import { Logo } from './TopBar';
import { isDebugMode } from './TraceViewer';
import { PERIOD_ORDER } from '../lib/itineraryOps';
import type { Itinerary } from '../types';
import compareData from '../data/compare-examples.json';

/** Shape of src/data/compare-examples.json (written by tests/eval/build-compare-examples.ts). */
type CompareFile = typeof compareData;
type Example = CompareFile['examples'][number];
type Tile = CompareFile['heldOut']['tiles'][number];

interface Side {
  usedLessonIds: string[];
  ungroundedPlaceNames: string[];
  itinerary: {
    title: string;
    days: Array<{ dayNumber: number; theme?: string; slots: Array<{ period: string; places: Array<{ id: string; name: string; type: string; estimatedCost: number }> }> }>;
  };
  /** Eval metrics; absent on a live run. */
  reward?: number;
  toolCorrect?: number;
  hallucinationRate?: number;
  steps?: number;
  invalidPoiRefs?: number;
}

const DATA: CompareFile = compareData;

/**
 * `#/compare`: one request run with the experience library off and on,
 * side by side. By default it shows a saved example from the held-out eval
 * (no API call); with ?debug=1 a "run both again" button generates two live
 * plans. The bottom tiles come from the two result files the JSON names.
 */
export default function ComparePage() {
  const t = useT();
  const [lang] = useLang();
  const [exampleIdx, setExampleIdx] = useState(0);
  const [activeDay, setActiveDay] = useState(1);
  const [live, setLive] = useState<{ off: Side; on: Side } | null>(null);
  const [running, setRunning] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const debug = isDebugMode();

  const example: Example = DATA.examples[exampleIdx];
  const sides: { off: Side; on: Side } = live ?? { off: example.off, on: example.on };
  const dayNumbers = [...new Set([...sides.off.itinerary.days, ...sides.on.itinerary.days].map(d => d.dayNumber))].sort((a, b) => a - b);
  const shownDay = dayNumbers.includes(activeDay) ? activeDay : (dayNumbers[0] ?? 1);

  const pickExample = (i: number) => {
    setExampleIdx(i);
    setLive(null);
    setLiveError(null);
    setActiveDay(1);
  };

  const runBoth = async () => {
    setRunning(true);
    setLiveError(null);
    try {
      const body = (useLibrary: boolean) => ({
        ...example.request,
        language: lang,
        useLibrary,
      });
      const call = async (useLibrary: boolean): Promise<Side> => {
        const res = await fetch(`${process.env.API_BASE_URL}/api/generate-itinerary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body(useLibrary)),
        });
        const data = (await res.json()) as Itinerary & { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const places = data.days.flatMap(d => d.slots.flatMap(s => s.places));
        const ungrounded = data.ungroundedPlaceNames ?? [];
        return {
          usedLessonIds: data.usedLessonIds ?? [],
          ungroundedPlaceNames: ungrounded,
          hallucinationRate: places.length > 0 ? ungrounded.length / places.length : 0,
          itinerary: {
            title: data.title,
            days: data.days.map(d => ({
              dayNumber: d.dayNumber,
              theme: d.theme,
              slots: d.slots.map(s => ({ period: s.period, places: s.places.map(p => ({ id: p.id, name: p.name, type: p.type, estimatedCost: p.estimatedCost })) })),
            })),
          },
        };
      };
      const [off, on] = await Promise.all([call(false), call(true)]);
      setLive({ off, on });
      setActiveDay(1);
    } catch (e: any) {
      setLiveError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  };

  const requestText = t('compare.request', {
    destination: example.request.destination,
    days: t('topbar.days', { count: example.request.days }),
    people: t('conversation.people', { count: example.request.people }),
    group: t(`form.groups.${example.request.groupType}`),
    vibes: example.request.preferences.map(v => t(`form.vibes.${v}`)).join(', '),
    min: example.request.budget.min,
    max: example.request.budget.max,
  });

  return (
    <div className="min-h-screen bg-bg-base">
      <header className="flex flex-wrap items-center gap-4 px-4 md:px-6 py-3 bg-surface border-b border-border">
        <Logo />
        <div className="text-text-muted">{t('compare.title')}</div>
        <div className="flex-1" />
        <a
          href="#/"
          className="flex items-center min-h-[40px] px-3.5 rounded-full border border-text-main bg-text-main !text-white no-underline font-medium"
          data-testid="exit-compare"
        >
          {t('topbar.exitCompare')}
        </a>
      </header>

      <main className="max-w-[1440px] mx-auto p-4 md:p-6 flex flex-col gap-4">
        <section className="bg-surface border border-border rounded-[14px] p-4 md:p-5 flex flex-col gap-3">
          <p className="m-0 text-text-muted">{t('compare.intro')}</p>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('compare.pickExample')}>
            <span className="text-[13px] text-text-muted">{t('compare.pickExample')}</span>
            {DATA.examples.map((e, i) => (
              <button
                key={e.caseId}
                type="button"
                aria-pressed={i === exampleIdx}
                onClick={() => pickExample(i)}
                data-testid={`compare-example-${e.caseId}`}
                className={`min-h-[34px] px-3 rounded-full border text-[13px] transition-colors ${
                  i === exampleIdx ? 'bg-text-main text-white border-text-main' : 'bg-surface border-border hover:bg-bg-base'
                }`}
              >
                {e.request.destination} · {t('topbar.days', { count: e.request.days })}
              </button>
            ))}
          </div>
          <blockquote className="m-0 font-display text-lg md:text-xl font-semibold" data-testid="compare-request">
            “{requestText}”
          </blockquote>
          {example.request.specialNeeds && example.request.specialNeeds.length > 0 && (
            <p className="m-0 text-[13px] text-text-muted">
              {t('conversation.requestNeeds', { needs: example.request.specialNeeds.map(n => t(`form.needs.${n}`)).join(', ') })}
            </p>
          )}
          {!live && (
            <p className="m-0 text-[12px] text-text-muted" data-testid="compare-precomputed">
              {t('compare.precomputed', { setup: DATA.library.setup, baseline: DATA.baseline.setup, caseId: example.caseId })}
            </p>
          )}

          {debug && (
            <div className="flex flex-wrap items-center gap-3 p-3 border border-updated-line bg-updated-tint rounded-xl" data-testid="compare-live">
              <AlertTriangle size={16} className="text-updated shrink-0" />
              <div className="flex-1 min-w-[220px] text-[13px]">
                <div className="font-semibold">{t('compare.live.title')}</div>
                <div className="text-text-muted">{t('compare.live.hint')}</div>
                {liveError && <div className="text-delete mt-1">{t('compare.live.failed', { error: liveError })}</div>}
              </div>
              {live && (
                <button type="button" onClick={() => setLive(null)} className="min-h-[36px] px-3 rounded-full border border-border bg-surface text-[13px]" data-testid="compare-live-back">
                  {t('compare.live.backToExample')}
                </button>
              )}
              <button
                type="button"
                onClick={runBoth}
                disabled={running}
                data-testid="compare-run-both"
                className="flex items-center gap-2 min-h-[36px] px-3.5 rounded-full bg-text-main text-white font-medium disabled:opacity-60"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {running ? t('compare.live.running') : t('compare.live.run')}
              </button>
            </div>
          )}
        </section>

        <nav aria-label={t('itinerary.days')} className="flex flex-wrap gap-1.5" data-testid="compare-day-tabs">
          {dayNumbers.map(n => (
            <button
              key={n}
              type="button"
              aria-current={n === shownDay ? 'true' : undefined}
              onClick={() => setActiveDay(n)}
              data-testid={`compare-day-${n}`}
              className={`min-h-[36px] px-3.5 rounded-full border transition-colors ${
                n === shownDay ? 'bg-text-main text-white border-text-main font-medium' : 'bg-surface border-border hover:bg-bg-base'
              }`}
            >
              {t('itinerary.day', { n })}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap gap-4 items-stretch">
          <SideColumn kind="off" side={sides.off} day={shownDay} live={!!live} />
          <SideColumn kind="on" side={sides.on} day={shownDay} live={!!live} />
        </div>

        <section className="bg-surface border border-border rounded-[14px] p-4 md:p-5 flex flex-col gap-3" data-testid="compare-held-out">
          <div>
            <h2 className="m-0 font-display text-lg font-semibold">{t('compare.heldOutTitle')}</h2>
            <p className="m-0 text-[13px] text-text-muted">
              {t('compare.heldOutSub', {
                cases: DATA.heldOut.cases,
                repeats: DATA.heldOut.repeats,
                baseline: DATA.baseline.setup,
                files: `${DATA.baseline.file.split('/').pop()} · ${DATA.library.file.split('/').pop()}`,
              })}
            </p>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            {DATA.heldOut.tiles.map(tile => (
              <HeldOutTileView key={tile.key} tile={tile} coreCases={DATA.heldOut.coreCases} allCases={DATA.heldOut.cases} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function SideColumn({ kind, side, day, live }: { kind: 'off' | 'on'; side: Side; day: number; live: boolean }) {
  const t = useT();
  const d = side.itinerary.days.find(x => x.dayNumber === day);
  const ungrounded = new Map<string, number>();
  for (const n of side.ungroundedPlaceNames) ungrounded.set(n, (ungrounded.get(n) ?? 0) + 1);
  // Consume one ungrounded mark per occurrence in itinerary order, across all days up to this one.
  const marks = new Map<string, boolean>();
  for (const dd of side.itinerary.days) {
    for (const s of dd.slots) {
      for (const p of s.places) {
        const left = ungrounded.get(p.name) ?? 0;
        marks.set(`${dd.dayNumber}:${p.id}`, left > 0);
        if (left > 0) ungrounded.set(p.name, left - 1);
      }
    }
  }
  let index = 0;
  const on = kind === 'on';
  const places = d ? PERIOD_ORDER.map(period => d.slots.find(s => s.period === period)).filter((s): s is NonNullable<typeof s> => !!s) : [];

  return (
    <section
      className={`[flex:1_1_380px] min-w-0 bg-surface border rounded-[14px] p-4 md:p-5 flex flex-col gap-3 ${on ? 'border-accent-line' : 'border-border'}`}
      data-testid={`compare-side-${kind}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={`m-0 font-display text-lg font-semibold ${on ? 'text-accent-deep' : ''}`}>{t(on ? 'compare.libraryOn' : 'compare.libraryOff')}</h2>
        {live && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-updated-chip text-updated-text text-[11px] font-semibold">
            <Radio size={11} /> {t('compare.live.badge')}
          </span>
        )}
        <div className="flex-1" />
        <span className={`inline-flex items-center gap-1.5 text-[12px] ${on ? 'text-accent-deep' : 'text-text-muted'}`} data-testid={`compare-lessons-${kind}`}>
          <BookOpen size={13} />
          {side.usedLessonIds.length > 0
            ? t('compare.lessonsUsed', { count: side.usedLessonIds.length, ids: side.usedLessonIds.join(' · ') })
            : t('compare.noLessons')}
        </span>
      </div>

      <dl className="m-0 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]" data-testid={`compare-metrics-${kind}`}>
        <Metric label={t('compare.metrics.reward')} value={side.reward != null ? side.reward.toFixed(3) : '–'} />
        <Metric label={t('compare.metrics.toolCorrect')} value={side.toolCorrect != null ? side.toolCorrect.toFixed(2) : '–'} />
        <Metric
          label={t('compare.metrics.hallucination')}
          value={side.hallucinationRate != null ? `${Math.round(side.hallucinationRate * 100)}%` : '–'}
          warn={(side.hallucinationRate ?? 0) > 0}
        />
        <Metric label={t('compare.metrics.steps')} value={side.steps != null ? String(side.steps) : '–'} />
      </dl>

      {(side.invalidPoiRefs ?? 0) > 0 && (
        <p className="m-0 text-[12px] text-delete flex items-center gap-1.5" data-testid={`compare-invalid-ids-${kind}`}>
          <AlertTriangle size={13} />
          {t('compare.invalidIds', { count: side.invalidPoiRefs! })}
        </p>
      )}

      {d?.theme && <h3 className="m-0 text-[15px] font-semibold">{t('itinerary.dayHeading', { n: d.dayNumber, theme: d.theme })}</h3>}
      {!d && <p className="m-0 text-[13px] text-text-muted">{t('itinerary.emptySlot')}</p>}

      <div className="flex flex-col gap-3">
        {places.map(slot => (
          <div key={slot.period} className="flex flex-col gap-1.5">
            <h4 className="m-0 text-[13px] font-medium text-text-muted">{t(`period.${slot.period}`)}</h4>
            {slot.places.length === 0 && <p className="m-0 text-xs text-text-muted px-3 py-1">{t('itinerary.emptySlot')}</p>}
            {slot.places.map(p => {
              const bad = marks.get(`${d!.dayNumber}:${p.id}`) === true;
              const n = ++index;
              return (
                <div
                  key={p.id}
                  className={`flex items-start gap-3 p-3 border rounded-xl ${bad ? 'border-updated-line bg-updated-tint' : 'border-border'}`}
                  data-testid={`compare-place-${kind}-${p.id}`}
                  data-grounded={bad ? 'false' : 'true'}
                >
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-semibold shrink-0 ${bad ? 'bg-updated' : 'bg-text-main'}`}>{n}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-words">{p.name}</div>
                    <div className="text-[12px] text-text-muted">
                      {t(`place.types.${p.type}`)} · {p.estimatedCost > 0 ? `¥${p.estimatedCost}` : t('place.free')}
                    </div>
                    {bad && (
                      <div className="mt-1 text-[12px] text-updated-text font-medium" title={t('compare.notGroundedHint')}>
                        {t('compare.notGrounded')}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="p-2 rounded-lg bg-bg-base">
      <dt className="text-text-muted">{label}</dt>
      <dd className={`m-0 font-semibold tabular-nums ${warn ? 'text-updated-text' : ''}`}>{value}</dd>
    </div>
  );
}

function HeldOutTileView({ tile, coreCases, allCases }: { tile: Tile; coreCases: number; allCases: number }) {
  const t = useT();
  const pct = tile.metric === 'hallucinationRate';
  const relative = tile.metric === 'promptTokens';
  const fmt = (x: number) => {
    if (relative) return `${x >= 0 ? '+' : '−'}${Math.round((Math.abs(x) / tile.meanA) * 100)}%`;
    if (pct) return `${x >= 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(1)} pp`;
    return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`;
  };
  const lowerIsBetter = pct || relative;
  const good = lowerIsBetter ? tile.meanDiff < 0 : tile.meanDiff > 0;
  const significant = tile.ci95[0] > 0 || tile.ci95[1] < 0;
  const n = tile.subset === 'core' ? coreCases : allCases;
  return (
    <div className="p-3.5 border border-border rounded-xl flex flex-col gap-1" data-testid={`held-out-${tile.key}`}>
      <div className={`font-display text-2xl font-semibold tabular-nums ${good ? 'text-accent-deep' : 'text-updated-text'}`}>{fmt(tile.meanDiff)}</div>
      <div className="text-[13px]">{t(`compare.heldOut.${tile.key}`, { n })}</div>
      <div className="text-[12px] text-text-muted">
        {t('compare.ci', { lo: fmt(tile.ci95[0]), hi: fmt(tile.ci95[1]) })}
        {significant ? ' *' : ''}
      </div>
      <div className="text-[12px] text-text-muted">{t('compare.betterWorse', { better: tile.better, worse: tile.worse })}</div>
    </div>
  );
}
