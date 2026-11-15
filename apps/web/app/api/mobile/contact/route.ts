import { contactService } from "@repo/core";
import { projectParam, withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/contact ──────────────────────────────────────────────────
// The app's Contacto: the site manager of the signed-in client's home
// (`?projectId=`, else the default one) and the builder's office →
// MobileContact, each part null when not given. 404 `project_not_found` for a
// project that isn't theirs. Requires `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, (client) =>
    contactService.getClientContact(client.tenantId, client.sub, projectParam(request)),
  );
}
