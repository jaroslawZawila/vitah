// ─── Standard payment plan (hitos H0–H9) ──────────────────────────────────────
// Every project starts with FRAMER's standard plan: §4 of the budget model
// (presupuesto 036/2026 Rev.3, Castrillón). Staff adjust the % and scope, and
// which budget chapters each hito closes, per project (PROCESS.md §4, §8.3).
// The chapter codes follow the Castrillón chapter numbering.
// ─────────────────────────────────────────────────────────────────────────────

type HitoTemplate = {
  code: string;
  name: string;
  pctBp: number;
  scope: string;
  billingMoment: string;
  chapterCodes: string[];
  checks: string[];
};

/** §7 of the budget: the documents handed over with the keys. */
const HANDOVER_DOCUMENTS = [
  "Certificado Final de Obra (CFO) visado por la Dirección Facultativa",
  "Libro del Edificio: actas, listado de industriales y Manual de Uso y Mantenimiento",
  "Trazabilidad de materiales: acero S350GD / Magnelis, Thermochip, Weber.pral Finish",
  "Resultado de la prueba Blower Door",
  "Ensayos acústicos conforme al DB-HR",
  "Certificado de Eficiencia Energética del edificio terminado",
  "Pruebas de estanqueidad de fontanería y saneamiento",
  "Verificación del sistema anti-radón (DB-HS 6)",
  "Acta de Recepción de la obra (art. 6 LOE)",
];

export const HITO_TEMPLATE: HitoTemplate[] = [
  {
    code: "H0",
    name: "Señal de reserva",
    pctBp: 500,
    scope:
      "Firma del contrato. Blinda el precio del acero en fábrica y activa la apertura del expediente BIM y las gestiones de licencia.",
    billingMoment: "En la firma del contrato",
    chapterCodes: [],
    checks: [],
  },
  {
    code: "H1",
    name: "Ingeniería BIM, proyecto y licencia",
    pctBp: 700,
    scope:
      "Gemelo digital completo, cálculo estructural visado por técnico competente, proyecto de ejecución y obtención de la Licencia Municipal de Obras.",
    billingMoment: "Entrega del modelo BIM y de la licencia",
    chapterCodes: [],
    checks: ["Modelo BIM entregado", "Licencia Municipal de Obras concedida"],
  },
  {
    code: "H2",
    name: "Cimentación",
    pctBp: 1200,
    scope: "Losa HA-25 de 25 cm, cámara sanitaria anti-radón DB-HS 6 y saneamiento bajo rasante.",
    billingMoment: "Finalización de la losa y el saneamiento",
    chapterCodes: ["01", "02", "03"],
    checks: [],
  },
  {
    code: "H3",
    name: "Estructura Steel Frame",
    pctBp: 1500,
    scope: "Montaje completo del esqueleto S350GD / Magnelis: muros estructurales, forjados y cubierta CNC.",
    billingMoment: "Estructura levantada",
    chapterCodes: ["04"],
    checks: [],
  },
  {
    code: "H4",
    name: "Envolvente estanca",
    pctBp: 1300,
    scope:
      "Thermochip en fachada y cubierta, carpintería PVC de triple vidrio con persianas. Prueba de estanqueidad provisional.",
    billingMoment: "Vivienda cerrada al agua y al aire",
    chapterCodes: ["05", "07", "10"],
    checks: ["Prueba de estanqueidad provisional"],
  },
  {
    code: "H5",
    name: "Fontanería",
    pctBp: 1000,
    scope: "Red Uponor PEX-a, descalcificador, sanitarios Roca Hall y grifería. Prueba de estanqueidad de toda la red.",
    billingMoment: "Red de fontanería probada",
    chapterCodes: ["12"],
    checks: ["Prueba de estanqueidad de toda la red"],
  },
  {
    code: "H6",
    name: "Electricidad y telecomunicaciones",
    pctBp: 800,
    scope:
      "Mecanismos Niessen Arco, cuadro Legrand de 48 elementos, preinstalación fotovoltaica, punto de recarga VE y red de telecomunicaciones Cat.6.",
    billingMoment: "Cuadro eléctrico y circuitos completos",
    chapterCodes: ["13"],
    checks: [],
  },
  {
    code: "H7",
    name: "Climatización y ventilación",
    pctBp: 800,
    scope: "Aerotermia Mitsubishi Ecodan R32 A+++, suelo radiante Uponor, acumulador ACS de 200 L y VMC HCC2 PLA F7.",
    billingMoment: "Sistemas climáticos probados",
    chapterCodes: ["14"],
    checks: ["Puesta en marcha y equilibrado de los sistemas"],
  },
  {
    code: "H8",
    name: "Acabados y fachada",
    pctBp: 1900,
    scope:
      "Pladur Q3, solados Porcelanosa, alicatados, carpintería de haya maciza, mortero Weber.pral Finish y pintura acrílica.",
    billingMoment: "Acabados exteriores e interiores completos",
    chapterCodes: ["06", "08", "09", "11"],
    checks: [],
  },
  {
    code: "H9",
    name: "Entrega de llaves",
    pctBp: 300,
    scope: "Llaves, CFO visado, Libro del Edificio, Blower Door y Certificado de Eficiencia Energética.",
    billingMoment: "Contra entrega de llaves y CFO",
    chapterCodes: ["15", "16", "17"],
    checks: HANDOVER_DOCUMENTS,
  },
];
