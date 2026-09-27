import type { Hito, MobileObra, MobilePhase } from "@repo/core/contract";

// A half-built obra (budget 036/2026 Rev.3): pre-construction, foundation and
// structure done, the envelope under way, H3 invoiced.

export function hito(overrides: Partial<Hito> = {}): Hito {
  return {
    id: "h4",
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
    checks: [{ id: "c1", label: "Prueba de estanqueidad provisional", done: false }],
    photoIds: [],
    actaSignedOn: null,
    invoicedOn: null,
    dueOn: null,
    paidOn: null,
    paidAmountCents: null,
    ...overrides,
  };
}

const priced = (h: Partial<Hito>) => hito({ ...h, totalCents: (h.amountCents ?? 0) + (h.vatCents ?? 0) });

export const hitos: Hito[] = [
  priced({ id: "h0", code: "H0", name: "Señal de reserva", pctBp: 500, amountCents: 2_241_025, vatCents: 224_103, status: "paid", paidOn: "2026-02-03", paidAmountCents: 2_465_128, chapters: [], checks: [], readyPct: 0, billingMoment: "En la firma del contrato" }),
  priced({ id: "h1", code: "H1", name: "Ingeniería BIM, proyecto y licencia", pctBp: 700, amountCents: 3_137_435, vatCents: 313_744, status: "paid", paidOn: "2026-04-20", paidAmountCents: 3_451_179, chapters: [], checks: [{ id: "c0", label: "Licencia Municipal de Obras concedida", done: true }], readyPct: 0 }),
  priced({ id: "h3", code: "H3", name: "Estructura Steel Frame", pctBp: 1500, amountCents: 6_723_075, vatCents: 672_308, status: "invoiced", readyPct: 100, chapters: [{ code: "04", name: "Estructura Steel Frame e Ingeniería BIM", totalCents: 6_639_485, progressPct: 100 }], checks: [], photoIds: ["p1", "p2"], actaSignedOn: "2026-09-24", invoicedOn: "2026-09-24", dueOn: "2026-10-01", scope: "Montaje completo del esqueleto S350GD / Magnelis.", billingMoment: "Estructura levantada" }),
  hito(),
  priced({ id: "h9", code: "H9", name: "Entrega de llaves", pctBp: 300, amountCents: 1_344_615, vatCents: 134_462, status: "pending", readyPct: 0, chapters: [{ code: "15", name: "Urbanización", totalCents: 1_018_202, progressPct: 0 }], checks: [], billingMoment: "Contra entrega de llaves y CFO" }),
];

const phase = (overrides: Partial<MobilePhase>): MobilePhase => ({
  key: "H4",
  name: "Envolvente estanca",
  status: "active",
  progressPct: 69,
  finishedOn: null,
  hitoIds: ["h4"],
  chapters: hitos[3]!.chapters,
  checks: [{ id: "c1", label: "Prueba de estanqueidad provisional", done: false }],
  photoIds: ["p1"],
  photoCount: 1,
  ...overrides,
});

export const obra: MobileObra = {
  stage: 6,
  progressPct: 52,
  totalCents: 44_820_503,
  vatRateBp: 1000,
  paidCents: 5_378_460,
  term: { startDate: "2026-05-04", completionDate: "2027-02-05", week: 21, totalWeeks: 40, lateDays: 0 },
  currentPhaseKey: "H4",
  phases: [
    phase({ key: "pre", name: null, status: "done", progressPct: 100, finishedOn: "2026-04-20", hitoIds: ["h0", "h1"], chapters: [], checks: [], photoIds: [], photoCount: 0 }),
    phase({ key: "H3", name: "Estructura Steel Frame", status: "done", progressPct: 100, finishedOn: "2026-09-24", hitoIds: ["h3"], chapters: hitos[2]!.chapters, checks: [], photoIds: [], photoCount: 0 }),
    phase({}),
    phase({ key: "H9", name: "Entrega de llaves", status: "pending", progressPct: 0, hitoIds: ["h9"], chapters: hitos[4]!.chapters, checks: [], photoIds: [], photoCount: 0 }),
  ],
  hitos,
};
