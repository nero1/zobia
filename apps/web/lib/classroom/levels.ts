/**
 * lib/classroom/levels.ts
 *
 * Pure, dependency-free rules for the per-classroom gamification sub-system:
 * point values per activity, the 9-level ladder, and the badge catalog.
 * Shared by the service layer (lib/classroom/gamification.ts) and unit tests.
 *
 * Classroom points live only inside their classroom (classroom_points_ledger
 * / classroom_member_points). Each rule also names a smaller global
 * Knowledge-track XP bonus so classroom engagement still counts toward the
 * member's platform-wide profile.
 */

/** Minimum points for levels 1..9 (Skool-style curve). */
export const CLASSROOM_LEVEL_THRESHOLDS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015] as const;

export const CLASSROOM_MAX_LEVEL = CLASSROOM_LEVEL_THRESHOLDS.length;

export function levelForPoints(points: number): number {
  let level = 1;
  for (let i = 0; i < CLASSROOM_LEVEL_THRESHOLDS.length; i++) {
    if (points >= CLASSROOM_LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  points: number;
  currentLevelMin: number;
  nextLevelMin: number | null;
  pointsToNextLevel: number | null;
  /** 0-100, progress through the current level. 100 at the max level. */
  percent: number;
}

export function levelProgress(points: number): LevelProgress {
  const safe = Math.max(0, Math.floor(points));
  const level = levelForPoints(safe);
  const currentLevelMin = CLASSROOM_LEVEL_THRESHOLDS[level - 1];
  const nextLevelMin = level < CLASSROOM_MAX_LEVEL ? CLASSROOM_LEVEL_THRESHOLDS[level] : null;
  const percent =
    nextLevelMin === null
      ? 100
      : Math.min(100, Math.floor(((safe - currentLevelMin) / (nextLevelMin - currentLevelMin)) * 100));
  return {
    level,
    points: safe,
    currentLevelMin,
    nextLevelMin,
    pointsToNextLevel: nextLevelMin === null ? null : nextLevelMin - safe,
    percent,
  };
}

/**
 * Point + global Knowledge XP value per classroom activity.
 * `quiz_passed` carries no extra Knowledge XP: passing a quiz already awards
 * the quiz's own xp_reward on the Knowledge track.
 */
export const CLASSROOM_POINT_RULES = {
  like_received: { points: 1, knowledgeXp: 1 },
  like_removed: { points: -1, knowledgeXp: 0 },
  lesson_completed: { points: 2, knowledgeXp: 5 },
  quiz_passed: { points: 5, knowledgeXp: 0 },
  course_completed: { points: 10, knowledgeXp: 25 },
} as const;

export type ClassroomPointSource = keyof typeof CLASSROOM_POINT_RULES;

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type ClassroomBadgeKey =
  | "first_post"
  | "conversation_starter"
  | "helpful"
  | "community_star"
  | "first_lesson"
  | "course_complete"
  | "quiz_ace"
  | "rising_star"
  | "legend";

export interface ClassroomBadgeDef {
  key: ClassroomBadgeKey;
  emoji: string;
  /** English fallback; clients translate via `classroom.badges.<key>.name`. */
  name: string;
  description: string;
}

export const CLASSROOM_BADGES: Record<ClassroomBadgeKey, ClassroomBadgeDef> = {
  first_post: { key: "first_post", emoji: "✍️", name: "First Post", description: "Started your first discussion." },
  conversation_starter: { key: "conversation_starter", emoji: "💬", name: "Conversation Starter", description: "Started 10 discussions." },
  helpful: { key: "helpful", emoji: "👍", name: "Helpful", description: "Received 10 likes." },
  community_star: { key: "community_star", emoji: "🌟", name: "Community Star", description: "Received 100 likes." },
  first_lesson: { key: "first_lesson", emoji: "📖", name: "First Lesson", description: "Completed your first lesson." },
  course_complete: { key: "course_complete", emoji: "🎓", name: "Course Complete", description: "Completed every lesson." },
  quiz_ace: { key: "quiz_ace", emoji: "💯", name: "Quiz Ace", description: "Scored 100% on a quiz." },
  rising_star: { key: "rising_star", emoji: "🚀", name: "Rising Star", description: "Reached level 5." },
  legend: { key: "legend", emoji: "👑", name: "Legend", description: "Reached the top level." },
};

export interface BadgeSignals {
  postCount?: number;
  likesReceived?: number;
  lessonsCompleted?: number;
  courseCompleted?: boolean;
  perfectQuiz?: boolean;
  level?: number;
}

/** Which badges the given signals qualify for (pure). */
export function badgesForSignals(s: BadgeSignals): ClassroomBadgeKey[] {
  const out: ClassroomBadgeKey[] = [];
  if ((s.postCount ?? 0) >= 1) out.push("first_post");
  if ((s.postCount ?? 0) >= 10) out.push("conversation_starter");
  if ((s.likesReceived ?? 0) >= 10) out.push("helpful");
  if ((s.likesReceived ?? 0) >= 100) out.push("community_star");
  if ((s.lessonsCompleted ?? 0) >= 1) out.push("first_lesson");
  if (s.courseCompleted) out.push("course_complete");
  if (s.perfectQuiz) out.push("quiz_ace");
  if ((s.level ?? 1) >= 5) out.push("rising_star");
  if ((s.level ?? 1) >= CLASSROOM_MAX_LEVEL) out.push("legend");
  return out;
}
