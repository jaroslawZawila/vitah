import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { documentsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// POST (@vercel/blob/client's upload protocol): a token for the browser to
// upload a budget input straight to the private store, past the 4.5 MB cap
// on function bodies. The portal then registers it (../register).

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => {
    const body = (await readJson(request)) as unknown as HandleUploadBody;
    return handleUpload({
      body,
      request,
      onBeforeGenerateToken: (pathname) => documentsService.authorizeBudgetInputUpload(ctx, id, pathname),
    });
  });
}
