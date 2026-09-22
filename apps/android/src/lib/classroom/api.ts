/**
 * apps/android/src/lib/classroom/api.ts
 *
 * Types + fetchers for the classroom community / LMS — mirrors the payloads
 * of apps/web's /api/classroom/** routes (lib/classroom/* on web). This app
 * doesn't import web code, so the shapes are declared here once and shared
 * by every classroom screen (hub, homepage, creator listing, studio).
 *
 * `apiClient`'s response interceptor already unwraps `{ success, data }`, so
 * every `res.data` below is the payload itself. React Query persists results
 * per signed-in user (lib/query), giving the screens offline-first reads.
 */

import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface ClassroomCard {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  coverEmoji: string;
  coverImageUrl: string | null;
  creatorId: string;
  creatorUsername: string;
  creatorDisplayName: string;
  enrolmentFeeNgn: number;
  memberCount: number;
  lessonCount: number;
  isActive: boolean;
  isPublic: boolean;
  showInCreatorListing: boolean;
  isEnrolled: boolean;
  isOwner: boolean;
  isPromoted: boolean;
}

export interface EnrolledClassroom {
  id: string;
  slug: string | null;
  title: string;
  coverEmoji: string;
  creatorName: string;
  lessonCount: number;
  completedLessons: number;
  quizScore: number | null;
  points: number;
  level: number;
  isActive: boolean;
}

export interface ClassroomCapabilities {
  viewMemberContent: boolean;
  createPost: boolean;
  comment: boolean;
  like: boolean;
  report: boolean;
  completeLessons: boolean;
  managePosts: boolean;
  manageMembers: boolean;
  manageEvents: boolean;
  handleReports: boolean;
  manageClassroom: boolean;
}

export interface ClassroomViewer {
  userId: string | null;
  role: 'staff' | 'creator' | 'moderator' | 'member' | 'visitor';
  isCreator: boolean;
  isModerator: boolean;
  isEnrolled: boolean;
  isStaff: boolean;
  mutedUntil: string | null;
  can: ClassroomCapabilities;
}

export interface ModuleView {
  id: string;
  title: string;
  description?: string;
  content?: string;
  contentHtml?: string;
  videoUrl?: string;
  resources?: string[];
  unlockLevel?: number;
  locked: boolean;
  completed: boolean;
}

export interface MemberStanding {
  level: number;
  points: number;
  pointsToNextLevel: number | null;
  percent: number;
  rank: number | null;
  badges: Array<{ key: string; awardedAt: string }>;
}

export interface ClassroomEvent {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  meetingUrl: string | null;
  recordingUrl: string | null;
  hasMeetingUrl: boolean;
  hasRecording: boolean;
  status: 'upcoming' | 'live' | 'ended';
}

export interface SlugPolicy {
  mode: 'paid' | 'free';
  freeChanges: number;
  costCredits: number;
  cooldownUnit: 'none' | 'days' | 'months';
  cooldownValue: number;
}

export interface ModeratorPermissions {
  managePosts: boolean;
  manageMembers: boolean;
  manageEvents: boolean;
  handleReports: boolean;
}

export interface ClassroomSettings {
  slugPolicy: SlugPolicy;
  levelNames: string[];
  postCategories: string[];
  postingPolicy: 'members' | 'moderators';
  moderatorPermissions: ModeratorPermissions;
}

export interface ClassroomHome {
  classroom: {
    id: string;
    slug: string | null;
    name: string;
    description: string | null;
    category: string | null;
    coverEmoji: string;
    coverImageUrl: string | null;
    creator: { id: string; username: string; displayName: string; avatarEmoji: string };
    isPublic: boolean;
    isActive: boolean;
    enrolmentFeeNgn: number;
    memberCount: number;
    classStartDate: string | null;
    classEndDate: string | null;
    showInCreatorListing: boolean;
    postCategories: string[];
    postingPolicy: 'members' | 'moderators';
    levels: Array<{ level: number; name: string; minPoints: number }>;
  };
  viewer: ClassroomViewer;
  modules: ModuleView[];
  progress: { completed: number; total: number } | null;
  standing: MemberStanding | null;
  upcomingEvents: ClassroomEvent[];
  moderators: Array<{ userId: string; username: string; avatarEmoji: string }>;
  settings: ClassroomSettings | null;
}

