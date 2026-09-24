import { vi } from "vitest";
import type { Ctx } from "@repo/core";

// Server actions resolve the caller with `getSessionContext()` from
// @repo/auth/context. Tests mock that module with
// `vi.mock("@repo/auth/context", () => sessionMock)`.

export const getSessionContext = vi.fn();
export const sessionMock = { getSessionContext };

export function signInAs(ctx: Ctx | null) {
  getSessionContext.mockResolvedValue(ctx);
}
