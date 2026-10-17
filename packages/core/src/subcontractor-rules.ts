// ─── Subcontractor rules ──────────────────────────────────────────────────────
// The CAE (coordinación de actividades empresariales) logic of the Subcontratas
// module, pure: the documents asked of a company, its workers and each obra,
// when they expire, a company's status and a worker's site access. Nothing here
// touches the database, so the portal also runs it in the browser (the worker
// form's live "Acceso a obra" card). Shared by ./subcontractors.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const SUBCONTRACTOR_KINDS = ["company", "self_employed"] as const;
export type SubcontractorKind = (typeof SUBCONTRACTOR_KINDS)[number];

export const PREVENTION_MODES = ["external_service", "own_service", "joint_service", "employer"] as const;
export type PreventionMode = (typeof PREVENTION_MODES)[number];

/** A worker's functions that need training of their own. */
export const WORKER_ROLES = ["preventive_resource", "machine_operator"] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

export const SUBCONTRACTOR_TRADES = [
  "earthworks",
  "foundations",
  "steel_frame",
  "roofing",
  "insulation",
  "masonry",
  "plastering",
  "flooring",
  "carpentry",
  "metalwork",
  "plumbing",
  "hvac",
  "electrical",
  "telecom",
  "painting",
  "landscaping",
] as const;
export type SubcontractorTrade = (typeof SUBCONTRACTOR_TRADES)[number];

export const WORKER_CATEGORIES = [
  "site_manager",
  "foreman",
  "officer_1",
  "officer_2",
  "specialist_labourer",
  "labourer",
  "self_employed",
] as const;

export const CONTRACT_TYPES = ["permanent", "permanent_site", "temporary", "self_employed"] as const;

export const PPE_ITEMS = ["helmet", "boots", "harness", "gloves", "goggles", "hearing", "hi_vis"] as const;

export const MACHINERY = ["mewp", "welding", "crane", "scaffold", "excavator", "forklift"] as const;

/** Ley 32/2006 art. 5: at most three levels of subcontracting. */
export const MAX_CHAIN_LEVEL = 3;
/** Ley 32/2006 art. 4.4: at least 30 % of the workforce on permanent contracts. */
export const MIN_PERMANENT_SHARE = 0.3;

// ─── Document requirements ───────────────────────────────────────────────────
// The template every company, worker and obra is checked against. Ids are
// stable (stored in subcontractor_documents.requirement_id); names and legal
// bases are translated in the portal under `subcontractors.requirements.<id>`.

export type RequirementScope = "company" | "worker" | "obra";

export type DocumentRequirement = {
  id: string;
  scope: RequirementScope;
  /** Mandatory documents decide a company's status; optional ones may be "No aplica". */
  mandatory: boolean;
  /** Months a document stays valid from its issue date; null = no expiry. */
  validityMonths: number | null;
  /** Worker documents: the section of the worker's page they're listed in. */
  group?: WorkerDocGroup;
};

export const WORKER_DOC_GROUPS = ["hiring", "tpc", "training", "health", "ppe"] as const;
export type WorkerDocGroup = (typeof WORKER_DOC_GROUPS)[number];

