-- 0033_support_tickets.sql
--
-- Support Ticket System.
--
-- New sitewide staff role: `is_support` (grantable exactly like `is_moderator`
-- today, see app/api/admin/users/[userId]/actions/route.ts), plus a
-- `is_senior_support` flag that can additionally be set on any support,
-- moderator, or admin account (escalation target).
--
-- Tickets carry their own status/assignment; a lightweight audit table
-- (support_ticket_events) records every status/assignment change instead of
-- a separate escalation table, per the "no table sprawl" guidance.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_support boolean DEFAULT false NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_senior_support boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_support ON users USING btree (is_support) WHERE (is_support = true);
CREATE INDEX IF NOT EXISTS idx_users_is_senior_support ON users USING btree (is_senior_support) WHERE (is_senior_support = true);

-- support_tickets
CREATE TABLE IF NOT EXISTS support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject text NOT NULL,
    status text DEFAULT 'open' NOT NULL,
    priority text DEFAULT 'normal' NOT NULL,
    assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
    is_ai_handled boolean DEFAULT false NOT NULL,
    ai_resolved boolean DEFAULT false NOT NULL,
    -- Populated when a ticket is created from a Help Center "Ask AI" transcript
    -- (Feature 2) so the first human responder has full context.
    source text DEFAULT 'ticket' NOT NULL,
    source_help_doc_id uuid,
    charged_credits integer DEFAULT 0 NOT NULL,
    charged_stars integer DEFAULT 0 NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT support_tickets_status_check CHECK (status = ANY (ARRAY['open'::text, 'pending'::text, 'escalated'::text, 'resolved'::text, 'closed'::text])),
    CONSTRAINT support_tickets_priority_check CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])),
    CONSTRAINT support_tickets_source_check CHECK (source = ANY (ARRAY['ticket'::text, 'help_center_ai'::text]))
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets USING btree (user_id, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets USING btree (status, last_activity_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets USING btree (assigned_to, status) WHERE (deleted_at IS NULL AND assigned_to IS NOT NULL);

-- support_ticket_messages
CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    -- sender_id is NULL for AI-authored messages (sender_type = 'ai')
    sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
    sender_type text DEFAULT 'user' NOT NULL,
    body text NOT NULL,
    charged boolean DEFAULT false NOT NULL,
    charged_credits integer DEFAULT 0 NOT NULL,
    charged_stars integer DEFAULT 0 NOT NULL,
    -- true once shown to the ticket owner (internal staff-only notes are out
    -- of scope for v1 — every message is visible to the ticket owner).
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_ticket_messages_sender_type_check CHECK (sender_type = ANY (ARRAY['user'::text, 'staff'::text, 'ai'::text]))
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages USING btree (ticket_id, created_at ASC);

-- support_ticket_events — audit trail for status changes, assignment,
-- escalation, and AI hand-off. Keeps escalation modeled as ticket state +
-- an event log rather than a dedicated escalation table.
CREATE TABLE IF NOT EXISTS support_ticket_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    from_value text,
    to_value text,
    note text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_ticket_events_type_check CHECK (event_type = ANY (ARRAY[
        'created'::text, 'status_changed'::text, 'assigned'::text, 'escalated'::text,
        'ai_response'::text, 'ai_rejected'::text, 'message_added'::text, 'charged'::text
    ]))
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_events_ticket ON support_ticket_events USING btree (ticket_id, created_at ASC);

-- x_manifest seed defaults for the Support Ticket System (safe no-ops if a
-- key already exists — ON CONFLICT DO NOTHING so re-running never clobbers
-- an admin's saved value).
INSERT INTO x_manifest (key, value, description) VALUES
    ('feature_support_tickets', 'false', 'Master on/off switch for the Support Ticket System.'),
    ('feature_help_center_ai', 'true', '"Ask AI" block on Help Center doc pages. Independent of feature_support_tickets.'),
    ('support_ai_triage_enabled', 'true', 'When true, a new ticket first gets an AI-generated response before reaching the human queue.'),
    ('support_eligible_plans', '["plus","pro","max"]', 'JSON array of plan slugs (and/or prestige_N entries) that can create tickets for free. Read via lib/plans/eligibility.ts.'),
    ('support_ticket_cost_credits', '0', 'One-time credits charged to create a ticket for users not covered by support_eligible_plans. 0 = not chargeable in credits.'),
    ('support_ticket_cost_stars', '0', 'One-time stars charged to create a ticket for users not covered by support_eligible_plans. 0 = not chargeable in stars.'),
    ('support_charging_model', 'first_message_only', 'One of: first_message_only | every_message | every_x_messages | first_x_messages.'),
    ('support_charging_x', '1', 'The X parameter for every_x_messages / first_x_messages charging models.'),
    ('support_staff_roles', '["support","moderator","admin"]', 'JSON array of roles ("support","moderator","admin") permitted to view/respond to the ticket queue.')
ON CONFLICT (key) DO NOTHING;
