// What the database itself refuses, on a database built from schema.ts: the
// CHECK constraints, the tenant-composite foreign keys and the keys to
// projects that no longer cascade. Each test runs in a transaction that is
// rolled back, on one database pushed once for the file.

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDatabase, pushSchema } from "../src/ops/connection";
import { COLUMN_VALUES } from "../src/schema";
import { SCRATCH_PREFIX, SERVER_URL } from "./scratch";
import { TENANT_TABLES, tenantTree } from "./tree";

let sql: postgres.Sql;
let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createScratchDatabase(SERVER_URL, SCRATCH_PREFIX);
  drop = database.drop;
  pushSchema(database.url);
  sql = postgres(database.url, { max: 1, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await drop?.();
});

class Rollback extends Error {}

/** Runs `setup`, then `statement`, in a transaction that is always rolled back → the statement's SQLSTATE, or null when it went in. */
async function attempt(setup: string, statement: string): Promise<string | null> {
  let code: string | null = null;
  await sql
    .begin(async (tx) => {
      await tx.unsafe(setup);
      try {
        await tx.unsafe(statement);
      } catch (error) {
        code = (error as { code?: string }).code ?? "unknown";
      }
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return code;
}

/** Runs `run` after `setup` in a transaction that is rolled back, and returns what it returned. */
async function inRolledBack<T>(setup: string, run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await sql
    .begin(async (tx) => {
      await tx.unsafe(setup);
      result = await run(tx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return result as T;
}

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const TREE = tenantTree("a") + tenantTree("b");

describe("the tree every test starts from", () => {
  it("goes in whole: every constraint takes rows as the application writes them", async () => {
    const counts = await inRolledBack(TREE, (tx) =>
      Promise.all(TENANT_TABLES.map(async (table) => [table, Number((await tx.unsafe(`select count(*) from ${table}`))[0]!.count)])),
    );
    for (const [table, count] of counts) expect(count, table as string).toBeGreaterThan(0);
  });
});

describe("text columns hold one of their words", () => {
  // The column's CHECK, built from its list in COLUMN_VALUES.
  const columns: [string, string, keyof typeof COLUMN_VALUES][] = [
    ["users", "language", "language"],
    ["push_tokens", "language", "language"],
    ["project_documents", "budget_input", "budgetInput"],
    ["project_documents", "budget_pdf", "budgetPdf"],
    ["budget_revisions", "model", "budgetModel"],
    ["budget_revisions", "quality", "budgetQuality"],
    ["budget_chapters", "kind", "budgetChapterKind"],
    ["budget_chapters", "option_kind", "budgetOptionKind"],
    ["budget_lines", "source", "budgetLineSource"],
    ["obra_progress_events", "kind", "progressEventKind"],
    ["obra_hito_events", "action", "hitoEventAction"],
    ["obra_issues", "kind", "issueKind"],
    ["obra_issues", "party", "issueParty"],
    ["obra_issues", "status", "issueStatus"],
    ["budget_generations", "status", "budgetGenerationStatus"],
    ["purchase_orders", "kind", "purchaseKind"],
    ["purchase_orders", "vat_kind", "purchaseVatKind"],
    ["purchase_requests", "kind", "purchaseKind"],
    ["purchase_requests", "status", "purchaseRequestStatus"],
    ["purchase_invoices", "vat_kind", "purchaseVatKind"],
    ["purchase_payments", "method", "purchasePaymentMethod"],
    ["purchase_document_checks", "status", "purchaseCheckStatus"],
    ["planning_versions", "status", "planningStatus"],
    ["planning_versions", "region", "planningRegion"],
    ["subcontractors", "cae_status", "caeStatus"],
    ["budget_approvals", "status", "budgetApprovalStatus"],
    ["warranty_claims", "kind", "warrantyKind"],
    ["warranty_claims", "room", "warrantyRoom"],
    ["warranty_claims", "status", "warrantyStatus"],
    ["warranty_claim_events", "action", "warrantyEventAction"],
  ];

  it("lists exactly the words of COLUMN_VALUES, for every list there is", async () => {
    const rows = await sql<{ table: string; name: string; def: string }[]>`
      select conrelid::regclass::text as "table", conname as name, pg_get_constraintdef(oid) as def
      from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`;
    for (const [table, column, key] of columns) {
      const words = COLUMN_VALUES[key].map((word) => `'${word}'::text`);
      // Postgres writes a list of one as an equality.
      const condition = words.length === 1 ? `${column} = ${words[0]}` : `${column} = ANY (ARRAY[${words.join(", ")}])`;
      expect(rows.find((row) => row.name === `${table}_${column}_check`)?.def, `${table}.${column}`).toBe(`CHECK ((${condition}))`);
    }
    // The two order flows make the status check of purchase_orders, and the invoice kinds the kind check of
    // purchase_invoices (both below); every other list has a column of its own.
    const combined = ["purchaseMaterialStatus", "purchaseSubcontractStatus", "purchaseInvoiceKind"];
    const used = new Set<string>([...columns.map(([, , key]) => key), ...combined]);
    expect(Object.keys(COLUMN_VALUES).filter((key) => !used.has(key))).toEqual([]);
  });

  it("refuses a word outside the list and takes null where the column is nullable", async () => {
    expect(await attempt(TREE, "update users set language = 'fr' where id = 'admin_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update users set language = null where id = 'admin_a'")).toBeNull();
    expect(await attempt(TREE, "update purchase_requests set status = 'shipped' where id = 'request_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update obra_hito_events set action = 'acta_signed' where id = 'hito_event_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update planning_versions set region = 'xx' where id = 'plan_a'")).toBe(CHECK);
    for (const status of COLUMN_VALUES.budgetGenerationStatus) {
      expect(await attempt(TREE, `update budget_generations set status = '${status}' where id = 'generation_a'`), status).toBeNull();
    }
  });

  it("keeps an order to its own kind's statuses", async () => {
    for (const status of COLUMN_VALUES.purchaseSubcontractStatus) {
      expect(await attempt(TREE, `update purchase_orders set status = '${status}' where id = 'order_a'`), status).toBeNull();
    }
    expect(await attempt(TREE, "update purchase_orders set status = 'delivered' where id = 'order_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update purchase_orders set kind = 'material', status = 'delivered' where id = 'order_a'")).toBeNull();
    expect(await attempt(TREE, "update purchase_orders set kind = 'material', status = 'finished' where id = 'order_a'")).toBe(CHECK);
  });
});

describe("amounts, shares and counts in range", () => {
  it.each([
    ["projects", "obra_stage = 9", "project_a"],
    ["budget_revisions", "profit_bp = 10000", "revision_a"],
    ["budget_revisions", "overhead_bp = 5000, profit_bp = 5000", "revision_a"],
    ["budget_revisions", "vat_rate_bp = -1", "revision_a"],
    ["budget_lines", "executed_pct = 101", "line_a"],
    ["budget_lines", "quantity_milli = -1", "line_a"],
    ["obra_hitos", "pct_bp = 10001", "hito_a"],
    ["obra_hitos", "paid_amount_cents = 0", "hito_a"],
    ["obra_issues", "number = 0", "issue_a"],
    ["budget_generations", "step = 6", "generation_a"],
    ["subcontractors", "chain_level = 4", "company_a"],
    ["subcontractors", "permanent_count = 11", "company_a"],
    ["subcontractors", "cae_status = 'otra'", "company_a"],
    ["purchase_orders", "retention_bp = 10001", "order_a"],
    ["purchase_order_lines", "amount_cents = 0", "order_line_a"],
    ["purchase_order_milestones", "amount_cents = 0", "milestone_a"],
    ["purchase_invoice_lines", "amount_cents = 0", "invoice_line_a"],
    ["purchase_payments", "amount_cents = 0", "payment_a"],
    ["planning_items", "duration_days = 0", "plan_item_a"],
    ["planning_items", "lead_days = -1", "plan_item_a"],
    ["project_documents", "size_bytes = -1", "document_a"],
    ["warranty_claims", "number = 0", "claim_a"],
    ["warranty_claim_photos", "thumb_size_bytes = -1", "claim_photo_a"],
  ])("refuses %s with %s", async (table, change, id) => {
    expect(await attempt(TREE, `update ${table} set ${change} where id = '${id}'`)).toBe(CHECK);
  });

  it("takes what may be negative: an option's deduction, a credit note, a saving, an overlap", async () => {
    expect(await attempt(TREE, "update budget_lines set unit_price_cents = -1 where id = 'deduction_a'")).toBeNull();
    expect(await attempt(TREE, "update purchase_invoices set base_cents = -900 where id = 'credit_a'")).toBeNull();
    expect(await attempt(TREE, "update obra_issues set cost_impact_cents = -1, schedule_impact_days = -3 where id = 'issue_a'")).toBeNull();
    expect(await attempt(TREE, "update planning_items set lag_days = -10 where id = 'plan_item_a'")).toBeNull();
  });

  it("registers and cancels a hito's payment as a pair", async () => {
    expect(await attempt(TREE, "update obra_hitos set paid_on = null where id = 'hito_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update obra_hitos set paid_on = null, paid_amount_cents = null where id = 'hito_a'")).toBeNull();
  });

  it("schedules a warranty visit for a day, and rejects a claim with a reason", async () => {
    expect(await attempt(TREE, "update warranty_claims set visit_on = null where id = 'claim_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update warranty_claims set status = 'resolved', visit_on = null where id = 'claim_a'")).toBeNull();
    expect(await attempt(TREE, "update warranty_claims set status = 'rejected' where id = 'claim_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update warranty_claims set status = 'rejected', answer = 'Fuera de garantía' where id = 'claim_a'")).toBeNull();
  });

  it("tells an invoice from a credit note by its sign, what it rectifies and its due day", async () => {
    expect(await attempt(TREE, "update purchase_invoices set base_cents = -1000 where id = 'invoice_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update purchase_invoices set rectifies_id = 'credit_a' where id = 'invoice_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update purchase_invoices set base_cents = 100 where id = 'credit_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update purchase_invoices set rectifies_id = null where id = 'credit_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update purchase_invoices set due_on = '2026-06-01' where id = 'credit_a'")).toBe(CHECK);
  });

  it("keeps a client's answer to what answered it: when, a reason only to reject, closed only by staff", async () => {
    const approval = (change: string) => `update budget_approvals set ${change} where id = 'approval_a'`;
    expect(await attempt(TREE, approval("decided_at = null"))).toBe(CHECK);
    expect(await attempt(TREE, approval("reject_reason = 'Caro'"))).toBe(CHECK);
    expect(await attempt(TREE, approval("status = 'rejected'"))).toBe(CHECK);
    expect(await attempt(TREE, approval("status = 'rejected', reject_reason = 'Caro'"))).toBeNull();
    expect(await attempt(TREE, approval("status = 'withdrawn'"))).toBe(CHECK);
    expect(await attempt(TREE, approval("status = 'withdrawn', decided_at = null, closed_at = now()"))).toBeNull();
    expect(await attempt(TREE, approval("status = 'pending', decided_at = null"))).toBeNull();
    // One open request per revision.
    expect(
      await attempt(
        TREE + approval("status = 'pending', decided_at = null") + ";",
        "insert into budget_approvals (id, tenant_id, project_id, revision_id, before_cents, after_cents, vat_rate_bp) values ('x', 'a', 'project_a', 'revision1_a', 1, 1, 0)",
      ),
    ).toBe("23505");
  });

  it("reviews exactly one file per document check", async () => {
    expect(await attempt(TREE, "update purchase_document_checks set payment_id = null where id = 'payment_check_a'")).toBe(CHECK);
    expect(await attempt(TREE, "update purchase_document_checks set invoice_file_id = 'invoice_file_a' where id = 'payment_check_a'")).toBe(CHECK);
  });
});

describe("dates in order", () => {
  it.each([
    ["projects", "completion_date = '2025-12-31'", "project_a"],
    ["obra_chapter_progress", "actual_end = '2026-02-28'", "progress_a"],
    ["obra_chapter_progress", "actual_start = null", "progress_a"],
    ["subcontractor_assignments", "planned_end = '2026-02-28'", "assignment_a"],
    ["purchase_orders", "work_end = '2026-02-28'", "order_a"],
    ["purchase_invoices", "due_on = '2026-03-31'", "invoice_a"],
    ["planning_items", "planned_end = '2026-02-28'", "plan_item_a"],
  ])("refuses %s with %s", async (table, change, id) => {
    expect(await attempt(TREE, `update ${table} set ${change} where id = '${id}'`)).toBe(CHECK);
  });

  it("takes a period with either end missing", async () => {
    expect(await attempt(TREE, "update subcontractor_assignments set planned_start = null where id = 'assignment_a'")).toBeNull();
    expect(await attempt(TREE, "update obra_chapter_progress set actual_end = null where id = 'progress_a'")).toBeNull();
  });
});

describe("asking for an account to be deleted", () => {
  it("is a client's: taken on a client, refused on staff", async () => {
    expect(await attempt(TREE, "update users set deletion_requested_at = now() where id = 'client_a'")).toBeNull();
    expect(await attempt(TREE, "update users set deletion_requested_at = now() where id = 'admin_a'")).toBe(CHECK);
  });
});

describe("soft deletes", () => {
  const softDeleted = [
    ["projects", "project_a"],
    ["project_documents", "document_a"],
    ["project_photos", "photo_a"],
    ["obra_issue_files", "issue_file_a"],
    ["subcontractor_assignments", "assignment_a"],
    ["purchase_order_documents", "order_document_a"],
    ["purchase_invoices", "invoice_a"],
    ["purchase_payments", "payment_a"],
  ];

  it.each(softDeleted)("never says who deleted a row of %s that is not deleted", async (table, id) => {
    expect(await attempt(TREE, `update ${table} set deleted_by_id = 'admin_a' where id = '${id}'`)).toBe(CHECK);
    expect(await attempt(TREE, `update ${table} set deleted_at = now(), deleted_by_id = 'admin_a' where id = '${id}'`)).toBeNull();
  });

  it("keeps a row deleted when the user who deleted it is deleted (who becomes null)", async () => {
    const deleted = await inRolledBack(
      TREE + "update projects set deleted_at = now(), deleted_by_id = 'admin_a' where id = 'project_a'; delete from users where id = 'admin_a';",
      (tx) => tx`select deleted_at is not null as deleted, deleted_by_id from projects where id = 'project_a'`,
    );
    expect(deleted).toEqual([{ deleted: true, deleted_by_id: null }]);
  });
});

describe("a row and its parent belong to the same tenant", () => {
  it.each([
    ["project_documents", "tenant_id = 'b'", "document_a"],
    ["budget_chapters", "revision_id = 'revision_b', code = '06'", "chapter_a"],
    ["budget_lines", "chapter_id = 'chapter_b'", "line_a"],
    ["obra_hito_checks", "hito_id = 'hito_b'", "check_a"],
    ["obra_issue_files", "issue_id = 'issue_b'", "issue_file_a"],
    ["warranty_claims", "project_id = 'project_b', number = 2", "claim_a"],
    ["warranty_claim_photos", "claim_id = 'claim_b'", "claim_photo_a"],
    ["warranty_claim_events", "claim_id = 'claim_b'", "claim_event_a"],
    ["subcontractor_documents", "worker_id = 'worker_b'", "cae_a"],
    ["purchase_orders", "subcontractor_id = 'company_b'", "order_a"],
    ["purchase_invoices", "milestone_id = 'milestone_b'", "invoice_a"],
    ["purchase_invoices", "rectifies_id = 'invoice_b'", "credit_a"],
    ["purchase_payments", "invoice_id = 'invoice_b'", "payment_a"],
    ["purchase_document_checks", "order_id = 'order_b'", "payment_check_a"],
    ["planning_items", "version_id = 'plan_b', chapter_code = '06'", "plan_item_a"],
    ["budget_approvals", "revision_id = 'revision1_b'", "approval_a"],
  ])("refuses %s pointing at another tenant's parent (%s)", async (table, change, id) => {
    expect(await attempt(TREE, `update ${table} set ${change} where id = '${id}'`)).toBe(FOREIGN_KEY);
  });

  it("refuses a document check of another tenant's file", async () => {
    // Each file has one check at most: b's go first, so only the tenant can be what fails.
    const setup = TREE + "delete from purchase_document_checks where tenant_id = 'b';";
    const files = { payment_id: "payment_b", invoice_file_id: "invoice_file_b", document_version_id: "order_version_b" };
    for (const [column, file] of Object.entries(files)) {
      const set = Object.keys(files).map((other) => `${other} = ${other === column ? `'${file}'` : "null"}`);
      expect(await attempt(setup, `update purchase_document_checks set ${set.join(", ")} where id = 'payment_check_a'`), column).toBe(
        FOREIGN_KEY,
      );
    }
  });

  it("refuses another tenant's photo on a hito, and another tenant's user's two-step secret", async () => {
    expect(await attempt(TREE, "insert into obra_hito_photos (hito_id, photo_id, tenant_id) values ('hito_a', 'photo_b', 'a')")).toBe(FOREIGN_KEY);
    expect(await attempt(TREE, "update user_mfa set tenant_id = 'b' where user_id = 'admin_a'")).toBe(FOREIGN_KEY);
    expect(await attempt(TREE, "update budget_revision_changes set issue_id = 'issue_b' where revision_id = 'revision1_a'")).toBe(FOREIGN_KEY);
  });
});

describe("deleting", () => {
  it("refuses a hand-run delete of a project with anything under it", async () => {
    expect(await attempt(TREE, "delete from projects where id = 'project_a'")).toBe(FOREIGN_KEY);
    // Whatever is under it: one hito is enough.
    const one = tenantTree("a").split("insert into project_documents")[0]!;
    expect(
      await attempt(
        one + "insert into obra_hitos (id, tenant_id, project_id, code, name, pct_bp, scope, billing_moment, position) values ('h', 'a', 'project_a', 'H0', 'Firma', 0, 's', 'b', 0);",
        "delete from projects where id = 'project_a'",
      ),
    ).toBe(FOREIGN_KEY);
  });

  it("deletes a whole tenant, everything under its projects included, and nothing of another tenant", async () => {
    const counts = await inRolledBack(TREE + "delete from tenants where id = 'a';", (tx) =>
      Promise.all(
        TENANT_TABLES.map(async (table) => {
          const [row] = await tx.unsafe(`select count(*) filter (where tenant_id = 'a') as a, count(*) filter (where tenant_id = 'b') as b from ${table}`);
          return { table, a: Number(row!.a), b: Number(row!.b) };
        }),
      ),
    );
    for (const { table, a, b } of counts) {
      expect(a, table).toBe(0);
      expect(b, table).toBeGreaterThan(0);
    }
  });

  it("still deletes for real what the application deletes: a draft budget, a draft plan, rewritten rows, a user", async () => {
    const left = await inRolledBack(
      TREE +
        `delete from purchase_document_checks where tenant_id = 'a';
         delete from purchase_invoices where id = 'credit_a';
         update purchase_invoices set milestone_id = null where id = 'invoice_a';
         delete from budget_revisions where id = 'revision_a';
         delete from planning_versions where id = 'plan_a';
         delete from purchase_order_milestones where id = 'milestone_a';
         delete from purchase_order_lines where order_id = 'order_a';
         delete from purchase_invoice_lines where invoice_id = 'invoice_a';
         delete from purchase_request_lines where request_id = 'request_a';
         delete from obra_hito_chapters where hito_id = 'hito_a';
         delete from obra_hito_checks where hito_id = 'hito_a';
         delete from obra_hito_photos where hito_id = 'hito_a';
         delete from users where id = 'client_a';
         delete from user_mfa where user_id = 'admin_a';`,
      (tx) => tx`
        select (select count(*) from budget_chapters where tenant_id = 'a')::int as chapters,
               (select count(*) from budget_lines where tenant_id = 'a')::int as lines,
               (select count(*) from planning_items where tenant_id = 'a')::int as items,
               (select count(*) from client_profiles where tenant_id = 'a')::int as profiles,
               (select count(*) from push_tokens where tenant_id = 'a')::int as tokens,
               (select client_user_id from projects where id = 'project_a') as client`,
    );
    expect(left).toEqual([{ chapters: 0, lines: 0, items: 0, profiles: 0, tokens: 0, client: null }]);
  });
});