export const SUBCONTRACTOR_REQUIREMENTS = [
  // Company, mandatory
  { id: "rea_subcontrata", scope: "company", mandatory: true, validityMonths: 36 },
  { id: "cert_aeat_contratistas", scope: "company", mandatory: true, validityMonths: 12 },
  { id: "cert_tgss", scope: "company", mandatory: true, validityMonths: 1 },
  { id: "poliza_rc_subcontrata", scope: "company", mandatory: true, validityMonths: 12 },
  { id: "concierto_spa", scope: "company", mandatory: true, validityMonths: 12 },
  { id: "evaluacion_riesgos", scope: "company", mandatory: true, validityMonths: null },
  // For the self-employed: their RETA receipt.
  { id: "rnt_mensual", scope: "company", mandatory: true, validityMonths: 1 },
  // Company, optional
  { id: "doc_maquinaria", scope: "company", mandatory: false, validityMonths: 12 },
  { id: "habilitacion_instalador", scope: "company", mandatory: false, validityMonths: null },
  { id: "escrituras_036", scope: "company", mandatory: false, validityMonths: null },
  // Per obra (the Libro de Subcontratación entry is a field of the assignment)
  { id: "adhesion_pss", scope: "obra", mandatory: true, validityMonths: null },
  // Worker
  { id: "alta_ss", scope: "worker", mandatory: true, validityMonths: null, group: "hiring" },
  { id: "tpc", scope: "worker", mandatory: false, validityMonths: 60, group: "tpc" },
  { id: "formacion_prl_inicial", scope: "worker", mandatory: false, validityMonths: null, group: "training" },
  { id: "formacion_prl_oficio", scope: "worker", mandatory: false, validityMonths: null, group: "training" },
  { id: "formacion_nivel_basico_60h", scope: "worker", mandatory: false, validityMonths: null, group: "training" },
  { id: "formacion_altura", scope: "worker", mandatory: false, validityMonths: null, group: "training" },
  { id: "formacion_andamios", scope: "worker", mandatory: false, validityMonths: null, group: "training" },
  { id: "formacion_pemp", scope: "worker", mandatory: false, validityMonths: 60, group: "training" },
  { id: "formacion_maquinaria", scope: "worker", mandatory: false, validityMonths: null, group: "training" },
  { id: "info_riesgos", scope: "worker", mandatory: true, validityMonths: null, group: "health" },
  { id: "aptitud_medica", scope: "worker", mandatory: false, validityMonths: 12, group: "health" },
  { id: "renuncia_vigilancia_salud", scope: "worker", mandatory: false, validityMonths: null, group: "health" },
  { id: "entrega_epis", scope: "worker", mandatory: true, validityMonths: null, group: "ppe" },
] as const satisfies readonly DocumentRequirement[];

export type RequirementId = (typeof SUBCONTRACTOR_REQUIREMENTS)[number]["id"];

const BY_ID = new Map<string, DocumentRequirement>(SUBCONTRACTOR_REQUIREMENTS.map((r) => [r.id, r]));

export function requirement(id: string): DocumentRequirement | undefined {
  return BY_ID.get(id);
}

export const requirementsFor = (scope: RequirementScope) =>
  SUBCONTRACTOR_REQUIREMENTS.filter((r) => r.scope === scope);

export const MANDATORY_COMPANY_REQUIREMENTS = requirementsFor("company").filter((r) => r.mandatory);

/** The worker trainings a site role needs. */
export const ROLE_TRAININGS: Record<WorkerRole, RequirementId> = {
  preventive_resource: "formacion_nivel_basico_60h",
  machine_operator: "formacion_maquinaria",
};

/** The specific trainings the budget chapters a company executes need (FRAMER chapters 01–20). */
export const CHAPTER_TRAININGS: Record<string, readonly RequirementId[]> = {
  "03": ["formacion_altura"],
  "05": ["formacion_altura"],
  "06": ["formacion_andamios"],
};

