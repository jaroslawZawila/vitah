"use server";

// Thin portal adapters over @repo/core (packages/core/src/clients.ts).

import { CoreError, clientsService as svc, type ClientError, type Ctx } from "@repo/core";
import { revalidatePath } from "next/cache";
import { requireSession } from "../../lib/access";
import { read } from "./run";

export type ClientFormState = { error?: ClientError; success?: boolean } | null;

/** The app's clients (admins only: anyone else gets the "No tienes permiso" page). */
export async function getClients() {
  return (await read((ctx) => svc.listClients(ctx)))?.data ?? [];
}

/** Runs a core mutation; returns `{ error: code }` for expected failures. */
async function mutate(fn: (ctx: Ctx) => Promise<unknown>): Promise<ClientFormState> {
  const ctx = await requireSession();
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
