import {
  BUDGET_CHAPTER_CODES,
  type BudgetConditions,
  type BudgetTexts,
} from "./contract";

// ─── The FRAMER budget model ──────────────────────────────────────────────────
// Every budget has the same twenty chapters (names can be adjusted per
// project, codes can't) and starts from these texts. Template:
// features/budget/PreFRAMER_Caviedes_Valdadiga_V1.pdf.
// ─────────────────────────────────────────────────────────────────────────────

export const CHAPTER_NAMES: Record<string, string> = {
  "01": "Actuaciones previas y movimiento de tierras",
  "02": "Cimentación y protección frente al radón — DB-HS 6",
  "03": "Estructura Steel Frame e ingeniería BIM",
  "04": "Albañilería, cerramientos interiores y saneamiento",
  "05": "Cubierta inclinada y recogida de aguas pluviales",
  "06": "Envolvente térmica Thermochip y acabados de fachada",
  "07": "Revestimientos interiores y falsos techos",
  "08": "Solados y alicatados",
  "09": "Urbanización y cerramientos de parcela",
  "10": "Carpintería exterior e interior",
  "11": "Fontanería y aparatos sanitarios",
  "12": "Climatización: aerotermia + suelo radiante + VMC",
  "13": "Electricidad e iluminación",
  "14": "Telecomunicaciones y seguridad",
  "15": "Protección contra incendios",
  "16": "Pinturas y varios",
  "17": "Control de calidad",
  "18": "Seguridad y salud",
  "19": "Gestión de residuos RD 105/2008",
  "20": "Imprevistos",
};

export const TEMPLATE_CHAPTERS = BUDGET_CHAPTER_CODES.map((code) => ({ code, name: CHAPTER_NAMES[code]! }));

/** Chapter 20's single line, worded for its share (500 bp → "5 %"). */
export function contingencyDescription(contingencyBp: number) {
  const pct = (contingencyBp / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 });
  return (
    `Fondo de imprevistos equivalente al ${pct} % del importe de los capítulos 01 a 19, ` +
    "destinado a absorber las desviaciones de medición propias de un presupuesto elaborado sobre planos."
  );
}

export const DEFAULT_EXCLUSIONS = [
  "Estudio Geotécnico Definitivo, imprescindible para el dimensionado definitivo de la cimentación. Debe realizarse antes del inicio de la obra.",
  "Honorarios de Dirección de Obra y Dirección de Ejecución (arquitecto y arquitecto técnico), así como las modificaciones del Proyecto de Ejecución que requiera la adaptación al sistema Steel Frame.",
  "Honorarios del Coordinador de Seguridad y Salud en fase de ejecución. El Capítulo 18 incluye únicamente los medios materiales de protección colectiva e individual.",
  "Licencia Municipal de Obras e ICIO, tasas urbanísticas y autorizaciones previas que correspondan.",
  "IVA 10 % en régimen de autopromoción de vivienda habitual (Art. 91.Uno.3.º LIVA).",
  "Extensión de las redes generales de suministro hasta el límite de la parcela y derechos de acometida y enganche de las compañías.",
  "Mobiliario, cocina amueblada y electrodomésticos.",
  "Jardinería, arbolado y tratamiento paisajístico del resto de la parcela.",
];

export const DEFAULT_INCLUDES =
  "El movimiento de tierras y la cimentación completa, la protección frente al radón del DB-HS 6, la Seguridad y Salud en medios materiales, la Gestión de Residuos conforme al RD 105/2008, el Control de Calidad con prueba Blower Door y trazabilidad del acero, y el fondo de Imprevistos del Capítulo 20.";

export function defaultTexts(): BudgetTexts {
  return {
    cover: { promoter: "", site: "", cadastral: "", surfaces: "", program: "", basis: "", scope: "", system: "" },
    justification: {
      intro:
        "El proyecto se adapta al estándar constructivo FRAMER Steel Frame conforme a la Memoria de Calidad FRAMER 4.0, manteniendo íntegramente el diseño, la distribución, las superficies y los acabados del Proyecto de Ejecución. Los cambios técnicos introducidos respecto al sistema constructivo original son los siguientes:",
      blocks: [],
    },
    measurementCriterion: "",
    annex: [],
    exclusions: [...DEFAULT_EXCLUSIONS],
    includes: DEFAULT_INCLUDES,
  };
}

export function defaultConditions(): BudgetConditions {
  return {
    validityDays: 90,
    term: "8 a 10 meses naturales desde el Acta de Inicio de Obras",
    penalty: "150 €/día natural a partir del decimoquinto día de retraso, hasta un máximo del 5 % del precio",
    signingPlace: "",
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Stored texts over the defaults: tolerant of rows written before a field existed. */
export function readTexts(stored: unknown): BudgetTexts {
  const base = defaultTexts();
  if (!isRecord(stored)) return base;
  const texts = stored as Partial<BudgetTexts>;
  return {
    cover: { ...base.cover, ...(isRecord(texts.cover) ? texts.cover : {}) },
    justification: {
      intro: texts.justification?.intro ?? base.justification.intro,
      blocks: texts.justification?.blocks ?? [],
    },
    measurementCriterion: texts.measurementCriterion ?? "",
    annex: texts.annex ?? [],
    exclusions: texts.exclusions ?? base.exclusions,
    includes: texts.includes ?? base.includes,
  };
}

export function readConditions(stored: unknown): BudgetConditions {
  return { ...defaultConditions(), ...(isRecord(stored) ? stored : {}) };
}
