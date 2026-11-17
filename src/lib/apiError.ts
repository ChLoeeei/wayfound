/**
 * Errors from our own API routes, with the fields the server attaches
 * (`code`, and for 429s `scope` / `limit` / `resetAt` from server/rateLimit.ts),
 * so the UI can show a specific message instead of the raw text.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public scope?: 'ip' | 'global',
    public limit?: number,
    public resetAt?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Builds an ApiError from a non-OK response and its parsed JSON body (may be null). */
export function apiErrorFrom(res: { status: number }, data: any, fallback: string): ApiError {
  const body = data && typeof data === 'object' ? data : {};
  return new ApiError(typeof body.error === 'string' && body.error ? body.error : fallback || `HTTP ${res.status}`, res.status, body.code, body.scope, body.limit, body.resetAt);
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** The message to show for any thrown value; rate-limit errors get their localized text. */
export function describeApiError(err: unknown, t: T): string {
  if (err instanceof ApiError && err.code === 'rate_limited') {
    const time = err.resetAt ? new Date(err.resetAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
    return t(err.scope === 'global' ? 'limits.global' : 'limits.ip', { time, limit: err.limit ?? '' });
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
