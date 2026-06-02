/**
 * Zobia Social — canonical color palette.
 *
 * Constraints:
 *  - No purple anywhere
 *  - No gradients
 *  - Primary: brand blue (#2563EB)
 *  - Accent:  brand green (#16A34A) and brand gold (#D97706)
 *  - Neutral: gray scale
 */

export const colors = {
  brand: {
    blue: '#2563EB',
    blueLight: '#3B82F6',
    blueDark: '#1D4ED8',
    green: '#16A34A',
    greenLight: '#22C55E',
    greenDark: '#15803D',
    gold: '#D97706',
    goldLight: '#F59E0B',
    goldDark: '#B45309',
  },

  neutral: {
    0: '#FFFFFF',
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
    950: '#030712',
  },

  semantic: {
    success: '#16A34A',
    warning: '#D97706',
    error: '#DC2626',
    info: '#2563EB',
  },
} as const;

/** Rank ring colors mapped to rank tier names. */
export const rankColors = {
  bronze: '#CD7F32',
  silver: '#A8A9AD',
  gold: '#D97706',
  platinum: '#2563EB',
  diamond: '#16A34A',
} as const;

export type BrandColor = keyof typeof colors.brand;
export type NeutralShade = keyof typeof colors.neutral;
export type RankTier = keyof typeof rankColors;
