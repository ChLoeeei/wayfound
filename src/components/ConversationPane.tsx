import React, { useRef, useState } from 'react';
import { Camera, ArrowRight, Loader2 } from 'lucide-react';
import type { ClarificationQuestion, Itinerary, PlanningInput, SlotPeriod } from '../types';
import type { TravelMemory } from '../lib/memory';
import type { ChatTurn } from '../lib/editFlow';
import type { PhotoCandidate, PhotoState } from '../lib/photoTypes';
import { ACCEPTED_TYPES } from '../lib/photo';
import PhotoCandidatesCard from './PhotoCandidatesCard';
import { useT } from '../i18n';
import PlanningForm, { diffDays } from './PlanningForm';
import AIClarification from './AIClarification';

export type Stage = 'idle' | 'clarifying' | 'generating' | 'ready';

interface ConversationPaneProps {
  stage: Stage;
  /** The request being planned (or last planned); null before the first submit. */
  input: PlanningInput | null;
  itinerary: Itinerary | null;
  error: string;
  clarifyQuestions: ClarificationQuestion[];
  onClarifyResolve: (answers: Record<string, string>, skipped: boolean) => void;
  onSubmit: (input: PlanningInput) => void;
  memory: TravelMemory;
  formOpen: boolean;
  onToggleForm: () => void;
  /** Edit conversation after the plan exists (feature C). */
  messages?: ChatTurn[];
  onSendMessage?: (text: string) => void;
  /** True while an edit is being parsed or replanned. */
  editBusy?: boolean;
  /** Photo input (feature D). */
  photo?: PhotoState | null;
  onPhotoFile?: (file: File) => void;
  onPhotoAdd?: (candidate: PhotoCandidate, dayNumber: number, period: SlotPeriod) => void;
  onPhotoDismiss?: () => void;
  activeDay?: number;
}

const USER_BUBBLE = 'self-end max-w-[88%] bg-text-main text-white px-3 py-2.5 rounded-[12px_12px_4px_12px]';
const ASSISTANT_BUBBLE = 'max-w-[92%] bg-bg-base px-3 py-2.5 rounded-[12px_12px_12px_4px]';
const BUBBLE_BY_KIND: Record<NonNullable<ChatTurn['kind']>, string> = {
  question: 'max-w-[92%] bg-accent-soft border border-accent-line px-3 py-2.5 rounded-[12px_12px_12px_4px]',
  error: 'max-w-[92%] bg-delete-tint border border-delete-line text-delete px-3 py-2.5 rounded-[12px_12px_12px_4px]',
  done: 'max-w-[92%] bg-updated-tint border border-updated-line px-3 py-2.5 rounded-[12px_12px_12px_4px]',
  status: ASSISTANT_BUBBLE,
};

/**
 * Left column: the planning request as the first turn, clarification
 * questions and status as assistant turns, then the edit conversation.
 * The message box replans only the stops the user names (feature C); the
 * photo button stays disabled until photo input (feature D) exists.
 */
