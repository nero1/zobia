/**
 * components/ui/Icon.tsx
 *
 * Swappable icon component for the two site-wide icon sets defined in
 * shared/utils/uiThemes.ts (ICON_SET_IDS: "emoji" | "mono"). Reads the
 * active set from useTheme().iconSet (apps/android/src/lib/theme/ThemeProvider)
 * and renders either the existing raw emoji character (the historical,
 * still-default look) or a matching monochrome lucide-react vector icon
 * ("Pro (Black & White)", styled like GitHub/YouTube's nav iconography).
 *
 * IMPORTANT — SCOPE: this is a PARTIAL migration. Only the primary nav
 * chrome (top bar, bottom tab bar, side drawer/menu) has been converted to
 * use <Icon>. The rest of the app (post reactions, gift emojis, badges,
 * achievement icons, etc.) still uses raw emoji characters directly in
 * JSX, and that is intentional — not an oversight to "finish later" by
 * grep-replacing every emoji in the codebase. A future task may extend the
 * <Icon> vocabulary to more surfaces, but should treat every emoji outside
 * nav chrome as deliberately out of scope unless told otherwise.
 *
 * Compromises (lucide-react has no exact match for a few source emoji):
 *  - tweets (🐦): lucide dropped its Twitter/bird glyph; using `Rss` (feed).
 *  - guilds (🏰) / guild (🛡️): using `Landmark` / `ShieldCheck` respectively
 *    — no castle icon in lucide, and `admin` already owns plain `Shield`.
 *  - quizzes (🧠): lucide DOES ship `Brain`, used as-is (no compromise).
 *
 * This name vocabulary matches apps/web/components/ui/Icon.tsx exactly so
 * both apps' nav chrome stay in sync; keep them in lockstep by hand (no
 * shared React component crosses the web/Capacitor source-tree boundary).
 */

import {
  Home,
  Search,
  Zap,
  Rss,
  HelpCircle,
  MessagesSquare,
  Target,
  Gamepad2,
  PenLine,
  BarChart3,
  Brain,
  Building2,
  Megaphone,
  DoorOpen,
  Landmark,
  MessageCircle,
  Users,
  Gift,
  Coins,
  Store,
  Bell,
  Calendar,
  Inbox,
  GraduationCap,
  Link2,
  School,
  Trophy,
  CalendarRange,
  Scale,
  User,
  Settings,
  Shield,
  ShieldCheck,
  Compass,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Star,
  Ghost,
  NotebookPen,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from '@/lib/theme/ThemeProvider';

/** The curated icon-name vocabulary for nav chrome (web + Android share this list). */
export type IconName =
  | 'home'
  | 'search'
  | 'moments'
  | 'tweets'
  | 'answers'
  | 'forum'
  | 'quests'
  | 'games'
  | 'blogs'
  | 'polls'
  | 'quizzes'
  | 'business'
  | 'ads'
  | 'rooms'
  | 'guilds'
  | 'guild'
  | 'messages'
  | 'friends'
  | 'gifts'
  | 'wallet'
  | 'market'
  | 'notifications'
  | 'events'
  | 'announcements'
  | 'elder'
  | 'referrals'
  | 'classroom'
  | 'leaderboards'
  | 'seasons'
  | 'council'
  | 'communityNotes'
  | 'nemesis'
  | 'profile'
  | 'settings'
  | 'admin'
  | 'moderation'
  | 'logout'
  | 'menu'
  | 'close'
  | 'themeLight'
  | 'themeDark'
  | 'star';

interface EmojiPair {
  /** Emoji shown when `active` is false (or unspecified). */
  default: string;
  /** Emoji shown when `active` is true, if it differs (e.g. the bottom tab bar's filled/outline pair). */
  active?: string;
}

const EMOJI: Record<IconName, EmojiPair> = {
  home: { default: '🏡', active: '🏠' },
  search: { default: '🔍' },
  moments: { default: '🎬' },
  tweets: { default: '🐦' },
  answers: { default: '❓' },
  forum: { default: '🗂️' },
  quests: { default: '🎯' },
  games: { default: '🕹️', active: '🎮' },
  blogs: { default: '✍️' },
  polls: { default: '📊' },
  quizzes: { default: '🧠' },
  business: { default: '🏢' },
  ads: { default: '📢' },
  rooms: { default: '🚪' },
  guilds: { default: '🏰' },
  guild: { default: '🛡️' },
  messages: { default: '💬' },
  friends: { default: '👥' },
  gifts: { default: '🎁' },
  wallet: { default: '🪙' },
  market: { default: '🏪' },
  notifications: { default: '🔔' },
  events: { default: '📅' },
  announcements: { default: '📬' },
  elder: { default: '🎓' },
  referrals: { default: '🔗' },
  classroom: { default: '🏫' },
  leaderboards: { default: '🏆' },
  seasons: { default: '🗓️' },
  council: { default: '⚖️' },
  communityNotes: { default: '📝' },
  nemesis: { default: '👻' },
  profile: { default: '👤' },
  settings: { default: '⚙️' },
  admin: { default: '🛡️' },
  moderation: { default: '🧭' },
  logout: { default: '🚪' },
  menu: { default: '☰' },
  close: { default: '✕' },
  themeLight: { default: '☀️' },
  themeDark: { default: '🌙' },
  star: { default: '⭐' },
};

const LUCIDE: Record<IconName, LucideIcon> = {
  home: Home,
  search: Search,
  moments: Zap,
  tweets: Rss,
  answers: HelpCircle,
  forum: MessagesSquare,
  quests: Target,
  games: Gamepad2,
  blogs: PenLine,
  polls: BarChart3,
  quizzes: Brain,
  business: Building2,
  ads: Megaphone,
  rooms: DoorOpen,
  guilds: Landmark,
  guild: ShieldCheck,
  messages: MessageCircle,
  friends: Users,
  gifts: Gift,
  wallet: Coins,
  market: Store,
  notifications: Bell,
  events: Calendar,
  announcements: Inbox,
  elder: GraduationCap,
  referrals: Link2,
  classroom: School,
  leaderboards: Trophy,
  seasons: CalendarRange,
  council: Scale,
  communityNotes: NotebookPen,
  nemesis: Ghost,
  profile: User,
  settings: Settings,
  admin: Shield,
  moderation: Compass,
  logout: LogOut,
  menu: Menu,
  close: X,
  themeLight: Sun,
  themeDark: Moon,
  star: Star,
};

export interface IconProps {
  name: IconName;
  /** Filled/active variant — swaps the emoji glyph (e.g. home/games tab icons) or bumps stroke weight for mono. */
  active?: boolean;
  className?: string;
  size?: number;
  /** Forwarded to the rendered element; usually left `true` since the caller supplies its own accessible label. */
  ['aria-hidden']?: boolean;
}

/**
 * Renders the current icon set's version of `name`. See file header for
 * scope notes (nav chrome only) and known lucide substitutions.
 */
export function Icon({ name, active, className, size = 20, ...rest }: IconProps) {
  const { iconSet } = useTheme();
  const ariaHidden = rest['aria-hidden'] ?? true;

  if (iconSet === 'mono') {
    const LucideComponent = LUCIDE[name];
    return (
      <LucideComponent
        aria-hidden={ariaHidden}
        className={className}
        width={size}
        height={size}
        strokeWidth={1.75}
        color="currentColor"
      />
    );
  }

  const pair = EMOJI[name];
  const glyph = active && pair.active ? pair.active : pair.default;
  return (
    <span aria-hidden={ariaHidden} className={className}>
      {glyph}
    </span>
  );
}
