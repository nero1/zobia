/**
 * shared/utils/emojiIconMap.ts
 *
 * Maps raw UI-chrome emoji (buttons, badges, status indicators, section
 * headers, empty states, toasts, admin panels, etc.) to the matching
 * `lucide-react` export name, for the "Pro (Black & White)" icon set
 * (see shared/utils/uiThemes.ts ICON_SET_IDS). Framework-agnostic on
 * purpose — this file has no React/lucide-react dependency, just a string
 * table — so both apps/web/components/ui/Icon.tsx and
 * apps/android/src/components/ui/Icon.tsx can share ONE mapping instead of
 * maintaining two, each importing the actual lucide component objects
 * itself and indexing into them by the name string this file returns.
 *
 * `<Icon emoji="🏠" />` looks up `EMOJI_TO_LUCIDE_NAME["🏠"]` → `"Home"`.
 * An emoji with no entry here renders as the plain emoji character in BOTH
 * icon sets (never a broken/missing icon) — that is the correct, safe
 * behavior for emoji that are deliberately excluded below, not a gap to
 * "finish" by force-mapping them.
 *
 * DELIBERATELY EXCLUDED — these are CONTENT, not icons, and must never be
 * looked up here or swapped for a monochrome icon, because the emoji IS the
 * feature, not a decoration of it:
 *  - Default avatar emoji (shared/utils/defaultAvatars.ts DEFAULT_AVATAR_EMOJIS)
 *    and any other user-selectable "pick an emoji as your identity" list.
 *  - Country flag emoji (🇳🇬🇬🇭🇰🇪 etc.) used as country-selector content
 *    (e.g. phone number country picker) — the flag *is* the selected value.
 *  - Game content: chess pieces (♔♕♖♗♘♙♚♛♜♝♞♟), playing-card suits
 *    (♠♥♦♣) in card games (Blackjack/Whot), dice faces (⚀⚁⚂⚃⚄⚅), snake/
 *    fruit-slicer food emoji, memory-match/emoji-quiz/word-guess answer
 *    keys (including multi-emoji combo strings like "🦁👑" or "🍕🇮🇹" —
 *    those are literal puzzle answers, never icons), flag-quiz country
 *    flags, and any other game engine's emoji-as-gameplay-data.
 *  - Animal/food/nature emoji used as the above game content or as
 *    avatar/sticker *options* a user picks from (as opposed to a single
 *    fixed icon meaning e.g. "user profile").
 *
 * A file doing this migration should read this comment before treating an
 * unmapped emoji as a bug — check whether it's UI chrome (map it) or
 * content (leave it as a raw emoji character, unconditionally, in both
 * icon sets).
 */

