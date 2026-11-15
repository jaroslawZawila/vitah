import { contactService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// Admins and managers (403 otherwise). The site manager the client's app shows on Contacto.
// GET /api/v1/projects/:id/site-manager → ProjectSiteManager { siteManager, options }
// PUT /api/v1/projects/:id/site-manager  body { userId } (null: none) → { projectId, userId }

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => contactService.getProjectSiteManager(ctx, id));
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => contactService.setSiteManager(ctx, id, await readJson(request)));
}
