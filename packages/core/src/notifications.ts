import { and, clientSettings, db, eq, inArray, projects, pushTokens, sql, users } from "@repo/db";
import { fromCalendarDate } from "./calendar";
import { settingsOf } from "./client-account";
import type { AppLanguage } from "./contract";
import { projectInTenant } from "./project-client";
import { sendPush } from "./push";

// ─── Client notifications ────────────────────────────────────────────────────
// Tells a project's client, on their phones, that staff shared something new
// or moved the handover date.
// Respects the client's Perfil settings and never fails the caller: a push is
// a courtesy, the upload has already succeeded.
// ─────────────────────────────────────────────────────────────────────────────

export type ClientEvent =
  | { kind: "photo" }
  | { kind: "document"; title: string }
  /** A new Planning baseline moved the handover the client is told. */
  | { kind: "delivery"; date: string };

/** The notification's title and body, in the client's language. */
function text(language: AppLanguage, event: ClientEvent): [string, string] {
  const es = language === "es";
  if (event.kind === "photo") {
    return es
      ? ["Nuevas fotos de tu obra", "Tu equipo de ViTAH ha compartido fotos nuevas."]
      : ["New photos of your home", "Your ViTAH team has shared new photos."];
  }
  if (event.kind === "delivery") {
    const date = fromCalendarDate(event.date).toLocaleDateString(es ? "es-ES" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return es
      ? ["Nueva fecha de entrega", `La entrega prevista de tu vivienda es ahora el ${date}.`]
      : ["New handover date", `Your home is now due to be handed over on ${date}.`];
  }
  return es
    ? ["Nuevo documento", `«${event.title}» ya está en la app.`]
    : ["New document", `“${event.title}” is now in the app.`];
}

/** The app tab a tapped notification opens. */
const SCREEN: Record<ClientEvent["kind"], string> = { photo: "photos", document: "documents", delivery: "obra" };

/**
 * A client with several homes is told which one: its ref after the title. The
 * push carries the project's id, and tapping it opens the app on that home.
 */
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
        ref: projects.ref,
        homes: sql<number>`(select count(*) from ${projects} p where p.client_user_id = ${users.id})`.mapWith(Number),
      })
      .from(projects)
      .innerJoin(users, and(eq(users.id, projects.clientUserId), eq(users.active, true)))
      .innerJoin(pushTokens, eq(pushTokens.userId, users.id))
      .leftJoin(clientSettings, eq(clientSettings.userId, users.id))
      .where(projectInTenant(tenantId, projectId));
    const first = phones[0];
    if (!first) return;
    const { notifications } = settingsOf(first);
    if (!(event.kind === "document" ? notifications.documents : notifications.progress)) return;
    const named = first.homes > 1;

    const unregistered = await sendPush(
      phones.map(({ token, language }) => {
        const [title, body] = text(language as AppLanguage, event);
        return {
          to: token,
          title: named ? `${title} · ${first.ref}` : title,
          body,
          data: { screen: SCREEN[event.kind], projectId },
        };
      }),
    );
    if (unregistered.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, unregistered));
    }
  } catch (error) {
    console.error("Failed to notify the client of project", projectId, error);
  }
}
