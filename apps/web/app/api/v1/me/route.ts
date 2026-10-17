import { usersService } from "@repo/core";
import { readJson, withContext } from "../../../../lib/api";

// Any staff user, about themselves.
// GET   /api/v1/me → { id, name, email, role, language }
// PATCH /api/v1/me → same; body { language?: "es" | "en" | null } (the portal's
//   language; null follows the browser)

export function GET(request: Request) {
  return withContext(request, (ctx) => usersService.getMe(ctx));
}

export function PATCH(request: Request) {
  return withContext(request, async (ctx) => usersService.updateMe(ctx, await readJson(request)));
}
