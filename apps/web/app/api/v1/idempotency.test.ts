import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, staffToken } from "../../../test/api";
import { CREATES, countRecords, createBody, obraToCreateOn, type Create, type Obra } from "../../../test/idempotency-fixture";
import { POST as createIssue } from "./projects/[id]/obra/issues/route";
import { POST as createRequest } from "./projects/[id]/purchases/requests/route";
import { POST as createOrder } from "./projects/[id]/purchases/route";
import { POST as amend } from "./purchases/[orderId]/amendments/route";
import { POST as createInvoice } from "./purchases/[orderId]/invoices/route";
import { POST as pay } from "./purchases/invoices/[invoiceId]/payments/route";

// The six creates that take an idempotency key, through /api/v1: the key in
// the `Idempotency-Key` header or in the body's `idempotencyKey`; sent again,
// the same status and body, and one record. The semantics are covered in
// packages/core/test/idempotency.test.ts.

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

const pdf = (content: string) => new File([content], "doc.pdf", { type: "application/pdf" });

/** A multipart body: the fields as JSON in `data`, and a file. */
function multipart(data: Record<string, unknown>, file: File) {
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  form.set("file", file);
  return form;
}

type Key = { header?: string; field?: string };

/** POSTs a create's body with the key in the header, in the body, or both. `file`: as multipart. */
function post(obra: Obra, token: string, create: Create, body: Record<string, unknown>, key: Key = {}, file?: File) {
  const fields = key.field === undefined ? body : { ...body, idempotencyKey: key.field };
  const request = apiRequest(token, { method: "POST", body: file ? multipart(fields, file) : fields });
  if (key.header !== undefined) request.headers.set("Idempotency-Key", key.header);
  switch (create) {
    case "order":
      return createOrder(request, routeParams({ id: obra.project.id }));
    case "request":
      return createRequest(request, routeParams({ id: obra.project.id }));
    case "issue":
      return createIssue(request, routeParams({ id: obra.project.id }));
    case "invoice":
      return createInvoice(request, routeParams({ orderId: obra.orderId }));
    case "payment":
      return pay(request, routeParams({ invoiceId: obra.invoiceId }));
    case "amendment":
      return amend(request, routeParams({ orderId: obra.orderId }));
  }
}

async function setup() {
  const obra = await obraToCreateOn();
  const { token } = await staffToken(obra.tenant.id, "manager");
  return { obra, token, before: await countRecords(obra.tenant.id) };
}

describe.each(CREATES)("POST that creates: %s", (create) => {
  it.each([
    ["the Idempotency-Key header", (key: string): Key => ({ header: key })],
    ["the body's idempotencyKey", (key: string): Key => ({ field: key })],
  ])("applies it once per key in %s, and answers a retry the same", async (_where, keyIn) => {
    const { obra, token, before } = await setup();
    const key = keyIn(crypto.randomUUID());
    const body = createBody[create](obra, 1);

    const first = await post(obra, token, create, body, key);
    const firstBody: unknown = await first.json();
    const again = await post(obra, token, create, body, key);

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(firstBody);
    expect((await countRecords(obra.tenant.id))[create]).toBe(before[create] + 1);

    // The key with another body: refused, and still one record.
    const other = await post(obra, token, create, createBody[create](obra, 2), key);
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: "idempotency_key_reused" });
    // Another key: another record.
    const next = await post(obra, token, create, createBody[create](obra, 2), keyIn(crypto.randomUUID()));
    expect(next.status).toBe(201);
    expect(await next.json()).not.toEqual(firstBody);
    expect((await countRecords(obra.tenant.id))[create]).toBe(before[create] + 2);
  });

  it("refuses a key that isn't one (400) and creates nothing; without a key each call is its own record", async () => {
    const { obra, token, before } = await setup();

    for (const key of [{ header: "short" }, { header: "" }, { field: "with spaces, not a key" }, { field: "x".repeat(101) }]) {
      const response = await post(obra, token, create, createBody[create](obra, 1), key);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(await countRecords(obra.tenant.id)).toEqual(before);

    // Callers from before keys send none: nothing changes for them.
    expect((await post(obra, token, create, createBody[create](obra, 1))).status).toBe(201);
    expect((await post(obra, token, create, createBody[create](obra, 2))).status).toBe(201);
    expect((await countRecords(obra.tenant.id))[create]).toBe(before[create] + 2);
  });
});

describe("the key's place", () => {
  it("takes the header over the body's field", async () => {
    const { obra, token, before } = await setup();
    const [header, field] = [crypto.randomUUID(), crypto.randomUUID()];
    const body = createBody.order(obra, 1);

    const first = await post(obra, token, "order", body, { header, field });
    // The same header with another field: the same request. The field alone: a key not used yet.
    const sameHeader = await post(obra, token, "order", body, { header, field: crypto.randomUUID() });
    const fieldOnly = await post(obra, token, "order", body, { field });

    const made: unknown = await first.json();
    expect(await sameHeader.json()).toEqual(made);
    expect(await fieldOnly.json()).not.toEqual(made);
    expect((await countRecords(obra.tenant.id)).order).toBe(before.order + 2);
  });

  it("is the tenant's: another tenant's same key is its own", async () => {
    const one = await setup();
    const two = await setup();
    const key = { header: crypto.randomUUID() };

    const first = await post(one.obra, one.token, "request", createBody.request(one.obra, 1), key);
    const second = await post(two.obra, two.token, "request", createBody.request(two.obra, 2), key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(((await second.json()) as { requestId: string }).requestId).not.toBe(((await first.json()) as { requestId: string }).requestId);
  });

  it("covers a multipart body: a payment with its proof sent twice is one payment and one stored file", async () => {
    const { obra, token, before } = await setup();
    const body = createBody.payment(obra, 1);
    const stored = files.size;

    for (const key of [{ header: crypto.randomUUID() }, { field: crypto.randomUUID() }]) {
      const first = await post(obra, token, "payment", body, key, pdf("%PDF-1.7 justificante"));
      const again = await post(obra, token, "payment", body, key, pdf("%PDF-1.7 justificante"));
      expect([first.status, again.status]).toEqual([201, 201]);
      expect(await again.json()).toEqual(await first.json());
      // Another proof under the key is another request.
      expect((await post(obra, token, "payment", body, key, pdf("%PDF-1.7 otro"))).status).toBe(409);
    }
    expect((await countRecords(obra.tenant.id)).payment).toBe(before.payment + 2);
    expect(files.size).toBe(stored + 2);
  });

  it("is still the caller's to use: a viewer's retry of someone's key is forbidden", async () => {
    const { obra, token } = await setup();
    const key = { header: crypto.randomUUID() };
    const body = createBody.payment(obra, 1);
    expect((await post(obra, token, "payment", body, key)).status).toBe(201);

    const viewer = await staffToken(obra.tenant.id, "viewer");
    const response = await post(obra, viewer.token, "payment", body, key);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });
});
