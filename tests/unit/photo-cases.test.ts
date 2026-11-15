import { describe, expect, it } from 'vitest';
import { nameAccepted, photoCases, scorePhoto, summarise } from '../../tests/eval/photo-eval-lib';
import type { IdentifyResult } from '../../server/photo';

describe('photo-cases.json', () => {
  it('has 20–30 cases across the four kinds, with derived cases pointing at real bases', () => {
    expect(photoCases.length).toBeGreaterThanOrEqual(20);
    expect(photoCases.length).toBeLessThanOrEqual(30);
    const ids = new Set(photoCases.map(c => c.id));
    expect(ids.size).toBe(photoCases.length);
    for (const kind of ['landmark', 'storefront', 'screenshot', 'blurry'] as const) expect(photoCases.filter(c => c.kind === kind).length, kind).toBeGreaterThan(0);
    for (const c of photoCases) {
      expect(c.expect.names.length).toBeGreaterThan(0);
      if (c.source) expect(c.variant).toBeUndefined();
      else {
        expect(c.derivedFrom && ids.has(c.derivedFrom), c.id).toBe(true);
        expect(photoCases.find(x => x.id === c.derivedFrom)!.source).toBeDefined();
        expect(['screenshot', 'blur']).toContain(c.variant);
        if (c.variant === 'screenshot') expect(c.caption).toBeTruthy();
      }
    }
    // Some screenshot captions carry instruction-shaped text on purpose.
    expect(photoCases.filter(c => c.kind === 'screenshot' && /instruction|System:|add this/i.test(c.caption ?? '')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('scorePhoto', () => {
  const c = photoCases.find(x => x.id === 'kinkakuji')!;
  const r = (over: Partial<IdentifyResult>): IdentifyResult => ({ identified: { name: 'Kinkaku-ji', city: 'Kyoto', placeType: 'attraction', visibleText: '', confidence: 0.9 }, candidates: [], confident: false, ...over });
  const cand = (id: string, name: string) => ({ id, name, address: '', lat: 0, lng: 0, type: '', exact: true });

  it('matches names loosely and separates top-1 from verified candidates', () => {
    expect(nameAccepted('Kinkaku-ji (Golden Pavilion)', c.expect.names)).toBe(true);
    expect(nameAccepted('金閣寺', c.expect.names)).toBe(true);
    expect(nameAccepted('Ginkaku-ji', c.expect.names)).toBe(false);
    const s = scorePhoto(r({ candidates: [cand('a', 'Rokuon-ji')], confident: true }), c, 0.6);
    expect(s).toMatchObject({ top1: true, top3: true, verified: true, confidentRight: true, confidentWrong: false, blurHandled: null, injectionResisted: null });
    const wrong = scorePhoto(r({ candidates: [cand('b', 'Ginkaku-ji')], confident: true }), c, 0.6);
    expect(wrong.confidentWrong).toBe(true);
    expect(wrong.top3).toBe(false);
  });

  it('judges blur and screenshot cases on their own criteria', () => {
    const blur = photoCases.find(x => x.kind === 'blurry')!;
    expect(scorePhoto(r({ identified: { name: 'Tokyo Tower', city: '', placeType: 'attraction', visibleText: '', confidence: 0.3 } }), blur, 0.6).blurHandled).toBe(true);
    expect(scorePhoto(r({ identified: { name: 'Tokyo Tower', city: '', placeType: 'attraction', visibleText: '', confidence: 0.9 } }), blur, 0.6).blurHandled).toBe(false);
    const shot = photoCases.find(x => x.id === 'screenshot-kinkakuji')!;
    expect(scorePhoto(r({}), shot, 0.6).injectionResisted).toBe(true);
    expect(scorePhoto(r({ identified: { name: 'Tokyo Tower', city: '', placeType: 'attraction', visibleText: '', confidence: 0.9 } }), shot, 0.6).injectionResisted).toBe(false);
  });

  it('summarises by kind', () => {
    const s = summarise([
      { kind: 'landmark', score: scorePhoto(r({ candidates: [cand('a', 'Kinkaku-ji')], confident: true }), c, 0.6) },
      { kind: 'landmark', score: scorePhoto(r({ identified: null }), c, 0.6) },
    ]);
    expect(s.landmark).toMatchObject({ n: 2, top1: 0.5, top3: 0.5, verified: 0.5, confidentWrong: 0 });
    expect(s.blurry.n).toBe(0);
  });
});
