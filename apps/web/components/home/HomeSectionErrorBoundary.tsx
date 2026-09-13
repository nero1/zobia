"use client";

/**
 * components/home/HomeSectionErrorBoundary.tsx
 *
 * The Home Dashboard composes many independent, data-fetching widgets on
 * one page (Zobian of the Month, quests, nemesis, presence, leaderboard,
 * guild discovery, creator spotlight, the notices carousel, each feed tab).
 * A render-time exception in ANY ONE of them must never blank out the
 * entire dashboard — this wraps each section individually so a single
 * widget failing degrades to a small inline notice while every other
 * section keeps working. The page-level app/(app)/error.tsx boundary
 * remains as a final catch-all for anything outside these sections.
 *
 * React error boundaries must be class components — there is no hooks
 * equivalent — so this is deliberately the one class component in the
 * Home Dashboard's otherwise all-function-component tree.
 */

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional label included in the client-side log line, for identifying which section failed. */
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
    // Client-side only (this is a "use client" boundary) — matches the
    // console.error convention already used by app/(app)/error.tsx.
    // eslint-disable-next-line no-console
    console.error(`[home] section "${this.props.section ?? "unknown"}" render error, degrading gracefully:`, error);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
