/**
 * apps/android/src/components/home/HomeSectionErrorBoundary.tsx
 *
 * Mirrors apps/web/components/home/HomeSectionErrorBoundary.tsx. Wraps each
 * Home Dashboard widget individually so a render-time exception in one
 * section (a data shape the widget didn't expect, etc.) degrades to that
 * section quietly disappearing instead of crashing the whole screen.
 */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  section?: string;
}

interface State {
  hasError: boolean;
}

export class HomeSectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error(`[home] section "${this.props.section ?? 'unknown'}" render error, degrading gracefully:`, error);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
