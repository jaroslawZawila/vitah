import { describe, expect, it } from "vitest";
import {
  budgetFilterCounts,
  budgetFilterOf,
  budgetSituation,
  perM2High,
  type BudgetOverviewItem,
  type BudgetOverviewRevision,
} from "../src/contract";

const revision = (r: Partial<BudgetOverviewRevision> & Pick<BudgetOverviewRevision, "status">): BudgetOverviewRevision => ({
  id: "r",
  number: 1,
  totalCents: 100_000,
  costCents: 80_000,
  contractTotalCents: 100_000,
  acceptedAt: null,
  issuedOn: "2026-10-07",
  chosenOptions: 0,
  perM2Cents: null,
  perM2DeltaBp: null,
  validUntil: "2026-11-06",
  acceptedOn: null,
  rejectedOn: null,
  openChecks: null,
  daysLeft: null,
  ...r,
});

const item = (i: Partial<BudgetOverviewItem>): BudgetOverviewItem => ({
  projectId: "p",
  ref: "VTH-1",
  address: "Calle Mayor 1",
  clientName: null,
  revision: null,
  generation: null,
  updatedAt: "2026-10-30T09:00:00.000Z",
  ...i,
});

const running = item({ generation: { status: "running", step: 3 } });
const failed = item({ generation: { status: "failed", step: 1 } });
const none = item({});
const draft = item({ revision: revision({ status: "draft", number: 0, openChecks: 4 }) });
const issued = (daysLeft: number | null) => item({ revision: revision({ status: "issued", daysLeft }) });

describe("budget overview rules", () => {
  it("file the AI's first draft under drafts, and a failed or missing one under no budget", () => {
    const items = [draft, issued(5), running, item({ revision: revision({ status: "accepted" }) }), none, failed];
    expect(items.map(budgetFilterOf)).toEqual(["draft", "issued", "draft", "accepted", "none", "none"]);
    expect(budgetFilterCounts(items)).toEqual({ all: 6, draft: 2, issued: 1, accepted: 1, rejected: 0, none: 2 });
  });

  it("say what each budget waits for", () => {
    expect(budgetSituation(running)).toEqual({ kind: "generating", step: 3 });
    expect(budgetSituation(failed)).toEqual({ kind: "failed" });
    expect(budgetSituation(none)).toEqual({ kind: "none" });
    expect(budgetSituation(draft)).toEqual({ kind: "checks", count: 4, number: 0 });
    expect(budgetSituation(item({ revision: revision({ status: "draft", openChecks: 0 }) }))).toEqual({ kind: "draft", number: 1 });
    expect(budgetSituation(item({ revision: revision({ status: "accepted", acceptedOn: "2026-10-14", chosenOptions: 2 }) }))).toEqual({
      kind: "accepted",
      date: "2026-10-14",
      options: 2,
    });
    expect(budgetSituation(item({ revision: revision({ status: "rejected", rejectedOn: "2026-10-21" }) }))).toEqual({
      kind: "rejected",
      date: "2026-10-21",
      next: 2,
    });
  });

  it("warn of an offer expiring within a week, and flag one past its validity", () => {
    expect(budgetSituation(issued(5))).toMatchObject({ kind: "expiring", days: 5 });
    expect(budgetSituation(issued(7))).toMatchObject({ kind: "expiring", days: 7 });
    expect(budgetSituation(issued(8))).toMatchObject({ kind: "waiting" });
    expect(budgetSituation(issued(-1))).toMatchObject({ kind: "expired" });
    expect(budgetSituation(issued(null))).toMatchObject({ kind: "waiting" });
  });

  it("flag a €/m² more than 5 % above the average", () => {
    expect(perM2High(501)).toBe(true);
    expect(perM2High(500)).toBe(false);
    expect(perM2High(null)).toBe(false);
  });
});