// ─── Dates ────────────────────────────────────────────────────────────────────
// Calendar dates as YYYY-MM-DD (today's: todayInSpain in ./obra-calc).

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The date `months` after `date` (clamped to the month's last day). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** When a document issued on `issuedAt` expires by default, or null if it doesn't. */
export function defaultExpiry(requirementId: string, issuedAt: string): string | null {
  const months = requirement(requirementId)?.validityMonths;
  return months ? addMonths(issuedAt, months) : null;
}

/** Days before expiry a document starts asking for attention: monthly ones a week, the rest a month. */
export function alertDays(requirementId: string): number {
  return requirement(requirementId)?.validityMonths === 1 ? 7 : 30;
}

// ─── Document state ──────────────────────────────────────────────────────────

export type DocStatus = "requested" | "uploaded" | "validated" | "rejected" | "not_applicable";

/** What the rules need of a document: its stored status and its current version's expiry. */
export type DocFacts = {
  status: DocStatus;
  expiresAt: string | null;
  /**
   * While a newer version awaits review (or was rejected), the expiry of the
   * last validated one (null: it doesn't expire). Absent when there is none.
   */
  previousValidUntil?: string | null;
};

/**
 * Where a document stands today. `missing` has nothing at all; `expired` was
 * uploaded or validated but its date has passed (it is valid through `expiresAt`);
 * `expiring` is validated and inside its alert window.
 */
export type DocState =
  | "missing"
  | "requested"
  | "uploaded"
  | "rejected"
  | "not_applicable"
  | "validated"
  | "expiring"
  | "expired";

export function docState(
  requirementId: string,
  doc: DocFacts | undefined,
  today: string,
): { state: DocState; daysLeft: number | null } {
  if (!doc) return { state: "missing", daysLeft: null };
  const daysLeft = doc.expiresAt ? daysBetween(today, doc.expiresAt) : null;
  const hasFile = doc.status === "uploaded" || doc.status === "validated";
  if (hasFile && daysLeft !== null && daysLeft < 0) return { state: "expired", daysLeft };
  if (doc.status === "validated" && daysLeft !== null && daysLeft <= alertDays(requirementId)) {
    return { state: "expiring", daysLeft };
  }
  return { state: doc.status, daysLeft };
}

/** Validated and in date: what the rules accept. */
export const isValid = (state: DocState) => state === "validated" || state === "expiring";

/**
 * The state the rules go by: a renewal uploaded early (or rejected) doesn't
 * undo the version validated before it while that one is still in date.
 */
export function standing(requirementId: string, doc: DocFacts | undefined, today: string): DocState {
  const { state } = docState(requirementId, doc, today);
  if (isValid(state) || doc?.previousValidUntil === undefined) return state;
  const previous = docState(requirementId, { status: "validated", expiresAt: doc.previousValidUntil }, today).state;
  return isValid(previous) ? previous : state;
}

// Worst first: a column standing for several documents shows the worst of them.
const SEVERITY: readonly DocState[] = [
  "expired",
  "rejected",
  "missing",
  "requested",
  "uploaded",
  "expiring",
  "validated",
  "not_applicable",
];

/** The worst of some documents' states (the soonest to expire among equals). */
export function worstBadge<B extends { state: DocState; daysLeft: number | null }>(badges: readonly B[]): B {
  return badges.reduce((a, b) => {
    const order = SEVERITY.indexOf(b.state) - SEVERITY.indexOf(a.state);
    return order < 0 || (order === 0 && (b.daysLeft ?? Infinity) < (a.daysLeft ?? Infinity)) ? b : a;
  });
}

// ─── Company status ──────────────────────────────────────────────────────────
// Computed, never set by hand. Apta: every mandatory document validated and in
// date. Bloqueada: any of them expired. Pendiente: anything else (missing,
// requested, rejected or awaiting validation).

export type CompanyStatus = "apta" | "pendiente" | "bloqueada";

export type CompanyStatusResult = {
  status: CompanyStatus;
  /** Mandatory documents that aren't valid, by what is wrong with them. */
  expired: RequirementId[];
  pending: RequirementId[];
};

export function companyStatus(
  docs: ReadonlyMap<string, DocFacts>,
  today: string,
): CompanyStatusResult {
  const expired: RequirementId[] = [];
  const pending: RequirementId[] = [];
  for (const req of MANDATORY_COMPANY_REQUIREMENTS) {
    const state = standing(req.id, docs.get(req.id), today);
    if (state === "expired") expired.push(req.id);
    else if (!isValid(state)) pending.push(req.id);
  }
  const status = expired.length > 0 ? "bloqueada" : pending.length > 0 ? "pendiente" : "apta";
  return { status, expired, pending };
}

// ─── Worker access ───────────────────────────────────────────────────────────
// Six checks, in the order the portal lists them. A worker has access when all
// pass; is blocked when one fails because something expired (or the company is
// blocked); and is pending otherwise. Every failing check says why.

export const ACCESS_RULES = ["company", "social_security", "training", "medical", "ppe", "tasks"] as const;
export type AccessRule = (typeof ACCESS_RULES)[number];

export type AccessReason =
  | { code: "company_pending" | "company_blocked" | "book_missing" | "tpc_or_training" }
  | { code: "missing" | "not_validated" | "expired"; requirementId: RequirementId };

export type AccessCheck = { rule: AccessRule; ok: boolean; blocking: boolean; reasons: AccessReason[] };

export type WorkerAccessStatus = "ok" | "pending" | "blocked";

export type WorkerAccess = { status: WorkerAccessStatus; checks: AccessCheck[] };

export type WorkerAccessInput = {
  company: CompanyStatus;
  /** The worker's own documents, by requirement id. */
  docs: ReadonlyMap<string, DocFacts>;
  roles: readonly string[];
  /** On a given obra: its PSS adhesion, whether the subcontracting book has the entry, and its chapters. */
  obra?: { pssAdhesion: DocFacts | undefined; bookEntry: boolean; chapterCodes: readonly string[] } | null;
  today: string;
};

/** The trainings a worker needs for their roles and the chapters of the obra. */
export function requiredTrainings(roles: readonly string[], chapterCodes: readonly string[] = []) {
  const ids = new Set<RequirementId>();
  for (const role of roles) {
    const id = ROLE_TRAININGS[role as WorkerRole];
    if (id) ids.add(id);
  }
  for (const code of chapterCodes) for (const id of CHAPTER_TRAININGS[code] ?? []) ids.add(id);
  return [...ids];
}

export function workerAccess(input: WorkerAccessInput): WorkerAccess {
  const { docs, today } = input;
  const state = (id: RequirementId, doc = docs.get(id)) => standing(id, doc, today);

  /** The reason a document doesn't count, or null when it does. */
  function docReason(id: RequirementId, doc = docs.get(id)): AccessReason | null {
    const s = state(id, doc);
    if (isValid(s)) return null;
    if (s === "expired") return { code: "expired", requirementId: id };
    if (s === "uploaded") return { code: "not_validated", requirementId: id };
    return { code: "missing", requirementId: id };
  }

  function check(rule: AccessRule, reasons: (AccessReason | null)[]): AccessCheck {
    const list = reasons.filter((r): r is AccessReason => r !== null);
    const blocking = list.some((r) => r.code === "expired" || r.code === "company_blocked");
    return { rule, ok: list.length === 0, blocking, reasons: list };
  }

  const companyReasons: (AccessReason | null)[] = [
    input.company === "bloqueada"
      ? { code: "company_blocked" }
      : input.company === "pendiente"
        ? { code: "company_pending" }
        : null,
  ];
  if (input.obra) {
    companyReasons.push(docReason("adhesion_pss", input.obra.pssAdhesion));
    if (!input.obra.bookEntry) companyReasons.push({ code: "book_missing" });
  }

  // A valid TPC, or the initial 8 h plus the trade's 20 h training.
  const tpc = state("tpc");
  const trained = isValid(state("formacion_prl_inicial")) && isValid(state("formacion_prl_oficio"));
  const trainingReasons: AccessReason[] = [];
  if (!isValid(tpc) && !trained) {
    trainingReasons.push(tpc === "expired" ? { code: "expired", requirementId: "tpc" } : { code: "tpc_or_training" });
  }

  // Fit for work, or a signed waiver where the law allows one.
  const medicalReasons: (AccessReason | null)[] = [];
  if (!isValid(state("renuncia_vigilancia_salud"))) medicalReasons.push(docReason("aptitud_medica"));

  const checks = [
    check("company", companyReasons),
    check("social_security", [docReason("alta_ss")]),
    check("training", trainingReasons),
    check("medical", medicalReasons),
    check("ppe", [docReason("entrega_epis"), docReason("info_riesgos")]),
    check(
      "tasks",
      requiredTrainings(input.roles, input.obra?.chapterCodes).map((id) => docReason(id)),
    ),
  ];
  const status = checks.every((c) => c.ok) ? "ok" : checks.some((c) => c.blocking) ? "blocked" : "pending";
  return { status, checks };
}

// ─── Identity numbers ────────────────────────────────────────────────────────
// DNI, NIE and CIF with their check characters. Stored upper case without
// separators; lists show them masked.

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

export function normalizeIdNumber(raw: string): string {
  return raw.toUpperCase().replace(/[\s.\-/]/g, "");
}

export function isValidDni(id: string): boolean {
  const match = /^(\d{8})([A-Z])$/.exec(id);
  return !!match && DNI_LETTERS[Number(match[1]) % 23] === match[2];
}

export function isValidNie(id: string): boolean {
  const match = /^([XYZ])(\d{7})([A-Z])$/.exec(id);
  if (!match) return false;
  const number = Number(`${"XYZ".indexOf(match[1]!)}${match[2]}`);
  return DNI_LETTERS[number % 23] === match[3];
}

/** A company's CIF: letter, 7 digits, then a control digit or letter depending on the entity type. */
export function isValidCif(id: string): boolean {
  const match = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(id);
  if (!match) return false;
  const [, type, digits, control] = match as unknown as [string, string, string, string];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number(digits[i]);
    if (i % 2 === 0) {
      const doubled = n * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += n;
    }
  }
  const digit = (10 - (sum % 10)) % 10;
  const letter = "JABCDEFGHI"[digit]!;
  if ("PQRSNW".includes(type)) return control === letter;
  if ("ABEH".includes(type)) return control === String(digit);
  return control === String(digit) || control === letter;
}

