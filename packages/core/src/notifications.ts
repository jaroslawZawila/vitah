import { and, clientSettings, db, eq, inArray, projects, pushTokens, users } from "@repo/db";
import { settingsOf } from "./client-account";
import type { AppLanguage } from "./contract";
import { projectInTenant } from "./project-client";
import { sendPush } from "./push";

// ─── Client notifications ────────────────────────────────────────────────────
// Tells a project's client, on their phones, that staff shared something new.
// Respects the client's Perfil settings and never fails the caller: a push is
// a courtesy, the upload has already succeeded.
// ─────────────────────────────────────────────────────────────────────────────

export type ClientEvent =
  | { kind: "photo" }
  | { kind: "document"; title: string };

/** The notification's title and body, in the client's language. */
function text(language: AppLanguage, event: ClientEvent): [string, string] {
  const es = language === "es";
  if (event.kind === "photo") {
    return es
      ? ["Nuevas fotos de tu obra", "Tu equipo de ViTAH ha compartido fotos nuevas."]
      : ["New photos of your home", "Your ViTAH team has shared new photos."];
  }
  return es
    ? ["Nuevo documento", `«${event.title}» ya está en la app.`]
    : ["New document", `“${event.title}” is now in the app.`];
}

/** The app tab a tapped notification opens. */
const SCREEN: Record<ClientEvent["kind"], string> = { photo: "photos", document: "documents" };

export async function notifyProjectClient(tenantId: string, projectId: string, event: ClientEvent) {
  try {
    // One row per phone of the project's (active) client, with their toggles.
    const phones = await db
      .select({
        token: pushTokens.token,
        language: pushTokens.language,
        notifyProgress: clientSettings.notifyProgress,
        notifyDocuments: clientSettings.notifyDocuments,
        notifyMessages: clientSettings.notifyMessages,
      })
      .from(projects)
      .innerJoin(users, and(eq(users.id, projects.clientUserId), eq(users.active, true)))
      .innerJoin(pushTokens, eq(pushTokens.userId, users.id))
      .leftJoin(clientSettings, eq(clientSettings.userId, users.id))
      .where(projectInTenant(tenantId, projectId));
    const first = phones[0];
    if (!first) return;
    const { notifications } = settingsOf(first);
    if (!(event.kind === "photo" ? notifications.progress : notifications.documents)) return;

    const unregistered = await sendPush(
      phones.map(({ token, language }) => {
        const [title, body] = text(language as AppLanguage, event);
        return { to: token, title, body, data: { screen: SCREEN[event.kind] } };
      }),
    );
    if (unregistered.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, unregistered));
    }
  } catch (error) {
    console.error("Failed to notify the client of project", projectId, error);
  }
}
