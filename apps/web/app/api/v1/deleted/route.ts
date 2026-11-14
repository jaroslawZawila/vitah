import { deletedService } from "@repo/core";
import { withContext } from "../../../../lib/api";

// GET /api/v1/deleted → { items, nextCursor, projects? }: what the tenant's
// users deleted (nothing is erased), newest deletion first. Admins only.
// Query: `kind` (project | document | photo | issue_file | assignment |
// order_document | invoice | payment), `projectId`, `limit` (50; 200 at most)
// and `cursor` (the last page's `nextCursor`). `projects`, the obras that have
// deleted records, comes with the first page.

export async function GET(request: Request) {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  return withContext(request, (ctx) => deletedService.listDeleted(ctx, query));
}
