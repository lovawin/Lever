"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Error boundary that catches crashes from child components.
 * Wraps each major section so one failure doesn't take down the whole page.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const label = this.props.name || "Component";
      return (
        <div className="glass rounded-2xl p-4 text-center">
          <p className="text-sm text-red-400 mb-2">{label} failed to load</p>
          <p className="text-xs text-gray-500 font-mono break-all mb-3">
            {this.state.error?.message?.slice(0, 200)}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 text-xs rounded-lg bg-white/10 border border-white/20 hover:bg-white/20 transition-all"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}