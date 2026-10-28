-- Transactional (not CONCURRENTLY): schedule a write-maintenance window.
-- The leading user_id preserves existing lookup support; conversation_id
-- covers getConversationIds. Keep the UNIQUE(conversation_id,user_id).
CREATE INDEX "conversation_members_user_conversation_idx" ON "conversation_members" USING btree ("user_id","conversation_id");
--> statement-breakpoint
-- id supplies cursor filtering/order; username covers the directory projection.
-- The primary key and username uniqueness constraints are unchanged.
CREATE INDEX "users_directory_id_username_idx" ON "users" USING btree ("id","username");
--> statement-breakpoint
-- Avoid maintaining redundant narrow and covering user-prefix indexes.
DROP INDEX "conversation_members_user_id_idx";