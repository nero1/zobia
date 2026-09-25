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
 * Two ways to use it:
 *  - `<Icon name="home" />` — the curated nav-chrome vocabulary below, with
 *    per-icon active/inactive emoji pairs.
 *  - `<Icon emoji="🎁" />` — the general-purpose path for every other UI
 *    icon across the app, resolved via shared/utils/emojiIconMap.ts's
 *    EMOJI_TO_LUCIDE_NAME table. An emoji with no entry there renders as
 *    the plain character in BOTH icon sets (never broken) — see that
 *    file's header for which emoji are deliberately excluded (game
 *    content, country flags, avatar picker options) and must NEVER be
 *    routed through <Icon>, because the emoji IS the content there.
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
import * as LucideIcons from 'lucide-react';
import { EMOJI_TO_LUCIDE_NAME } from '@zobia/shared/utils';
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

interface IconPropsBase {
  className?: string;
  size?: number;
  /** Forwarded to the rendered element; usually left `true` since the caller supplies its own accessible label. */
  ['aria-hidden']?: boolean;
}

interface IconPropsByName extends IconPropsBase {
  name: IconName;
  emoji?: undefined;
  /** Filled/active variant — swaps the emoji glyph (e.g. home/games tab icons) or bumps stroke weight for mono. Only applies to `name`. */
  active?: boolean;
}

interface IconPropsByEmoji extends IconPropsBase {
  name?: undefined;
  /** A raw UI-chrome emoji character, e.g. "🎁". Looked up in shared/utils/emojiIconMap.ts — see that file's header for which emoji must NEVER be passed here. */
  emoji: string;
  active?: undefined;
}

export type IconProps = IconPropsByName | IconPropsByEmoji;

/**
 * Renders the current icon set's version of `name` (curated nav vocabulary)
 * or `emoji` (general-purpose, looked up in EMOJI_TO_LUCIDE_NAME). See file
 * header for the two usage modes and known lucide substitutions.
 */
export function Icon(props: IconProps) {
  const { className, size = 20 } = props;
  const { iconSet } = useTheme();
  const ariaHidden = props['aria-hidden'] ?? true;

  if (iconSet === 'mono') {
    let LucideComponent: LucideIcon | undefined;
    if (props.name) {
      LucideComponent = LUCIDE[props.name];
    } else {
      const lucideName = EMOJI_TO_LUCIDE_NAME[props.emoji];
      LucideComponent = lucideName ? (LucideIcons as unknown as Record<string, LucideIcon>)[lucideName] : undefined;
    }
    if (LucideComponent) {
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
    // No mono mapping (deliberately, or a gap) — fall through to the emoji glyph so nothing ever renders broken.
  }

  if (props.name) {
    const pair = EMOJI[props.name];
    const glyph = props.active && pair.active ? pair.active : pair.default;
    return (
      <span aria-hidden={ariaHidden} className={className}>
        {glyph}
      </span>
    );
  }

  return (
    <span aria-hidden={ariaHidden} className={className}>
      {props.emoji}
    </span>
  );
}
