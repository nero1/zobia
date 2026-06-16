/**
 * shared/schemas/api/notifications.ts
 *
 * Shared Zod schemas for notification API endpoints.
 *
 * ARCH-CONTRACT-01: Single source of truth for notification request/response
 * shapes used by web route handlers and Expo API client.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Notification entity
// ---------------------------------------------------------------------------

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  metadata: z.record(z.unknown()).nullable().optional(),
  is_read: z.boolean(),
  created_at: z.string(),
  read_at: z.string().nullable().optional(),
});

export type Notification = z.infer<typeof NotificationSchema>;

// ---------------------------------------------------------------------------
// List notifications
// ---------------------------------------------------------------------------

export const NotificationsListResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  unread_count: z.number().int().nonnegative(),
  cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});

export type NotificationsListResponse = z.infer<
  typeof NotificationsListResponseSchema
>;

// ---------------------------------------------------------------------------
// Mark as read
// ---------------------------------------------------------------------------

export const MarkNotificationsReadRequestSchema = z
  .object({
    notificationIds: z
      .array(z.string().uuid())
      .min(1, "At least one notification ID is required")
      .optional(),
    /** If true, mark ALL unread notifications as read. */
    all: z.boolean().optional(),
  })
  .refine((d) => d.notificationIds !== undefined || d.all === true, {
    message: "Either notificationIds or all=true is required",
  });

export type MarkNotificationsReadRequest = z.infer<
  typeof MarkNotificationsReadRequestSchema
>;
