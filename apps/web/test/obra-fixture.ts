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
    id: "line-1",
    code: "05.01",
    description: "Panel Thermochip TFbcY 12-60-12 en fachada",
    unit: "m²",
    quantity: 300.96,
    unitPriceCents: 9_800,
    amountCents: 2_949_408,
    executedPct: 100,
    ...overrides,
  };
}

export function chapter(overrides: Partial<BudgetChapter> = {}): BudgetChapter {
  return {
    id: "chapter-05",
    code: "05",
    name: "Envolvente Térmica — Paneles Thermochip",
    changeNote: null,
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
    ...overrides,
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

export const budget: ProjectBudget = {
  revisions: [
    { id: "rev-3", number: 3, status: "accepted", totalCents: 44_820_503, acceptedAt: "2026-06-12T10:00:00.000Z" },
    { id: "rev-2", number: 2, status: "superseded", totalCents: 41_950_073, acceptedAt: null },
  ],
  revision: {
    id: "rev-3",
    number: 3,
    status: "accepted",
    totalCents: 44_820_503,
    acceptedAt: "2026-06-12T10:00:00.000Z",
    reference: "036/2026",
    vatRateBp: 1000,
    vatCents: 4_482_050,
    builtAreaM2: 253.45,
    usefulAreaM2: 208.25,
    exclusions: ["Estudio geotécnico", "Mobiliario"],
    previous: { number: 2, totalCents: 41_950_073 },
    removedChapters: [],
    chapters: [
      chapter({ previousTotalCents: 3_000_000, change: "up", changeNote: "Precio de mercado" }),
      chapter({ id: "chapter-16", code: "16", name: "Seguridad y Salud", totalCents: 870_000, change: "new", shareBp: 194, hitoCode: "H9", lines: [] }),
    ],
  },
};