export default function ConversationPane({
  stage,
  input,
  itinerary,
  error,
  clarifyQuestions,
  onClarifyResolve,
  onSubmit,
  memory,
  formOpen,
  onToggleForm,
  messages = [],
  onSendMessage,
  editBusy = false,
  photo,
  onPhotoFile,
  onPhotoAdd,
  onPhotoDismiss,
  activeDay,
}: ConversationPaneProps) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const canPhoto = !!itinerary && stage === 'ready' && !!onPhotoFile;
  const generating = stage === 'generating' || (stage === 'clarifying' && clarifyQuestions.length === 0);
  const showForm = !input || formOpen;
  const canEdit = !!itinerary && stage === 'ready' && !!onSendMessage;

  const send = () => {
    const text = draft.trim();
    if (!text || !canEdit || editBusy) return;
    onSendMessage!(text);
    setDraft('');
  };

  return (
    <section
      aria-label={t('conversation.title')}
      className="[flex:1_1_280px] min-w-0 bg-surface border border-border rounded-[14px] p-4 md:p-[18px] flex flex-col gap-3"
      data-testid="conversation-pane"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 font-display text-base font-semibold">{t('conversation.title')}</h2>
        {input && (
          <button
            type="button"
            onClick={onToggleForm}
            data-testid="toggle-form"
            className="min-h-[32px] px-3 rounded-full border border-border-strong text-[13px] hover:bg-bg-base"
          >
            {formOpen ? t('conversation.hideForm') : t('conversation.editForm')}
          </button>
        )}
      </div>

      {!input && <div className={ASSISTANT_BUBBLE}>{t('conversation.planFirst')}</div>}

      {showForm && (
        <div className="border border-border rounded-xl p-3" data-testid="form-card">
          <PlanningForm loading={generating} onSubmit={onSubmit} memory={memory} />
        </div>
      )}

      {input && (
        <div className={USER_BUBBLE} data-testid="request-bubble">
          {t('conversation.requestSummary', {
            days: t('topbar.days', { count: diffDays(input.startDate, input.endDate) }),
            destination: input.destination,
            people: t('conversation.people', { count: input.people }),
            group: t(`form.groups.${input.groupType}`),
            vibes: input.vibes.map(v => t(`form.vibes.${v}`)).join(', '),
            min: input.budget.min,
            max: input.budget.max,
          })}
          {input.specialNeeds.length > 0 && (
            <>
              {' '}
              {t('conversation.requestNeeds', { needs: input.specialNeeds.map(n => t(`form.needs.${n}`)).join(', ') })}
            </>
          )}
        </div>
      )}

      {stage === 'clarifying' && clarifyQuestions.length > 0 && <AIClarification questions={clarifyQuestions} onResolve={onClarifyResolve} />}

      {generating && (
        <div className={`${ASSISTANT_BUBBLE} flex items-center gap-2`} data-testid="generating-bubble">
          <Loader2 size={14} className="animate-spin shrink-0" />
          {t('conversation.generating')}
        </div>
      )}

      {stage === 'ready' && itinerary && (
        <div className={ASSISTANT_BUBBLE} data-testid="ready-bubble">
          {t('conversation.ready', { title: itinerary.title })} {itinerary.groundingWarning ? t('conversation.readyWarning') : t('conversation.readyGrounded')}
        </div>
      )}

      {error && (
        <div className="max-w-[92%] bg-delete-tint border border-delete-line text-delete px-3 py-2.5 rounded-[12px_12px_12px_4px]" data-testid="error-bubble">
          {t('conversation.failed', { error })}
        </div>
      )}

      {messages.length > 0 && (
        <ol className="m-0 p-0 list-none flex flex-col gap-2" data-testid="edit-messages">
          {messages.map(m => (
            <li key={m.id} className={m.role === 'user' ? USER_BUBBLE : BUBBLE_BY_KIND[m.kind ?? 'status']} data-testid={`turn-${m.role}`} data-kind={m.kind}>
              {m.text}
            </li>
          ))}
        </ol>
      )}

      {photo && itinerary && (
        <PhotoCandidatesCard
          photo={photo}
          availableDays={itinerary.days.map(d => d.dayNumber)}
          defaultDay={activeDay ?? itinerary.days[0]?.dayNumber ?? 1}
          onAdd={(c, d, p) => onPhotoAdd?.(c, d, p)}
          onDismiss={() => onPhotoDismiss?.()}
          busy={editBusy}
        />
      )}

      {editBusy && (
        <div className={`${ASSISTANT_BUBBLE} flex items-center gap-2`} data-testid="edit-busy">
          <Loader2 size={14} className="animate-spin shrink-0" />
          {t('conversation.thinking')}
        </div>
      )}

      <div className="flex-1" />

      <form
        className={`flex items-center gap-2 border border-border-strong rounded-xl p-1.5 ${canEdit ? '' : 'opacity-70'}`}
        onSubmit={e => {
          e.preventDefault();
          send();
        }}
        title={canEdit ? t('conversation.inputHint') : t('conversation.noPlanYet')}
      >
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden"
          data-testid="photo-input"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f && onPhotoFile) onPhotoFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={!canPhoto || editBusy || photo?.status === 'preparing' || photo?.status === 'identifying'}
          aria-label={t('conversation.addPhoto')}
          title={canPhoto ? t('conversation.addPhoto') : t('conversation.photoDisabledHint')}
          data-testid="photo-button"
          onClick={() => fileRef.current?.click()}
          className="w-10 h-10 rounded-lg bg-bg-base flex items-center justify-center text-text-main hover:bg-border disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Camera size={18} />
        </button>
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={!canEdit || editBusy}
          placeholder={canEdit ? t('conversation.inputPlaceholder') : t('conversation.noPlanYet')}
          aria-label={t('conversation.inputPlaceholder')}
          data-testid="message-input"
          className="flex-1 min-w-0 border-0 bg-transparent p-2 outline-none disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!canEdit || editBusy || !draft.trim()}
          aria-label={t('conversation.send')}
          data-testid="send-button"
          className="w-10 h-10 rounded-lg bg-text-main flex items-center justify-center text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowRight size={18} />
        </button>
      </form>
    </section>
  );
}
