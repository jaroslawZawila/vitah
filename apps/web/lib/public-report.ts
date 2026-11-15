// What the endpoints anyone may post a report to share (POST /api/mobile/client-error,
// POST /api/csp-report): a rate limit, and a body read only up to a size.

/**
 * A rate limit, best effort and with no new infrastructure: a fixed window per
 * IP kept in this instance's memory, so a client reporting in a loop can't
 * flood the logs. Every serverless instance counts on its own and forgets on
 * a cold start, so the real ceiling is `perIp` × the instances serving the IP;
 * `all` caps what one instance lets through whatever the IPs, counting only
 * the requests their own IP's window let through: an address refused over and
 * over (anyone can call these) must not use up the room of every other one.
 *
 * Returns `allowed(ip)`, which counts the request and says whether it is
 * within both limits.
 */
export function perIpLimiter({ windowMs, perIp, all, maxTracked = 5000 }: { windowMs: number; perIp: number; all: number; maxTracked?: number }) {
  type Window = { startedAt: number; count: number };
  const perAddress = new Map<string, Window>();
  // The instance's own window lives apart from the addresses': forgetting
  // them (a full table, e.g. a caller rotating addresses) never resets it.
  let instance: Window | undefined;

  /** Counts the request in `window` (a new one once it is over); the window, and whether it is within `limit`. */
  function count(window: Window | undefined, limit: number, now: number): [Window, boolean] {
    if (!window || now - window.startedAt >= windowMs) return [{ startedAt: now, count: 1 }, true];
    window.count += 1;
    return [window, window.count <= limit];
  }

  return function allowed(ip: string | undefined) {
    const now = Date.now();
    if (perAddress.size > maxTracked) {
      for (const [key, window] of perAddress) if (now - window.startedAt >= windowMs) perAddress.delete(key);
      // Still full of live windows: forget them all rather than grow.
      if (perAddress.size > maxTracked) perAddress.clear();
    }
    const key = ip ?? "unknown";
    const [window, withinAddress] = count(perAddress.get(key), perIp, now);
    perAddress.set(key, window);
    if (!withinAddress) return false;
    let withinInstance: boolean;
    [instance, withinInstance] = count(instance, all, now);
    return withinInstance;
  };
}

/** The body as text, or null once it is over `maxBytes` (the rest is not read). */
export async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}