export interface Author {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  level: number;
  isCreator: boolean;
  isModerator: boolean;
}

export interface ClassroomPost {
  id: string;
  category: string;
  title: string | null;
  body: string;
  isPinned: boolean;
  isLocked: boolean;
  isHidden: boolean;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
  author: Author;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ClassroomComment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  isHidden: boolean;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
  author: Author;
  canDelete: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  points: number;
  level: number;
}

export interface Member {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  paid: boolean;
  mutedUntil: string | null;
  isModerator: boolean;
  points: number;
  level: number;
  lessonsCompleted: number;
}

export interface ClassroomReport {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  escalated: boolean;
  createdAt: string;
  reporter: { username: string };
  target: { kind: 'post' | 'comment'; id: string; body: string; author: { username: string } };
}

export interface SlugQuote {
  eligible: boolean;
  costCredits: number;
  freeChangesRemaining: number | null;
  nextEligibleAt: string | null;
  policy: SlugPolicy;
}

export interface SlugAvailability {
  slug: string;
  available: boolean;
  reason: 'invalid' | 'too_short' | 'reserved' | 'taken' | 'retired' | null;
}

export interface StudioRow {
  id: string;
  name: string;
  slug: string | null;
  coverEmoji: string;
  isActive: boolean;
  isPublic: boolean;
  showInCreatorListing: boolean;
  members: number;
  paidMembers: number;
  revenueAllTimeKobo: number;
  revenue30dKobo: number;
  activeMembers7d: number;
  pendingReports: number;
}

export interface StudioSummary {
  tier: 'basic' | 'more' | 'detailed';
  totals: {
    classrooms: number;
    activeClassrooms: number;
    members: number;
    paidMembers: number;
    revenueTodayKobo: number;
    revenueWeekKobo: number;
    revenueMonthKobo: number;
    revenueAllTimeKobo: number;
    pendingReports: number;
  };
  classrooms: StudioRow[];
  daily: Array<{ day: string; enrolments: number; revenueKobo: number }> | null;
  username: string | null;
  canWithdraw: boolean;
  availableEarningsKobo: number;
}

export interface ClassroomStats {
  tier: 'basic' | 'more' | 'detailed';
  basic: { members: number; paidMembers: number; revenueAllTimeKobo: number; posts: number; lessons: number; upcomingEvents: number; moderators: number };
  more: {
    newMembers7d: number;
    newMembers30d: number;
    activeMembers7d: number;
    revenue30dKobo: number;
    comments: number;
    likes: number;
    courseCompletions: number;
    lessonCompletionRate: number;
    quizAttempts: number;
    quizPassRate: number;
    shares: number;
    pageViews30d: number;
  } | null;
  detailed: {
    daily: Array<{ day: string; enrolments: number; revenueKobo: number; pageViews: number; posts: number }>;
    lessonFunnel: Array<{ moduleId: string; title: string; completions: number }>;
    topContributors: LeaderboardEntry[];
    viewToEnrolmentRate: number | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull `{ error: { code, message } }` out of an axios failure. */
export function apiError(err: unknown): { code: string | null; message: string } {
  if (isAxiosError(err)) {
    const body = err.response?.data as { error?: { code?: string; message?: string } | string; message?: string } | undefined;
    const e = body?.error;
    if (typeof e === 'string') return { code: null, message: e };
    return { code: e?.code ?? null, message: e?.message ?? body?.message ?? err.message };
  }
  return { code: null, message: err instanceof Error ? err.message : String(err) };
}

export function formatNgnKobo(kobo: number): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(kobo / 100);
}

export async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const { data } = await apiClient.get<T>(`/classroom${path}`, { params });
  return data;
}

export async function send<T>(method: 'post' | 'patch' | 'put' | 'delete', path: string, body?: unknown): Promise<T> {
  const { data } = await apiClient.request<T>({ method, url: `/classroom${path}`, data: body });
  return data;
}
