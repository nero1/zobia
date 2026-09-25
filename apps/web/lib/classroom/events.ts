/**
 * lib/classroom/events.ts
 *
 * Scheduled live sessions for a classroom. Sessions run on an external
 * platform (Zoom, Google Meet, Teams, YouTube Live, ...) — the classroom just
 * stores the meeting URL and, after the session, a link to its recording.
 *
 * Meeting and recording links are member-only: visitors see the schedule
 * (title/time) but never the URLs, so paid access can't be bypassed by
 * reading a public page.
 */

import { z } from "zod";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { badRequest, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import type { ClassroomRecord, ClassroomViewer } from "@/lib/classroom/access";
import { notifyMembers } from "@/lib/classroom/community";

const linkSchema = z
  .string()
  .trim()
  .url()
  .max(1000)
  .refine((u) => /^https:\/\//i.test(u), "Links must use https://");

export const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  meetingUrl: linkSchema.optional().nullable().or(z.literal("")),
  recordingUrl: linkSchema.optional().nullable().or(z.literal("")),
});
export type EventInput = z.infer<typeof eventInputSchema>;
export const eventPatchSchema = eventInputSchema.partial();

export interface ClassroomEventView {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  /** Null for visitors. */
  meetingUrl: string | null;
  /** Null for visitors, and until the creator/moderator adds one. */
  recordingUrl: string | null;
  hasMeetingUrl: boolean;
  hasRecording: boolean;
  recordingAddedAt: string | null;
  status: "upcoming" | "live" | "ended";
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  meetingUrl: string | null;
  recordingUrl: string | null;
  recordingAddedAt: Date | null;
}

