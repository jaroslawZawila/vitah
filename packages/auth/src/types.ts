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
  }
}