/** A person's id: DNI or NIE. */
export const isValidPersonalId = (id: string) => isValidDni(id) || isValidNie(id);

export const workerName = (w: { firstName: string; surnames: string }) => `${w.firstName} ${w.surnames}`;

/** Keeps the start and the last characters, e.g. 72•••836B, X•••567L, B39•••450. */
export function maskIdNumber(id: string): string {
  if (id.length < 7) return "•••";
  const head = /^\d/.test(id) ? 2 : /^[XYZ]/.test(id) ? 1 : 3;
  const tail = /[A-Z]$/.test(id) && /^[\dXYZ]/.test(id) ? 4 : 3;
  return `${id.slice(0, head)}•••${id.slice(-tail)}`;
}

// ─── Ley 32/2006 ─────────────────────────────────────────────────────────────

/** Whether the share of permanent contracts is under the 30 % the law asks for (null when unknown). */
export function lowPermanentShare(headcount: number | null, permanent: number | null): boolean | null {
  if (!headcount || permanent === null) return null;
  return permanent / headcount < MIN_PERMANENT_SHARE;
}

// ─── Regions ─────────────────────────────────────────────────────────────────
// The autonomous community whose REA (Registro de Empresas Acreditadas) holds a
// company, from the province of its registered office (the postal code's first
// two digits).

