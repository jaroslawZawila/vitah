import "next-auth";
import "next-auth/jwt";
import type { UserRole } from "@repo/db";

declare module "next-auth" {
  interface User {
    role?: UserRole;
    tenantId?: string;
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
  }
}
