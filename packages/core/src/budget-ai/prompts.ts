import { CHAPTER_NAMES } from "../budget-template";
import type { BudgetQuality } from "../contract";
import { priceBaseForChapters } from "../price-base";

// ─── Prompts ──────────────────────────────────────────────────────────────────
// features/budget/PROMPTS_IA.md §1, step by step. The answers' shapes are
// enforced by structured outputs (schemas.ts), so the prompts describe what
// to put in each field rather than how to write JSON.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE =
  "Eres el técnico de presupuestos de FRAMER, constructora de viviendas industrializadas con estructura Steel Frame " +
  "(perfiles S350GD Magnelis, paneles Thermochip, aerotermia, suelo radiante, VMC).";

export const QUALITY_TEXT: Record<BudgetQuality, string> = {
  framer: "Memoria de calidades FRAMER estándar",
  project: "Respetar las calidades del proyecto",
};

/** Step 1: read the project's documents (attached before this text). */
export function extractionPrompt(hasMeasurements: boolean) {
  return {
    system: `${ROLE} Lees la documentación de un proyecto y extraes los datos para presupuestarlo y redactar su presupuesto.`,
    instruction: [
      "Lee la documentación adjunta de este proyecto (y las imágenes de sus planos) y extrae los datos para presupuestarlo.",
      "",
      "- datos, superficies, recuento y mediciones: lo que dicen los documentos. Usa 0 o \"\" cuando un dato no aparezca y explícalo en supuestos. No inventes nombres ni referencias.",
      "- sistema: resumen del sistema constructivo y calidades del proyecto en 5-8 líneas.",
      "- incoherencias: contradicciones entre documentos (título corto + qué dice cada documento y cómo conviene presupuestarlo).",
      "- supuestos: datos que faltan y cómo se han supuesto (título corto + explicación).",
      "- portada: textos para la portada del presupuesto: programa (estancias), base (proyecto de referencia, autor y fecha, adaptado al sistema FRAMER Steel Frame conforme a la Memoria de Calidad FRAMER 4.0), alcance y sistemaConstructivo (2-4 líneas cada uno).",
      "- justificacion: la justificación técnica de la adaptación del proyecto al sistema Steel Frame: una introducción y un apartado por elemento que cambia o se conserva (estructura vertical, cubierta, cimentación y forjado sanitario, envolvente, instalaciones, carpintería, elementos no ejecutados en Steel Frame…), cada uno con un título corto y un párrafo técnico.",
      `- criterioMedicion: de dónde salen las mediciones. ${hasMeasurements ? "Se ha facilitado el estado de mediciones: explica cómo se ha contrastado con los planos." : "No se ha facilitado el estado de mediciones: di que se ha medido sobre los planos acotados, que las mediciones son estimativas y que el Capítulo 20 (Imprevistos) absorbe las desviaciones."}`,
      "- notasCapitulo: para los capítulos que cambian respecto al proyecto, una nota de 1-2 frases (p. ej. \"Sustituye a los pilares de hormigón… \"), con el código del capítulo FRAMER (01–19).",
      "- noIncluido: gastos que no incluye el presupuesto, adaptados a este proyecto (geotécnico, honorarios, licencia e ICIO, IVA, acometidas, mobiliario…), cada uno en una frase que empieza por el concepto.",
      "",
      `Capítulos FRAMER: ${Object.entries(CHAPTER_NAMES)
        .map(([code, name]) => `${code} ${name}`)
        .join("; ")}.`,
    ].join("\n"),
  };
}

export const GROUPS = [
  ["01", "02", "03", "04", "05"],
  ["06", "07", "08", "09", "10"],
  ["11", "12", "13", "14", "15"],
  ["16", "17", "18", "19"],
] as const;

/** Steps 2–5: the system prompt and the part every group shares (cached). */
export function groupPrompt(quality: BudgetQuality, extracted: unknown, measurements: string) {
  return {
    system: `${ROLE} Generas las partidas de un presupuesto adaptando el proyecto al sistema FRAMER (${QUALITY_TEXT[quality]}).`,
    shared: [
      `DATOS DEL PROYECTO (JSON): ${JSON.stringify(extracted)}`,
      measurements ? `MEDICIONES DEL PROYECTO:\n${measurements}` : "MEDICIONES DEL PROYECTO: no se han facilitado; mide con los datos y superficies.",
    ].join("\n\n"),
  };
}

/** One group's instruction and its slice of the price base. */
export function groupInstruction(chapters: readonly string[]) {
  const base = priceBaseForChapters([...chapters])
    .map((item) => `${item.code} | ${item.description} | ${item.unit} | ${(item.unitPriceCents / 100).toFixed(2)}`)
    .join("\n");
  return [
    `Genera las partidas de los capítulos ${chapters.map((c) => `${c} ${CHAPTER_NAMES[c]}`).join("; ")}.`,
    "Reglas:",
    "- Usa las partidas de la BASE DE PRECIOS FRAMER 2026 siempre que encajen, con su código, unidad y P.U. (los P.U. son costes de ejecución, sin gastos generales ni beneficio industrial: se suman aparte en el resumen; no añadas nada). fuente = \"base\".",
    "- Las mediciones salen de los datos, superficies y mediciones del proyecto. Si estimas una medición, dilo en nota; si no, nota = \"\".",
    "- Si hace falta una partida que no está en la base, créala con código del capítulo y .9x (p. ej. 06.91), P.U. de coste de mercado razonable (sin gastos generales ni beneficio) y fuente = \"estimado\".",
    "- No incluyas imprevistos (el capítulo 20 se calcula aparte). Un capítulo puede quedar sin partidas si el proyecto no lo necesita.",
    "- desc: la descripción completa de la unidad de obra, adaptada a este proyecto.",
    "",
    "BASE DE PRECIOS (código | descripción | ud | P.U. de coste €):",
    base,
  ].join("\n");
}
