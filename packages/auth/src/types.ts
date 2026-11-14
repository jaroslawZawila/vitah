import "next-auth";
import "next-auth/jwt";
import type { UserRole } from "@repo/db";

declare module "next-auth" {
  interface User {
    role?: UserRole;
    tenantId?: string;
    /** Whether this sign-in passed two-step verification (see JWT.mfa). */
    mfa?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    tenantId?: string;
    /** When the user was last found active (ms); see ./session.ts. */
    checkedAt?: number;
    /** When this session signed in with the password (ms); see ./session.ts. */
    authAt?: number;
    /**
     * This session signed in with a two-step verification code as well as the
     * password. Absent for an account without it, and for a session from before
     * its user switched it on. For features that must require it; nothing does yet.
     */
    mfa?: boolean;
  }
}
