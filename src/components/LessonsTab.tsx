import React, { useEffect, useState } from 'react';
import { Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useT } from '../i18n';
import { LESSON_FILTERS, type Lesson, type LessonFilter, type LessonLibrary, fetchLessons, filterLessons, parseLessonScope, sortLessons } from '../lib/lessons';

interface LessonsTabProps {
  /** Ids injected into the shown plan's prompt; undefined before any plan. */
  usedLessonIds?: string[];
  /** Start on the "this run" filter (when opened from the "Used N lessons" chip). */
  initialFilter?: LessonFilter;
}

/** Human label for a scope such as `international/search_places`. */
export function scopeLabel(scope: string, t: (k: string, p?: Record<string, string | number>) => string): string {
  const p = parseLessonScope(scope);
  const parts: string[] = [];
  if (p.region) parts.push(t(`panel.lessons.scopes.${p.region}`));
  if (p.tool) parts.push(t(`panel.lessons.scopes.${p.tool}`));
  return parts.length > 0 ? parts.join(' · ') : t('panel.lessons.scopes.general');
}

/**
 * Agent panel → "Lessons": the experience library, read-only, with the
 * lessons this plan used marked, filterable by "this run" or tool scope.
 */
export default function LessonsTab({ usedLessonIds, initialFilter }: LessonsTabProps) {
  const t = useT();
  const [library, setLibrary] = useState<LessonLibrary | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<LessonFilter>(initialFilter ?? 'all');

  useEffect(() => {
    let cancelled = false;
    fetchLessons()
      .then(lib => {
        if (!cancelled) setLibrary(lib);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);

  const used = new Set(usedLessonIds ?? []);
  const shown = library ? sortLessons(filterLessons(library.lessons, filter, usedLessonIds ?? [])) : [];

  return (
    <div className="flex flex-col gap-3 flex-1" data-testid="panel-lessons">
      <p className="m-0 text-text-muted text-[13px]">{t('panel.lessons.intro')}</p>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('panel.tabs.lessons')}>
        {LESSON_FILTERS.map(f => {
          const active = f === filter;
          const disabled = f === 'used' && !usedLessonIds;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              title={disabled ? t('panel.lessons.noPlanYet') : undefined}
              onClick={() => setFilter(f)}
              data-testid={`lesson-filter-${f}`}
              className={`min-h-[30px] px-2.5 rounded-full border text-[12px] transition-colors disabled:opacity-40 ${
                active ? 'bg-text-main text-white border-text-main' : 'bg-surface border-border text-text-main hover:bg-bg-base'
              }`}
            >
              {t(`panel.lessons.filters.${f}`)}
              {f === 'used' && usedLessonIds ? ` (${usedLessonIds.length})` : ''}
            </button>
          );
        })}
      </div>

      {!library && !failed && (
        <div className="flex items-center gap-2 text-text-muted py-6 justify-center text-sm">
          <Loader2 size={16} className="animate-spin" />
          {t('panel.lessons.loading')}
        </div>
      )}
      {failed && (
        <p className="m-0 text-[13px] text-delete" data-testid="lessons-failed">
          {t('panel.lessons.failed')}
        </p>
      )}

      {library && (
        <>
          {shown.length === 0 ? (
            <p className="m-0 text-[13px] text-text-muted" data-testid="lessons-empty">
              {t('panel.lessons.empty')}
            </p>
          ) : (
            <ol className="m-0 p-0 list-none flex flex-col gap-2" data-testid="lesson-list">
              {shown.map(l => (
                <LessonRow key={l.id} lesson={l} used={used.has(l.id)} />
              ))}
            </ol>
          )}
          <div className="mt-auto text-[12px] text-text-muted flex flex-col gap-1">
            <span data-testid="library-version">
              {t('panel.lessons.library', { version: library.libraryVersion, count: library.lessons.length, epoch: library.epoch })}
            </span>
            <span>{t('panel.lessons.readOnly')}</span>
          </div>
        </>
      )}
    </div>
  );
}

function LessonRow({ lesson, used }: { lesson: Lesson; used: boolean }) {
  const t = useT();
  return (
    <li
      className={`p-3 rounded-[10px] border flex flex-col gap-1.5 ${used ? 'border-accent-line bg-accent-soft' : 'border-border'}`}
      data-testid={`lesson-${lesson.id}`}
      data-used={used ? 'true' : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="font-mono font-semibold text-text-main">{lesson.id}</span>
        <span className="text-text-muted">{scopeLabel(lesson.scope, t)}</span>
        {used && (
          <span className="ml-auto px-2 py-0.5 rounded-full bg-accent text-white text-[11px] font-semibold">{t('panel.lessons.usedBadge')}</span>
        )}
      </div>
      <p className="m-0 text-[13px] leading-relaxed">{lesson.lesson}</p>
      <div className="flex items-center gap-3 text-[12px] text-text-muted tabular-nums">
        <span className="inline-flex items-center gap-1">
          <ThumbsUp size={12} /> {lesson.helpful} {t('panel.lessons.helpful')}
        </span>
        <span className="inline-flex items-center gap-1">
          <ThumbsDown size={12} /> {lesson.harmful} {t('panel.lessons.harmful')}
        </span>
        <span>
          {t('panel.lessons.net')} {lesson.helpful - lesson.harmful >= 0 ? '+' : ''}
          {lesson.helpful - lesson.harmful}
        </span>
      </div>
    </li>
  );
}
