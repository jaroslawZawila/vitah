-- Two-step verification for staff (TOTP): one row per user who started
-- enrolling (packages/core/src/mfa.ts). Additive only; safe to re-run.
--
-- The row gates sign-in only once "confirmed_at" is set. "secret" is the TOTP
-- key encrypted with a key derived from NEXTAUTH_SECRET (mfa-secret.ts), never
-- the key itself; "recovery_codes" holds salted SHA-256 hashes
-- ([{ salt, hash, usedAt }]), never the codes; "last_step" is the last
-- 30-second step a code was accepted for, so a code is refused a second time.
--
-- The previous deployment never reads this table. The new one signs everyone
-- in as before until someone enrols.

CREATE TABLE IF NOT EXISTS "user_mfa" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "secret" text NOT NULL,
  "confirmed_at" timestamp,
  "recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_step" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
