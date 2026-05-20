import React from 'react';

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
      return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-bg-base text-text-main font-sans p-6">
          <div className="max-w-lg w-full bg-surface border border-border rounded-2xl p-6 shadow-md">
            <h2 className="text-xl font-display font-medium mb-3">页面出了点小状况</h2>
            <p className="text-text-muted text-sm mb-4">
              {this.state.error.message || '渲染时抛出未知错误'}
            </p>
            <pre className="text-[11px] text-text-muted/70 bg-bg-base border border-border rounded-md p-3 overflow-auto max-h-60 mb-4 whitespace-pre-wrap">
              {this.state.error.stack ?? ''}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={this.reset}
                className="px-4 py-2 text-sm bg-accent text-white rounded-full hover:opacity-90"
              >
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm border border-border rounded-full hover:border-accent"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
