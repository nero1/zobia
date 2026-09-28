"use client";

/**
 * components/ui/Icon.tsx
 *
 * Swappable icon component for the two site-wide icon sets defined in
 * shared/utils/uiThemes.ts (ICON_SET_IDS: "emoji" | "mono"). Reads the
 * active set from useSiteTheme() and renders either the existing raw emoji
 * character (the historical, still-default look) or a matching monochrome
 * lucide-react vector icon ("Pro (Black & White)", styled like GitHub/
 * YouTube's nav iconography).
 *
 * Two ways to use it:
 *  - `<Icon name="home" />` — the curated nav-chrome vocabulary below
 *    (top bar, bottom tabs, drawer, profile menu), with per-icon
 *    active/inactive emoji pairs.
 *  - `<Icon emoji="🎁" />` — the general-purpose path for every other UI
 *    icon across the app (buttons, badges, status indicators, empty
 *    states, admin panels, etc.), resolved via
 *    shared/utils/emojiIconMap.ts's EMOJI_TO_LUCIDE_NAME table. An emoji
 *    with no entry there renders as the plain character in BOTH icon sets
 *    (never broken) — see that file's header for which emoji are
 *    deliberately excluded (game content, country flags, avatar picker
 *    options) and must NEVER be routed through <Icon>, because the emoji
 *    IS the content there, not a decoration of it.
 *
 * Compromises (lucide-react has no exact match for a few source emoji):
 *  - tweets (🐦): lucide dropped its Twitter/bird glyph; using `Rss` (feed).
 *  - guilds (🏰) / guild (🛡️ on Android): using `Landmark` / `ShieldCheck`
 *    respectively — no castle icon in lucide.
 *  - quizzes (🧠): lucide DOES ship `Brain`, used as-is (no compromise).
 */

// Explicit named imports ONLY (never `import * as LucideIcons`) — lucide-react
// is tree-shaken per-icon by name; a namespace import pulls in every icon in
// the library (1000+) into the bundle because bundlers can't statically
// determine which ones a computed `LucideIcons["Foo"]` lookup will touch.
// This list is generated to cover exactly the icons referenced by the
// curated nav vocabulary below AND every value in
// shared/utils/emojiIconMap.ts's EMOJI_TO_LUCIDE_NAME table — regenerate it
// (see that file's header) if either grows.
import {
  AlarmClock, Activity, AlertTriangle, Archive, ArrowDown, ArrowDownLeft, ArrowDownRight,
  ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpLeft,
  ArrowUpRight, Award, BadgePlus, Ban, Banknote, BarChart3, Bell,
  BellOff, BellRing, BookOpen, Bot, Brain, Building2, Calendar,
  CalendarDays, CalendarRange, Camera, Check, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronUp, Circle, CircleDot, CircleOff, Clipboard,
  Clock, CloudRain, Coins, Compass, Construction, CornerDownLeft,
  CornerDownRight, CreditCard, Crown, Delete, Diamond, DoorOpen, Drama,
  Eye, EyeOff, Factory, FileEdit, FileText, Film,
  Flag, Flame, FlaskConical, Folder, FolderOpen, Frown,
  Gamepad2, Gem, Ghost, Gift, Globe, GraduationCap,
  Hand, Handshake, Heart, HelpCircle, Home, Hourglass,
  Flashlight, IdCard, Image, Inbox, Info, Landmark, Laptop,
  LayoutGrid, Lightbulb, Link2, Lock, LogOut, Mail, Map,
  MapPin, Medal, Megaphone, Meh, Menu, MessageCircle, MoreHorizontal,
  MessageSquare, MessagesSquare, Mic, Moon, MousePointer, Music,
  NotebookPen, Package, Palette, PartyPopper, Pause, PenLine,
  Pencil, Pickaxe, Pin, Play, Plus, Pointer,
  Radio, Receipt, RefreshCw, Repeat, Rocket, RotateCw,
  Rss, Save, Scale, School, Search, Settings,
  Shield, ShieldCheck, ShoppingBag, ShoppingCart, Shuffle, Siren,
  Skull, Smartphone, Smile, Sparkle, Sparkles, Square,
  Star, Store, Sun, Swords, Tag, Target, ThumbsDown,
  ThumbsUp, Ticket, Timer, Trash2, TrendingDown, TrendingUp,
  Triangle, Trophy, Undo2, Unlock, User, Users,
  Video, Volume2, VolumeX, Vote, Wallet, Wrench,
  X, XCircle, Zap,
  type LucideIcon,
} from "lucide-react";
import { EMOJI_TO_LUCIDE_NAME } from "@zobia/shared/utils";
import { useSiteTheme } from "@/lib/hooks/useSiteTheme";

