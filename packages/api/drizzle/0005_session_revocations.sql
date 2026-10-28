CREATE TABLE "session_revocations" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);
