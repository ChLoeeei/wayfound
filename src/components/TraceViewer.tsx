import React, { useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, XCircle } from 'lucide-react';

/**
 * Debug-only panel that fetches the persisted reasoning/tool-call trace for
 * a generation request (GET /api/trace/:requestId, written by server.ts's
 * writeTraceFile / server/agent.ts's opts.stepTrace) and renders it as a
 * step-by-step list: the agent's reasoning at each loop iteration, followed
 * by the tool calls it made and whether each succeeded.
 *
 * Gated behind isDebugMode() — see the export below — so it never shows for
 * normal users. Not wired into any always-mounted layout; ItineraryPane
 * only renders its trigger button when isDebugMode() is true.
 */

interface AgentStepRecord {
  step: number;
  timestamp: string;
  reasoning: string;
  toolCalls: Array<{ name: string; args: Record<string, any>; ok: boolean; resultSummary: string }>;
  isFinal: boolean;
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

interface TraceViewerProps {
  requestId: string;
  onClose: () => void;
}

export default function TraceViewer({ requestId, onClose }: TraceViewerProps) {
  const [trace, setTrace] = useState<TracePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${process.env.API_BASE_URL}/api/trace/${requestId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setTrace(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load trace.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="trace-viewer">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-surface border border-border shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Agent trace</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-border/40 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-[11px] text-text-muted/70 mb-4 break-all">{requestId}</p>

        {loading && (
          <div className="flex items-center gap-2 text-text-muted py-8 justify-center">
            <Loader2 size={18} className="animate-spin" />
            Loading trace…
          </div>
        )}

        {error && !loading && (
          <p className="text-delete text-sm py-4">{error}</p>
        )}

        {trace && !loading && (
          <div className="space-y-4">
            <p className="text-[11px] text-text-muted/70 -mt-2">
              {trace.destination ? `${trace.destination} · ` : ''}
              {trace.durationMs}ms
            </p>
            {trace.error && (
              <p className="text-delete text-sm p-3 rounded-lg bg-delete/5 border border-delete/30">
                Request failed: {trace.error}
              </p>
            )}
            {trace.steps.length === 0 && (
              <p className="text-text-muted text-sm">No steps recorded.</p>
            )}
            {trace.steps.map((step) => (
              <div key={step.step} className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wide font-medium text-text-muted">
                    Step {step.step}
                    {step.isFinal ? ' · final answer' : ''}
                  </span>
                  <span className="text-[11px] text-text-muted/60">{step.timestamp}</span>
                </div>
                {step.reasoning && (
                  <p className="text-sm whitespace-pre-wrap mb-2">{step.reasoning}</p>
                )}
                {step.toolCalls.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {step.toolCalls.map((call, i) => (
                      <div key={i} className="text-xs bg-bg rounded-lg p-2 border border-border/60">
                        <div className="flex items-center gap-1.5 font-medium">
                          {call.ok ? (
                            <CheckCircle2 size={14} className="text-accent shrink-0" />
                          ) : (
                            <XCircle size={14} className="text-delete shrink-0" />
                          )}
                          {call.name}
                        </div>
                        <pre className="mt-1 overflow-x-auto text-[11px] text-text-muted">
                          {JSON.stringify(call.args)}
                        </pre>
                        <p className="mt-1 text-text-muted">{call.resultSummary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
