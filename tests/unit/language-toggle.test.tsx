import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, useT, STORAGE_KEY } from '../../src/i18n';
import LanguageToggle from '../../src/components/LanguageToggle';

function Probe() {
  const t = useT();
  return <span data-testid="probe">{t('form.generate')}</span>;
}

describe('LanguageToggle', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('switches every translated string at once and remembers the choice', () => {
    render(
      <I18nProvider initialLang="en">
        <LanguageToggle />
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('Generate itinerary');
    expect(screen.getByTestId('lang-en')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('lang-zh'));
    expect(screen.getByTestId('probe')).toHaveTextContent('生成行程');
    expect(screen.getByTestId('lang-zh')).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('starts from the remembered language', () => {
    window.localStorage.setItem(STORAGE_KEY, 'zh');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('生成行程');
  });
});
