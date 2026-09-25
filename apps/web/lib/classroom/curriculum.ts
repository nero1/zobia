/**
 * lib/classroom/curriculum.ts
 *
 * Curriculum modules (lessons) live in rooms.curriculum as
 * `{ "modules": [ { id, title, ... } ] }` (normalised by migration 0003).
 * Every module carries a stable string `id` so lesson completion
 * (classroom_lesson_completions) survives reordering/edits.
 *
 * Visibility:
 *   - visitors see the outline (title + description) only;
 *   - members see content/resources/video unless the module is level-locked
 *     (`unlockLevel` > their classroom level — Skool-style content unlocks);
 *   - the creator, moderators and staff always see everything.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { badRequest, notFound } from "@/lib/api/errors";
import { CLASSROOM_MAX_LEVEL } from "@/lib/classroom/levels";
import { sanitizeBlogPostHtml } from "@/lib/security/htmlSanitizer";
import { awardClassroomPoints, type PointsAwardResult } from "@/lib/classroom/gamification";

export interface CurriculumModule {
  id: string;
  title: string;
  description?: string;
  /** Lesson body (plain text / markdown). */
  content?: string;
  /** Optional lesson video (YouTube, Vimeo, Loom, ...). */
  videoUrl?: string;
  resources?: string[];
  /** Minimum classroom level required to open this lesson (1 = everyone). */
  unlockLevel?: number;
}

const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL");

export const moduleInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  content: z.string().max(20_000).optional(),
  videoUrl: httpsUrl.optional().or(z.literal("")),
  resources: z.array(httpsUrl).max(20).optional(),
  unlockLevel: z.number().int().min(1).max(CLASSROOM_MAX_LEVEL).optional(),
});
export type ModuleInput = z.infer<typeof moduleInputSchema>;

export const MAX_MODULES = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse rooms.curriculum (object or legacy bare array) into typed modules. */
export function parseModules(curriculum: unknown): CurriculumModule[] {
  const list = Array.isArray(curriculum)
    ? curriculum
    : isRecord(curriculum) && Array.isArray(curriculum.modules)
      ? curriculum.modules
      : [];
  const out: CurriculumModule[] = [];
  for (const raw of list) {
    if (!isRecord(raw) || typeof raw.title !== "string") continue;
    out.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
      title: raw.title,
      ...(typeof raw.description === "string" && raw.description ? { description: raw.description } : {}),
      ...(typeof raw.content === "string" && raw.content ? { content: raw.content } : {}),
      ...(typeof raw.videoUrl === "string" && raw.videoUrl ? { videoUrl: raw.videoUrl } : {}),
      ...(Array.isArray(raw.resources)
        ? { resources: raw.resources.filter((r): r is string => typeof r === "string") }
        : {}),
      ...(typeof raw.unlockLevel === "number" && raw.unlockLevel > 1 ? { unlockLevel: raw.unlockLevel } : {}),
    });
  }
  return out;
}

/** Build a stored module from validated input, keeping (or minting) its id. */
export function buildModule(input: ModuleInput, id?: string): CurriculumModule {
  return {
    id: id ?? randomUUID(),
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.content ? { content: input.content } : {}),
    ...(input.videoUrl ? { videoUrl: input.videoUrl } : {}),
    ...(input.resources && input.resources.length > 0 ? { resources: input.resources } : {}),
    ...(input.unlockLevel && input.unlockLevel > 1 ? { unlockLevel: input.unlockLevel } : {}),
  };
}

export interface ModuleView extends CurriculumModule {
  locked: boolean;
  completed: boolean;
  /**
   * Lesson body rendered server-side (Markdown → sanitized HTML, the same
   * allow-list as blog posts) so web and Android render identical, safe markup.
   */
  contentHtml?: string;
}

function withRenderedContent(m: CurriculumModule): Pick<ModuleView, "contentHtml"> {
  return m.content ? { contentHtml: sanitizeBlogPostHtml(m.content) } : {};
}

/**
 * Shape modules for a viewer. `fullAccess` = creator/moderator/staff;
 * `memberLevel` null = not a member (outline only).
 */
export function viewModules(
  modules: CurriculumModule[],
  opts: { fullAccess: boolean; memberLevel: number | null; completedIds?: Set<string> }
): ModuleView[] {
  return modules.map((m) => {
    const completed = opts.completedIds?.has(m.id) ?? false;
    if (opts.fullAccess) return { ...m, ...withRenderedContent(m), locked: false, completed };
    const levelLocked = (m.unlockLevel ?? 1) > (opts.memberLevel ?? 0);
    if (opts.memberLevel === null || levelLocked) {
      // Outline only: never leak lesson content/resources to non-members or
      // members below the unlock level.
      return {
        id: m.id,
        title: m.title,
        ...(m.description ? { description: m.description } : {}),
        ...(m.unlockLevel ? { unlockLevel: m.unlockLevel } : {}),
        locked: true,
        completed,
      };
    }
    return { ...m, ...withRenderedContent(m), locked: false, completed };
  });
}

