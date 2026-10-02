-- Duplicate membership rows made a user appear twice in a conversation and
-- double-counted members. Keep one arbitrary row per (conversation, user):
-- `a.id > b.id` compares random v4 UUIDs, which says nothing about insertion
-- order. That is only safe because duplicates here are identical apart from
-- `id`; where rows differ, pick the survivor by an explicit column instead.
DELETE FROM "conversation_members" a
USING "conversation_members" b
WHERE a.conversation_id = b.conversation_id
  AND a.user_id = b.user_id
  AND a.id > b.id;
--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_user_id_unique" UNIQUE("conversation_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_members_user_id_idx" ON "conversation_members" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_created_id_idx" ON "messages" USING btree ("conversation_id","created_at","id");
