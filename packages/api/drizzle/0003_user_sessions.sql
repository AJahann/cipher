-- Adopt existing connect-pg-simple tables without deleting active sessions.
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" USING btree ("expire");