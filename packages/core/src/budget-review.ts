import { db, sql } from "@repo/db";
import { BUDGET_MODEL, checkKey, CONTINGENCY_CHAPTER, type BudgetCheck, type BudgetTexts } from "./contract";
import { perM2Cents as perM2 } from "./obra-calc";
import type { LoadedChapter } from "./obra-data";

// ─── Budget review ────────────────────────────────────────────────────────────
// The "Antes de emitir" checklist: what the AI flagged (inconsistencies and
// assumptions), the lines it priced outside the price base, and chapters whose
// €/m² is far from the tenant's other budgets. Computed on every read; only
// which items staff ticked is stored (`budget_revisions.review`).
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
  chapters: LoadedChapter[];
  builtAreaCm2: number | null;
  ratios: Record<string, number>;
  done: Set<string>;
}): BudgetCheck[] {
  const { texts, chapters, builtAreaCm2, ratios, done } = input;
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
  if (builtAreaCm2) {
    for (const chapter of chapters) {
      const averageCents = ratios[chapter.code];
      if (chapter.code === CONTINGENCY_CHAPTER || !averageCents || chapter.totalCents === 0) continue;
      const perM2Cents = perM2(chapter.totalCents, builtAreaCm2)!;
      if (Math.abs(perM2Cents / averageCents - 1) <= RATIO_TOLERANCE) continue;
      const key = checkKey.ratio(chapter.code);
      checks.push({
        key,
        kind: "ratio",
        title: `${chapter.code} ${chapter.name}`,
        detail: "",
        ref: chapter.code,
        chapterCode: chapter.code,
        done: done.has(key),
        perM2Cents,
        averageCents,
      });
    }
  }
  return checks;
}

/**
 * The tenant's average €/m² built per chapter code (cents), over the issued
 * and accepted FRAMER budgets of its other projects.
 */
export async function tenantRatios(tenantId: string, projectId: string): Promise<Record<string, number>> {
  const rows = (await db.execute(sql`
    select code, round(avg(total * 100.0 / area))::int as average
    from (
      select chapter.code, revision.built_area_cm2 as area,
        sum(round(line.quantity_milli::numeric * line.unit_price_cents / 1000)) as total
      from budget_lines as line
      join budget_chapters as chapter on chapter.id = line.chapter_id
      join budget_revisions as revision on revision.id = chapter.revision_id
      where revision.tenant_id = ${tenantId}
        and revision.project_id <> ${projectId}
        and revision.model = ${BUDGET_MODEL}
        and revision.status in ('issued', 'accepted')
        and revision.built_area_cm2 > 0
        and chapter.kind = 'chapter'
      group by chapter.id, chapter.code, revision.built_area_cm2
    ) as chapters
    group by code
  `)) as unknown as { code: string; average: number }[];
  return Object.fromEntries(rows.map((r) => [r.code, Number(r.average)]));
}
