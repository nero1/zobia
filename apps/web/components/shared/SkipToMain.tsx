/**
 * components/shared/SkipToMain.tsx
 *
 * Skip-to-main link for keyboard users and screen readers.
 * Allows users to bypass navigation and go directly to main content.
 */

export function SkipToMain() {
  return (
    <a
      href="#main-content"
      className="skip-to-main focus:left-0 focus:top-0"
    >
      Skip to main content
    </a>
  );
}
