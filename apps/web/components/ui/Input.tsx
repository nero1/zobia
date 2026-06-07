/**
 * components/ui/Input.tsx
 *
 * Reusable Input component with label, error, and helper text support.
 * Fully accessible with proper ARIA attributes.
 *
 * NO purple colors. NO gradients.
 */

import { forwardRef, type InputHTMLAttributes, useId } from "react";
import { clsx } from "clsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Label text displayed above the input. */
  label?: string;
  /** Error message displayed below the input (sets aria-invalid). */
  error?: string;
  /** Helper text displayed below the input (hidden when error is shown). */
  helperText?: string;
  /** Show a loading spinner inside the right side of the input. */
  isLoading?: boolean;
  /** Icon or element rendered inside the left side of the input. */
  leftAddon?: React.ReactNode;
  /** Icon or element rendered inside the right side of the input. */
  rightAddon?: React.ReactNode;
  /** Make the label visually hidden but still accessible. @default false */
  srOnlyLabel?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Zobia Input – accessible text input with label, error, and helper text.
 *
 * @example
 * ```tsx
 * <Input
 *   label="Email address"
 *   type="email"
 *   placeholder="you@example.com"
 *   error={errors.email?.message}
 * />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      error,
      helperText,
      isLoading,
      leftAddon,
      rightAddon,
      srOnlyLabel = false,
      className,
      id: externalId,
      disabled,
      ...rest
    },
    ref
  ) {
    const generatedId = useId();
    const id = externalId ?? generatedId;
    const errorId = `${id}-error`;
    const helperId = `${id}-helper`;
    const hasError = Boolean(error);
    const isDisabled = disabled || isLoading;

    return (
      <div className="w-full">
        {/* Label */}
        {label && (
          <label
            htmlFor={id}
            className={clsx(
              "mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300",
              srOnlyLabel && "sr-only"
            )}
          >
            {label}
          </label>
        )}

        {/* Input wrapper */}
        <div className="relative">
          {/* Left addon */}
          {leftAddon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <span className="text-neutral-400 dark:text-neutral-500">
                {leftAddon}
              </span>
            </div>
          )}

          {/* The actual input */}
          <input
            ref={ref}
            id={id}
            disabled={isDisabled}
            aria-invalid={hasError}
            aria-required={rest.required}
            aria-describedby={
              hasError ? errorId : helperText ? helperId : undefined
            }
            className={clsx(
              // Base
              "block w-full rounded-xl border bg-white text-sm text-neutral-900",
              "placeholder:text-neutral-400",
              "transition-colors duration-150",
              "focus:outline-none focus:ring-2 focus:ring-offset-0",
              // Dark mode
              "dark:bg-neutral-800 dark:text-neutral-50 dark:placeholder:text-neutral-500",
              // Normal state
              !hasError && [
                "border-neutral-300 dark:border-neutral-700",
                "focus:border-primary-500 focus:ring-primary-500/20 dark:focus:border-primary-400",
              ],
              // Error state
              hasError && [
                "border-danger-500 dark:border-danger-500",
                "focus:border-danger-500 focus:ring-danger-500/20",
              ],
              // Disabled
              "disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400",
              "dark:disabled:bg-neutral-900 dark:disabled:text-neutral-500",
              // Accessibility: minimum touch target size (44×44px per WCAG 2.1)
              "min-h-11",
              // Padding adjustments for addons
              leftAddon ? "pl-9" : "pl-3",
              rightAddon || isLoading ? "pr-9" : "pr-3",
              "py-2.5",
              className
            )}
            {...rest}
          />

          {/* Right addon / loading spinner */}
          {(rightAddon || isLoading) && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
              {isLoading ? (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600"
                  aria-hidden="true"
                />
              ) : (
                <span className="text-neutral-400 dark:text-neutral-500">
                  {rightAddon}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Error message */}
        {hasError && (
          <p
            id={errorId}
            role="alert"
            className="mt-1.5 text-xs text-danger-600 dark:text-danger-400"
          >
            {error}
          </p>
        )}

        {/* Helper text (hidden when error is shown) */}
        {!hasError && helperText && (
          <p
            id={helperId}
            className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
