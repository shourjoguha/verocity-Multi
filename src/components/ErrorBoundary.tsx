import { Component, type ReactNode } from 'react';

// Island-level error boundary: keeps one screen's crash from blanking the page,
// with a reload escape hatch. Wrap the heavy islands (e.g. the Logger).
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[verocity] island error', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="mb-3 font-display text-2xl font-semibold text-fg">Something broke</p>
          <p className="mb-6 text-sm text-muted">
            This screen hit an error. Reloading usually clears it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="hill-btn inline-flex min-h-11 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
