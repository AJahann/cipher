ALTER TABLE "conversations" ADD COLUMN "direct_key" text;
--> statement-breakpoint
WITH dm_keys AS (
  SELECT
    cm.conversation_id,
    'dm:' || string_agg(cm.user_id::text, ':' ORDER BY cm.user_id::text) AS direct_key,
    c.created_at
  FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  GROUP BY cm.conversation_id, c.created_at
  HAVING COUNT(*) = 2
), ranked AS (
  SELECT
    conversation_id,
    direct_key,
    ROW_NUMBER() OVER (PARTITION BY direct_key ORDER BY created_at, conversation_id) AS rank
  FROM dm_keys
)
UPDATE conversations c
SET direct_key = ranked.direct_key
FROM ranked
WHERE c.id = ranked.conversation_id AND ranked.rank = 1;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_direct_key_unique" UNIQUE("direct_key");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "client_message_id" uuid;
--> statement-breakpoint
UPDATE "messages" SET "client_message_id" = "id" WHERE "client_message_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "client_message_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_client_message_id_unique" UNIQUE("sender_id", "client_message_id");