/** Sessions with no end time are treated as 1 hour long for the live/ended badge. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function toView(r: EventRow, memberAccess: boolean): ClassroomEventView {
  const start = new Date(r.startsAt).getTime();
  const end = r.endsAt ? new Date(r.endsAt).getTime() : start + DEFAULT_DURATION_MS;
  const now = Date.now();
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    startsAt: new Date(r.startsAt).toISOString(),
    endsAt: r.endsAt ? new Date(r.endsAt).toISOString() : null,
    meetingUrl: memberAccess ? r.meetingUrl : null,
    recordingUrl: memberAccess ? r.recordingUrl : null,
    hasMeetingUrl: !!r.meetingUrl,
    hasRecording: !!r.recordingUrl,
    recordingAddedAt: r.recordingAddedAt ? new Date(r.recordingAddedAt).toISOString() : null,
    status: now < start ? "upcoming" : now <= end ? "live" : "ended",
  };
}

const EVENT_COLUMNS = {
  id: schema.classroomEvents.id,
  title: schema.classroomEvents.title,
  description: schema.classroomEvents.description,
  startsAt: schema.classroomEvents.startsAt,
  endsAt: schema.classroomEvents.endsAt,
  meetingUrl: schema.classroomEvents.meetingUrl,
  recordingUrl: schema.classroomEvents.recordingUrl,
  recordingAddedAt: schema.classroomEvents.recordingAddedAt,
};

export async function listEvents(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  scope: "upcoming" | "past" | "all" = "all"
): Promise<ClassroomEventView[]> {
  const orm = await getDb();
  const cutoff = sql`COALESCE(${schema.classroomEvents.endsAt}, ${schema.classroomEvents.startsAt} + INTERVAL '1 hour')`;
  const conditions = [eq(schema.classroomEvents.roomId, classroom.id), isNull(schema.classroomEvents.deletedAt)];
  if (scope === "upcoming") {
    conditions.push(gte(cutoff, sql`NOW()`));
  } else if (scope === "past") {
    conditions.push(lt(cutoff, sql`NOW()`));
  }

  const rows = await orm
    .select(EVENT_COLUMNS)
    .from(schema.classroomEvents)
    .where(and(...conditions))
    .orderBy(scope === "past" ? desc(schema.classroomEvents.startsAt) : asc(schema.classroomEvents.startsAt))
    .limit(200);

  return rows.map((r) => toView(r, viewer.can.viewMemberContent));
}

function normaliseLink(v: string | null | undefined): string | null {
  return v && v.trim() ? v.trim() : null;
}

function assertTimes(startsAt: string, endsAt: string | null | undefined): void {
  if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw badRequest("The end time must be after the start time.");
  }
}

export async function createEvent(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  input: EventInput
): Promise<ClassroomEventView> {
  assertTimes(input.startsAt, input.endsAt);
  const recordingUrl = normaliseLink(input.recordingUrl);
  const orm = await getDb();
  const [row] = await orm
    .insert(schema.classroomEvents)
    .values({
      roomId: classroom.id,
      title: input.title,
      description: input.description?.trim() || null,
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      meetingUrl: normaliseLink(input.meetingUrl),
      recordingUrl,
      recordingAddedAt: recordingUrl ? new Date() : null,
      createdBy: viewer.userId,
    })
    .returning(EVENT_COLUMNS);
  const event = toView(row!, true);

  notifyMembers(
    classroom,
    viewer.userId,
    "classroom_event_scheduled",
    `📅 New live session in ${classroom.name}`,
    `${input.title} — ${new Date(input.startsAt).toUTCString()}`,
    { eventId: event.id }
  ).catch((err) => logger.warn({ err, roomId: classroom.id }, "[classroom:events] schedule fan-out failed"));

  return event;
}

export async function updateEvent(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  eventId: string,
  patch: z.infer<typeof eventPatchSchema>
): Promise<ClassroomEventView> {
  const orm = await getDb();
  const [existing] = await orm
    .select(EVENT_COLUMNS)
    .from(schema.classroomEvents)
    .where(
      and(
        eq(schema.classroomEvents.id, eventId),
        eq(schema.classroomEvents.roomId, classroom.id),
        isNull(schema.classroomEvents.deletedAt)
      )
    )
    .limit(1);
  if (!existing) throw notFound("Session not found");

  const startsAt = patch.startsAt ?? new Date(existing.startsAt).toISOString();
  const endsAt =
    patch.endsAt !== undefined ? patch.endsAt : existing.endsAt ? new Date(existing.endsAt).toISOString() : null;
  assertTimes(startsAt, endsAt);

  const recordingChanged = patch.recordingUrl !== undefined;
  const newRecording = recordingChanged ? normaliseLink(patch.recordingUrl) : existing.recordingUrl;
  const addedRecording = recordingChanged && !!newRecording && newRecording !== existing.recordingUrl;

  const [row] = await orm
    .update(schema.classroomEvents)
    .set({
      title: patch.title ?? existing.title,
      description: patch.description !== undefined ? patch.description?.trim() || null : existing.description,
      startsAt: new Date(startsAt),
      endsAt: endsAt ? new Date(endsAt) : null,
      meetingUrl: patch.meetingUrl !== undefined ? normaliseLink(patch.meetingUrl) : existing.meetingUrl,
      recordingUrl: newRecording,
      recordingAddedAt: newRecording === null ? null : addedRecording ? new Date() : existing.recordingAddedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.classroomEvents.id, eventId), eq(schema.classroomEvents.roomId, classroom.id)))
    .returning(EVENT_COLUMNS);

  if (addedRecording) {
    notifyMembers(
      classroom,
      viewer.userId,
      "classroom_recording_added",
      `🎬 Recording available in ${classroom.name}`,
      `The recording for "${row!.title}" is ready to watch or download.`,
      { eventId }
    ).catch((err) => logger.warn({ err, roomId: classroom.id }, "[classroom:events] recording fan-out failed"));
  }

  return toView(row!, true);
}

export async function deleteEvent(classroom: ClassroomRecord, eventId: string): Promise<void> {
  const orm = await getDb();
  const result = await orm
    .update(schema.classroomEvents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.classroomEvents.id, eventId),
        eq(schema.classroomEvents.roomId, classroom.id),
        isNull(schema.classroomEvents.deletedAt)
      )
    )
    .returning({ id: schema.classroomEvents.id });
  if (result.length === 0) throw notFound("Session not found");
}
