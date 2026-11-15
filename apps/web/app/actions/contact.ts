"use server";

// Thin portal adapters over @repo/core (packages/core/src/contact.ts): what the
// client's app shows on Contacto. A project's site manager (the "Jefe de obra"
// card on its General tab) and the office ("Contacto para clientes", admins).

import { contactService as svc, requireAdmin, type ContactError, type OfficeContact } from "@repo/core";
import { revalidatePath } from "next/cache";
import { mutate, read, type ActionState } from "./run";

/** The project's site manager and who may be one (admins and managers; anyone else: no card). */
export async function getSiteManager(projectId: string) {
  return (await read((ctx) => svc.getProjectSiteManager(ctx, projectId)))?.data ?? null;
}

/** The form's `userId` ("" for none). */
export async function setSiteManagerAction(
  projectId: string,
  _prevState: ActionState<ContactError>,
  formData: FormData,
): Promise<ActionState<ContactError>> {
  return mutate<ContactError>(projectId, (ctx) =>
    svc.setSiteManager(ctx, projectId, { userId: formData.get("userId") }),
  );
}

/** The office, for its page (admins only: anyone else gets the "No tienes permiso" page). */
export async function getOfficeContact(): Promise<OfficeContact | null> {
  return (
    (await read((ctx) => {
      requireAdmin(ctx);
      return svc.getOfficeContact(ctx);
    }))?.data ?? null
  );
}

/** The form's four fields; a blank one is cleared. */
export async function updateOfficeContactAction(
  _prevState: ActionState<ContactError>,
  formData: FormData,
): Promise<ActionState<ContactError>> {
  const state = await mutate<ContactError>(null, (ctx) => svc.updateOfficeContact(ctx, Object.fromEntries(formData)));
  if (state?.success) revalidatePath("/dashboard/contacto");
  return state;
}
