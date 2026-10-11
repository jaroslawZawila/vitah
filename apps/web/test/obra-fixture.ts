import type {
  BudgetChapter,
  BudgetLine,
  Hito,
  ProjectBudget,
  ProjectObra,
} from "@repo/core/contract";

// Static data for the obra screens' tests: a slice of budget 036/2026 Rev.3.

export function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    lineageId: `lineage-${overrides.id ?? "line-1"}`,
    id: "line-1",
    code: "05.01",
    description: "Panel Thermochip TFbcY 12-60-12 en fachada",
    unit: "m²",
    quantity: 300.96,
    unitPriceCents: 9_800,
    amountCents: 2_949_408,
    executedPct: 100,
    source: "base",
    baseCode: null,
    note: null,
    ...overrides,
  };
}

export function chapter(overrides: Partial<BudgetChapter> = {}): BudgetChapter {
  const merged: Omit<BudgetChapter, "computed" | "lineCount"> & Partial<BudgetChapter> = {
    id: "chapter-05",
    code: "05",
    name: "Envolvente Térmica — Paneles Thermochip",
    changeNote: null,
    pdfNote: null,
    totalCents: 3_505_603,
    executedCents: 3_283_147,
    progressPct: 94,
    status: "active",
    shareBp: 1926,
    previousTotalCents: null,
    change: null,
    hitoCode: "H4",
    lines: [
      line(),
      line({ id: "line-2", code: "05.03", description: "Barrera de vapor Blowerproof", quantity: 604.56, unitPriceCents: 920, amountCents: 556_195, executedPct: 60 }),
    ],
    perM2Cents: null,
    ...overrides,
  };
  // What core derives from the lines, unless given.
  return {
    computed: merged.lines.some((l) => l.source === "computed"),
    lineCount: merged.lines.filter((l) => l.source !== "computed").length,
    ...merged,
  };
}

export function hito(overrides: Partial<Hito> = {}): Hito {
  return {
    id: "hito-h4",
    code: "H4",
    name: "Envolvente estanca",
    pctBp: 1300,
    amountCents: 5_826_665,
    vatCents: 582_667,
    totalCents: 6_409_332,
    scope: "Thermochip en fachada y cubierta, carpintería PVC de triple vidrio con persianas.",
    billingMoment: "Vivienda cerrada al agua y al aire",
    status: "active",
    readyPct: 69,
    chapters: [
      { code: "05", name: "Envolvente Térmica — Paneles Thermochip", totalCents: 8_630_439, progressPct: 80 },
      { code: "07", name: "Cubiertas y Recogida de Aguas Pluviales", totalCents: 2_501_308, progressPct: 60 },
    ],
    checks: [{ id: "check-1", label: "Prueba de estanqueidad provisional", done: false }],
    photoIds: [],
    actaSignedOn: null,
    invoicedOn: null,
    dueOn: null,
    paidOn: null,
    paidAmountCents: null,
    ...overrides,
  };
}

/** A hito with its total = amount + VAT. */
const priced = (overrides: Partial<Hito>) =>
  hito({ ...overrides, totalCents: (overrides.amountCents ?? 0) + (overrides.vatCents ?? 0) });

export const hitos: Hito[] = [
  priced({ id: "hito-h0", code: "H0", name: "Señal de reserva", pctBp: 500, amountCents: 2_241_025, vatCents: 224_103, status: "paid", chapters: [], checks: [], readyPct: 0, paidOn: "2026-02-03", paidAmountCents: 2_465_128, billingMoment: "En la firma del contrato" }),
  priced({ id: "hito-h1", code: "H1", name: "Ingeniería BIM, proyecto y licencia", pctBp: 700, amountCents: 3_137_435, vatCents: 313_744, status: "paid", chapters: [], checks: [], readyPct: 0, paidOn: "2026-04-20", paidAmountCents: 3_451_179 }),
  priced({ id: "hito-h3", code: "H3", name: "Estructura Steel Frame", pctBp: 1500, amountCents: 6_723_075, vatCents: 672_308, status: "invoiced", chapters: [{ code: "04", name: "Estructura Steel Frame e Ingeniería BIM", totalCents: 6_639_485, progressPct: 100 }], checks: [], readyPct: 100, actaSignedOn: "2026-09-24", invoicedOn: "2026-09-24", dueOn: "2026-10-01" }),
  hito(),
];

export const obra: ProjectObra = {
  stage: 6,
  budget: {
    revisionId: "rev-3",
    number: 3,
    reference: "036/2026",
    totalCents: 44_820_503,
    vatRateBp: 1000,
    acceptedAt: "2026-06-12T10:00:00.000Z",
  },
  executedCents: 23_285_684,
  progressPct: 52,
  paidCents: 5_378_460,
  invoicedUnpaidCents: 6_723_075,
  toInvoiceCents: 32_718_968,
  planPctBp: 4000,
  term: {
    startDate: "2026-05-04",
    completionDate: "2027-02-05",
    week: 21,
    totalWeeks: 40,
    lateDays: 0,
    penaltyCents: 0,
  },
  chapters: [
    { code: "04", name: "Estructura Steel Frame e Ingeniería BIM", totalCents: 6_639_485, executedCents: 6_639_485, progressPct: 100, status: "done", shareBp: 1481, hitoCode: "H3" },
    { code: "05", name: "Envolvente Térmica — Paneles Thermochip", totalCents: 8_630_439, executedCents: 6_902_060, progressPct: 80, status: "active", shareBp: 1926, hitoCode: "H4" },
    { code: "06", name: "Fachada — Mortero Monocapa", totalCents: 1_533_984, executedCents: 0, progressPct: 0, status: "pending", shareBp: 342, hitoCode: null },
  ],
  hitos,
};

