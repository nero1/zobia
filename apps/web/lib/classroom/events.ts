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
import { db } from "@/lib/db";
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
  starts_at: string;
  ends_at: string | null;
  meeting_url: string | null;
  recording_url: string | null;
  recording_added_at: string | null;
}

/** Sessions with no end time are treated as 1 hour long for the live/ended badge. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function toView(r: EventRow, memberAccess: boolean): ClassroomEventView {
  const start = new Date(r.starts_at).getTime();
  const end = r.ends_at ? new Date(r.ends_at).getTime() : start + DEFAULT_DURATION_MS;
  const now = Date.now();
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    meetingUrl: memberAccess ? r.meeting_url : null,
    recordingUrl: memberAccess ? r.recording_url : null,
    hasMeetingUrl: !!r.meeting_url,
    hasRecording: !!r.recording_url,
    recordingAddedAt: r.recording_added_at ? new Date(r.recording_added_at).toISOString() : null,
    status: now < start ? "upcoming" : now <= end ? "live" : "ended",
  };
}

export async function listEvents(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  scope: "upcoming" | "past" | "all" = "all"
): Promise<ClassroomEventView[]> {
  const filter =
    scope === "upcoming"
      ? "AND COALESCE(ends_at, starts_at + INTERVAL '1 hour') >= NOW()"
      : scope === "past"
        ? "AND COALESCE(ends_at, starts_at + INTERVAL '1 hour') < NOW()"
        : "";
  const order = scope === "past" ? "starts_at DESC" : "starts_at ASC";
  const { rows } = await db.query<EventRow>(
    `SELECT id, title, description, starts_at, ends_at, meeting_url, recording_url, recording_added_at
       FROM classroom_events
      WHERE room_id = $1 AND deleted_at IS NULL ${filter}
      ORDER BY ${order}
      LIMIT 200`,
    [classroom.id]
  );
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
  const { rows } = await db.query<EventRow>(
    `INSERT INTO classroom_events
       (room_id, title, description, starts_at, ends_at, meeting_url, recording_url, recording_added_at, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE NOW() END, $8, NOW(), NOW())
     RETURNING id, title, description, starts_at, ends_at, meeting_url, recording_url, recording_added_at`,
    [
      classroom.id,
      input.title,
      input.description?.trim() || null,
      input.startsAt,
      input.endsAt ?? null,
      normaliseLink(input.meetingUrl),
      recordingUrl,
      viewer.userId,
    ]
  );
  const event = toView(rows[0]!, true);

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
  const { rows: existingRows } = await db.query<EventRow>(
    `SELECT id, title, description, starts_at, ends_at, meeting_url, recording_url, recording_added_at
       FROM classroom_events WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
    [eventId, classroom.id]
  );
  const existing = existingRows[0];
  if (!existing) throw notFound("Session not found");

  const startsAt = patch.startsAt ?? new Date(existing.starts_at).toISOString();
  const endsAt =
    patch.endsAt !== undefined ? patch.endsAt : existing.ends_at ? new Date(existing.ends_at).toISOString() : null;
  assertTimes(startsAt, endsAt);

  const recordingChanged = patch.recordingUrl !== undefined;
  const newRecording = recordingChanged ? normaliseLink(patch.recordingUrl) : existing.recording_url;
  const addedRecording = recordingChanged && !!newRecording && newRecording !== existing.recording_url;

  const { rows } = await db.query<EventRow>(
    `UPDATE classroom_events
        SET title = $3, description = $4, starts_at = $5, ends_at = $6, meeting_url = $7,
            recording_url = $8,
            recording_added_at = CASE WHEN $8::text IS NULL THEN NULL
                                      WHEN $9::boolean THEN NOW()
                                      ELSE recording_added_at END,
            updated_at = NOW()
      WHERE id = $1 AND room_id = $2
      RETURNING id, title, description, starts_at, ends_at, meeting_url, recording_url, recording_added_at`,
    [
      eventId,
      classroom.id,
      patch.title ?? existing.title,
      patch.description !== undefined ? patch.description?.trim() || null : existing.description,
      startsAt,
      endsAt,
      patch.meetingUrl !== undefined ? normaliseLink(patch.meetingUrl) : existing.meeting_url,
      newRecording,
      addedRecording,
    ]
  );

  if (addedRecording) {
    notifyMembers(
      classroom,
      viewer.userId,
      "classroom_recording_added",
      `🎬 Recording available in ${classroom.name}`,
      `The recording for "${rows[0]!.title}" is ready to watch or download.`,
      { eventId }
    ).catch((err) => logger.warn({ err, roomId: classroom.id }, "[classroom:events] recording fan-out failed"));
  }

  return toView(rows[0]!, true);
}

export async function deleteEvent(classroom: ClassroomRecord, eventId: string): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE classroom_events SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
    [eventId, classroom.id]
  );
  if (rowCount === 0) throw notFound("Session not found");
}
