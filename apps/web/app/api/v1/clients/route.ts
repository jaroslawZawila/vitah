import { clientsService } from "@repo/core";
import { readJson, withContext } from "../../../../lib/api";

// Admin only (403 otherwise).
// GET  /api/v1/clients → ClientListItem[]
// POST /api/v1/clients body { firstName, surnames, email, password,
//                             dateOfBirth?, address?, phone? } → { id }

export function GET(request: Request) {
  return withContext(request, (ctx) => clientsService.listClients(ctx));
}

export function POST(request: Request) {
  return withContext(
    request,
    async (ctx) => clientsService.createClient(ctx, await readJson(request)),
    201,
  );
}