/** A FRAMER draft (Rev.1, Rev.0 issued): chapters 01, 05 with lines, 20 computed, one option. */
export const budget: ProjectBudget = {
  revisions: [
    { id: "rev-1", number: 1, status: "draft", totalCents: 3_855_478, acceptedAt: null, issuedOn: null },
    { id: "rev-0", number: 0, status: "issued", totalCents: 3_680_883, acceptedAt: null, issuedOn: "2026-10-14" },
  ],
  revision: {
    id: "rev-1",
    number: 1,
    status: "draft",
    totalCents: 3_855_478,
    acceptedAt: null,
    issuedOn: null,
    reference: "041/2026",
    vatRateBp: 1000,
    vatCents: 385_548,
    builtAreaM2: 184.91,
    usefulAreaM2: 139.7,
    exclusions: ["Estudio geotécnico", "Mobiliario"],
    previous: { number: 0, totalCents: 3_680_883 },
    removedChapters: [],
    lineCount: 4,
    perM2Cents: 2_085_067,
    optionTotals: { adding: { count: 1, cents: 4_597_500 }, subtracting: { count: 0, cents: 0 } },
    chapters: [
      chapter({ id: "chapter-01", code: "01", name: "Actuaciones previas y movimiento de tierras", totalCents: 166_256, shareBp: 431, hitoCode: "H2", lines: [line({ id: "line-01", code: "01.01", description: "Replanteo", unit: "ud", quantity: 1, unitPriceCents: 166_256, amountCents: 166_256, executedPct: 0 })] }),
      chapter({ previousTotalCents: 3_340_000, change: "up", pdfNote: "Sustituye al SATE del proyecto", lines: [line(), line({ id: "line-2", code: "05.91", description: "Remates de chapa", quantity: 1, unitPriceCents: 556_195, amountCents: 556_195, executedPct: 0, source: "estimated", note: "Precio de mercado" })] }),
      chapter({ id: "chapter-20", code: "20", name: "Imprevistos", totalCents: 183_619, shareBp: 476, hitoCode: "H9", lines: [line({ id: "line-20", code: "20.01", description: "Fondo de imprevistos equivalente al 5 % del importe de los capítulos 01 a 19", unit: "pa", quantity: 1, unitPriceCents: 183_619, amountCents: 183_619, executedPct: 0, source: "computed" })] }),
    ],
    model: "framer20",
    options: [
      {
        id: "option-1",
        code: "OP1",
        name: "Piscina desbordante",
        changeNote: null,
        pdfNote: "Fuera del PEC a petición del promotor",
        totalCents: 4_597_500,
        executedCents: 0,
        progressPct: 0,
        status: "pending",
        previousTotalCents: 4_597_500,
        change: null,
        hitoCode: null,
        optionKind: "extra",
        replacesLine: null,
        chosen: null,
        computed: false,
        lineCount: 1,
        perM2Cents: null,
        lines: [line({ id: "line-op1", code: "OP.01", description: "Vaso de hormigón armado", unit: "m³", quantity: 22, unitPriceCents: 42_000, amountCents: 924_000, executedPct: 0 })],
      },
    ],
    contractTotalCents: 3_855_478,
    contingencyBp: 500,
    quality: "framer",
    texts: {
      cover: { promoter: "D. Roberto Guzmán Mesa", site: "C/ de la Arboleda 3, Zarzalejo (Madrid)", cadastral: "", surfaces: "184,91 m² construidos", program: "Salón, cocina", basis: "Proyecto de Ejecución", scope: "Llave en mano", system: "Steel Frame" },
      justification: { intro: "El proyecto se adapta…", blocks: [{ title: "Estructura vertical", text: "Muros C150" }] },
      measurementCriterion: "Sobre el BC3",
      annex: [{ id: "i1", kind: "inconsistency", title: "Carga de nieve", text: "E1 frente a E4" }],
      exclusions: ["Estudio geotécnico", "Mobiliario"],
      includes: "El movimiento de tierras",
    },
    conditions: { validityDays: 90, term: "8 a 10 meses", penalty: "150 €/día", signingPlace: "Zarzalejo" },
    changeReason: "Mediciones del BC3",
    validUntil: null,
    acceptedOn: null,
    acceptedBy: null,
    rejectedOn: null,
    pdfs: { general: null, detailed: null },
    checks: [
      { key: "annex:i1", kind: "inconsistency", title: "Carga de nieve", detail: "E1 frente a E4", ref: null, chapterCode: null, done: false },
      { key: "line:lineage-line-2", kind: "estimated", title: "05.91 Remates de chapa", detail: "Precio de mercado", ref: "05.91", chapterCode: "05", done: true },
    ],
    ratios: { "05": 1_500_000 },
    lineChanges: [
      { code: "05.91", description: "Remates de chapa", kind: "added", before: null, after: { quantity: 1, unitPriceCents: 556_195, amountCents: 556_195 } },
    ],
  },
  generation: null,
};
