import type { ClientListItem } from "@repo/core/contract";

// Pure formatting helpers shared by the client views.

export function displayName(client: ClientListItem): string {
  const name = [client.firstName, client.surnames].filter(Boolean).join(" ");
  return name || client.email;
}

/** Calendar date (YYYY-MM-DD) → Date at UTC midnight, for formatting. */
export function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}
