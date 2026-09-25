import { clientAccountService } from "@repo/core";
import { readJson, withMobileClient } from "../../../../lib/api";

// ─── /api/mobile/push-token ───────────────────────────────────────────────────
// POST   → body: { token, language? } (Expo push token; the phone's app
//          language, "es" | "en", for the text of its pushes) → { success: true }
// DELETE → body: { token } → { success: true }; the app calls it on sign-out
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  return withMobileClient(request, async (client) =>
    clientAccountService.registerPushToken(client.tenantId, client.sub, await readJson(request)),
  );
}

export async function DELETE(request: Request) {
  return withMobileClient(request, async (client) =>
    clientAccountService.removePushToken(client.tenantId, client.sub, await readJson(request)),
  );
}
