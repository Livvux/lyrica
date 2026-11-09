"use client";

import { Component } from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" className="flex aspect-video flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <p className="text-sm text-white/70">Vorschau konnte nicht geladen werden.</p>
        <button type="button" onClick={() => this.setState({ hasError: false })} className="btn">
          Erneut versuchen
        </button>
      </div>
    );
  }
}
