import { notFound, projectsService } from "@repo/core";
import { readJson, withContext } from "../../../../../lib/api";

// GET    /api/v1/projects/:id → ProjectWithRelations
// PATCH  /api/v1/projects/:id → { projectId }
// DELETE /api/v1/projects/:id → 204

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => {
    const project = await projectsService.getProject(ctx, id);
    if (!project) throw notFound();
    return project;
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) =>
    projectsService.updateProject(ctx, id, await readJson(request)),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => projectsService.deleteProject(ctx, id), 204);
}
