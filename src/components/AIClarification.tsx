import React, { useState } from 'react';
import { ClarificationQuestion } from '../types';
import { useT } from '../i18n';
import { clarificationOptionText, clarificationQuestionText } from '../lib/clarifyText';

interface AIClarificationProps {
  questions: ClarificationQuestion[];
  onResolve: (answers: Record<string, string>, skipped: boolean) => void;
}

/** Assistant-side card in the conversation: up to two quick questions before planning. */
export default function AIClarification({ questions, onResolve }: AIClarificationProps) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const allAnswered = questions.every(q => (answers[q.id] ?? '').trim().length > 0);

  return (
    <div className="max-w-[96%] border border-border rounded-xl p-3 flex flex-col gap-3" data-testid="ai-clarification">
      <div className="font-semibold">{t('clarify.intro')}</div>

      {questions.map(q => (
        <div key={q.id} className="flex flex-col gap-2" data-testid={`clarify-${q.id}`}>
          <p className="m-0 text-sm">{clarificationQuestionText(q, t)}</p>
          {q.options && q.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map(opt => {
                const text = clarificationOptionText(q, opt, t);
                const active = answers[q.id] === text;
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setAnswers(a => ({ ...a, [q.id]: text }))}
                    data-testid={`clarify-${q.id}-${opt}`}
                    className={`min-h-[32px] px-3 rounded-full text-xs border transition-colors ${
                      active ? 'bg-text-main text-white border-text-main' : 'bg-surface text-text-main border-border-strong hover:bg-bg-base'
                    }`}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
          )}
          <input
            type="text"
            value={answers[q.id] ?? ''}
            placeholder={t('clarify.ownAnswer')}
            onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
            className="w-full bg-surface border border-border-strong rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-accent"
          />
        </div>
      ))}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => onResolve({}, true)}
          data-testid="clarify-skip"
          className="min-h-[36px] px-3 text-sm text-text-muted hover:text-text-main transition-colors"
        >
          {t('clarify.skip')}
        </button>
        <button
          type="button"
          onClick={() => onResolve(answers, false)}
          disabled={!allAnswered}
          data-testid="clarify-continue"
          className="min-h-[36px] px-4 bg-accent text-white text-sm rounded-lg hover:bg-accent-deep transition-colors disabled:opacity-50 font-medium"
        >
          {t('clarify.continue')}
        </button>
      </div>
    </div>
  );
}
