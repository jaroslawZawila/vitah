import { defaultTexts } from "../budget-template";
import type { BudgetTexts } from "../contract";
import { priceBaseItem } from "../price-base";
import type { ChapterLines, ProjectExtraction } from "./schemas";

// ─── From the AI's answers to a draft ─────────────────────────────────────────
// Pure (features/budget/PROMPTS_IA.md §1 "Post-proceso"): lines with no
// quantity or price are dropped, codes outside the group are dropped, prices
// become cents and quantities thousandths-safe; the texts fill the PDF's.
// ─────────────────────────────────────────────────────────────────────────────

export type DraftLine = {
  chapter: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  source: "base" | "estimated";
  baseCode: string | null;
  note: string | null;
};

const MAX_DESCRIPTION = 2_000;
const MAX_UNIT = 10;
const MAX_NOTE = 2_000;

/** One group's lines, in the order the AI gave them. */
export function toDraftLines(result: ChapterLines, group: readonly string[]) {
  const lines: DraftLine[] = [];
  for (const chapter of result.capitulos) {
    const code = chapter.cod.trim().padStart(2, "0");
    if (!group.includes(code)) continue;
    chapter.partidas.forEach((line, i) => {
      const quantity = Math.round(line.med * 1000) / 1000;
      const unitPriceCents = Math.round(line.pu * 100);
      const description = line.desc.trim().slice(0, MAX_DESCRIPTION);
      if (!(quantity > 0 && unitPriceCents > 0 && description)) return;
      const given = line.cod.trim();
      const lineCode = given || `${code}.${String(i + 1).padStart(2, "0")}`;
      const estimated = line.fuente === "estimado";
      lines.push({
        chapter: code,
        code: lineCode.slice(0, 20),
        description,
        unit: (line.ud.trim() || "ud").slice(0, MAX_UNIT),
        quantity,
        unitPriceCents,
        source: estimated ? "estimated" : "base",
        baseCode: !estimated && given && priceBaseItem(given) ? given : null,
        note: line.nota.trim().slice(0, MAX_NOTE) || null,
      });
    });
  }
  return lines;
}

const m2 = (value: number) => value.toLocaleString("es-ES", { maximumFractionDigits: 2 });

/** The PDF's texts from step 1, over the defaults (kept where the AI gave nothing). */
export function toTexts(e: ProjectExtraction): BudgetTexts {
  const defaults = defaultTexts();
  const { datos } = e;
  const surfaces = [
    datos.m2c ? `${m2(datos.m2c)} m² construidos` : "",
    datos.m2u ? `${m2(datos.m2u)} m² útiles` : "",
    e.superficies.terrazas ? `terrazas ${m2(e.superficies.terrazas)} m²` : "",
  ];
  const cadastral = [
    datos.refCatastral ? `Ref. catastral ${datos.refCatastral}` : "",
    datos.parcela ? `Parcela de ${m2(datos.parcela)} m²` : "",
  ];
  return {
    cover: {
      promoter: datos.cliente,
      site: [datos.ubicacion, datos.municipio, datos.provincia ? `(${datos.provincia})` : ""].filter(Boolean).join(", ").replace(", (", " ("),
      cadastral: cadastral.filter(Boolean).join(" · "),
      surfaces: surfaces.filter(Boolean).join(" · "),
      program: e.portada.programa,
      basis: e.portada.base,
      scope: e.portada.alcance,
      system: e.portada.sistemaConstructivo,
    },
    justification: {
      intro: e.justificacion.intro || defaults.justification.intro,
      blocks: e.justificacion.apartados.map((a) => ({ title: a.titulo.replace(/\.$/, ""), text: a.texto })),
    },
    measurementCriterion: e.criterioMedicion,
    annex: [
      ...e.incoherencias.map((i, n) => ({ id: `i${n + 1}`, kind: "inconsistency" as const, title: i.titulo, text: i.texto })),
      ...e.supuestos.map((s, n) => ({ id: `s${n + 1}`, kind: "assumption" as const, title: s.titulo, text: s.texto })),
    ],
    exclusions: e.noIncluido.length > 0 ? e.noIncluido : defaults.exclusions,
    includes: defaults.includes,
  };
}

/** The AI's notes for chapters 01–19 ("Sustituye a…"), by code. */
export function chapterNotes(e: ProjectExtraction): Map<string, string> {
  return new Map(
    e.notasCapitulo
      .map((n) => [n.cod.trim().padStart(2, "0"), n.nota.trim()] as const)
      .filter(([code, note]) => note && code >= "01" && code <= "19"),
  );
}
