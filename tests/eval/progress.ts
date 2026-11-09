/**
 * Long eval runs that span days: a daily Geoapify budget guard and a
 * per-run checkpoint store so the same command resumes where it stopped.
 *
 * - Budget: Geoapify's free tier is 3,000 credits/day, assumed to reset at
 *   00:00 UTC. The harness stops starting new runs once today's metered
 *   requests reach EVAL_GEOAPIFY_DAILY_LIMIT (default 2700, a 10% margin).
 *   Only requests made by the eval harness are counted; dev-server use of
 *   the same key is not, so check the Geoapify dashboard if you also use it.
 * - Checkpoints: one JSON file per completed (case, repeat) run, under a
 *   directory keyed by everything that affects results (setup label, case
 *   selection, temperature, judge, flags, reward version, cases.json hash).
 *   EVAL_REPEATS is deliberately NOT part of the key, so raising it later
 *   just adds runs. A source-code fingerprint is stored too: resuming after
 *   the agent/tools/scoring code changed is refused unless
 *   EVAL_ALLOW_CODE_CHANGE=1, since mixing runs from two code versions
 *   would silently contaminate a baseline.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// ==================== Daily Geoapify budget ====================

export interface DailyUsage {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  requests: number;
}

export function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function readDailyUsage(file: string, now = new Date()): DailyUsage {
  const today = utcDate(now);
  try {
    const u = JSON.parse(fs.readFileSync(file, 'utf8')) as DailyUsage;
    if (u.date === today && Number.isFinite(u.requests)) return u;
  } catch {
    // Missing or corrupt: start today's count from zero.
  }
  return { date: today, requests: 0 };
}

/** Adds `delta` requests to today's count (rolling over at UTC midnight) and persists it. */
export function addDailyUsage(file: string, delta: number, now = new Date()): DailyUsage {
  const u = readDailyUsage(file, now);
  const next = { date: u.date, requests: u.requests + Math.max(0, delta) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function budgetExhausted(usage: DailyUsage, limit: number): boolean {
  return usage.requests >= limit;
}

// ==================== Checkpoints ====================

export function configKey(config: unknown): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 10);
}

/** Hash of the source files whose changes would change scores. Order-stable. */
export function codeFingerprint(root: string, relPaths: string[]): string {
  const h = createHash('sha256');
  const files: string[] = [];
  for (const rel of relPaths) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) {
      for (const f of fs.readdirSync(abs).sort()) if (f.endsWith('.ts')) files.push(path.join(rel, f));
    } else {
      files.push(rel);
    }
  }
  for (const f of files.sort()) {
    h.update(f);
    h.update(fs.readFileSync(path.join(root, f)));
  }
  return h.digest('hex').slice(0, 12);
}

export const runFileName = (caseId: string, repeat: number) => `${caseId}-r${repeat}.json`;

export interface CheckpointManifest {
  config: unknown;
  codeFingerprint: string;
  createdAt: string;
}

export class CheckpointStore<T> {
  readonly runsDir: string;

  constructor(readonly dir: string) {
    this.runsDir = path.join(dir, 'runs');
  }

  /**
   * Creates the manifest, or validates it against the current code.
   * Returns a reason string when resuming must be refused.
   */
  open(config: unknown, fingerprint: string, allowCodeChange: boolean): string | null {
    fs.mkdirSync(this.runsDir, { recursive: true });
    const mf = path.join(this.dir, 'manifest.json');
    if (!fs.existsSync(mf)) {
      const manifest: CheckpointManifest = { config, codeFingerprint: fingerprint, createdAt: new Date().toISOString() };
      fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n');
      return null;
    }
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8')) as CheckpointManifest;
    if (manifest.codeFingerprint !== fingerprint && this.completedCount() > 0 && !allowCodeChange) {
      return `agent/tools/scoring code changed since this checkpoint was started (${manifest.codeFingerprint} -> ${fingerprint}). Resuming would mix two code versions in one result. Set EVAL_ALLOW_CODE_CHANGE=1 to resume anyway, or EVAL_FRESH=1 to start over.`;
    }
    return null;
  }

  has(caseId: string, repeat: number): boolean {
    return fs.existsSync(path.join(this.runsDir, runFileName(caseId, repeat)));
  }

  save(caseId: string, repeat: number, value: T) {
    const file = path.join(this.runsDir, runFileName(caseId, repeat));
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written run
  }

  load(caseId: string, repeat: number): T | null {
    const file = path.join(this.runsDir, runFileName(caseId, repeat));
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null;
  }

  completedCount(): number {
    return fs.existsSync(this.runsDir) ? fs.readdirSync(this.runsDir).filter(f => f.endsWith('.json')).length : 0;
  }

  /** Moves an existing checkpoint aside (EVAL_FRESH=1) instead of deleting it. */
  archive(): string | null {
    if (!fs.existsSync(this.dir)) return null;
    const dest = `${this.dir}.archived-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(this.dir, dest);
    return dest;
  }
}