/** Persist the full module list back to rooms.curriculum (always the object shape). */
export async function saveModules(
  roomId: string,
  modules: CurriculumModule[],
  client?: DbOrTx
): Promise<void> {
  if (modules.length > MAX_MODULES) throw badRequest(`A classroom can have at most ${MAX_MODULES} modules`);
  const orm = client ?? (await getDb());
  const modulesJson = JSON.stringify(modules);
  await orm
    .update(schema.rooms)
    .set({
      curriculum: sql`CASE
              WHEN ${schema.rooms.curriculum} IS NULL OR jsonb_typeof(${schema.rooms.curriculum}) <> 'object'
                THEN jsonb_build_object('modules', ${modulesJson}::jsonb)
              ELSE jsonb_set(${schema.rooms.curriculum}, '{modules}', ${modulesJson}::jsonb)
            END`,
      updatedAt: new Date(),
    })
    .where(eq(schema.rooms.id, roomId));
}

export async function getCompletedModuleIds(roomId: string, userId: string): Promise<Set<string>> {
  const orm = await getDb();
  const rows = await orm
    .select({ moduleId: schema.classroomLessonCompletions.moduleId })
    .from(schema.classroomLessonCompletions)
    .where(and(eq(schema.classroomLessonCompletions.roomId, roomId), eq(schema.classroomLessonCompletions.userId, userId)));
  return new Set(rows.map((r) => r.moduleId));
}

export interface LessonCompletionResult {
  completed: boolean;
  alreadyCompleted: boolean;
  completedCount: number;
  totalCount: number;
  awards: PointsAwardResult[];
}

/**
 * Mark a lesson complete for a member, awarding lesson points (and course
 * points once every lesson is done) in the same transaction.
 */
export async function completeLesson(
  params: {
    roomId: string;
    userId: string;
    moduleId: string;
    memberLevel: number;
    fullAccess: boolean;
    classroom: { slug: string | null; name: string };
  }
): Promise<LessonCompletionResult> {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const [roomRow] = await tx
      .select({ curriculum: schema.rooms.curriculum })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, params.roomId))
      .for("share");
    const modules = parseModules(roomRow?.curriculum);
    const mod = modules.find((m) => m.id === params.moduleId);
    if (!mod) throw notFound("Lesson not found");
    if (!params.fullAccess && (mod.unlockLevel ?? 1) > params.memberLevel) {
      throw badRequest(`This lesson unlocks at level ${mod.unlockLevel}`, "CLASSROOM_LESSON_LOCKED");
    }

    const ins = await tx
      .insert(schema.classroomLessonCompletions)
      .values({ roomId: params.roomId, userId: params.userId, moduleId: params.moduleId })
      .onConflictDoNothing({
        target: [
          schema.classroomLessonCompletions.roomId,
          schema.classroomLessonCompletions.userId,
          schema.classroomLessonCompletions.moduleId,
        ],
      })
      .returning({ moduleId: schema.classroomLessonCompletions.moduleId });
    const newlyCompleted = ins.length > 0;

    const moduleIds = modules.map((m) => m.id);
    const [countRow] = await tx
      .select({ n: sql<string>`COUNT(*)` })
      .from(schema.classroomLessonCompletions)
      .where(
        and(
          eq(schema.classroomLessonCompletions.roomId, params.roomId),
          eq(schema.classroomLessonCompletions.userId, params.userId),
          sql`${schema.classroomLessonCompletions.moduleId} = ANY(${moduleIds}::text[])`
        )
      );
    const completedCount = Number(countRow?.n ?? 0);

    const awards: PointsAwardResult[] = [];
    if (newlyCompleted) {
      await tx
        .update(schema.classroomEnrolments)
        .set({ lastActiveAt: new Date() })
        .where(and(eq(schema.classroomEnrolments.roomId, params.roomId), eq(schema.classroomEnrolments.userId, params.userId)));
      awards.push(
        await awardClassroomPoints(
          {
            roomId: params.roomId,
            userId: params.userId,
            source: "lesson_completed",
            referenceId: params.moduleId,
            xpReferenceId: `lesson:${params.roomId}:${params.moduleId}`,
            classroom: params.classroom,
          },
          tx
        )
      );
      if (modules.length > 0 && completedCount >= modules.length) {
        awards.push(
          await awardClassroomPoints(
            {
              roomId: params.roomId,
              userId: params.userId,
              source: "course_completed",
              referenceId: "course",
              xpReferenceId: `course:${params.roomId}`,
              classroom: params.classroom,
            },
            tx
          )
        );
        await tx
          .update(schema.classroomEnrolments)
          .set({ completedAt: sql`COALESCE(${schema.classroomEnrolments.completedAt}, NOW())` })
          .where(and(eq(schema.classroomEnrolments.roomId, params.roomId), eq(schema.classroomEnrolments.userId, params.userId)));
      }
    }

    return {
      completed: true,
      alreadyCompleted: !newlyCompleted,
      completedCount,
      totalCount: modules.length,
      awards,
    };
  });
}

/** Un-mark a lesson (does not claw back points — completions are a progress aid). */
export async function uncompleteLesson(roomId: string, userId: string, moduleId: string): Promise<void> {
  const orm = await getDb();
  await orm
    .delete(schema.classroomLessonCompletions)
    .where(
      and(
        eq(schema.classroomLessonCompletions.roomId, roomId),
        eq(schema.classroomLessonCompletions.userId, userId),
        eq(schema.classroomLessonCompletions.moduleId, moduleId)
      )
    );
}
