CREATE TABLE "github_identities" (
	"github_user_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "github_identities_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "github_oauth_attempts" (
	"session_id" varchar PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"verifier" text NOT NULL,
	"link_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_identities" ADD CONSTRAINT "github_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_oauth_attempts" ADD CONSTRAINT "github_oauth_attempts_session_id_user_sessions_sid_fk" FOREIGN KEY ("session_id") REFERENCES "public"."user_sessions"("sid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_oauth_attempts" ADD CONSTRAINT "github_oauth_attempts_link_user_id_users_id_fk" FOREIGN KEY ("link_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_oauth_attempts_expiry_idx" ON "github_oauth_attempts" USING btree ("expires_at");