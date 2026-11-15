import { describe, expect, it, vi } from "vitest";
import { JSON_CSP } from "../../../../lib/security-headers.js";

// Auth.js answers its own routes (it can't load under Vitest: its handlers are
// stood in for); the route adds the API's policy to each answer
// (withApiPolicy, tested in lib/responses.test.ts).
vi.mock("../../../../auth", () => {
  const answer = (status: number) => async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "authjs.csrf-token=abc; Path=/; HttpOnly");
    return new Response(JSON.stringify({ csrfToken: "abc" }), { status, headers });
  };
  return { handlers: { GET: answer(200), POST: answer(302) } };
});

const { GET, POST } = await import("./route");

describe("/api/auth/*", () => {
  it.each([
    ["GET", GET, 200],
    ["POST", POST, 302],
  ] as const)("%s answers as Auth.js does, with the JSON policy and its cookies", async (_, handler, status) => {
    const res = await handler(new Request("http://localhost/api/auth/csrf") as never);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ csrfToken: "abc" });
    expect(res.headers.getSetCookie()).toEqual(["authjs.csrf-token=abc; Path=/; HttpOnly"]);
    expect(res.headers.get("content-security-policy")).toBe(JSON_CSP);
  });
});
