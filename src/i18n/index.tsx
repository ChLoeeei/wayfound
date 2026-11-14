import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from '../locales/en.json';
import zh from '../locales/zh.json';

/**
 * Minimal i18n runtime: two JSON dictionaries (src/locales/*.json), a
 * context carrying the active language, and `t(key, params)` with `{name}`
 * interpolation and `_one` / `_other` plural suffixes picked by
 * `params.count`. No component may hold user-facing text itself; the unit
 * test tests/unit/i18n.test.ts also checks that both dictionaries carry
 * exactly the same keys.
 *
 * Without a provider (unit tests rendering one component), `t` resolves
 * against English, so existing component tests keep working unwrapped.
 */

export type Lang = 'en' | 'zh';
export const LANGS: Lang[] = ['en', 'zh'];
export const STORAGE_KEY = 'wayfound.lang';

type Dict = { [key: string]: string | Dict };
const DICTS: Record<Lang, Dict> = { en: en as Dict, zh: zh as Dict };

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every dotted leaf key of en.json, e.g. 'form.vibes.food'. */
export type MessageKey = Leaves<typeof en>;
/** A plural key without its suffix: 'topbar.days' for 'topbar.days_one' / 'topbar.days_other'. */
type PluralBase = MessageKey extends infer K ? (K extends `${infer B}_one` ? B : never) : never;
export type TKey = MessageKey | PluralBase;

export type Params = Record<string, string | number | undefined>;
export type Translate = (key: TKey | (string & {}), params?: Params) => string;

export function flattenKeys(dict: Dict, prefix = ''): string[] {
  return Object.entries(dict).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flattenKeys(v, `${prefix}${k}.`),
  );
}

function lookup(dict: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? m : String(v);
  });
}

/** Resolves a key in one language: plural suffix by `count`, then English fallback, then the key itself. */
export function translate(lang: Lang, key: string, params?: Params): string {
  const dict = DICTS[lang];
  const candidates: string[] = [];
  if (params && typeof params.count === 'number') candidates.push(`${key}_${params.count === 1 ? 'one' : 'other'}`);
  candidates.push(key);
  for (const k of candidates) {
    const hit = lookup(dict, k) ?? (lang !== 'en' ? lookup(DICTS.en, k) : undefined);
    if (hit !== undefined) return interpolate(hit, params);
  }
  return key;
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'zh';
}

/** Browser default: Chinese UI for zh-* locales, English otherwise. */
export function detectLang(navigatorLanguage: string | undefined): Lang {
  return (navigatorLanguage ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function loadLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // localStorage unavailable: fall through to the browser default
  }
  return detectLang(typeof navigator !== 'undefined' ? navigator.language : undefined);
}

export function saveLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // not fatal: the choice just does not survive a reload
  }
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key, params) => translate('en', key, params),
});

export function I18nProvider({ children, initialLang }: { children: React.ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? loadLang());
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);
  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t: (key, params) => translate(lang, key, params) }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): Translate {
  return useContext(I18nContext).t;
}

export function useLang(): [Lang, (lang: Lang) => void] {
  const { lang, setLang } = useContext(I18nContext);
  return [lang, setLang];
}

/** Month name for the top-bar trip title, in the active language. */
export function monthName(isoDate: string | undefined, lang: Lang): string {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long' });
}
