CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  next_dispatch_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  last_error text,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_message_unique UNIQUE (message_id)
);
--> statement-breakpoint
CREATE INDEX notification_outbox_pending_idx ON notification_outbox(next_dispatch_at) WHERE status = 'pending';
--> statement-breakpoint
-- Existing messages were accepted before the outbox protocol. Do not replay old
-- history as new notifications; retain a completed intent tombstone instead.
INSERT INTO notification_outbox(message_id, status, completed_at, last_error)
SELECT id, 'completed', now(), 'LEGACY_NO_DISPATCH' FROM messages;
