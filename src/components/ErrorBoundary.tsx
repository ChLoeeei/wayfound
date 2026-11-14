import React from 'react';
import { loadLang, translate } from '../i18n';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Wayfound ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      // A class component cannot use the i18n hook; it may also sit above
      // the provider, so read the stored language directly.
      const lang = loadLang();
      const t = (key: string) => translate(lang, key);
      return (
        <div className="min-h-screen w-full flex flex-col items-center justify-center bg-bg-base text-text-main p-6">
          <div className="max-w-lg w-full bg-surface border border-border rounded-[14px] p-6">
            <h2 className="m-0 mb-3 text-xl font-display font-semibold">{t('error.title')}</h2>
            <p className="text-text-muted text-sm mb-4">{this.state.error.message || t('error.unknown')}</p>
            <pre className="text-[11px] text-text-muted bg-bg-base border border-border rounded-md p-3 overflow-auto max-h-60 mb-4 whitespace-pre-wrap">
              {this.state.error.stack ?? ''}
            </pre>
            <div className="flex gap-2">
              <button onClick={this.reset} className="min-h-[40px] px-4 text-sm bg-accent text-white rounded-lg hover:bg-accent-deep">
                {t('error.retry')}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="min-h-[40px] px-4 text-sm border border-border-strong rounded-lg hover:bg-bg-base"
              >
                {t('error.reload')}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
