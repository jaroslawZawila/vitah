import { auth } from "../auth";

/** Throws unless the current user is an admin. Returns their tenant scope. */
export async function requireAdmin() {
  const session = await auth();
  const user = session?.user;
  if (!user?.tenantId || user.role !== "admin") {
    throw new Error("Unauthorized");
  }
  return { tenantId: user.tenantId, userId: user.id! };
}
