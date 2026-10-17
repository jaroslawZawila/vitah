import { subcontractorsService } from "@repo/core";
import { fileResponse, withContext } from "../../../../../lib/api";

// GET /api/v1/subcontractors/dossier?projectId=&subcontractorId= → the CAE dossier (ZIP)

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return withContext(request, async (ctx) =>
    fileResponse(
      await subcontractorsService.exportDossier(ctx, {
        projectId: params.get("projectId"),
        subcontractorId: params.get("subcontractorId"),
      }),
      { download: true },
    ),
  );
}
