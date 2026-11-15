/**
 * Photo-input eval (v2 feature D). Calls the vision model and the map
 * providers; ask before running.
 *
 *   npm run eval:photo
 *   PHOTO_EVAL_FILTER=kinkakuji,blur-colosseum npm run eval:photo
 *
 * Images: each base case names a Wikimedia Commons file search; the runner
 * resolves the first JPEG/PNG result through the Commons API, downloads it
 * at 1200px into tests/eval/.photo-cache/ (gitignored) and records the
 * file title so the exact image can be looked up. Derived cases are made
 * from those downloads with headless Chromium: `screenshot` wraps the image
 * in a social-feed mock with the case's caption; `blur` applies a 14px
 * blur. Every image goes through the same path as the UI
 * (identifyPhoto: byte check, metadata strip, vision, search_places).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createDeepSeekClient } from '../../server/llm';
import { CONFIDENCE_AUTO, identifyPhoto } from '../../server/photo';
import { geoapifyMeterSnapshot } from '../../server/tools/geoapify';
import { photoCases, scorePhoto, summarise, type PhotoCase } from './photo-eval-lib';

const filter = (process.env.PHOTO_EVAL_FILTER ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CACHE = path.join(process.cwd(), 'tests', 'eval', '.photo-cache');
const REPORTS_DIR = path.join(process.cwd(), 'tests', 'eval', 'reports');
const UA = 'Wayfound-eval/1.0 (https://github.com/; photo-input eval; contact via repo)';

interface Resolved {
  file: string;
  title?: string;
  pageUrl?: string;
}

async function resolveCommons(query: string, id: string): Promise<Resolved> {
  fs.mkdirSync(CACHE, { recursive: true });
  const meta = path.join(CACHE, `${id}.json`);
  if (fs.existsSync(meta)) {
    const m = JSON.parse(fs.readFileSync(meta, 'utf8')) as Resolved;
    if (fs.existsSync(m.file)) return m;
  }
  const search = new URL('https://commons.wikimedia.org/w/api.php');
  search.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${query} filetype:bitmap`, srnamespace: '6', srlimit: '5', format: 'json' }).toString();
  const res = await fetch(search, { headers: { 'User-Agent': UA } });
  const data: any = await res.json();
  const hit = (data?.query?.search ?? []).find((s: any) => /\.(jpe?g|png)$/i.test(s.title));
  if (!hit) throw new Error(`no Commons image for "${query}"`);
  const title: string = hit.title; // "File:..."
  const info = new URL('https://commons.wikimedia.org/w/api.php');
  info.search = new URLSearchParams({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '1200', format: 'json' }).toString();
  const infoData: any = await (await fetch(info, { headers: { 'User-Agent': UA } })).json();
  const page: any = Object.values(infoData?.query?.pages ?? {})[0];
  const url: string | undefined = page?.imageinfo?.[0]?.thumburl ?? page?.imageinfo?.[0]?.url;
  if (!url) throw new Error(`no image url for ${title}`);
  const bytes = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  const file = path.join(CACHE, `${id}${/\.png$/i.test(url) ? '.png' : '.jpg'}`);
  fs.writeFileSync(file, bytes);
  const resolved: Resolved = { file, title, pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}` };
  fs.writeFileSync(meta, JSON.stringify(resolved));
  return resolved;
}

async function derive(base: Resolved, c: PhotoCase): Promise<Resolved> {
  const file = path.join(CACHE, `${c.id}.png`);
  if (fs.existsSync(file)) return { file, title: base.title, pageUrl: base.pageUrl };
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  const dataUrl = `data:image/${base.file.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(base.file).toString('base64')}`;
  const html =
    c.variant === 'screenshot'
      ? `<html><body style="margin:0;background:#fff;font-family:-apple-system,Helvetica,sans-serif">
          <div style="padding:14px 16px;display:flex;align-items:center;gap:10px"><div style="width:36px;height:36px;border-radius:50%;background:#ddd"></div><div><b>travel_notes</b><div style="color:#888;font-size:12px">2h</div></div></div>
          <img src="${dataUrl}" style="width:540px;height:540px;object-fit:cover;display:block">
          <div style="padding:12px 16px;font-size:15px;line-height:1.4"><span style="color:#999">♡ 1,284</span><p style="margin:8px 0 0">${escapeHtml(c.caption ?? '')}</p></div>
        </body></html>`
      : `<html><body style="margin:0;background:#000"><img src="${dataUrl}" style="width:540px;height:960px;object-fit:cover;filter:blur(14px) saturate(0.8);display:block"></body></html>`;
  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, fullPage: false });
  await browser.close();
  return { file, title: base.title, pageUrl: base.pageUrl };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

async function main() {
  const client = createDeepSeekClient();
  const cases = photoCases.filter(c => filter.length === 0 || filter.includes(c.id));
  const bases = new Map<string, Resolved>();
  const records: any[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  console.log(`Photo eval: ${cases.length} case(s)\n`);
  const geoBefore = geoapifyMeterSnapshot().requests;

  for (const c of cases) {
    process.stdout.write(`${c.id} ... `);
    try {
      let img: Resolved;
      if (c.source) {
        img = bases.get(c.id) ?? (await resolveCommons(c.source.commons, c.id));
        bases.set(c.id, img);
      } else {
        const baseCase = photoCases.find(x => x.id === c.derivedFrom)!;
        const base = bases.get(baseCase.id) ?? (await resolveCommons(baseCase.source!.commons, baseCase.id));
        bases.set(baseCase.id, base);
        img = await derive(base, c);
      }
      const bytes = fs.readFileSync(img.file);
      const dataUrl = `data:image/${img.file.endsWith('.png') ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}`;
      const start = Date.now();
      const result = await identifyPhoto(client, dataUrl, c.destination, /[一-鿿]/.test(c.destination) ? 'zh' : 'en');
      const score = scorePhoto(result, c, CONFIDENCE_AUTO);
      records.push({ id: c.id, kind: c.kind, image: img, identified: result.identified, candidates: result.candidates.map(x => ({ id: x.id, name: x.name, exact: x.exact })), confident: result.confident, score, durationMs: Date.now() - start });
      console.log(
        `${result.identified?.name || '(none)'} ${((result.identified?.confidence ?? 0) * 100).toFixed(0)}% → top1 ${score.top1 ? 'ok' : 'NO'}, top3 ${score.top3 ? 'ok' : 'NO'}, candidates ${result.candidates.length}${score.confidentWrong ? ' CONFIDENT-WRONG' : ''}${score.blurHandled === false ? ' BLUR-NOT-HANDLED' : ''}${score.injectionResisted === false ? ' INJECTION-FOLLOWED' : ''}`,
      );
    } catch (err: any) {
      console.log(`ERROR ${err?.message ?? err}`);
      records.push({ id: c.id, kind: c.kind, error: err?.message ?? String(err) });
    }
  }

  const summary = { ...summarise(records.filter(r => r.score).map(r => ({ kind: r.kind, score: r.score }))), errors: records.filter(r => r.error).length, geoapifyRequests: geoapifyMeterSnapshot().requests - geoBefore };
  const out = path.join(REPORTS_DIR, `photo-eval-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ stamp, summary, records }, null, 2));
  console.log('\n' + JSON.stringify(summary, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
