/**
 * lib/classroom/home.ts
 *
 * Builds the classroom homepage payload (GET /api/classroom/[roomId]) — the
 * single call the /c/<slug> page and the Android classroom screen make on
 * open. Everything member-only is filtered here by the viewer's role.
 */

import type { ClassroomContext } from "@/lib/classroom/access";
import { getCompletedModuleIds, parseModules, viewModules, type ModuleView } from "@/lib/classroom/curriculum";
import { getMemberStanding, type MemberStanding } from "@/lib/classroom/gamification";
import { listEvents, type ClassroomEventView } from "@/lib/classroom/events";
import { listModerators, type ClassroomModeratorView } from "@/lib/classroom/members";
import { levelName, type ClassroomSettings } from "@/lib/classroom/settings";
import { CLASSROOM_LEVEL_THRESHOLDS } from "@/lib/classroom/levels";

export interface ClassroomHomePayload {
  classroom: {
    id: string;
    slug: string | null;
    name: string;
    description: string | null;
    category: string | null;
    coverEmoji: string;
    coverImageUrl: string | null;
    creator: { id: string; username: string; displayName: string; avatarEmoji: string; avatarUrl: string | null };
    isPublic: boolean;
    isActive: boolean;
    publishedAt: string | null;
    chatRoomEnabled: boolean;
    enrolmentFeeNgn: number;
    memberCount: number;
    classStartDate: string | null;
    classEndDate: string | null;
    showInCreatorListing: boolean;
    postCategories: string[];
    postingPolicy: ClassroomSettings["postingPolicy"];
    levels: Array<{ level: number; name: string; minPoints: number }>;
    createdAt: string;
  };
  viewer: ClassroomContext["viewer"];
  modules: ModuleView[];
  progress: { completed: number; total: number } | null;
  standing: MemberStanding | null;
  upcomingEvents: ClassroomEventView[];
  moderators: ClassroomModeratorView[];
  /** Full settings — creator/staff only. */
  settings: ClassroomSettings | null;
}

export async function buildClassroomHome(ctx: ClassroomContext): Promise<ClassroomHomePayload> {
  const { classroom, viewer } = ctx;
  const insider = viewer.can.viewMemberContent;
  const fullAccess = viewer.isCreator || viewer.isModerator || viewer.isStaff;

  const [standing, completedIds, events, moderators] = await Promise.all([
    viewer.userId && insider ? getMemberStanding(classroom.id, viewer.userId) : Promise.resolve(null),
    viewer.userId && insider ? getCompletedModuleIds(classroom.id, viewer.userId) : Promise.resolve(new Set<string>()),
    listEvents(classroom, viewer, "upcoming"),
    insider ? listModerators(classroom.id) : Promise.resolve([]),
  ]);

  const modules = parseModules(classroom.curriculum);
  const views = viewModules(modules, {
    fullAccess,
    memberLevel: insider ? (standing?.level ?? 1) : null,
    completedIds,
  });
  const completed = views.filter((m) => m.completed).length;

  return {
    classroom: {
      id: classroom.id,
      slug: classroom.slug,
      name: classroom.name,
      description: classroom.description,
      category: classroom.category,
      coverEmoji: classroom.coverEmoji,
      coverImageUrl: classroom.coverImageUrl,
      creator: {
        id: classroom.creatorId,
        username: classroom.creatorUsername,
        displayName: classroom.creatorDisplayName,
        avatarEmoji: classroom.creatorAvatarEmoji,
        avatarUrl: classroom.creatorAvatarUrl,
      },
      isPublic: classroom.isPublic,
      isActive: classroom.isActive,
      publishedAt: classroom.publishedAt,
      chatRoomEnabled: classroom.settings.chatRoomEnabled,
      enrolmentFeeNgn: classroom.enrolmentFeeNgn,
      memberCount: classroom.memberCount,
      classStartDate: classroom.classStartDate,
      classEndDate: classroom.classEndDate,
      showInCreatorListing: classroom.showInCreatorListing,
      postCategories: classroom.settings.postCategories,
      postingPolicy: classroom.settings.postingPolicy,
      levels: CLASSROOM_LEVEL_THRESHOLDS.map((min, i) => ({
        level: i + 1,
        name: levelName(classroom.settings, i + 1),
        minPoints: min,
      })),
      createdAt: new Date(classroom.createdAt).toISOString(),
    },
    viewer,
    modules: views,
    progress: viewer.isEnrolled ? { completed, total: modules.length } : null,
    standing,
    upcomingEvents: events.slice(0, 5),
    moderators,
    settings: viewer.can.manageClassroom ? classroom.settings : null,
  };
}
