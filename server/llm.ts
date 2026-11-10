import OpenAI from 'openai';

/**
 * Per-request timeout for DeepSeek calls. The SDK default is 10 minutes per
 * attempt (× up to 3 attempts), which let a single request hang for over an
 * hour during an overnight eval run while the machine slept. 300s still
 * leaves room for the longest legitimate completion (a 10-day itinerary is
 * ~8k output tokens, a few minutes at DeepSeek's speed).
 */
export const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 300_000);

/** The one place DeepSeek clients are built (server, eval harness, fuzzy tests). */
export function createDeepSeekClient(): OpenAI {
  return new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
    timeout: DEEPSEEK_TIMEOUT_MS,
    maxRetries: 2,
  });
}

/**
 * True when an error is the network / API service failing (timeouts,
 * connection resets, DNS, 5xx, 429), as opposed to the agent producing bad
 * output. The eval harness uses this to discard a run instead of scoring
 * the agent for an outage.
 */
export function isInfraError(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true; // includes APIConnectionTimeoutError
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true;
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket|timed? ?out|Invalid response body|Connection error|fetch failed|network/i.test(msg);
}
