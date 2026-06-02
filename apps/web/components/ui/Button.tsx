/**
 * components/ui/Button.tsx
 *
 * Reusable Button component.
 *
 * Variants: primary (blue), secondary (outlined), danger, ghost
 * Sizes: sm, md, lg
 *
 * NO purple colors. NO gradients.
 */

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant. @default 'primary' */
  variant?: ButtonVariant;
  /** Size preset. @default 'md' */
  size?: ButtonSize;
  /** Show a spinner and disable interactions. @default false */
  isLoading?: boolean;
  /** Stretch to fill the container width. @default false */
  fullWidth?: boolean;
  /** Icon displayed before the label (React element). */
  leftIcon?: React.ReactNode;
  /** Icon displayed after the label (React element). */
  rightIcon?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-600 text-white border-transparent hover:bg-primary-700 active:bg-primary-800 " +
    "focus-visible:ring-primary-500 " +
    "disabled:bg-primary-300 dark:disabled:bg-primary-800",
  secondary:
    "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100 " +
    "focus-visible:ring-primary-500 " +
    "dark:bg-neutral-800 dark:text-neutral-200 dark:border-neutral-700 " +
    "dark:hover:bg-neutral-750 dark:active:bg-neutral-700 " +
    "disabled:text-neutral-400 dark:disabled:text-neutral-500",
  danger:
    "bg-danger-600 text-white border-transparent hover:bg-danger-700 active:bg-danger-800 " +
    "focus-visible:ring-danger-500 " +
    "disabled:bg-danger-300 dark:disabled:bg-danger-800",
  ghost:
    "bg-transparent text-neutral-700 border-transparent hover:bg-neutral-100 active:bg-neutral-200 " +
    "focus-visible:ring-primary-500 " +
    "dark:text-neutral-300 dark:hover:bg-neutral-800 dark:active:bg-neutral-700 " +
    "disabled:text-neutral-400",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2.5 rounded-xl",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Zobia Button – accessible, keyboard-friendly, no purple, no gradients.
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="md" onClick={handleClick}>
 *   Save changes
 * </Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      className,
      disabled,
      children,
      ...rest
    },
    ref
  ) {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={isLoading}
        className={clsx(
          // Base styles
          "relative inline-flex items-center justify-center font-medium",
          "border transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-60",
          // Variant and size
          variantStyles[variant],
          sizeStyles[size],
          // Full width
          fullWidth && "w-full",
          className
        )}
        {...rest}
      >
        {/* Loading spinner (positioned absolutely to avoid layout shift) */}
        {isLoading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
              aria-hidden="true"
            />
          </span>
        )}

        {/* Content (hidden when loading to preserve button size) */}
        <span className={clsx("flex items-center", isLoading && "invisible")}>
          {leftIcon && <span aria-hidden="true">{leftIcon}</span>}
          {children}
          {rightIcon && <span aria-hidden="true">{rightIcon}</span>}
        </span>
      </button>
    );
  }
);

Button.displayName = "Button";
