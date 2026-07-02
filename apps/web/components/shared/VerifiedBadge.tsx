/**
 * components/shared/VerifiedBadge.tsx
 *
 * Blue checkmark shown next to a user's display name once they've reached
 * `manifest.kyc.badgeMinTier` approved KYC (users.is_verified, set by
 * lib/kyc/service.ts approveSubmission). Same visual language as X/Facebook.
 *
 * Usage: <VerifiedBadge show={user.isVerified} /> next to any displayName.
 */

interface VerifiedBadgeProps {
  show: boolean | null | undefined;
  /** "sm" for inline text (username rows, comments), "md" for profile headers. */
  size?: "sm" | "md";
  className?: string;
}

export function VerifiedBadge({ show, size = "sm", className = "" }: VerifiedBadgeProps) {
  if (!show) return null;
  const dimension = size === "md" ? "h-5 w-5" : "h-4 w-4";
  return (
    <svg
      viewBox="0 0 22 22"
      aria-label="Verified account"
      role="img"
      className={`inline-block shrink-0 align-middle ${dimension} ${className}`}
    >
      <title>Verified account</title>
      <path
        fill="#1d9bf0"
        d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.084-1.245-1.439C12.275.215 11.646.017 11 0c-.646.017-1.275.215-1.816.57-.54.354-.972.852-1.246 1.438-.607-.223-1.264-.27-1.897-.14-.634.131-1.218.437-1.687.882-.445.47-.75 1.053-.882 1.687-.13.633-.083 1.29.14 1.897-.587.274-1.084.706-1.439 1.246C.215 8.725.017 9.354 0 10c.017.646.215 1.275.57 1.816.354.54.852.972 1.438 1.245-.223.607-.27 1.264-.14 1.897.131.634.437 1.217.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.274.586.706 1.084 1.246 1.438.54.355 1.17.552 1.816.57.646-.018 1.275-.215 1.816-.57.54-.354.972-.852 1.245-1.438.607.223 1.264.27 1.897.14.634-.131 1.218-.437 1.687-.882.445-.47.75-1.053.882-1.687.13-.633.083-1.29-.14-1.897.586-.273 1.084-.705 1.438-1.245.355-.54.552-1.17.57-1.816zm-11.454 4.586-2.968-2.968 1.414-1.414 1.554 1.554 4.294-4.294 1.414 1.414-5.708 5.708z"
        transform="translate(0 1)"
      />
    </svg>
  );
}
