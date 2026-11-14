import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useT } from '../i18n';

/**
 * Debug-only trace list: fetches the persisted reasoning/tool-call trace for
 * a generation request (GET /api/trace/:requestId, written by server.ts's
 * writeTraceFile / server/agent.ts's opts.stepTrace) and renders it as a
 * step-by-step list: the agent's reasoning at each loop iteration, followed
 * by the tool calls it made and whether each succeeded. Lives in the agent
 * panel's Trace tab (src/components/AgentPanel.tsx).
 *
 * Gated behind isDebugMode() — see the export below — so it never shows for
 * normal users.
 */

interface AgentStepRecord {
  step: number;
  timestamp: string;
  reasoning: string;
  toolCalls: Array<{ name: string; args: Record<string, any>; ok: boolean; resultSummary: string }>;
  isFinal: boolean;
  /** Set on segment completions and on the lessons-injection entry (server/agent.ts). */
  segment?: string;
}

/** Matches the payload shape server.ts's writeTraceFile actually writes. */
interface TracePayload {
  requestId: string;
  destination?: string;
  createdAt: string;
  durationMs: number;
  error: string | null;
  steps: AgentStepRecord[];
}

/** ?debug=1 in the URL, or a one-time localStorage flag set the same way. */
export function isDebugMode(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      localStorage.setItem('wayfound_debug', '1');
      return true;
    }
    return localStorage.getItem('wayfound_debug') === '1';
  } catch {
    return false;
  }
}

interface TraceListProps {
  requestId: string;
}

export default function TraceList({ requestId }: TraceListProps) {
  const t = useT();
  const [trace, setTrace] = useState<TracePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${process.env.API_BASE_URL}/api/trace/${requestId}`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        if (!cancelled) setTrace(data);
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('panel.trace.failed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  return (
    <div className="flex flex-col gap-2" data-testid="trace-viewer">
      <p className="m-0 text-[11px] text-text-muted break-all">{requestId}</p>

      {loading && (
        <div className="flex items-center gap-2 text-text-muted py-6 justify-center text-sm">
          <Loader2 size={16} className="animate-spin" />
          {t('panel.trace.loading')}
        </div>
      )}

      {error && !loading && <p className="m-0 text-delete text-sm py-2">{error}</p>}

      {trace && !loading && (
        <>
          <p className="m-0 text-[12px] text-text-muted">
            {trace.destination ? `${trace.destination} · ` : ''}
            {trace.durationMs}ms
          </p>
          {trace.error && (
            <p className="m-0 text-delete text-sm p-3 rounded-lg bg-delete-tint border border-delete-line">
              {t('panel.trace.requestFailed', { error: trace.error })}
            </p>
          )}
          {trace.steps.length === 0 && <p className="m-0 text-text-muted text-sm">{t('panel.trace.noSteps')}</p>}
          <ol className="m-0 p-0 list-none flex flex-col gap-2">
            {trace.steps.map((step, i) => {
              const lessons = step.segment === 'lessons';
              return (
                <li
                  key={`${step.step}-${i}`}
                  className={`flex gap-2.5 px-3 py-2.5 rounded-[10px] border ${lessons ? 'border-accent-line bg-accent-soft' : 'border-border'}`}
                >
                  <span className={`flex-none w-[22px] font-semibold ${lessons ? 'text-accent-deep' : 'text-text-muted'}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {lessons
                        ? t('panel.trace.lessonsStep')
                        : step.segment
                          ? step.segment
                          : `${t('panel.trace.step', { n: step.step })}${step.isFinal ? ` · ${t('panel.trace.finalAnswer')}` : ''}`}
                    </div>
                    {step.reasoning && <p className="m-0 mt-1 text-xs text-text-muted whitespace-pre-wrap">{step.reasoning}</p>}
                    {step.toolCalls.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {step.toolCalls.map((call, j) => (
                          <div key={j} className="text-xs bg-bg-base rounded-lg p-2 border border-border">
                            <div className="flex items-center gap-1.5 font-medium">
                              {call.ok ? (
                                <CheckCircle2 size={14} className="text-accent shrink-0" />
                              ) : (
                                <XCircle size={14} className="text-delete shrink-0" />
                              )}
                              {call.name}
                            </div>
                            <pre className="m-0 mt-1 overflow-x-auto text-[11px] text-text-muted">{JSON.stringify(call.args)}</pre>
                            <p className="m-0 mt-1 text-text-muted">{call.resultSummary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
