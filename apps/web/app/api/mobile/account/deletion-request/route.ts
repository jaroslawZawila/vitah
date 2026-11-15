import { clientAccountService } from "@repo/core";
import { withMobileClient } from "../../../../../lib/api";

// ─── /api/mobile/account/deletion-request ────────────────────────────────────
// The client asks for their account to be deleted (the stores ask for this in
// the app). Only a request: the builder sees it on Clientes and handles it.
// POST   → DeletionRequest { deletionRequestedAt } (asking again keeps the first date)
// DELETE → DeletionRequest { deletionRequestedAt: null } (withdrawn; none to withdraw is fine)
// GET /api/mobile/settings carries `deletionRequestedAt` too.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  return withMobileClient(request, (client) =>
    clientAccountService.requestDeletion(client.tenantId, client.sub),
  );
}

export async function DELETE(request: Request) {
  return withMobileClient(request, (client) =>
    clientAccountService.withdrawDeletion(client.tenantId, client.sub),
  );
}
