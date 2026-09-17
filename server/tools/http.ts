/**
 * Shared HTTP helpers for external API clients (amap.ts, mapbox.ts,
 * wikivoyage.ts). Extracted from mapbox.ts's original rate-limit handling
 * so new clients can reuse the same throttling/retry/error-diagnostics
 * behavior instead of re-implementing it.
 */

/**
 * Creates an independent throttled fetch function: minimum spacing between
 * consecutive calls (a promise chain, not a hard concurrency lock — spreads
 * a burst out instead of firing it all at once) plus retries on retryable
 * HTTP statuses (honoring `Retry-After` when present, exponential backoff
 * otherwise) and, optionally, on the fetch call itself throwing (DNS
 * failure, connection reset, client-side timeout). Each call to this
 * factory gets its own independent spacing state — one per external
 * API/host, since rate limits are per-account/per-host, not shared across
 * unrelated APIs.
 */
export interface ThrottledFetchOptions {
  /** Minimum ms between consecutive calls through this fetch function. */
  minSpacingMs?: number;
  /** HTTP status codes that trigger a retry. Default: [429] (matches the original Mapbox-only behavior this was extracted from). */
  retryableStatuses?: number[];
  /** Max retries for a retryable status, or (if retryOnNetworkError) a thrown fetch error. */
  maxRetries?: number;
  /** Backoff base when there's no Retry-After header to honor (doubles per attempt). */
  retryBaseDelayMs?: number;
  /**
   * Also retry when fetch() itself throws, not just on a retryable status.
   * Default false — existing callers (Mapbox, Wikivoyage) rely on a thrown
   * network error propagating immediately; opt in per-client instead of
   * changing that default globally.
   */
  retryOnNetworkError?: boolean;
  /** Client-side abort timeout per attempt, ms. Default: none (no abort — relies on the underlying transport's own timeout). */
  timeoutMs?: number;
}

export function createThrottledFetch(options: ThrottledFetchOptions = {}) {
  const minSpacingMs = options.minSpacingMs ?? 150;
  const retryableStatuses = new Set(options.retryableStatuses ?? [429]);
  const maxRetries = options.maxRetries ?? 2;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 600;
  const retryOnNetworkError = options.retryOnNetworkError ?? false;
  const timeoutMs = options.timeoutMs;

  let lastCallAt = 0;
  let callChain: Promise<void> = Promise.resolve();

  function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Waits for its turn, then guarantees at least minSpacingMs since the previous call started. */
  function waitForSlot(): Promise<void> {
    const mySlot = callChain.then(async () => {
      const wait = minSpacingMs - (Date.now() - lastCallAt);
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();
    });
    callChain = mySlot;
    return mySlot;
  }

  async function attemptOnce(url: string, init?: RequestInit): Promise<Response> {
    if (!timeoutMs) return fetch(url, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  return async function throttledFetch(url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await waitForSlot();
      let res: Response;
      try {
        res = await attemptOnce(url, init);
      } catch (err) {
        if (!retryOnNetworkError || attempt >= maxRetries) throw err;
        await sleep(retryBaseDelayMs * 2 ** attempt);
        continue;
      }
      if (!retryableStatuses.has(res.status) || attempt >= maxRetries) return res;
      const retryAfterSec = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : retryBaseDelayMs * 2 ** attempt;
      await sleep(delay);
    }
  };
}

/**
 * Best-effort read of a failed response's body, for diagnostics. Error
 * responses are typically small JSON objects (e.g. `{"message":"..."}`) —
 * this is NOT parsed/validated, just captured verbatim (truncated) so
 * whoever's debugging a failure sees the API's own explanation, not just a
 * bare status code.
 */
export async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}
