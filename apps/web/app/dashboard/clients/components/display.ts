import type { ClientListItem } from "@repo/core/contract";

// Pure formatting helpers shared by the client views.

export function displayName(client: ClientListItem): string {
  const name = [client.firstName, client.surnames].filter(Boolean).join(" ");
  return name || client.email;
}
