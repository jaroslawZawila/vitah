// Sends push notifications through Expo's push service, which forwards them
// to Apple and Google. Tests swap this module for a spy.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100; // Expo's limit per request.

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  /** Read by the app when the notification is tapped. */
  data?: Record<string, string>;
};

type Ticket = { status: "ok" | "error"; details?: { error?: string } };

/** Sends the messages; returns the tokens Expo says are no longer registered. */
export async function sendPush(messages: PushMessage[]): Promise<string[]> {
  const unregistered: string[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(batch.map((m) => ({ ...m, sound: "default" }))),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Expo push failed: ${res.status}`);
    const { data } = (await res.json()) as { data: Ticket[] };
    data.forEach((ticket, j) => {
      if (ticket.details?.error === "DeviceNotRegistered") unregistered.push(batch[j]!.to);
    });
  }
  return unregistered;
}
