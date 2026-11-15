import { and, clientSettings, db, eq, inArray, projects, pushTokens, sql, users } from "@repo/db";
import { fromCalendarDate } from "./calendar";
import { settingsOf } from "./client-account";
import { warrantyRef, type AppLanguage, type MobileSettings, type WarrantyStatus } from "./contract";
import { logError } from "./log";
import { projectInTenant } from "./project-client";
import { sendPush } from "./push";

// ─── Client notifications ────────────────────────────────────────────────────
// Tells a project's client, on their phones, that staff shared something new,
// moved the handover date or answered a warranty claim.
// Respects the client's Perfil settings and never fails the caller: a push is
// a courtesy, the upload has already succeeded.
// ─────────────────────────────────────────────────────────────────────────────

export type ClientEvent =
  | { kind: "photo" }
  | { kind: "document"; title: string }
  /** A new Planning baseline moved the handover the client is told. */
  | { kind: "delivery"; date: string }
  /** Staff ask the client to approve a change to the contract (budget-approvals.ts). */
  | { kind: "approval"; number: number }
  /**
   * Staff moved a warranty claim on (`status`, with the visit day once one is
   * scheduled) or only answered it. Falls under the "messages" toggle: it is
   * the site manager answering the client.
   */
  | { kind: "warranty"; claimId: string; number: number; status: WarrantyStatus | null; visitOn: string | null };

/** "23 de diciembre de 2026" / "23 December 2026". */
const longDate = (date: string, es: boolean) =>
  fromCalendarDate(date).toLocaleDateString(es ? "es-ES" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const WARRANTY_STATUS: Record<WarrantyStatus, [string, string]> = {
  received: ["está recibida", "has been received"],
  in_review: ["está en revisión", "is being reviewed"],
  scheduled: ["tiene visita programada", "has a visit scheduled"],
  resolved: ["está resuelta", "has been resolved"],
  rejected: ["no ha sido aceptada", "has not been accepted"],
  cancelled: ["está cancelada", "has been cancelled"],
};

function warrantyText(es: boolean, event: Extract<ClientEvent, { kind: "warranty" }>): [string, string] {
  const ref = warrantyRef(event.number);
  const title = es ? "Tu solicitud de garantía" : "Your warranty claim";
  if (event.status === "scheduled" && event.visitOn) {
    const day = longDate(event.visitOn, es);
    return [title, es ? `${ref}: te visitaremos el ${day}.` : `${ref}: we will visit you on ${day}.`];
  }
  if (event.status) {
    const [esText, enText] = WARRANTY_STATUS[event.status];
    return [title, es ? `${ref} ${esText}.` : `${ref} ${enText}.`];
  }
  return [title, es ? `Tu jefe de obra ha respondido a ${ref}.` : `Your site manager has answered ${ref}.`];
}

/** The notification's title and body, in the client's language. */
function text(language: AppLanguage, event: ClientEvent): [string, string] {
  const es = language === "es";
  if (event.kind === "photo") {
    return es
      ? ["Nuevas fotos de tu obra", "Tu equipo de ViTAH ha compartido fotos nuevas."]
      : ["New photos of your home", "Your ViTAH team has shared new photos."];
  }
  if (event.kind === "warranty") return warrantyText(es, event);
  if (event.kind === "delivery") {
    const date = longDate(event.date, es);
    return es
      ? ["Nueva fecha de entrega", `La entrega prevista de tu vivienda es ahora el ${date}.`]
      : ["New handover date", `Your home is now due to be handed over on ${date}.`];
  }
  if (event.kind === "approval") {
    return es
      ? ["Cambio para aprobar", `Tu equipo de ViTAH te pide que apruebes un cambio en tu presupuesto (Rev.${event.number}).`]
      : ["A change to approve", `Your ViTAH team asks you to approve a change to your budget (Rev.${event.number}).`];
  }
  return es
    ? ["Nuevo documento", `«${event.title}» ya está en la app.`]
    : ["New document", `“${event.title}” is now in the app.`];
}

/** The app tab a tapped notification opens. */
const SCREEN: Record<ClientEvent["kind"], string> = {
  photo: "photos",
  document: "documents",
  delivery: "obra",
  approval: "approval",
  warranty: "warranty",
};

/**
 * The Perfil toggle each event follows. "messages" is the team writing to the
 * client: a change to approve, and the answer to a warranty claim.
 */
const TOGGLE: Record<ClientEvent["kind"], keyof MobileSettings["notifications"]> = {
  photo: "progress",
  delivery: "progress",
  document: "documents",
  approval: "messages",
  warranty: "messages",
};

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
        homes: sql<number>`(select count(*) from ${projects} p where p.client_user_id = ${users.id} and p.deleted_at is null)`.mapWith(Number),
      })
      .from(projects)
      .innerJoin(users, and(eq(users.id, projects.clientUserId), eq(users.active, true)))
      .innerJoin(pushTokens, eq(pushTokens.userId, users.id))
      .leftJoin(clientSettings, eq(clientSettings.userId, users.id))
      .where(projectInTenant(tenantId, projectId));
    const first = phones[0];
    if (!first) return;
    const { notifications } = settingsOf(first);
    if (!notifications[TOGGLE[event.kind]]) return;
    const named = first.homes > 1;

    const unregistered = await sendPush(
      phones.map(({ token, language }) => {
        const [title, body] = text(language as AppLanguage, event);
        return {
          to: token,
          title: named ? `${title} · ${first.ref}` : title,
          body,
          // A warranty push opens its claim.
          data: { screen: SCREEN[event.kind], projectId, ...(event.kind === "warranty" ? { claimId: event.claimId } : {}) },
        };
      }),
    );
    if (unregistered.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, unregistered));
    }
  } catch (error) {
    logError("notifications.push_failed", error, { projectId });
  }
}
