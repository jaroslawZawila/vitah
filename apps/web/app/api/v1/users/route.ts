import { usersService } from "@repo/core";
import { readJson, withContext } from "../../../../lib/api";

// Admin only (403 otherwise).
// GET  /api/v1/users → UserListItem[]
// POST /api/v1/users → { id }

export function GET(request: Request) {
  return withContext(request, (ctx) => usersService.listUsers(ctx));
}

export function POST(request: Request) {
  return withContext(
    request,
    async (ctx) => usersService.createUser(ctx, await readJson(request)),
    201,
  );
}
