/**
 * lib/theme/chatThemes.ts
 *
 * Chat theme catalogue for DM bubble colours.
 * Non-default themes require Pro or Max plan (PRD §3).
 */

import { colors } from '@/lib/theme/colors';

export type ChatTheme = 'default' | 'midnight' | 'ocean' | 'forest' | 'sunset';

export interface ThemeConfig {
  id: ChatTheme;
  label: string;
  emoji: string;
  bubbleOwn: string;
  bubbleOther: string;
  requiresPaid: boolean;
}

export const CHAT_THEMES: ThemeConfig[] = [
  {
    id: 'default',
    label: 'Default',
    emoji: '💬',
    bubbleOwn: colors.brand.blue,
    bubbleOther: colors.neutral[100],
    requiresPaid: false,
  },
  {
    id: 'midnight',
    label: 'Midnight',
    emoji: '🌙',
    bubbleOwn: colors.brand.blue,
    bubbleOther: '#1e1b4b',
    requiresPaid: true,
  },
  {
    id: 'ocean',
    label: 'Ocean',
    emoji: '🌊',
    bubbleOwn: '#0ea5e9',
    bubbleOther: '#0c4a6e',
    requiresPaid: true,
  },
  {
    id: 'forest',
    label: 'Forest',
    emoji: '🌿',
    bubbleOwn: '#16a34a',
    bubbleOther: '#14532d',
    requiresPaid: true,
  },
  {
    id: 'sunset',
    label: 'Sunset',
    emoji: '🌅',
    bubbleOwn: '#f97316',
    bubbleOther: '#7c2d12',
    requiresPaid: true,
  },
];
