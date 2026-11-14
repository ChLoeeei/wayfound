import { describe, it, expect, beforeEach } from 'vitest';
import en from '../../src/locales/en.json';
import zh from '../../src/locales/zh.json';
import { flattenKeys, translate, interpolate, detectLang, loadLang, saveLang, STORAGE_KEY } from '../../src/i18n';

describe('locale files', () => {
  it('en.json and zh.json carry exactly the same keys', () => {
    const enKeys = flattenKeys(en as any).sort();
    const zhKeys = flattenKeys(zh as any).sort();
    const missingInZh = enKeys.filter(k => !zhKeys.includes(k));
    const extraInZh = zhKeys.filter(k => !enKeys.includes(k));
    expect(missingInZh).toEqual([]);
    expect(extraInZh).toEqual([]);
  });

  it('has no empty strings', () => {
    for (const dict of [en, zh]) {
      for (const key of flattenKeys(dict as any)) {
        const v = key.split('.').reduce((n: any, p) => n[p], dict);
        expect(typeof v === 'string' && v.trim().length > 0, key).toBe(true);
      }
    }
  });

  it('every plural key has both _one and _other', () => {
    const keys = flattenKeys(en as any);
    for (const k of keys) {
      if (k.endsWith('_one')) expect(keys).toContain(k.replace(/_one$/, '_other'));
      if (k.endsWith('_other')) expect(keys).toContain(k.replace(/_other$/, '_one'));
    }
  });

  it('both languages use the same placeholders in each message', () => {
    const names = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of flattenKeys(en as any)) {
      const e = key.split('.').reduce((n: any, p) => n[p], en) as string;
      const z = key.split('.').reduce((n: any, p) => n[p], zh) as string;
      expect(names(z), key).toEqual(names(e));
    }
  });
});

describe('translate', () => {
  it('interpolates named params', () => {
    expect(interpolate('Day {n} · {theme}', { n: 2, theme: 'Ueno' })).toBe('Day 2 · Ueno');
    expect(interpolate('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });

  it('picks the plural form from count', () => {
    expect(translate('en', 'topbar.days', { count: 1 })).toBe('1 day');
    expect(translate('en', 'topbar.days', { count: 4 })).toBe('4 days');
    expect(translate('zh', 'topbar.days', { count: 4 })).toBe('4 天');
  });

  it('returns the Chinese text for zh and English for en', () => {
    expect(translate('en', 'form.generate')).toBe('Generate itinerary');
    expect(translate('zh', 'form.generate')).toBe('生成行程');
  });

  it('falls back to the key for an unknown key', () => {
    expect(translate('en', 'nope.missing')).toBe('nope.missing');
  });
});

describe('language persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('defaults from the browser locale', () => {
    expect(detectLang('zh-CN')).toBe('zh');
    expect(detectLang('zh-TW')).toBe('zh');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });

  it('remembers the chosen language', () => {
    saveLang('zh');
    expect(loadLang()).toBe('zh');
    saveLang('en');
    expect(loadLang()).toBe('en');
  });

  it('ignores a corrupt stored value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'fr');
    expect(['en', 'zh']).toContain(loadLang());
  });
});
