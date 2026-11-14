import React from 'react';
import { useT } from '../i18n';
import { Logo } from './TopBar';

/**
 * `#/compare`: the same request run with the experience library off and
 * on, side by side, plus the held-out eval numbers. This is the page
 * shell; the two runs and the result-file reader arrive with the Lessons
 * panel (v2 step 2).
 */
export default function ComparePage() {
  const t = useT();
  return (
    <div className="min-h-screen bg-bg-base">
      <header className="flex flex-wrap items-center gap-4 px-4 md:px-6 py-3 bg-surface border-b border-border">
        <Logo />
        <div className="text-text-muted">{t('compare.title')}</div>
        <div className="flex-1" />
        <a
          href="#/"
          className="flex items-center min-h-[40px] px-3.5 rounded-full border border-text-main bg-text-main !text-white no-underline font-medium"
          data-testid="exit-compare"
        >
          {t('topbar.exitCompare')}
        </a>
      </header>
      <main className="max-w-[1440px] mx-auto p-4 md:p-6 flex flex-col gap-4">
        <section className="bg-surface border border-border rounded-[14px] p-4 md:p-5">
          <p className="m-0 text-text-muted">{t('compare.intro')}</p>
        </section>
        <section className="bg-surface border border-border rounded-[14px] p-4 md:p-5 text-text-muted" data-testid="compare-placeholder">
          {t('compare.comingSoon')}
        </section>
      </main>
    </div>
  );
}
