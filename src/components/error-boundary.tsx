"use client";

import { Component } from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
          <p className="text-sm text-white/60">
            Etwas ist schiefgelaufen.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20"
          >
            Erneut versuchen
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
