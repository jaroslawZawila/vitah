import ExcelJS from "exceljs";

// ─── Measurements ─────────────────────────────────────────────────────────────
// A project's "estado de mediciones" arrives as BC3 (FIEBDC-3) or Excel. Both
// become rows first, then text for the prompt: the rows are what could later
// come from the database instead of a file (TECH_DESIGN §6.3).
// ─────────────────────────────────────────────────────────────────────────────

export type MeasurementRow = { chapter: string; code: string; description: string; unit: string; quantity: number };

const numberOf = (raw: string | undefined) => {
  const value = Number((raw ?? "").replace(",", "."));
  return Number.isFinite(value) ? value : 0;
};

/** Older BC3 files are Windows-1252 ("ANSI"); newer ones may be UTF-8, which never decodes by accident. */
function decodeBc3(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * FIEBDC-3: records start with `~`, fields are split by `|` and sub-fields by
 * `\`. ~C gives each concept's unit and summary (chapters' codes end in `#`),
 * ~D the children of a concept with their yield, ~M a child's measured total.
 * Measured totals win over yields.
 */
export function parseBc3(bytes: Uint8Array): MeasurementRow[] {
  const text = decodeBc3(bytes);
  const records = text.split("~").map((r) => r.replace(/[\r\n]+$/g, "").split("|"));
  const concepts = new Map<string, { unit: string; summary: string }>();
  const children = new Map<string, { code: string; quantity: number }[]>();
  const measured = new Map<string, number>();
  const clean = (code: string) => code.replace(/#+$/, "").trim();

  for (const [type, ...fields] of records) {
    if (type === "C") {
      const codes = (fields[0] ?? "").split("\\").filter(Boolean);
      for (const code of codes) concepts.set(clean(code), { unit: fields[1] ?? "", summary: (fields[2] ?? "").trim() });
    } else if (type === "D") {
      const parent = clean(fields[0] ?? "");
      const parts = (fields[1] ?? "").split("\\");
      const list: { code: string; quantity: number }[] = [];
      for (let i = 0; i < parts.length; i += 3) {
        const code = clean(parts[i] ?? "");
        if (!code) continue;
        // FACTOR and RENDIMIENTO are both optional, 1 when empty.
        const factor = parts[i + 1] ? numberOf(parts[i + 1]) : 1;
        list.push({ code, quantity: factor * (parts[i + 2] ? numberOf(parts[i + 2]) : 1) });
      }
      children.set(parent, list);
    } else if (type === "M") {
      const [parent, child] = (fields[0] ?? "").split("\\");
      if (child) measured.set(`${clean(parent ?? "")}/${clean(child)}`, numberOf(fields[2]));
    }
  }

  const rows: MeasurementRow[] = [];
  const root = [...children.keys()].find((code) => !code.includes(".") && ![...children.values()].some((list) => list.some((c) => c.code === code)));
  const visit = (parent: string, chapter: string, depth: number) => {
    for (const child of children.get(parent) ?? []) {
      const concept = concepts.get(child.code);
      if (children.has(child.code) && depth < 6 && !concept?.unit) {
        visit(child.code, concept?.summary ?? child.code, depth + 1);
        continue;
      }
      const quantity = measured.get(`${parent}/${child.code}`) ?? child.quantity;
      rows.push({ chapter, code: child.code, description: concept?.summary ?? "", unit: concept?.unit ?? "", quantity });
    }
  };
  if (root) visit(root, concepts.get(root)?.summary ?? "", 0);
  return rows;
}

/** Each sheet of a workbook as rows of text cells (the model reads the columns). */
export async function parseXlsx(bytes: Uint8Array): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheets: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines: string[] = [];
    sheet.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "");
        if (typeof v === "object" && "richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
        return String(v);
      });
      if (values.some((v) => v.trim())) lines.push(values.join(" | "));
    });
    sheets.push(`## ${sheet.name}\n${lines.join("\n")}`);
  });
  return sheets.join("\n\n");
}

/** Rows as the prompt shows them: one per line, grouped by chapter. */
export function measurementText(rows: MeasurementRow[]) {
  const lines: string[] = [];
  let chapter: string | null = null;
  for (const row of rows) {
    if (row.chapter !== chapter) {
      chapter = row.chapter;
      lines.push(`## ${chapter}`);
    }
    lines.push(`${row.code} | ${row.description} | ${row.unit} | ${row.quantity}`);
  }
  return lines.join("\n");
}
