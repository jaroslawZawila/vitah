import { db, sql } from "@repo/db";
import { linesPriceSql } from "./obra-data";
import { BUDGET_MODEL, checkKey, CONTINGENCY_CHAPTER, type BudgetChapter, type BudgetCheck, type BudgetTexts } from "./contract";

// ─── Budget review ────────────────────────────────────────────────────────────
// The "Antes de emitir" checklist: what the AI flagged (inconsistencies and
// assumptions), the lines it priced outside the price base, and chapters whose
// €/m² (at their price, margins in) is far from the tenant's other budgets.
// Computed on every read; only which items staff ticked is stored
// (`budget_revisions.review`).
// ─────────────────────────────────────────────────────────────────────────────

/** A chapter this far from the average (35 %) is worth a second look. */
const RATIO_TOLERANCE = 0.35;

/** The ticked keys of a stored `review`. */
export function reviewedKeys(stored: unknown): Set<string> {
  const done = (stored as { done?: unknown } | null)?.done;
  return new Set(Array.isArray(done) ? done.filter((key): key is string => typeof key === "string") : []);
}

export function computeChecks(input: {
  texts: BudgetTexts;
  chapters: BudgetChapter[];
  ratios: Record<string, number>;
  done: Set<string>;
}): BudgetCheck[] {
  const { texts, chapters, ratios, done } = input;
  const checks: BudgetCheck[] = [];
  for (const item of texts.annex) {
    if (item.kind === "note") continue;
    const key = checkKey.annex(item.id);
    checks.push({ key, kind: item.kind, title: item.title, detail: item.text, ref: null, chapterCode: null, done: done.has(key) });
  }
  for (const chapter of chapters) {
    for (const line of chapter.lines) {
      if (line.source !== "estimated") continue;
      const key = checkKey.line(line.lineageId);
      checks.push({
        key,
        kind: "estimated",
        title: `${line.code} ${line.description}`,
        detail: line.note ?? "",
        ref: line.code,
        chapterCode: chapter.code,
        done: done.has(key),
      });
    }
  }
  // €/m² at price (null without a built area).
  for (const { code, name, priceCents, perM2Cents } of chapters) {
    const averageCents = ratios[code];
    if (code === CONTINGENCY_CHAPTER || !averageCents || priceCents === 0 || perM2Cents === null) continue;
    if (Math.abs(perM2Cents / averageCents - 1) <= RATIO_TOLERANCE) continue;
    const key = checkKey.ratio(code);
    checks.push({
      key,
      kind: "ratio",
      title: `${code} ${name}`,
      detail: "",
      ref: code,
      chapterCode: code,
      done: done.has(key),
      perM2Cents,
      averageCents,
    });
  }
  return checks;
}

/**
 * The tenant's average €/m² built per chapter code (cents), over the issued
 * and accepted FRAMER budgets of its other projects. At price, margins in, so
 * budgets priced at cost and older ones (margins inside the unit prices, 0 %
 * on top) compare alike.
 */
export async function tenantRatios(tenantId: string, projectId: string): Promise<Record<string, number>> {
  const rows = (await db.execute(sql`
    select code, round(avg(total * 100.0 / area))::int as average
    from (
      select budget_chapters.code, budget_revisions.built_area_cm2 as area, ${linesPriceSql()} as total
      from budget_lines
      join budget_chapters on budget_chapters.id = budget_lines.chapter_id
      join budget_revisions on budget_revisions.id = budget_chapters.revision_id
      where budget_revisions.tenant_id = ${tenantId}
        and budget_revisions.project_id <> ${projectId}
        and budget_revisions.model = ${BUDGET_MODEL}
        and budget_revisions.status in ('issued', 'accepted')
        and budget_revisions.built_area_cm2 > 0
        and budget_chapters.kind = 'chapter'
      group by budget_chapters.id, budget_chapters.code, budget_revisions.built_area_cm2
    ) as chapters
    group by code
  `)) as unknown as { code: string; average: number }[];
  return Object.fromEntries(rows.map((r) => [r.code, Number(r.average)]));
}
