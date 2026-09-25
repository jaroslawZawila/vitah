import { clientAccountService } from "@repo/core";
import { readJson, withMobileClient } from "../../../../lib/api";

// ─── /api/mobile/settings ─────────────────────────────────────────────────────
// GET → MobileSettings { notifications: { progress, documents, messages } }
// PUT → body: { notifications: any subset of those flags } → the new MobileSettings
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, (client) =>
    clientAccountService.getSettings(client.tenantId, client.sub),
  );
}

export async function PUT(request: Request) {
  return withMobileClient(request, async (client) =>
    clientAccountService.updateSettings(client.tenantId, client.sub, await readJson(request)),
  );
}
