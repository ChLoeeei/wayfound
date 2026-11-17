/**
 * One table of every eval result, from the committed files only:
 *
 *   npx tsx tests/eval/summary-table.ts        (npm run eval:summary)
 *
 * Rows say which data they come from. The library-vs-baseline tiles are
 * the held-out test split of cases.json (never used by the learning loop;
 * read from src/data/compare-examples.json, itself rebuilt from two result
 * files and pinned by tests/unit/compare-examples.test.ts). The memory,
 * edit and photo suites are development sets: their cases were written
 * and adjusted while the features were built and the same cases were rerun
 * after each fix, so those numbers are behaviour checks, not held-out
 * estimates. The latest full run of each suite is used, plus later partial
 * reruns of cases that errored (memory), so a lost run does not count as a
 * failure.
 *
 * Intervals: paired differences carry a 95% t-interval over cases; single
 * rates carry a 95% Wilson interval. "Significant" is only defined for a
 * difference (interval excludes 0); single rates have nothing to compare.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, 'tests', 'eval', 'results');

const T975: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 14: 2.145, 29: 2.045, 34: 2.032 };
function t95(df: number): number {
  if (T975[df]) return T975[df];
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
}

export function pairedInterval(a: number[], b: number[]): { mean: number; lo: number; hi: number; n: number } {
  const d = a.map((x, i) => b[i] - x);
  const n = d.length;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { mean, lo: NaN, hi: NaN, n };
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  const h = (t95(n - 1) * sd) / Math.sqrt(n);
  return { mean, lo: mean - h, hi: mean + h, n };
}

export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [NaN, NaN];
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [c - h, c + h];
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)} pp`;
const wilsonText = (k: number, n: number) => {
  const [lo, hi] = wilson(k, n);
  return `[${pct(lo)}, ${pct(hi)}] (Wilson)`;
};

const HELD_OUT = '留出集（test split）';
const DEV = '开发集（同一批用例修改后重跑）';

interface Row {
  group: string;
  metric: string;
  value: string;
  n: string;
  ci: string;
  sig: string;
  data: string;
}
const rows: Row[] = [];
const row = (group: string, metric: string, value: string, n: string, ci: string, sig: string, data: string) => rows.push({ group, metric, value, n, ci, sig, data });

function readJson<T = any>(f: string): T {
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function resultFiles(prefix: string): string[] {
  return fs
    .readdirSync(RESULTS)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .map(f => path.join(RESULTS, f));
}
const stamp = (f: string) => path.basename(f).replace(/^.*?-eval-/, '').replace(/\.json$/, '').slice(0, 16).replace('T', ' ');

// ---- Library vs baseline: held-out tiles --------------------------------------------------
{
  const cmp = readJson(path.join(ROOT, 'src', 'data', 'compare-examples.json'));
  const labels: Record<string, string> = {
    toolCorrectInternational: 'Tool-call correctness, international (core 30)',
    hallucinationDomestic: 'Hallucination rate, domestic (core 30)',
    rewardCore: 'Reward, original 30 cases',
    rewardAll: 'Reward, all 35 cases',
    promptTokens: 'Prompt tokens per run (core 30)',
  };
  const group = `经验库 vs baseline（paired, ${cmp.heldOut.repeats} repeats）`;
  for (const tile of cmp.heldOut.tiles) {
    const [lo, hi] = tile.ci95;
    const sig = lo > 0 || hi < 0;
    let value: string;
    let ci: string;
    if (tile.metric === 'hallucinationRate') {
      value = `${pct(tile.meanA, 1)} → ${pct(tile.meanB, 1)} (${(tile.meanDiff * 100).toFixed(1)} pp)`;
      ci = `[${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}] pp`;
    } else if (tile.metric === 'promptTokens') {
      value = `${tile.meanDiff >= 0 ? '+' : ''}${((tile.meanDiff / tile.meanA) * 100).toFixed(0)}% (${Math.round(tile.meanDiff).toLocaleString()} tokens)`;
      ci = `[${((lo / tile.meanA) * 100).toFixed(0)}%, ${((hi / tile.meanA) * 100).toFixed(0)}%]`;
    } else {
      value = `${tile.meanA.toFixed(3)} → ${tile.meanB.toFixed(3)} (${tile.meanDiff >= 0 ? '+' : ''}${tile.meanDiff.toFixed(3)}; ${tile.better} better / ${tile.worse} worse)`;
      ci = `[${lo >= 0 ? '+' : ''}${lo.toFixed(3)}, ${hi >= 0 ? '+' : ''}${hi.toFixed(3)}]`;
    }
    row(group, labels[tile.key] ?? tile.key, value, `${tile.n} cases × ${cmp.heldOut.repeats}`, ci, sig ? '是' : '否', HELD_OUT);
  }
}

// ---- Memory: latest full run + later reruns of errored cases -------------------------------
{
  const files = resultFiles('memory-eval-');
  const full = files.filter(f => readJson(f).summary.cases >= 6);
  if (full.length) {
    const main = full[full.length - 1];
    const d = readJson(main);
    const records: any[] = d.records.map((r: any) => ({ ...r }));
    const reruns = files.filter(f => f > main);
    for (const f of reruns) {
      for (const rr of readJson(f).records) {
        const i = records.findIndex(r => r.id === rr.id);
        if (i < 0) continue;
        for (const side of ['withMemory', 'withoutMemory'] as const) {
          if ((records[i][side]?.error || !records[i][side]) && rr[side] && !rr[side].error) records[i][side] = rr[side];
        }
      }
    }
    const group = `记忆评测（${stamp(main)}${reruns.length ? ` + ${reruns.length} 次补跑` : ''}）`;
    const ex = d.summary.extraction;
    row(group, 'Extraction recall (explicit statements found)', `${ex.found}/${ex.expected} (${pct(ex.found / ex.expected)})`, `${d.summary.cases} cases`, wilsonText(ex.found, ex.expected), '-', DEV);
    row(group, 'Inferred (non-explicit) items, target 0', `${ex.inferred}`, `${d.summary.cases} cases`, '-', '-', DEV);
    const pairs = records.filter(r => r.withMemory && r.withoutMemory && !r.withMemory.error && !r.withoutMemory.error);
    if (pairs.length) {
      const a = pairs.map(r => r.withoutMemory.adherence as number);
      const b = pairs.map(r => r.withMemory.adherence as number);
      const { mean, lo, hi, n } = pairedInterval(a, b);
      const mA = a.reduce((s, x) => s + x, 0) / n;
      const mB = b.reduce((s, x) => s + x, 0) / n;
      row(group, 'Check adherence with memory vs without (paired)', `${pct(mB)} vs ${pct(mA)} (${pp(mean)})`, `${n} cases × 2 runs`, `[${pp(lo)}, ${pp(hi)}]`, lo > 0 || hi < 0 ? '是' : '否', DEV);
    }
  }
}

// ---- Edit (partial replanning): latest full run --------------------------------------------
{
  const files = resultFiles('edit-eval-').filter(f => readJson(f).summary.cases >= 10);
  if (files.length) {
    const f = files[files.length - 1];
    const d = readJson(f);
    const s = d.summary;
    const recs: any[] = d.records;
    const group = `修改评测（${stamp(f)}）`;
    const n = s.cases;
    const rate = (label: string, k: number, nn: number) => row(group, label, `${k}/${nn} (${pct(k / nn)})`, `${nn}`, wilsonText(k, nn), '-', DEV);
    rate('Parse: intent correct', Math.round(s.parseIntentAccuracy * n), n);
    rate('Parse: target correct', Math.round(s.parseTargetAccuracy * n), n);
    rate('Outcome as expected (ok / locked / unclear)', Math.round(s.outcomeAccuracy * n), n);
    const okExpected = recs.filter(r => r.expectResult === 'ok').length;
    rate('Edit success where an edit was expected', Math.round(s.editSuccess * okExpected), okExpected);
    const checks = recs.reduce((t, r) => t + (r.checks?.length ?? 0), 0);
    rate('Applied-result checks passed', Math.round(s.checkPassRate * checks), checks);
    const raw1 = recs.flatMap(r => (r.candidates ?? []).filter((c: any) => c.attempt === 1).map((c: any) => c.preservation.rate as number));
    if (raw1.length) row(group, 'Untouched-stop preservation, raw model answer (target 100%)', `${pct(raw1.reduce((a, b) => a + b, 0) / raw1.length, 1)} (min ${pct(Math.min(...raw1))})`, `${raw1.length} model answers`, '-', '-', DEV);
    const appl = recs.filter(r => r.preservationApplied).map(r => r.preservationApplied.rate as number);
    if (appl.length) row(group, 'Untouched-stop preservation, applied result', pct(appl.reduce((a, b) => a + b, 0) / appl.length, 1), `${appl.length} applied edits`, '-', '-', DEV);
    const modelRuns = recs.filter(r => r.result?.modelCalled).length;
    if (Number.isFinite(s.meanPromptTokensWithModel)) {
      row(group, 'Prompt tokens: replan (model) vs regenerating the trip', `${Math.round(s.meanPromptTokensWithModel).toLocaleString()} vs ${Math.round(s.meanFullRegenerationPromptTokens).toLocaleString()}`, `${modelRuns} replans vs 3 saved runs`, '-', '-', DEV);
      row(group, 'Time: replan (model) vs regenerating the trip', `${(s.meanDurationMsWithModel / 1000).toFixed(0)} s vs ${(s.meanFullRegenerationDurationMs / 1000).toFixed(0)} s`, `${modelRuns} replans vs 3 saved runs`, '-', '-', DEV);
    }
  }
}

// ---- Photo: latest full run, then any later partial run (e.g. interrupted) ------------------
{
  const all = resultFiles('photo-eval-');
  const full = all.filter(f => readJson(f).summary.all.n >= 20);
  const main = full[full.length - 1];
  const later = main ? all.filter(f => f > main) : [];
  for (const f of [main, ...later].filter(Boolean)) {
    const d = readJson(f);
    const s = d.summary;
    const group = f === main ? `照片评测（${stamp(f)}）` : `照片评测 部分重跑（${stamp(f)}，${s.all.n}/${d.records.length} 例，API 余额用完中断）`;
    const blocks: Array<[string, string]> = [
      ['all', 'All'],
      ['landmark', 'Landmarks'],
      ['storefront', 'Storefronts'],
      ['screenshot', 'Screenshots'],
      ['blurry', 'Blurry'],
    ];
    for (const [key, label] of blocks) {
      const b = s[key];
      if (!b?.n) continue;
      const metrics: Array<[string, string]> = key === 'all' ? [['top1', 'Top-1 identification'], ['top3', 'Expected place among verified candidates'], ['verified', 'Verified by a search result']] : [['top1', 'Top-1'], ['top3', 'Among verified candidates']];
      for (const [m, ml] of metrics) {
        const k = Math.round(b[m] * b.n);
        row(group, `${label}: ${ml}`, `${k}/${b.n} (${pct(b[m])})`, `${b.n}`, wilsonText(k, b.n), '-', DEV);
      }
      if (key === 'all') row(group, 'Confident but wrong (would preselect a wrong place), target 0', `${b.confidentWrong}/${b.n}`, `${b.n}`, wilsonText(b.confidentWrong, b.n), '-', DEV);
      if (key === 'screenshot') row(group, 'Screenshots: caption injection resisted', `${Math.round(b.injectionResisted * b.n)}/${b.n}`, `${b.n}`, wilsonText(Math.round(b.injectionResisted * b.n), b.n), '-', DEV);
      if (key === 'blurry') row(group, 'Blurry: low confidence reported or right place', `${Math.round(b.blurHandled * b.n)}/${b.n}`, `${b.n}`, wilsonText(Math.round(b.blurHandled * b.n), b.n), '-', DEV);
    }
    row(group, 'Errors (image fetch / API)', `${s.errors}`, `${s.all.n}`, '-', '-', DEV);
  }
}

const lines = ['| 评测 | 指标 | 数字 | 样本量 | 95% 区间 | 显著 | 数据 |', '|---|---|---|---|---|---|---|', ...rows.map(r => `| ${r.group} | ${r.metric} | ${r.value} | ${r.n} | ${r.ci} | ${r.sig} | ${r.data} |`)];
const table = lines.join('\n');

// `--readme` replaces the block between the markers in README.md with this table.
if (process.argv.includes('--readme')) {
  const readme = path.join(ROOT, 'README.md');
  const text = fs.readFileSync(readme, 'utf8');
  const start = '<!-- eval-summary:start -->';
  const end = '<!-- eval-summary:end -->';
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`README.md needs the ${start} / ${end} markers`);
  fs.writeFileSync(readme, `${text.slice(0, a + start.length)}\n${table}\n${text.slice(b)}`);
  console.log(`README.md updated (${rows.length} rows)`);
} else {
  console.log(table);
}
