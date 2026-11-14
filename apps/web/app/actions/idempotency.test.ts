import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, resetDatabase, withoutTable } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { CREATES, countRecords, createBody, obraToCreateOn, type Create, type Obra } from "../../test/idempotency-fixture";
import { signInAs } from "../../test/session";
import { createIssueAction } from "./construction";
import { createInvoiceAction, createPaymentAction } from "./purchase-invoices";
import { createRequestAction } from "./purchase-requests";
import { amendPurchaseAction, createPurchaseAction } from "./purchasing";

// The six creates that take an idempotency key, through their server actions:
// the form's key travels in the action's input (`idempotencyKey`), and the
// same submission sent twice is one record. The semantics are covered in
// packages/core/test/idempotency.test.ts; the form's side in
// dashboard/components/useIdempotencyKey.test.ts.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const pdf = (content = "%PDF-1.7 documento") => new File([content], "documento.pdf", { type: "application/pdf" });

/** A form's fields as JSON in `data`, and a file. */
function formOf(data: Record<string, unknown>, file?: File) {
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  if (file) form.set("file", file);
  return form;
}

/** Runs a create's action as its form does: the key in the input, a PDF where the form has one. */
function submit(obra: Obra, create: Create, input: Record<string, unknown>) {
  switch (create) {
    case "order":
      return createPurchaseAction(obra.project.id, input);
    case "request":
      return createRequestAction(obra.project.id, input);
    case "issue":
      return createIssueAction(obra.project.id, input);
    case "invoice":
      return createInvoiceAction(obra.orderId, formOf(input, pdf()));
    case "payment":
      return createPaymentAction(obra.invoiceId, formOf(input, pdf()));
    case "amendment":
      return amendPurchaseAction(obra.project.id, obra.orderId, formOf(input, pdf()));
  }
}

async function setup(role: "manager" | "viewer" = "manager") {
  const obra = await obraToCreateOn();
  const user = await createTestUser(obra.tenant.id, { role });
  signInAs({ tenantId: obra.tenant.id, userId: user.id, role });
  return { obra, before: await countRecords(obra.tenant.id), stored: files.size };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe.each(CREATES)("the %s action with the form's key", (create) => {
  const hasFile = create === "invoice" || create === "payment" || create === "amendment";

  it("makes one record of the same submission sent twice, and answers both the same", async () => {
    const { obra, before, stored } = await setup();
    const input = { ...createBody[create](obra, 1), idempotencyKey: crypto.randomUUID() };

    const first = await submit(obra, create, input);
    const again = await submit(obra, create, input);
    const [one, two] = await Promise.all([submit(obra, create, input), submit(obra, create, input)]);

    expect(first).toMatchObject({ success: true });
    expect([again, one, two]).toEqual([first, first, first]);
    expect((await countRecords(obra.tenant.id))[create]).toBe(before[create] + 1);
    if (hasFile) expect(files.size).toBe(stored + 1);
  });

  it("answers the key with other values with an error, and a new key makes another record", async () => {
    const { obra, before } = await setup();
    const idempotencyKey = crypto.randomUUID();
    await submit(obra, create, { ...createBody[create](obra, 1), idempotencyKey });

    expect(await submit(obra, create, { ...createBody[create](obra, 2), idempotencyKey })).toEqual({ error: "idempotency_key_reused" });
    expect(await submit(obra, create, { ...createBody[create](obra, 2), idempotencyKey: crypto.randomUUID() })).toMatchObject({ success: true });
    expect((await countRecords(obra.tenant.id))[create]).toBe(before[create] + 2);
  });

  it("keeps no key for a submission the server refused: the same key works once it is right", async () => {
    const { obra, before } = await setup();
    const idempotencyKey = crypto.randomUUID();
    // Nothing of what any of the six needs: missing fields, or a value that isn't one.
    expect(await submit(obra, create, { idempotencyKey })).toEqual({ error: expect.stringMatching(/^(missing_fields|invalid_input|invalid_date)$/) });
    expect(await countRecords(obra.tenant.id)).toEqual(before);

    expect(await submit(obra, create, { ...createBody[create](obra, 1), idempotencyKey })).toMatchObject({ success: true });
    expect((await countRecords(obra.tenant.id))[create]).toBe(before[create] + 1);
  });

  it("creates as before keys while the keys' table is not there yet (deployed ahead of its SQL), with a warning", async () => {
    const { obra, before, stored } = await setup();
    const idempotencyKey = crypto.randomUUID();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const made = await withoutTable("idempotency_keys", () => submit(obra, create, { ...createBody[create](obra, 1), idempotencyKey }));

    // The form sends a key with every create: without the table it must still create, not fail.
    expect(made).toMatchObject({ success: true });
    expect((await countRecords(obra.tenant.id))[create]).toBe(before[create] + 1);
    if (hasFile) expect(files.size).toBe(stored + 1);
    expect(warn.mock.calls.map(([line]) => (JSON.parse(line as string) as { event: string }).event)).toContain("idempotency.table_missing");
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();

    // The table there: the key works as a key (it was never taken meanwhile).
    const kept = await submit(obra, create, { ...createBody[create](obra, 2), idempotencyKey });
    expect(kept).toMatchObject({ success: true });
    expect(await submit(obra, create, { ...createBody[create](obra, 2), idempotencyKey })).toEqual(kept);
    expect((await countRecords(obra.tenant.id))[create]).toBe(before[create] + 2);
  });

  it("refuses a key that isn't one, and a viewer whatever the key", async () => {
    const { obra, before } = await setup();
    expect(await submit(obra, create, { ...createBody[create](obra, 1), idempotencyKey: "short" })).toEqual({ error: "invalid_input" });

    const viewer = await createTestUser(obra.tenant.id, { role: "viewer" });
    signInAs({ tenantId: obra.tenant.id, userId: viewer.id, role: "viewer" });
    expect(await submit(obra, create, { ...createBody[create](obra, 1), idempotencyKey: crypto.randomUUID() })).toEqual({ error: "forbidden" });
    expect(await countRecords(obra.tenant.id)).toEqual(before);
  });
});