export const REGIONS = [
  "andalucia",
  "aragon",
  "asturias",
  "baleares",
  "canarias",
  "cantabria",
  "castilla_la_mancha",
  "castilla_y_leon",
  "cataluna",
  "ceuta",
  "extremadura",
  "galicia",
  "la_rioja",
  "madrid",
  "melilla",
  "murcia",
  "navarra",
  "pais_vasco",
  "valencia",
] as const;
export type Region = (typeof REGIONS)[number];

// Index = province code − 1 (INE): Álava, Albacete, Alicante, …, Ceuta, Melilla.
const PROVINCES: readonly [string, Region][] = [
  ["Álava", "pais_vasco"],
  ["Albacete", "castilla_la_mancha"],
  ["Alicante", "valencia"],
  ["Almería", "andalucia"],
  ["Ávila", "castilla_y_leon"],
  ["Badajoz", "extremadura"],
  ["Illes Balears", "baleares"],
  ["Barcelona", "cataluna"],
  ["Burgos", "castilla_y_leon"],
  ["Cáceres", "extremadura"],
  ["Cádiz", "andalucia"],
  ["Castellón", "valencia"],
  ["Ciudad Real", "castilla_la_mancha"],
  ["Córdoba", "andalucia"],
  ["A Coruña", "galicia"],
  ["Cuenca", "castilla_la_mancha"],
  ["Girona", "cataluna"],
  ["Granada", "andalucia"],
  ["Guadalajara", "castilla_la_mancha"],
  ["Gipuzkoa", "pais_vasco"],
  ["Huelva", "andalucia"],
  ["Huesca", "aragon"],
  ["Jaén", "andalucia"],
  ["León", "castilla_y_leon"],
  ["Lleida", "cataluna"],
  ["La Rioja", "la_rioja"],
  ["Lugo", "galicia"],
  ["Madrid", "madrid"],
  ["Málaga", "andalucia"],
  ["Murcia", "murcia"],
  ["Navarra", "navarra"],
  ["Ourense", "galicia"],
  ["Asturias", "asturias"],
  ["Palencia", "castilla_y_leon"],
  ["Las Palmas", "canarias"],
  ["Pontevedra", "galicia"],
  ["Salamanca", "castilla_y_leon"],
  ["Santa Cruz de Tenerife", "canarias"],
  ["Cantabria", "cantabria"],
  ["Segovia", "castilla_y_leon"],
  ["Sevilla", "andalucia"],
  ["Soria", "castilla_y_leon"],
  ["Tarragona", "cataluna"],
  ["Teruel", "aragon"],
  ["Toledo", "castilla_la_mancha"],
  ["Valencia", "valencia"],
  ["Valladolid", "castilla_y_leon"],
  ["Bizkaia", "pais_vasco"],
  ["Zamora", "castilla_y_leon"],
  ["Zaragoza", "aragon"],
  ["Ceuta", "ceuta"],
  ["Melilla", "melilla"],
];

export const isPostalCode = (raw: string) => /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(raw);

/** The province and region of a Spanish postal code, or null if it isn't one. */
export function provinceForPostalCode(raw: string): { province: string; region: Region } | null {
  if (!isPostalCode(raw)) return null;
  const [province, region] = PROVINCES[Number(raw.slice(0, 2)) - 1]!;
  return { province, region };
}
