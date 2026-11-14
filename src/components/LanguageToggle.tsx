import React from 'react';
import { LANGS, useLang, useT, type Lang } from '../i18n';

const LABEL: Record<Lang, string> = { en: 'EN', zh: '中文' };

/** EN / 中文 segmented control; the choice applies immediately and is remembered (src/i18n). */
export default function LanguageToggle() {
  const [lang, setLang] = useLang();
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t('topbar.language')}
      className="flex p-[3px] border border-border-strong rounded-full bg-surface"
      data-testid="language-toggle"
    >
      {LANGS.map(l => {
        const active = l === lang;
        return (
          <button
            key={l}
            type="button"
            lang={l === 'zh' ? 'zh' : undefined}
            aria-pressed={active}
            onClick={() => setLang(l)}
            data-testid={`lang-${l}`}
            className={`min-h-[34px] min-w-[44px] px-3 rounded-full font-medium transition-colors ${
              active ? 'bg-text-main text-white' : 'bg-transparent text-text-main hover:bg-bg-base'
            }`}
          >
            {LABEL[l]}
          </button>
        );
      })}
    </div>
  );
}
