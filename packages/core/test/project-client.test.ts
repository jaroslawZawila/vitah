import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { db, eq, projects, users } from "@repo/db";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import {
  createProjectClient,
  getClientProject,
  normalizeEmail,
  resetProjectClientPassword,
  revokeProjectClient,
} from "../src";

const validInput = { name: "Ana García", email: "ana@example.com", password: "s3cret-pass" };

async function findUser(email: string) {
  return db.query.users.findFirst({ where: eq(users.email, email) });
}

async function findProject(id: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("createProjectClient", () => {
  it("creates a client user and attaches them to the project", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);

    const result = await createProjectClient(tenant.id, project.id, {
      ...validInput,
      name: "  Ana García ",
      email: " ANA@example.com",
    });

    expect(result).toEqual({ ok: true });
    const client = await findUser("ana@example.com");
    expect(client).toMatchObject({ tenantId: tenant.id, name: "Ana García", role: "client" });
    expect(await bcrypt.compare(validInput.password, client!.passwordHash!)).toBe(true);
    expect((await findProject(project.id))?.clientUserId).toBe(client!.id);
  });

  it.each([
    [{ ...validInput, name: "  " }, "missing_fields"],
    [{ ...validInput, email: "" }, "missing_fields"],
    [{ ...validInput, password: "" }, "missing_fields"],
    [{ ...validInput, email: "not-an-email" }, "invalid_email"],
    [{ ...validInput, password: "short" }, "password_too_short"],
  ])("rejects invalid input %j with %s", async (input, error) => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);

    expect(await createProjectClient(tenant.id, project.id, input)).toEqual({ ok: false, error });
    expect(await db.query.users.findMany()).toHaveLength(0);
  });

  it("rejects a project from another tenant", async () => {
    const tenant = await createTestTenant();
    const other = await createTestTenant();
    const project = await createTestProject(other.id);

    expect(await createProjectClient(tenant.id, project.id, validInput)).toEqual({
      ok: false,
      error: "project_not_found",
    });
    expect(await findUser(validInput.email)).toBeUndefined();
  });

  it("rejects a project that already has a client", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await createProjectClient(tenant.id, project.id, validInput);

    const result = await createProjectClient(tenant.id, project.id, {
      ...validInput,
      email: "other@example.com",
    });

    expect(result).toEqual({ ok: false, error: "client_already_attached" });
    expect(await findUser("other@example.com")).toBeUndefined();
  });

  it("rejects an email already used by a client in another tenant", async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    await createProjectClient(tenantA.id, (await createTestProject(tenantA.id)).id, validInput);
    const projectB = await createTestProject(tenantB.id);

    expect(await createProjectClient(tenantB.id, projectB.id, validInput)).toEqual({
      ok: false,
      error: "email_exists",
    });
    expect((await findProject(projectB.id))?.clientUserId).toBeNull();
  });

  it("rejects an email already used by staff in the same tenant", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: validInput.email, role: "manager" });
    const project = await createTestProject(tenant.id);

    expect(await createProjectClient(tenant.id, project.id, validInput)).toEqual({
      ok: false,
      error: "email_exists",
    });
  });

  it("allows an email used by staff in another tenant", async () => {
    const tenant = await createTestTenant();
    const other = await createTestTenant();
    await createTestUser(other.id, { email: validInput.email, role: "admin" });
    const project = await createTestProject(tenant.id);

    expect(await createProjectClient(tenant.id, project.id, validInput)).toEqual({ ok: true });
  });
});

describe("getClientProject", () => {
  it("returns the project attached to the client in mobile shape", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id, {
      ref: "VTH-2026-014",
      location: "Calle del Sol 5, Santander",
      startDate: new Date("2026-03-01T00:00:00Z"),
      expectedDeliveryDate: new Date("2026-11-15T00:00:00Z"),
    });
    await createProjectClient(tenant.id, project.id, validInput);
    const client = await findUser(validInput.email);

    expect(await getClientProject(tenant.id, client!.id)).toEqual({
      id: project.id,
      ref: "VTH-2026-014",
      address: "Calle del Sol 5, Santander",
      startDate: "2026-03-01",
      completionDate: "2026-11-15",
    });
  });

  it("returns null dates when they are not set", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await createProjectClient(tenant.id, project.id, validInput);
    const client = await findUser(validInput.email);

    expect(await getClientProject(tenant.id, client!.id)).toMatchObject({
      startDate: null,
      completionDate: null,
    });
  });

  it("returns null when the user has no project", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });

    expect(await getClientProject(tenant.id, client.id)).toBeNull();
  });

  it("does not return a project from another tenant", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await createProjectClient(tenant.id, project.id, validInput);
    const client = await findUser(validInput.email);
    const other = await createTestTenant();

    expect(await getClientProject(other.id, client!.id)).toBeNull();
  });
});

describe("resetProjectClientPassword", () => {
  it("replaces the client's password", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await createProjectClient(tenant.id, project.id, validInput);

    expect(await resetProjectClientPassword(tenant.id, project.id, "brand-new-pass")).toEqual({
      ok: true,
    });

    const client = await findUser(validInput.email);
    expect(await bcrypt.compare("brand-new-pass", client!.passwordHash!)).toBe(true);
    expect(await bcrypt.compare(validInput.password, client!.passwordHash!)).toBe(false);
  });

  it("rejects a short password", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await createProjectClient(tenant.id, project.id, validInput);

    expect(await resetProjectClientPassword(tenant.id, project.id, "short")).toEqual({
      ok: false,
      error: "password_too_short",
    });
  });

  it("reports when the project has no client", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);

    expect(await resetProjectClientPassword(tenant.id, project.id, "brand-new-pass")).toEqual({
      ok: false,
      error: "no_client",
    });
  });

  it("does not touch projects from another tenant", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await createProjectClient(tenant.id, project.id, validInput);
    const other = await createTestTenant();

    expect(await resetProjectClientPassword(other.id, project.id, "brand-new-pass")).toEqual({
      ok: false,
      error: "no_client",
    });
    const client = await findUser(validInput.email);
    expect(await bcrypt.compare(validInput.password, client!.passwordHash!)).toBe(true);
  });
});

describe("revokeProjectClient", () => {
  it("deletes the client and frees the project for a new client", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await createProjectClient(tenant.id, project.id, validInput);

    expect(await revokeProjectClient(tenant.id, project.id)).toEqual({ ok: true });

    expect(await findUser(validInput.email)).toBeUndefined();
    expect((await findProject(project.id))?.clientUserId).toBeNull();
    expect(await createProjectClient(tenant.id, project.id, validInput)).toEqual({ ok: true });
  });

  it("reports when the project has no client", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);

    expect(await revokeProjectClient(tenant.id, project.id)).toEqual({
      ok: false,
      error: "no_client",
    });
  });

  it("does not touch projects from another tenant", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await createProjectClient(tenant.id, project.id, validInput);
    const other = await createTestTenant();

    expect(await revokeProjectClient(other.id, project.id)).toEqual({
      ok: false,
      error: "no_client",
    });
    expect(await findUser(validInput.email)).toBeDefined();
  });
});
