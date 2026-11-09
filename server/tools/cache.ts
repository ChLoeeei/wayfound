import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Disk-backed read-through cache for external tool calls, keyed by
 * provider + tool + arguments. OFF unless TOOL_CACHE_DIR is set — meant for
 * the eval harness and the v2 learning loop, not production:
 *
 *   TOOL_CACHE_DIR=tests/eval/.tool-cache npm run eval
 *
 * Why: (1) saves Geoapify/ORS free-tier quota across hundreds of repeated
 * runs, (2) makes ablation runs see identical tool outputs, and (3) keeps
 * runs reproducible on days Overpass is down.
 *
 * Only "good" results are written (see `shouldStore`): an empty search or
 * null lookup during an outage is NOT cached, otherwise one bad day would
 * freeze the outage into every later run. Read per call, not at import, so
 * tests can toggle it.
 */
export function toolCacheDir(): string | null {
  const dir = process.env.TOOL_CACHE_DIR;
  return dir && dir.trim() ? dir.trim() : null;
}

export function toolCacheKey(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

const stats = { hits: 0, misses: 0, writes: 0 };
export function toolCacheStats() {
  return { ...stats };
}

export async function cachedToolCall<T>(
  parts: unknown[],
  fn: () => Promise<T>,
  shouldStore: (value: T) => boolean,
): Promise<T> {
  const dir = toolCacheDir();
  if (!dir) return fn();

  const file = path.join(dir, `${toolCacheKey(parts)}.json`);
  if (existsSync(file)) {
    try {
      const entry = JSON.parse(readFileSync(file, 'utf8'));
      stats.hits++;
      return entry.value as T;
    } catch {
      // Corrupt entry: fall through and overwrite it.
    }
  }

  stats.misses++;
  const value = await fn();
  if (shouldStore(value)) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify({ key: parts, savedAt: new Date().toISOString(), value }));
      stats.writes++;
    } catch (err) {
      console.warn(`[tool-cache] write failed for ${file}:`, (err as Error).message);
    }
  }
  return value;
}