export const EMOJI_TO_LUCIDE_NAME: Record<string, string> = {
  // Navigation / arrows
  "→": "ArrowRight",
  "←": "ArrowLeft",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "↗": "ArrowUpRight",
  "↖": "ArrowUpLeft",
  "↘": "ArrowDownRight",
  "↙": "ArrowDownLeft",
  "↔": "ArrowLeftRight",
  "↳": "CornerDownRight",
  "↵": "CornerDownLeft",
  "↩️": "Undo2",
  "🔁": "Repeat",
  "🔄": "RefreshCw",
  "🔀": "Shuffle",
  "▶": "Play",
  "▶️": "Play",
  "◀": "ChevronLeft",
  "▲": "ChevronUp",
  "▼": "ChevronDown",
  "⬆": "ArrowUp",
  "⬇": "ArrowDown",
  "➡️": "ArrowRight",
  "☰": "Menu",
  "✕": "X",
  "✗": "X",
  "❌": "XCircle",
  "✓": "Check",
  "✅": "CheckCircle2",
  "✚": "Plus",

  // Status / feedback
  "🔥": "Flame",
  "⚡": "Zap",
  "🎉": "PartyPopper",
  "✨": "Sparkles",
  "🌟": "Sparkle",
  "💫": "Sparkles",
  "⚠️": "AlertTriangle",
  "⚠": "AlertTriangle",
  "🚨": "Siren",
  "🚩": "Flag",
  "🚫": "Ban",
  "⭕": "CircleOff",
  "🔴": "Circle",
  "🟡": "Circle",
  "🟢": "Circle",
  "🔵": "Circle",
  "🟦": "Square",
  "🔺": "Triangle",
  "●": "Circle",
  "○": "Circle",
  "◼": "Square",
  "ℹ️": "Info",
  "💡": "Lightbulb",
  "⏳": "Hourglass",
  "⏱": "Timer",
  "⏱️": "Timer",
  "⏰": "AlarmClock",
  "🕐": "Clock",

  // People / social
  "👤": "User",
  "👥": "Users",
  "🤝": "Handshake",
  "🧑": "User",
  "👑": "Crown",
  "👋": "Hand",
  "👍": "ThumbsUp",
  "👎": "ThumbsDown",
  "👏": "PartyPopper",
  "🙂": "Smile",
  "😊": "Smile",
  "😔": "Frown",
  "😕": "Frown",
  "🤔": "HelpCircle",
  "🤖": "Bot",
  "👮": "ShieldCheck",
  "🕵️": "Search",

  // Communication
  "💬": "MessageCircle",
  "🗨️": "MessageSquare",
  "📢": "Megaphone",
  "📣": "Megaphone",
  "🔔": "Bell",
  "🔕": "BellOff",
  "📬": "Inbox",
  "📭": "Inbox",
  "📨": "Mail",
  "✉️": "Mail",
  "📧": "Mail",
  "📡": "Radio",

  // Money / commerce
  "🪙": "Coins",
  "💰": "Wallet",
  "💸": "Banknote",
  "💳": "CreditCard",
  "💱": "ArrowLeftRight",
  "🧾": "Receipt",
  "🛍️": "ShoppingBag",
  "🛒": "ShoppingCart",
  "🏪": "Store",
  "🏬": "Store",
  "🎫": "Ticket",
  "🎟️": "Ticket",
  "👛": "Wallet",
  "🪪": "IdCard",

  // Achievement / gamification
  "⭐": "Star",
  "★": "Star",
  "☆": "Star",
  "🏆": "Trophy",
  "🥇": "Medal",
  "🥈": "Medal",
  "🥉": "Medal",
  "🏅": "Award",
  "🎯": "Target",
  "💯": "Sparkles",
  "⚜️": "Award",
  "🎖️": "Award",

  // Content types
  "📚": "BookOpen",
  "📖": "BookOpen",
  "📝": "FileEdit",
  "✍️": "PenLine",
  "📊": "BarChart3",
  "📈": "TrendingUp",
  "📉": "TrendingDown",
  "📋": "Clipboard",
  "📄": "FileText",
  "📁": "Folder",
  "🗂️": "FolderOpen",
  "🗄": "Archive",
  "🗄️": "Archive",
  "🗑": "Trash2",
  "🗑️": "Trash2",
  "📦": "Package",
  "📌": "Pin",
  "📍": "MapPin",
  "🌐": "Globe",
  "🌍": "Globe",
  "🔗": "Link2",
  "🖼️": "Image",
  "📷": "Camera",
  "🎨": "Palette",
  "🎵": "Music",
  "🎙️": "Mic",
  "🎬": "Film",
  "📼": "Video",

  // Places / sections
  "🏠": "Home",
  "🏡": "Home",
  "🏢": "Building2",
  "🏛️": "Landmark",
  "🏛": "Landmark",
  "🏰": "Landmark",
  "🏫": "School",
  "🎓": "GraduationCap",
  "🚪": "DoorOpen",
  "🧭": "Compass",

  // Actions / tools
  "🔍": "Search",
  "⚙️": "Settings",
  "🛠️": "Wrench",
  "🚧": "Construction",
  "🔧": "Wrench",
  "🔐": "Lock",
  "🔒": "Lock",
  "🔓": "Unlock",
  "🖱️": "MousePointer",
  "💾": "Save",
  "🔊": "Volume2",
  "🔇": "VolumeX",
  "⏸": "Pause",
  "✏️": "Pencil",

  // Misc icons used as UI chrome
  "🎁": "Gift",
  "🎮": "Gamepad2",
  "🕹️": "Gamepad2",
  "❓": "HelpCircle",
  "👁": "Eye",
  "👁️": "Eye",
  "🙈": "EyeOff",
  "🚀": "Rocket",
  "⚔️": "Swords",
  "⚖️": "Scale",
  "🐦": "Rss",
  "💻": "Laptop",
  "📱": "Smartphone",
  "🌙": "Moon",
  "☀️": "Sun",
  "☀": "Sun",
  "📅": "Calendar",
  "🗓️": "CalendarDays",
  "🗳️": "Vote",
  "🗺️": "Map",
  "🧠": "Brain",
  "❤️": "Heart",
  "🤍": "Heart",
  "💎": "Gem",
  "🔷": "Diamond",
  "🌈": "Sparkles",
};

/** Look up the lucide-react export name for a UI-chrome emoji, or undefined if it isn't mapped (render the emoji as-is in that case — see the file header on why an unmapped emoji is not a bug). */
export function lucideNameForEmoji(emoji: string): string | undefined {
  return EMOJI_TO_LUCIDE_NAME[emoji];
}
