"use server";

import { revalidatePath } from "next/cache";
import {
  createProjectClient,
  normalizeEmail,
  resetProjectClientPassword,
  revokeProjectClient,
  type ProjectClientError,
  type Result,
} from "@repo/core";
import { logActivity } from "../../lib/activity";
import { requireAdmin } from "../../lib/session";

// Server actions behind the "Client app access" card on the project page.

export type ClientAccessState = { error?: ProjectClientError; success?: boolean } | null;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Logs and revalidates on success; maps the result to form state. */
async function finish(
  result: Result,
  projectId: string,
  activity: { tenantId: string; userId: string; action: string; detail: string },
): Promise<ClientAccessState> {
  if (!result.ok) return { error: result.error };

  const { tenantId, userId, action, detail } = activity;
  await logActivity(tenantId, projectId, userId, action, detail);
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { success: true };
}

export async function createProjectClientAction(
  projectId: string,
  _prevState: ClientAccessState,
  formData: FormData,
): Promise<ClientAccessState> {
  const { tenantId, userId } = await requireAdmin();
  const email = field(formData, "email");

  const result = await createProjectClient(tenantId, projectId, {
    name: field(formData, "name"),
    email,
    password: field(formData, "password"),
  });

  return finish(result, projectId, {
    tenantId,
    userId,
    action: "client_access_granted",
    detail: `Acceso a la app concedido a ${normalizeEmail(email)}`,
  });
}

export async function resetProjectClientPasswordAction(
  projectId: string,
  _prevState: ClientAccessState,
  formData: FormData,
): Promise<ClientAccessState> {
  const { tenantId, userId } = await requireAdmin();

  const result = await resetProjectClientPassword(tenantId, projectId, field(formData, "password"));

  return finish(result, projectId, {
    tenantId,
    userId,
    action: "client_password_reset",
    detail: "Contraseña de la app restablecida",
  });
}

export async function revokeProjectClientAction(projectId: string): Promise<ClientAccessState> {
  const { tenantId, userId } = await requireAdmin();

  const result = await revokeProjectClient(tenantId, projectId);

  return finish(result, projectId, {
    tenantId,
    userId,
    action: "client_access_revoked",
    detail: "Acceso a la app revocado",
  });
}
