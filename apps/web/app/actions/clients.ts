"use server";

// Thin portal adapters over @repo/core (packages/core/src/clients.ts).

import { CoreError, clientsService as svc, type ClientError, type Ctx } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { revalidatePath } from "next/cache";

export type ClientFormState = { error?: ClientError; success?: boolean } | null;

export async function getClients() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.role !== "admin") return [];
  return svc.listClients(ctx);
}

/** Runs a core mutation; returns `{ error: code }` for expected failures. */
async function mutate(fn: (ctx: Ctx) => Promise<unknown>): Promise<ClientFormState> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  try {
    await fn(ctx);
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as ClientError };
    throw err;
  }
  revalidatePath("/dashboard/clients");
  return { success: true };
}

export async function createClientAction(
  _prevState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  return mutate((ctx) => svc.createClient(ctx, Object.fromEntries(formData)));
}

export async function setClientPasswordAction(
  clientId: string,
  _prevState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  return mutate((ctx) => svc.setClientPassword(ctx, clientId, Object.fromEntries(formData)));
}
