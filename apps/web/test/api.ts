import { createMobileToken } from "@repo/auth/mobile";
import { seedObra } from "@repo/core/seed";
import { createTestProject, createTestTenant, createTestUser } from "@repo/db/testing";

// Helpers for /api/v1 and /api/mobile route tests: Bearer tokens and requests.

export async function staffToken(tenantId: string, role: "admin" | "manager" | "viewer" = "manager") {
  const user = await createTestUser(tenantId, { role });
  const token = await createMobileToken({ sub: user.id, email: user.email, name: user.name, role, tenantId });
  return { token, user };
}

/** A mobile-app client's Bearer token. */
export function clientToken(tenantId: string, userId: string, email: string) {
  return createMobileToken({ sub: userId, email, name: null, role: "client", tenantId });
}

/** A request with a Bearer token; a plain object body is sent as JSON. */
export function apiRequest(
  token: string | null,
  { method = "GET", body, query = "" }: { method?: string; body?: unknown; query?: string } = {},
) {
  const json = body !== undefined && !(body instanceof FormData);
  return new Request(`http://localhost/api/v1/test${query}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: json ? JSON.stringify(body) : (body as FormData | undefined),
  });
}

export const routeParams = <T extends Record<string, string>>(params: T) => ({
  params: Promise.resolve(params),
});

/** A project with the real Castrillón budget half built (@repo/core/seed). Mock storage first. */
export async function seededObraProject() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const project = await createTestProject(tenant.id);
  await seedObra({ tenantId: tenant.id, userId: admin.id, role: "admin" }, project.id);
  return { tenant, project };
}
