import React, { useState } from 'react';
import { ClarificationQuestion } from '../types';
import { Sparkles } from 'lucide-react';

interface AIClarificationProps {
  questions: ClarificationQuestion[];
  onResolve: (answers: Record<string, string>, skipped: boolean) => void;
}

export default function AIClarification({ questions, onResolve }: AIClarificationProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const allAnswered = questions.every(q => (answers[q.id] ?? '').trim().length > 0);

  return (
    <div className="max-w-2xl mx-auto py-8" data-testid="ai-clarification">
      <div className="flex items-center gap-2 mb-6 text-accent">
        <Sparkles size={18} />
        <span className="font-mono text-xs uppercase tracking-widest">让我再问一两个问题</span>
      </div>

      <div className="space-y-6">
        {questions.map(q => (
          <div key={q.id} className="bg-surface border border-border rounded-2xl p-5" data-testid={`clarify-${q.id}`}>
            <p className="text-sm font-medium mb-4">{q.question}</p>
            {q.options && q.options.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {q.options.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                      answers[q.id] === opt
                        ? 'bg-text-main text-bg-base border-text-main'
                        : 'bg-transparent text-text-muted border-border hover:border-accent'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              value={answers[q.id] ?? ''}
              placeholder="或者自己写一句"
              onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
              className="w-full bg-bg-base border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-accent"
            />
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-6 justify-end">
        <button
          type="button"
          onClick={() => onResolve({}, true)}
          data-testid="clarify-skip"
          className="px-4 py-2 text-sm text-text-muted hover:text-text-main transition-colors"
        >
          跳过，直接生成
        </button>
        <button
          type="button"
          onClick={() => onResolve(answers, false)}
          disabled={!allAnswered}
          data-testid="clarify-continue"
          className="px-5 py-2 bg-accent text-white text-sm rounded-full hover:opacity-90 transition-all disabled:opacity-50"
        >
          继续生成
        </button>
      </div>
    </div>
  );
}
