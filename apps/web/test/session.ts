import { vi } from "vitest";
import type { UserRole } from "@repo/db";

// Server code reads the session through `auth()` from apps/web/auth.ts.
// Tests mock that module with `vi.mock("<path>/auth", () => authMock)`.

export const auth = vi.fn();
export const authMock = { auth };

export function signInAs(user: { id: string; tenantId: string; role: UserRole } | null) {
  auth.mockResolvedValue(user ? { user } : null);
}