/** Every lucide icon this file imports, indexed by its export name — the general-purpose `emoji` lookup path resolves through this instead of a namespace import (see the import block comment above for why). */
const LUCIDE_BY_NAME: Record<string, LucideIcon> = {
  AlarmClock, Activity, AlertTriangle, Archive, ArrowDown, ArrowDownLeft, ArrowDownRight,
  ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpLeft,
  ArrowUpRight, Award, BadgePlus, Ban, Banknote, BarChart3, Bell,
  BellOff, BellRing, BookOpen, Bot, Brain, Building2, Calendar,
  CalendarDays, CalendarRange, Camera, Check, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronUp, Circle, CircleDot, CircleOff, Clipboard,
  Clock, CloudRain, Coins, Compass, Construction, CornerDownLeft,
  CornerDownRight, CreditCard, Crown, Delete, Diamond, DoorOpen, Drama,
  Eye, EyeOff, Factory, FileEdit, FileText, Film,
  Flag, Flame, FlaskConical, Folder, FolderOpen, Frown,
  Gamepad2, Gem, Ghost, Gift, Globe, GraduationCap,
  Hand, Handshake, Heart, HelpCircle, Home, Hourglass,
  Flashlight, IdCard, Image, Inbox, Info, Landmark, Laptop,
  LayoutGrid, Lightbulb, Link2, Lock, LogOut, Mail, Map,
  MapPin, Medal, Megaphone, Meh, Menu, MessageCircle, MoreHorizontal,
  MessageSquare, MessagesSquare, Mic, Moon, MousePointer, Music,
  NotebookPen, Package, Palette, PartyPopper, Pause, PenLine,
  Pencil, Pickaxe, Pin, Play, Plus, Pointer,
  Radio, Receipt, RefreshCw, Repeat, Rocket, RotateCw,
  Rss, Save, Scale, School, Search, Settings,
  Shield, ShieldCheck, ShoppingBag, ShoppingCart, Shuffle, Siren,
  Skull, Smartphone, Smile, Sparkle, Sparkles, Square,
  Star, Store, Sun, Swords, Tag, Target, ThumbsDown,
  ThumbsUp, Ticket, Timer, Trash2, TrendingDown, TrendingUp,
  Triangle, Trophy, Undo2, Unlock, User, Users,
  Video, Volume2, VolumeX, Vote, Wallet, Wrench,
  X, XCircle, Zap,
};

/** The curated icon-name vocabulary for nav chrome (web + Android share this list). */
export type IconName =
  | "home"
  | "search"
  | "moments"
  | "tweets"
  | "answers"
  | "forum"
  | "quests"
  | "games"
  | "blogs"
  | "polls"
  | "quizzes"
  | "business"
  | "ads"
  | "rooms"
  | "guilds"
  | "guild"
  | "messages"
  | "friends"
  | "gifts"
  | "wallet"
  | "market"
  | "notifications"
  | "events"
  | "announcements"
  | "elder"
  | "referrals"
  | "classroom"
  | "leaderboards"
  | "seasons"
  | "council"
  | "communityNotes"
  | "nemesis"
  | "profile"
  | "settings"
  | "admin"
  | "moderation"
  | "logout"
  | "menu"
  | "close"
  | "themeLight"
  | "themeDark"
  | "star";

interface EmojiPair {
  /** Emoji shown when `active` is false (or unspecified). */
  default: string;
  /** Emoji shown when `active` is true, if it differs (e.g. the bottom tab bar's filled/outline pair). */
  active?: string;
}

const EMOJI: Record<IconName, EmojiPair> = {
  home: { default: "🏡", active: "🏠" },
  search: { default: "🔍" },
  moments: { default: "⚡" },
  tweets: { default: "🐦" },
  answers: { default: "❓" },
  forum: { default: "🗨️" },
  quests: { default: "🎯" },
  games: { default: "🕹️", active: "🎮" },
  blogs: { default: "✍️" },
  polls: { default: "📊" },
  quizzes: { default: "🧠" },
  business: { default: "🏢" },
  ads: { default: "📢" },
  rooms: { default: "🚪" },
  guilds: { default: "🏰" },
  guild: { default: "🛡️" },
  messages: { default: "💬" },
  friends: { default: "👥" },
  gifts: { default: "🎁" },
  wallet: { default: "🪙" },
  market: { default: "🏪" },
  notifications: { default: "🔔" },
  events: { default: "📅" },
  announcements: { default: "📬" },
  elder: { default: "🎓" },
  referrals: { default: "🔗" },
  classroom: { default: "🏫" },
  leaderboards: { default: "🏆" },
  seasons: { default: "🗓️" },
  council: { default: "⚖️" },
  communityNotes: { default: "📝" },
  nemesis: { default: "👻" },
  profile: { default: "👤" },
  settings: { default: "⚙️" },
  admin: { default: "🛡️" },
  moderation: { default: "🧭" },
  logout: { default: "🚪" },
  menu: { default: "☰" },
  close: { default: "✕" },
  themeLight: { default: "☀️" },
  themeDark: { default: "🌙" },
  star: { default: "⭐" },
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
  ["aria-hidden"]?: boolean;
}

interface IconPropsByName extends IconPropsBase {
  name: IconName;
  emoji?: undefined;
  /** Filled/active variant — swaps the emoji glyph (e.g. home/games tab icons) or bumps stroke weight for mono. Only applies to `name`. */
  active?: boolean;
}

interface IconPropsByEmoji extends IconPropsBase {
  name?: undefined;
  /** A raw UI-chrome emoji character, e.g. "🎁". Looked up in shared/utils/emojiIconMap.ts — see that file's header for which emoji must NEVER be passed here (game content, flags, avatar-picker options). */
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
  const { iconSet } = useSiteTheme();
  const ariaHidden = props["aria-hidden"] ?? true;

  if (iconSet === "mono") {
    let LucideComponent: LucideIcon | undefined;
    if (props.name) {
      LucideComponent = LUCIDE[props.name];
    } else {
      const lucideName = EMOJI_TO_LUCIDE_NAME[props.emoji];
      LucideComponent = lucideName ? LUCIDE_BY_NAME[lucideName] : undefined;
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
