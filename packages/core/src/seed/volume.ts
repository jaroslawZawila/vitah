// `pnpm db:seed:volume`: fills a scratch database with about ten times a
// mid-size builder, to see how the portal behaves with volume (doc/ops/capacity.md;
// measured by ./volume-bench). One big tenant (60 obras in every stage, each
// with the Caviedes budget at its own size, some 40 orders per obra under way
// with their invoices and payments, purchase requests, 150 companies with
// 1,200 workers and their CAE documents, incidents, photos) and a small second
// tenant, so tenant isolation shows in the numbers.
//
// Dev and test only: it refuses any database that isn't on this machine, and
// the dev database `vitah` itself. No file is uploaded: rows that name one
// (photos, PDFs) point at nothing. What happens once per obra goes through the
// services (budget, Avance, Planning, the hitos' payments), so it is as valid
// as what staff enter; the thousands of rows (orders, invoices, payments,
// workers, documents) are inserted in bulk, as the services would write them.
// Seeded randomness: the same run gives the same obras, amounts and states
// (dates are relative to today, so the states stay true whenever it runs).
// Running it again replaces its two tenants.

import {
  and,
  clientProfiles,
  db,
  eq,
  inArray,
  obraIssues,
  obraProgressEvents,
  planningItems,
  planningVersions,
  projectDocuments,
  projectPhotos,
  projects,
  purchaseInvoiceFiles,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseOrderDocuments,
  purchaseOrderDocumentVersions,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrderMilestones,
  purchaseOrders,
  purchasePayments,
  purchaseRequestEvents,
  purchaseRequestLines,
  purchaseRequests,
  sql,
  subcontractorAssignments,
  subcontractorAudit,
  subcontractorDocuments,
  subcontractorDocumentVersions,
  subcontractorWorkers,
  tenants,
  users,
  type PgTable,
} from "@repo/db";
import { hashPassword } from "../accounts";
import * as budget from "../budget";
import { fromCalendarDate } from "../calendar";
import type { Ctx } from "../context";
import * as construction from "../construction";
import {
  MANDATORY_COMPANY_REQUIREMENTS,
  addMonths,
  isValidCif,
  isValidDni,
  placedStatus,
  requirement,
  type PurchaseKind,
  type PurchaseStatus,
  type RequirementId,
  type SubcontractorTrade,
} from "../contract";
import * as hitos from "../hitos";
import { addDays, todayInSpain } from "../obra-calc";
import * as planning from "../planning";
import { schedulePlan, templateItems } from "../planning-calc";
import { invoiceAmounts, splitProportional, termsOf } from "../purchase-calc";
import { contractLines } from "../purchasing";
import { createSubcontractor } from "../subcontractors";
import { forgetCae } from "../subcontractor-attention";
import { seedBudget } from "./seed-obra";

// ─── Where it may run ────────────────────────────────────────────────────────

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
/** The dev database: never filled with this. */
const DEV_DATABASE = "vitah";

/**
 * Throws unless `connectionString` is a database on this machine other than
 * the dev one (e.g. `vitah_volume`, or a test database).
 */
export function assertVolumeTarget(connectionString: string | undefined) {
  if (!connectionString) throw new Error("POSTGRES_URL is not set");
  const { hostname, pathname } = new URL(connectionString);
  const database = decodeURIComponent(pathname.slice(1));
  if (!LOCAL_HOSTS.includes(hostname)) {
    throw new Error(`The volume seed only runs against a local database, not ${hostname}`);
  }
  if (!database || database === DEV_DATABASE) {
    throw new Error(`The volume seed needs a database of its own (e.g. vitah_volume), not "${database}"`);
  }
}

// ─── Seeded randomness ───────────────────────────────────────────────────────

/** mulberry32: small, fast and good enough to spread amounts and states. */
function randomness(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (length: number) => Array.from({ length }, () => Math.floor(next() * 16).toString(16)).join("");
  return {
    next,
    /** A whole number from `min` to `max`, both included. */
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
    /** An id shaped like a UUID, the same on every run. */
    id: () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`,
  };
}

type Random = ReturnType<typeof randomness>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Rows in chunks small enough for one statement's parameters. */
async function insertAll<T extends PgTable>(table: T, rows: T["$inferInsert"][], size = 400) {
  for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size));
}

/** `work` over `items`, a few at a time: each obra is on its own rows. */
async function pooled<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

const at = (day: string, time = "09:00:00") => new Date(`${day}T${time}Z`);
const earlier = (a: string, b: string) => (a < b ? a : b);
const later = (a: string, b: string) => (a > b ? a : b);
const pad = (n: number, width: number) => String(n).padStart(width, "0");

const cif = (stem: string) => [..."0123456789"].map((c) => stem + c).find(isValidCif)!;
const dni = (digits: string) => [..."TRWAGMYFPDXBNJZSQVHLCKE"].map((l) => digits + l).find(isValidDni)!;

// ─── What it makes ───────────────────────────────────────────────────────────

/** The standard plan takes some 280 days; the contract gives the works a little more. */
const WORKS_DAYS = 300;
const CALENDAR = { region: "cb", augustClosure: true, christmasClosure: true } as const;

/** The stages of twenty obras in a row: ten under way, the rest before and after. */
const STAGE_CYCLE = [6, 7, 1, 6, 5, 6, 8, 6, 2, 6, 6, 3, 6, 7, 6, 4, 6, 5, 8, 6] as const;

/** The trade that builds each chapter (17–19 run through the works: the general contractor's). */
const CHAPTER_TRADES: Record<string, SubcontractorTrade> = {
  "01": "earthworks",
  "02": "foundations",
  "03": "steel_frame",
  "04": "masonry",
  "05": "roofing",
  "06": "insulation",
  "07": "plastering",
  "08": "flooring",
  "09": "masonry",
  "10": "carpentry",
  "11": "plumbing",
  "12": "hvac",
  "13": "electrical",
  "14": "telecom",
  "15": "metalwork",
  "16": "painting",
  "17": "landscaping",
  "18": "masonry",
  "19": "masonry",
};
const TRADES = [...new Set(Object.values(CHAPTER_TRADES))];

const TOWNS = [
  ["39001", "Santander"],
  ["39300", "Torrelavega"],
  ["39600", "Maliaño"],
  ["39500", "Cabezón de la Sal"],
  ["39700", "Castro Urdiales"],
  ["39770", "Laredo"],
  ["39200", "Reinosa"],
  ["33400", "Avilés"],
  ["48001", "Bilbao"],
  ["09001", "Burgos"],
] as const;
const STREETS = ["Calle Castelar", "Paseo de Pereda", "Calle Alta", "Avenida de España", "Barrio La Iglesia", "Calle del Sol", "Camino Real", "Calle San Roque"];
const FIRST_NAMES = ["Sergio", "Ana", "Rubén", "Laura", "Pedro", "Lucía", "Marcos", "Elena", "Iván", "Marta", "Óscar", "Sara", "Hugo", "Paula", "Tomás", "Irene", "Javier", "Nuria", "Diego", "Carmen"];
const SURNAMES = ["Fernández", "Cuesta", "Sainz", "Abascal", "Gutiérrez", "Mazo", "Llata", "Ceballos", "Revuelta", "Gil", "Álvarez", "Menéndez", "Pérez", "Díaz", "Gómez", "Ruiz", "Cobo", "Pando", "Ortiz", "Lavín", "Pellón", "Ríos", "Sierra", "Bustamante"];
const COMPANY_WORDS = ["Montajes", "Cubiertas", "Aislamientos", "Instalaciones", "Electricidad", "Pinturas", "Excavaciones", "Carpinterías", "Reformas", "Estructuras", "Fontanería", "Solados"];
const COMPANY_PLACES = ["Besaya", "Asón", "Saja", "Miera", "Pas", "Nansa", "Deva", "Cantábrico", "Norte", "Liébana", "Trasmiera", "Campoo", "Buelna", "Iguña", "Soba"];
const SUPPLIER_WORDS = ["Suministros", "Hormigones", "Áridos", "Maderas", "Ferretería", "Cerámicas", "Piedra", "Almacenes"];
const ISSUE_TEXTS = [
  "Nivel freático más alto de lo previsto: se achica y se añade un dren.",
  "El cliente pide cambiar una ventana fija por una corredera elevable.",
  "Retraso en el suministro del panel de fachada: el camión se reprograma.",
  "Recálculo de cargas: la aerotermia pasa de 8 a 10 kW.",
  "Golpe en un perfil durante la descarga: se repone la pieza.",
  "Lluvia intensa: se para la cubierta dos días.",
  "Replanteo de tabiquería corregido tras la visita de la dirección facultativa.",
  "El cliente añade dos tomas de corriente en el salón.",
];
const WORKER_CATEGORIES = ["foreman", "officer_1", "officer_1", "officer_2", "specialist_labourer", "labourer"] as const;

type Company = { id: string; name: string; trade: SubcontractorTrade | null; suppliesOnly: boolean; selfEmployed: boolean };
type ProjectSeed = {
  id: string;
  index: number;
  ref: string;
  stage: number;
  /** The works' start, set from the contract on (stage 5 up): past for an obra started, ahead otherwise. */
  start: string | null;
  /** The home's size against Caviedes'. */
  size: number;
  /** Each chapter's actual dates, as recorded on Avance. */
  actual: Map<string, { start: string; end: string | null }>;
  /** Each chapter's planned dates (the template plan from the works' start). */
  planned: Map<string, { start: string; end: string }>;
};

export type VolumeCounts = Record<
  "projects" | "started" | "budgets" | "orders" | "invoices" | "payments" | "requests" | "companies" | "workers" | "documents" | "assignments" | "issues" | "photos",
  number
>;

type TenantShape = {
  slug: string;
  name: string;
  /** Emails are `<role>@<domain>`: staff emails are unique across tenants. */
  domain: string;
  refPrefix: string;
  projects: number;
  companies: number;
  workers: number;
};

/** The big tenant's admin: the benchmark signs in as them. */
export const VOLUME_ADMIN_EMAIL = "admin@volumen.test";
export const VOLUME_SLUGS = { big: "volumen-constructora", small: "volumen-reformas" } as const;

// ─── One tenant ──────────────────────────────────────────────────────────────

async function seedTenant(shape: TenantShape, rng: Random, passwordHash: string, log: (line: string) => void) {
  const today = todayInSpain();
  const tenantId = rng.id();
  await db.insert(tenants).values({ id: tenantId, name: shape.name, slug: shape.slug });
  const staff = [
    { role: "admin" as const, email: `admin@${shape.domain}`, name: "Administración" },
    { role: "manager" as const, email: `jefe1@${shape.domain}`, name: "Laura Pérez" },
    { role: "manager" as const, email: `jefe2@${shape.domain}`, name: "Marcos Sainz" },
    { role: "viewer" as const, email: `consulta@${shape.domain}`, name: "Consulta" },
  ].map((user) => ({ ...user, id: rng.id(), tenantId, passwordHash }));
  await db.insert(users).values(staff);
  const ctx: Ctx = { tenantId, userId: staff[0]!.id, role: "admin" };
  const managers = [staff[1]!.id, staff[2]!.id];

  // ── Obras and their clients ──
  const seeds: ProjectSeed[] = Array.from({ length: shape.projects }, (_, index) => {
    const stage = STAGE_CYCLE[index % STAGE_CYCLE.length]!;
    const start =
      stage >= 8
        ? addDays(today, -rng.int(480, 900))
        : stage === 7
          ? addDays(today, -rng.int(330, 420))
          : stage === 6
            ? addDays(today, -rng.int(30, 270))
            : stage === 5
              ? addDays(today, rng.int(10, 60))
              : null;
    return {
      id: rng.id(),
      index,
      ref: `${shape.refPrefix}-${pad(index + 1, 3)}`,
      stage,
      start,
      size: 0.7 + rng.next() * 0.8,
      actual: new Map(),
      planned: new Map(),
    };
  });
  const clients = seeds.map((seed, i) => ({
    id: rng.id(),
    tenantId,
    email: `cliente${i + 1}@${shape.domain}`,
    name: `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)} ${rng.pick(SURNAMES)}`,
    passwordHash,
    role: "client" as const,
  }));
  await insertAll(users, clients);
  await insertAll(
    clientProfiles,
    clients.map((client) => {
      const [firstName = "", ...surnames] = client.name.split(" ");
      return { userId: client.id, tenantId, firstName, surnames: surnames.join(" "), phone: "+34 600 000 000" };
    }),
  );
  await insertAll(
    projects,
    seeds.map((seed, i) => {
      const [postalCode, town] = rng.pick(TOWNS);
      // Listed newest first: the obras were opened in turn.
      const createdAt = at(addDays(seed.start && seed.start < today ? seed.start : today, -rng.int(60, 200)), `10:${pad(i % 60, 2)}:00`);
      return {
        id: seed.id,
        tenantId,
        ref: seed.ref,
        address: `${rng.pick(STREETS)} ${rng.int(1, 140)}, ${postalCode} ${town}`,
        startDate: seed.start ? fromCalendarDate(seed.start) : null,
        completionDate: seed.start ? fromCalendarDate(addDays(seed.start, WORKS_DAYS)) : null,
        clientUserId: clients[i]!.id,
        createdAt,
        updatedAt: createdAt,
      };
    }),
  );
  log(`${shape.slug}: ${seeds.length} obras`);

  // ── Budgets, Avance, Planning and the hitos' payments: through the services ──
  await pooled(seeds, 6, async (seed) => {
    if (seed.stage <= 2) return;
    const accepted = seed.stage >= 5;
    const signedOn = seed.start && seed.start < today ? addDays(seed.start, -30) : addDays(today, -(5 + (seed.index % 30)));
    await seedBudget(ctx, seed.id, {
      accept: accepted,
      scale: seed.size,
      reference: `${pad(seed.index + 1, 3)}/20${signedOn.slice(2, 4)}`,
      acceptedOn: signedOn,
    });
    if (!accepted) return;
    const plan = await hitos.listHitos(ctx, seed.id);
    const hito = (code: string) => plan.find((h) => h.code === code);
    if (hito("H0")) await hitos.registerPayment(ctx, seed.id, hito("H0")!.id, { paidOn: earlier(addDays(signedOn, 7), today) });

    // The standard plan from the works' start gives each chapter its days. (A
    // draft's own dates are a forecast as of today: nothing is placed in the past.)
    const { versionId } = await planning.createPlanningDraft(ctx, seed.id, { from: "template", ...CALENDAR });
    const drafted = await db
      .select({ code: planningItems.chapterCode, spans: planningItems.spansWorks })
      .from(planningItems)
      .where(eq(planningItems.versionId, versionId));
    const dates = schedulePlan(templateItems(drafted.map((item) => item.code)), { startDate: seed.start!, calendar: CALENDAR });
    const items = drafted.map((item) => ({ ...item, ...dates.get(item.code)! }));
    for (const item of items) seed.planned.set(item.code, { start: item.start, end: item.end });

    if (seed.stage >= 6) {
      const yesterday = addDays(today, -1);
      const over = seed.stage >= 7;
      // Each chapter's own spread, the same whatever order the obras are seeded in.
      const local = randomness(0x5eed + seed.index * 7919);
      const works = items
        .map((item) => {
          const start = earlier(addDays(item.start, local.int(0, 4)), yesterday);
          const ends = over || (!item.spans && addDays(item.end, 6) <= yesterday);
          const end = ends ? later(start, earlier(addDays(item.end, local.int(-2, 6)), yesterday)) : null;
          return { code: item.code, start, end, started: over || item.start <= yesterday };
        })
        .filter((w) => w.started)
        .sort((a, b) => a.start.localeCompare(b.start));
      for (const work of works) {
        await construction.startChapter(ctx, seed.id, work.code, { date: work.start });
        if (work.end) await construction.finishChapter(ctx, seed.id, work.code, { date: work.end });
        seed.actual.set(work.code, { start: work.start, end: work.end });
      }
      // A hito is collected a few weeks after its last chapter; the recent ones still wait.
      for (const h of await hitos.listHitos(ctx, seed.id)) {
        if (h.code === "H0" || h.chapters.length === 0) continue;
        const ends = h.chapters.map((c) => seed.actual.get(c.code)?.end ?? null);
        if (ends.some((end) => end === null)) continue;
        const paidOn = addDays((ends as string[]).sort().at(-1)!, local.int(20, 38));
        if (paidOn <= today && (seed.stage === 8 || h.code !== "H9")) await hitos.registerPayment(ctx, seed.id, h.id, { paidOn });
      }
    }
    // Some obras about to start haven't approved their plan yet.
    if (seed.stage >= 6 || seed.index % 2 === 0) {
      await planning.approvePlanningDraft(ctx, seed.id, { reason: "Plan inicial con el acta de inicio" });
    }
    // A change being priced: a draft revision over the contract.
    if (seed.stage === 6 && seed.index % 10 === 3) await budget.createRevision(ctx, seed.id);
  });
  // The stage each obra is at (the evidence above raises most of them on its own), and Avance's records on their day.
  for (const stage of new Set(seeds.map((s) => s.stage))) {
    const ids = seeds.filter((s) => s.stage === stage).map((s) => s.id);
    await db.update(projects).set({ obraStage: stage }).where(inArray(projects.id, ids));
  }
  await db.execute(sql`update ${obraProgressEvents} set recorded_at = new_date::timestamp + interval '17 hours' where tenant_id = ${tenantId}`);
  await db
    .update(planningVersions)
    .set({ approvedAt: sql`${planningVersions.startDate}::timestamp - interval '10 days'` })
    .where(and(eq(planningVersions.tenantId, tenantId), eq(planningVersions.status, "approved")));
  const started = seeds.filter((s) => s.stage >= 6);
  log(`${shape.slug}: budgets, Avance and plans of ${seeds.filter((s) => s.stage >= 3).length} obras (${started.length} started)`);

  // ── Companies (through the service), then their workers and documents in bulk ──
  const companies: Company[] = [];
  const supplierCount = Math.max(2, Math.round(shape.companies * 0.2));
  const companyInputs = Array.from({ length: shape.companies }, (_, i) => {
    const suppliesOnly = i < supplierCount;
    const selfEmployed = !suppliesOnly && i % 11 === 5;
    const trade = suppliesOnly ? null : TRADES[i % TRADES.length]!;
    const [postalCode, city] = TOWNS[i % TOWNS.length]!;
    const person = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${SURNAMES[i % SURNAMES.length]} ${SURNAMES[(i * 7 + 3) % SURNAMES.length]}`;
    const legalName = suppliesOnly
      ? `${SUPPLIER_WORDS[i % SUPPLIER_WORDS.length]} ${COMPANY_PLACES[(i * 3) % COMPANY_PLACES.length]} ${pad(i + 1, 3)} S.A.`
      : selfEmployed
        ? `${person} (${pad(i + 1, 3)})`
        : `${COMPANY_WORDS[i % COMPANY_WORDS.length]} ${COMPANY_PLACES[(i * 5 + 1) % COMPANY_PLACES.length]} ${pad(i + 1, 3)} S.L.`;
    const headcount = selfEmployed ? 1 : 3 + ((i * 13) % 22);
    return {
      company: { name: legalName, trade, suppliesOnly, selfEmployed },
      input: {
        kind: selfEmployed ? "self_employed" : "company",
        legalName,
        taxId: selfEmployed ? dni(pad(40_000_000 + i * 131, 8)) : cif(`${suppliesOnly ? "A" : "B"}39${pad(10_000 + i * 17, 5)}`),
        address: `Polígono Industrial, nave ${i + 1}`,
        postalCode,
        city,
        phone: "942 000 000",
        trades: trade ? [trade] : [],
        suppliesOnly,
        ...(suppliesOnly
          ? {}
          : {
              headcount,
              permanentCount: Math.max(1, Math.round(headcount * 0.6)),
              preventionMode: "external_service",
              preventionEntity: "Prevención Cantabria SPA S.L.",
              preventionValidUntil: addMonths(today, 9),
            }),
      },
    };
  });
  const created: (Company | undefined)[] = [];
  await pooled(
    companyInputs.map((entry, i) => ({ ...entry, i })),
    8,
    async ({ company, input, i }) => {
      const { id } = await createSubcontractor(ctx, input);
      created[i] = { ...company, id };
    },
  );
  companies.push(...(created as Company[]));
  const cae = companies.filter((c) => !c.suppliesOnly);
  const suppliers = companies.filter((c) => c.suppliesOnly);

  const documents: (typeof subcontractorDocuments.$inferInsert)[] = [];
  const versions: (typeof subcontractorDocumentVersions.$inferInsert)[] = [];
  const audits: (typeof subcontractorAudit.$inferInsert)[] = [];
  type DocState = "validated" | "uploaded" | "requested" | "rejected";
  const addDocument = (
    owner: { subcontractorId: string; workerId?: string; projectId?: string },
    requirementId: RequirementId,
    state: DocState,
    expiresIn: number | null,
    /** Earlier files of a document renewed often (the monthly certificates). */
    renewals = 0,
  ) => {
    const id = rng.id();
    const workerId = owner.workerId ?? null;
    const projectId = owner.projectId ?? null;
    const requestedAt = state === "requested" ? at(addDays(today, -9)) : null;
    documents.push({ id, tenantId, subcontractorId: owner.subcontractorId, workerId, projectId, requirementId, status: state, requestedAt });
    const base = { tenantId, subcontractorId: owner.subcontractorId, workerId, userId: ctx.userId };
    const detail = { requirementId, projectId };
    if (state === "requested") {
      audits.push({ ...base, action: "document_requested", detail: { ...detail, version: 1 }, createdAt: requestedAt! });
      return;
    }
    const months = requirement(requirementId)?.validityMonths ?? null;
    const expiresAt = months === null || expiresIn === null ? null : addDays(today, expiresIn);
    for (let version = 1; version <= renewals + 1; version++) {
      const current = version === renewals + 1;
      // Each file one validity period before the next.
      const expiry = expiresAt && months ? addMonths(expiresAt, -months * (renewals + 1 - version)) : null;
      const issuedAt = expiry && months ? addMonths(expiry, -months) : addDays(today, -60 - 30 * (renewals + 1 - version));
      const versionId = rng.id();
      const reviewed = !current || state === "validated" || state === "rejected";
      const rejected = current && state === "rejected";
      versions.push({
        id: versionId,
        tenantId,
        documentId: id,
        version,
        pathname: `tenants/${tenantId}/subcontractors/${owner.subcontractorId}/${versionId}.pdf`,
        filename: `${requirementId}.pdf`,
        sizeBytes: 180_000 + (version % 7) * 21_000,
        issuedAt,
        expiresAt: expiry,
        uploadedById: ctx.userId,
        reviewedById: reviewed ? ctx.userId : null,
        reviewedAt: reviewed ? at(issuedAt, "16:30:00") : null,
        rejectReason: rejected ? "Ilegible: vuelve a escanearlo" : null,
        createdAt: at(issuedAt, "10:00:00"),
      });
      audits.push({ ...base, action: "document_uploaded", detail: { ...detail, version }, createdAt: at(issuedAt, "10:00:00") });
      if (reviewed) {
        audits.push({
          ...base,
          action: rejected ? "document_rejected" : "document_validated",
          detail: { ...detail, version },
          createdAt: at(issuedAt, "16:30:00"),
        });
      }
    }
  };

  // Company documents: most in order, some expiring, expired, waiting or missing.
  cae.forEach((company, i) => {
    const profile = i % 25;
    const troubled = profile === 3 ? "expired" : profile === 7 || profile === 15 ? "expiring" : profile === 11 ? "uploaded" : profile === 19 ? "requested" : profile === 23 ? "missing" : null;
    MANDATORY_COMPANY_REQUIREMENTS.forEach((req, r) => {
      const monthly = req.validityMonths === 1;
      const hit = troubled !== null && r === i % MANDATORY_COMPANY_REQUIREMENTS.length;
      if (hit && troubled === "missing") return;
      const far = req.validityMonths === null ? null : monthly ? 20 + (i % 9) : 60 + ((i * 7 + r * 31) % 280);
      const expiresIn = hit && troubled === "expired" ? -(3 + (i % 30)) : hit && troubled === "expiring" ? 2 + (i % 5) : far;
      const state: DocState = hit && (troubled === "uploaded" || troubled === "requested") ? troubled : "validated";
      addDocument({ subcontractorId: company.id }, req.id, state, expiresIn, monthly && state === "validated" ? 2 : 0);
    });
  });

  // Workers: a company's headcount, give or take, adding up to the tenant's.
  const workers: (typeof subcontractorWorkers.$inferInsert)[] = [];
  const weights = cae.map((c, i) => (c.selfEmployed ? 0 : 2 + ((i * 13) % 17)));
  const firms = cae.filter((c) => !c.selfEmployed).length;
  const shares = splitProportional(Math.max(0, shape.workers - (cae.length - firms)), weights);
  let person = 0;
  cae.forEach((company, i) => {
    const count = company.selfEmployed ? 1 : shares[i]!;
    for (let w = 0; w < count; w++, person++) {
      const id = rng.id();
      const firstName = FIRST_NAMES[(person * 7) % FIRST_NAMES.length]!;
      const surnames = `${SURNAMES[(person * 5) % SURNAMES.length]} ${SURNAMES[(person * 11 + 3) % SURNAMES.length]}`;
      const role = person % 13 === 0 ? "preventive_resource" : person % 17 === 0 ? "machine_operator" : null;
      workers.push({
        id,
        tenantId,
        subcontractorId: company.id,
        firstName,
        surnames,
        idDocument: dni(pad(10_000_000 + person * 4_099, 8)),
        phone: "600 000 000",
        category: company.selfEmployed ? "self_employed" : WORKER_CATEGORIES[person % WORKER_CATEGORIES.length]!,
        trade: company.trade,
        contractType: company.selfEmployed ? "self_employed" : person % 4 === 0 ? "temporary" : "permanent",
        startDate: addDays(today, -(90 + ((person * 37) % 1500))),
        tpcNumber: `TPC${pad(person, 7)}`,
        roles: role ? [role] : [],
        ppeItems: ["helmet", "boots", "gloves", "hi_vis"],
      });
      audits.push({
        tenantId,
        subcontractorId: company.id,
        workerId: id,
        userId: ctx.userId,
        action: "worker_created",
        detail: { name: `${firstName} ${surnames}` },
      });
      const owner = { subcontractorId: company.id, workerId: id };
      const medical = person % 29 === 4 ? -(2 + (person % 40)) : person % 19 === 6 ? 3 + (person % 25) : 40 + ((person * 23) % 300);
      addDocument(owner, "alta_ss", "validated", null);
      addDocument(owner, "tpc", "validated", 200 + ((person * 41) % 1400));
      // One in thirty hasn't brought theirs yet.
      if (person % 31 !== 9) addDocument(owner, "aptitud_medica", person % 37 === 2 ? "uploaded" : "validated", medical);
      addDocument(owner, "entrega_epis", "validated", null);
      addDocument(owner, "info_riesgos", "validated", null);
      addDocument(owner, "formacion_prl_inicial", "validated", null);
      if (role === "preventive_resource") addDocument(owner, "formacion_nivel_basico_60h", "validated", null);
      if (role === "machine_operator") addDocument(owner, "formacion_maquinaria", "validated", null);
    }
  });
  await insertAll(subcontractorWorkers, workers);

  // ── Each obra's orders, invoices, payments, requests, incidents and photos ──
  const byTrade = new Map<string, Company[]>();
  for (const company of cae) byTrade.set(company.trade!, [...(byTrade.get(company.trade!) ?? []), company]);
  const builderOf = (seed: ProjectSeed, code: string) => {
    const pool = byTrade.get(CHAPTER_TRADES[code] ?? "masonry") ?? cae;
    return pool[(seed.index * 5 + Number(code)) % pool.length]!;
  };
  const invoiceNumbers = new Map<string, number>();
  const rows = {
    orders: [] as (typeof purchaseOrders.$inferInsert)[],
    orderLines: [] as (typeof purchaseOrderLines.$inferInsert)[],
    orderEvents: [] as (typeof purchaseOrderEvents.$inferInsert)[],
    milestones: [] as (typeof purchaseOrderMilestones.$inferInsert)[],
    orderDocuments: [] as (typeof purchaseOrderDocuments.$inferInsert)[],
    orderDocumentVersions: [] as (typeof purchaseOrderDocumentVersions.$inferInsert)[],
    invoices: [] as (typeof purchaseInvoices.$inferInsert)[],
    invoiceLines: [] as (typeof purchaseInvoiceLines.$inferInsert)[],
    invoiceFiles: [] as (typeof purchaseInvoiceFiles.$inferInsert)[],
    payments: [] as (typeof purchasePayments.$inferInsert)[],
    requests: [] as (typeof purchaseRequests.$inferInsert)[],
    requestLines: [] as (typeof purchaseRequestLines.$inferInsert)[],
    requestEvents: [] as (typeof purchaseRequestEvents.$inferInsert)[],
    assignments: [] as (typeof subcontractorAssignments.$inferInsert)[],
    issues: [] as (typeof obraIssues.$inferInsert)[],
    photos: [] as (typeof projectPhotos.$inferInsert)[],
    projectDocuments: [] as (typeof projectDocuments.$inferInsert)[],
  };

  for (const seed of seeds) {
    const folder = `tenants/${tenantId}/projects/${seed.id}/`;
    // A few PDFs on every obra (the files themselves aren't stored).
    for (let d = 0; d < 3 + (seed.index % 5); d++) {
      const id = rng.id();
      const createdAt = at(addDays(today, -rng.int(5, 400)));
      rows.projectDocuments.push({
        id,
        tenantId,
        projectId: seed.id,
        title: ["Contrato de obra", "Planos de ejecución", "Licencia de obra", "Certificado energético", "Acta de replanteo", "Estudio geotécnico", "Memoria de calidades"][d]!,
        category: (["contract", "plans", "certificates", "certificates", "other", "other", "other"] as const)[d]!,
        pathname: `${folder}${id}.pdf`,
        sizeBytes: rng.int(200_000, 3_800_000),
        visibleToClient: d !== 5,
        clientNotifiedAt: d !== 5 ? createdAt : null,
        uploadedById: rng.pick(managers),
        createdAt,
        updatedAt: createdAt,
      });
    }
    if (seed.stage < 5) continue;

    const contract = [...(await contractLines(tenantId, seed.id)).values()].filter((line) => line.amountCents > 0);
    const chapters = new Map<string, typeof contract>();
    for (const line of contract) chapters.set(line.chapterCode, [...(chapters.get(line.chapterCode) ?? []), line]);
    const codes = [...chapters.keys()].sort();
    const nextUp = codes
      .filter((code) => !seed.actual.has(code))
      .sort((a, b) => (seed.planned.get(a)?.start ?? "").localeCompare(seed.planned.get(b)?.start ?? ""));

    type Draft = {
      id: string;
      kind: PurchaseKind;
      company: Company;
      description: string;
      status: PurchaseStatus;
      createdOn: string;
      orderedOn: string | null;
      expectedOn: string | null;
      workStart: string | null;
      workEnd: string | null;
      completedOn: string | null;
      retentionBp: number;
      paymentDays: number | null;
      lines: { lineageId: string; chapterCode: string; amountCents: number; closesLine: boolean }[];
    };
    const drafts: Draft[] = [];
    for (const code of codes) {
      const lines = chapters.get(code)!;
      const recorded = seed.actual.get(code);
      const queue = nextUp.indexOf(code);
      // Nothing is bought for a chapter still far off.
      if (!recorded && (queue < 0 || queue > 2 || rng.chance(0.3))) continue;
      // A subcontract and an order or two of material per chapter: some 40 orders on an obra under way.
      const groups = Math.min(lines.length, Math.ceil(lines.length / 3.5));
      const size = Math.ceil(lines.length / groups);
      for (let g = 0; g < groups; g++) {
        const own = lines.slice(g * size, (g + 1) * size);
        if (own.length === 0) continue;
        const kind: PurchaseKind = g === 0 ? "subcontract" : "material";
        const company = kind === "subcontract" ? builderOf(seed, code) : suppliers[(seed.index + Number(code) * 3 + g) % suppliers.length]!;
        const planned = seed.planned.get(code);
        const open = recorded && !recorded.end && rng.chance(0.2) ? own.at(-1)!.lineageId : null;
        let status: PurchaseStatus = "pending";
        let orderedOn: string | null = null;
        let completedOn: string | null = null;
        let expectedOn: string | null = null;
        if (recorded) {
          orderedOn = addDays(recorded.start, -rng.int(8, 30));
          if (recorded.end) {
            status = kind === "material" ? "delivered" : "finished";
            completedOn = later(orderedOn, addDays(recorded.end, -rng.int(0, 8)));
            expectedOn = kind === "material" ? addDays(completedOn, rng.int(-3, 3)) : null;
          } else if (kind === "subcontract") {
            status = "contracted";
          } else {
            status = rng.pick(["ordered", "confirmed", "in_transit", "delivered"] as const);
            // Some deliveries are late.
            expectedOn = addDays(today, rng.int(-8, 30));
            if (status === "delivered") completedOn = later(orderedOn, addDays(today, -rng.int(1, 20)));
          }
        } else if (rng.chance(0.35)) {
          status = placedStatus(kind);
          orderedOn = addDays(today, -rng.int(1, 15));
          expectedOn = kind === "material" ? addDays(today, rng.int(10, 45)) : null;
        }
        drafts.push({
          id: rng.id(),
          kind,
          company,
          description: `${kind === "subcontract" ? "Subcontrato" : "Suministro"} cap. ${code}: ${own[0]!.description.slice(0, 90)}`,
          status,
          createdOn: orderedOn ? addDays(orderedOn, -rng.int(1, 6)) : addDays(today, -rng.int(1, 20)),
          orderedOn,
          expectedOn,
          workStart: kind === "subcontract" ? (planned?.start ?? null) : null,
          workEnd: kind === "subcontract" ? (planned?.end ?? null) : null,
          completedOn,
          retentionBp: kind === "subcontract" && rng.chance(0.5) ? 500 : 0,
          paymentDays: rng.chance(0.2) ? 60 : null,
          lines: own.map((line) => ({
            lineageId: line.lineageId,
            chapterCode: line.chapterCode,
            amountCents:
              line.lineageId === open ? Math.max(100, Math.round(line.amountCents / 2)) : Math.max(100, Math.round(line.amountCents * (0.94 + rng.next() * 0.12))),
            closesLine: line.lineageId !== open,
          })),
        });
      }
    }
    // An order or two withdrawn: another supplier got it.
    for (const original of drafts.filter((d) => d.orderedOn).slice(0, seed.actual.size > 0 ? 2 : 0)) {
      drafts.push({
        ...original,
        id: rng.id(),
        company: original.kind === "material" ? suppliers[(seed.index + 1) % suppliers.length]! : original.company,
        description: `${original.description} (oferta descartada)`,
        status: "cancelled",
        createdOn: addDays(original.createdOn, -3),
        orderedOn: null,
        completedOn: null,
        lines: original.lines.map((l) => ({ ...l, closesLine: false })),
      });
    }
    drafts.sort((a, b) => a.createdOn.localeCompare(b.createdOn));

    const assigned = new Map<string, { company: Company; codes: Set<string>; start: string; end: string }>();
    drafts.forEach((draft, n) => {
      const amountCents = draft.lines.reduce((sum, l) => sum + l.amountCents, 0);
      const createdAt = at(draft.createdOn, `09:${pad(n % 60, 2)}:00`);
      const createdById = managers[n % managers.length]!;
      rows.orders.push({
        id: draft.id,
        tenantId,
        projectId: seed.id,
        number: n + 1,
        kind: draft.kind,
        subcontractorId: draft.company.id,
        description: draft.description,
        status: draft.status,
        orderedOn: draft.orderedOn,
        expectedOn: draft.kind === "material" ? draft.expectedOn : null,
        workStart: draft.workStart,
        workEnd: draft.workEnd,
        completedOn: draft.completedOn,
        retentionBp: draft.retentionBp,
        paymentDays: draft.paymentDays,
        createdById,
        createdAt,
        updatedAt: createdAt,
      });
      for (const line of draft.lines) rows.orderLines.push({ ...line, id: rng.id(), tenantId, orderId: draft.id });
      const event = (action: string, detail: Record<string, unknown>, day: string, time = "09:30:00") =>
        rows.orderEvents.push({ id: rng.id(), tenantId, orderId: draft.id, action, detail, userId: createdById, createdAt: at(day, time) });
      event("created", { number: n + 1, status: "pending", amountCents, lines: draft.lines.length }, draft.createdOn, `09:${pad(n % 60, 2)}:00`);
      if (draft.status === "cancelled") event("status", { from: "pending", to: "cancelled", date: null }, addDays(draft.createdOn, 2));
      if (!draft.orderedOn) return;
      const placed = placedStatus(draft.kind);
      event("status", { from: "pending", to: placed, date: draft.orderedOn }, draft.orderedOn);
      if (draft.status !== placed) {
        const day = draft.completedOn ?? earlier(addDays(draft.orderedOn, 4), today);
        event("status", { from: placed, to: draft.status, date: draft.completedOn }, day, "12:00:00");
      }
      if (draft.kind === "subcontract" && seed.actual.has(draft.lines[0]!.chapterCode)) {
        const code = draft.lines[0]!.chapterCode;
        const entry = assigned.get(draft.company.id) ?? {
          company: draft.company,
          codes: new Set<string>(),
          start: draft.workStart ?? draft.orderedOn,
          end: draft.workEnd ?? addDays(draft.orderedOn, 60),
        };
        entry.codes.add(code);
        entry.start = earlier(entry.start, draft.workStart ?? entry.start);
        entry.end = later(entry.end, draft.workEnd ?? entry.end);
        assigned.set(draft.company.id, entry);
      }
      // Most orders keep their PDF (and a signed contract's second version).
      if (rng.chance(0.6)) {
        const documentId = rng.id();
        rows.orderDocuments.push({ id: documentId, tenantId, orderId: draft.id, title: draft.kind === "subcontract" ? "Contrato firmado" : "Pedido", createdById, createdAt: at(draft.orderedOn, "10:00:00") });
        for (let version = 1; version <= (draft.kind === "subcontract" && rng.chance(0.3) ? 2 : 1); version++) {
          const versionId = rng.id();
          rows.orderDocumentVersions.push({
            id: versionId,
            tenantId,
            documentId,
            version,
            pathname: `${folder}purchases/${draft.id}/documents/${versionId}.pdf`,
            filename: `PED-${pad(n + 1, 3)}.pdf`,
            sizeBytes: rng.int(90_000, 900_000),
            note: version > 1 ? "Con la firma del subcontratista" : null,
            uploadedById: createdById,
            createdAt: at(draft.orderedOn, `10:0${version}:00`),
          });
        }
      }

      // A larger subcontract is paid by milestones.
      const schedule: { id: string; amountCents: number }[] = [];
      if (draft.kind === "subcontract" && amountCents > 1_500_000 && rng.chance(0.3)) {
        const parts = splitProportional(amountCents, [30, 40, 30]);
        ["Inicio de los trabajos", "Avance al 70 %", "Fin de los trabajos"].forEach((concept, position) => {
          const id = rng.id();
          schedule.push({ id, amountCents: parts[position]! });
          rows.milestones.push({ id, tenantId, orderId: draft.id, position, concept, amountCents: parts[position]! });
        });
      }

      // Invoices: a completed order in full, one under way in part.
      const terms = termsOf({ kind: draft.kind, paymentDays: draft.paymentDays, retentionBp: draft.retentionBp, vatKind: null });
      const span = (share: number) => earlier(addDays(draft.orderedOn!, Math.round(share * 60) + rng.int(3, 12)), draft.completedOn ?? today);
      const plan: { baseCents: number; issuedOn: string; milestoneId: string | null }[] = [];
      if (draft.completedOn && schedule.length > 0) {
        schedule.forEach((m, i) => plan.push({ baseCents: m.amountCents, issuedOn: i === 2 ? earlier(addDays(draft.completedOn!, rng.int(0, 5)), today) : span(i / 2), milestoneId: m.id }));
      } else if (draft.completedOn) {
        const done = earlier(addDays(draft.completedOn, rng.int(0, 5)), today);
        if (rng.chance(0.3)) {
          const half = Math.round(amountCents / 2);
          plan.push({ baseCents: half, issuedOn: span(0.3), milestoneId: null }, { baseCents: amountCents - half, issuedOn: done, milestoneId: null });
        } else plan.push({ baseCents: amountCents, issuedOn: done, milestoneId: null });
      } else if (schedule.length > 0) {
        plan.push({ baseCents: schedule[0]!.amountCents, issuedOn: span(0), milestoneId: schedule[0]!.id });
      } else if (rng.chance(0.5)) {
        plan.push({ baseCents: Math.round(amountCents * 0.4), issuedOn: span(0.2), milestoneId: null });
      }
      for (const entry of plan) {
        const invoiceId = rng.id();
        const amounts = invoiceAmounts({
          baseCents: entry.baseCents,
          vatKind: terms.vatKind,
          irpfBp: draft.company.selfEmployed ? 1500 : 0,
          retentionBp: terms.retentionBp,
        });
        const sequence = (invoiceNumbers.get(draft.company.id) ?? 0) + 1;
        invoiceNumbers.set(draft.company.id, sequence);
        const number = `F${entry.issuedOn.slice(2, 4)}/${pad(sequence, 4)}`;
        const dueOn = addDays(entry.issuedOn, terms.paymentDays);
        const issuedAt = at(entry.issuedOn, "11:00:00");
        const invoice = { tenantId, orderId: draft.id, subcontractorId: draft.company.id, vatKind: amounts.vatKind, irpfBp: amounts.irpfBp, retentionBp: amounts.retentionBp, createdById: ctx.userId };
        rows.invoices.push({
          ...invoice,
          id: invoiceId,
          kind: "invoice",
          number,
          milestoneId: entry.milestoneId,
          issuedOn: entry.issuedOn,
          dueOn,
          baseCents: amounts.baseCents,
          vatCents: amounts.vatCents,
          irpfCents: amounts.irpfCents,
          retentionCents: amounts.retentionCents,
          createdAt: issuedAt,
          updatedAt: issuedAt,
        });
        const weights = draft.lines.map((l) => l.amountCents);
        const split = (cents: number) =>
          splitProportional(cents, weights)
            .map((part, i) => ({ lineageId: draft.lines[i]!.lineageId, chapterCode: draft.lines[i]!.chapterCode, amountCents: part }))
            .filter((l) => l.amountCents !== 0);
        for (const line of split(amounts.baseCents)) rows.invoiceLines.push({ ...line, id: rng.id(), tenantId, invoiceId });
        event("invoice_created", { invoiceId, number, kind: "invoice", baseCents: amounts.baseCents, milestoneId: entry.milestoneId, rectifiesId: null }, entry.issuedOn, "11:00:00");
        if (rng.chance(0.75)) {
          const fileId = rng.id();
          rows.invoiceFiles.push({
            id: fileId,
            tenantId,
            invoiceId,
            version: 1,
            pathname: `${folder}purchases/${draft.id}/invoices/${invoiceId}/${fileId}.pdf`,
            filename: `${number.replace("/", "-")}.pdf`,
            sizeBytes: rng.int(60_000, 600_000),
            uploadedById: ctx.userId,
            createdAt: issuedAt,
          });
        }

        // A credit note on a few (material sent back), settled with the invoice.
        let payableCents = amounts.payableCents;
        if (rng.chance(0.03)) {
          const creditId = rng.id();
          const credit = invoiceAmounts({ baseCents: -Math.round(amounts.baseCents * 0.02), vatKind: amounts.vatKind, irpfBp: amounts.irpfBp, retentionBp: amounts.retentionBp });
          const creditOn = earlier(addDays(entry.issuedOn, 10), today);
          const creditNumber = `R${creditOn.slice(2, 4)}/${pad(sequence, 4)}`;
          rows.invoices.push({
            ...invoice,
            id: creditId,
            kind: "credit_note",
            number: creditNumber,
            rectifiesId: invoiceId,
            issuedOn: creditOn,
            dueOn: null,
            baseCents: credit.baseCents,
            vatCents: credit.vatCents,
            irpfCents: credit.irpfCents,
            retentionCents: credit.retentionCents,
            notes: "Abono por material sobrante devuelto",
            createdAt: at(creditOn, "11:30:00"),
            updatedAt: at(creditOn, "11:30:00"),
          });
          for (const line of split(credit.baseCents)) rows.invoiceLines.push({ ...line, id: rng.id(), tenantId, invoiceId: creditId });
          event("invoice_created", { invoiceId: creditId, number: creditNumber, kind: "credit_note", baseCents: credit.baseCents, milestoneId: null, rectifiesId: invoiceId }, creditOn, "11:30:00");
          payableCents += credit.payableCents;
        }

        // Paid by its due date, but for a few past due or part paid.
        const due = dueOn <= today;
        const fate = rng.next();
        const paidCents = due ? (fate < 0.95 ? payableCents : fate < 0.975 ? Math.round(payableCents / 2) : 0) : fate < 0.15 ? payableCents : fate < 0.25 ? Math.round(payableCents / 3) : 0;
        if (paidCents > 0) {
          const paidOn = later(entry.issuedOn, earlier(addDays(dueOn, -rng.int(0, 5)), today));
          const pay = (amountCents: number, day: string, reference: string) => {
            const paymentId = rng.id();
            const method = rng.pick(["transfer", "transfer", "transfer", "confirming", "direct_debit"] as const);
            rows.payments.push({ id: paymentId, tenantId, invoiceId, paidOn: day, amountCents, method, reference, createdById: ctx.userId, createdAt: at(day, "13:00:00") });
            event("payment_added", { invoiceId, number, paymentId, amountCents, paidOn: day, method }, day, "13:00:00");
          };
          pay(paidCents, paidOn, `Remesa ${paidOn.slice(0, 7)}`);
          // The guarantee is released a year on.
          const releaseOn = addDays(entry.issuedOn, 365);
          if (paidCents === payableCents && amounts.retentionCents > 0 && payableCents === amounts.payableCents && releaseOn <= today) {
            pay(amounts.retentionCents, releaseOn, "Devolución de la retención");
          }
        }
      }
    });

    // The companies building it are assigned to the obra (its Libro de Subcontratación).
    [...assigned.values()].forEach((entry, order) => {
      rows.assignments.push({
        id: rng.id(),
        tenantId,
        subcontractorId: entry.company.id,
        projectId: seed.id,
        chapterCodes: [...entry.codes].sort(),
        plannedStart: entry.start,
        plannedEnd: entry.end,
        bookOrder: order + 1,
        bookDate: addDays(entry.start, -10),
        cssInformed: true,
      });
      // One in twelve hasn't signed the safety plan.
      if ((seed.index + order) % 12 !== 7) addDocument({ subcontractorId: entry.company.id, projectId: seed.id }, "adhesion_pss", "validated", null);
    });

    // Requests: those its orders came from, and what the obra is asking for now.
    const requested: { createdOn: string; kind: PurchaseKind; description: string; status: "pending" | "approved" | "rejected" | "ordered" | "cancelled"; order: Draft | null; lines: { lineageId: string; chapterCode: string; amountCents: number }[] }[] = [];
    for (const draft of drafts.filter((d) => d.orderedOn && d.status !== "cancelled").filter((_, i) => i % 9 === 2)) {
      requested.push({
        createdOn: addDays(draft.createdOn, -rng.int(2, 9)),
        kind: draft.kind,
        description: draft.description,
        status: "ordered",
        order: draft,
        lines: draft.lines.map((l) => ({ lineageId: l.lineageId, chapterCode: l.chapterCode, amountCents: Math.round(l.amountCents * 0.97) })),
      });
    }
    const ordered = new Set(drafts.flatMap((d) => d.lines.map((l) => l.lineageId)));
    const free = contract.filter((line) => !ordered.has(line.lineageId));
    (["pending", "pending", "approved", "rejected", "cancelled"] as const).forEach((status, i) => {
      const lines = free.slice(i * 2, i * 2 + 2);
      if (lines.length === 0 || (i > 1 && rng.chance(0.4))) return;
      requested.push({
        createdOn: addDays(today, -rng.int(1, 25)),
        kind: i % 2 === 0 ? "material" : "subcontract",
        description: `Cap. ${lines[0]!.chapterCode}: ${lines[0]!.description.slice(0, 90)}`,
        status,
        order: null,
        lines: lines.map((l) => ({ lineageId: l.lineageId, chapterCode: l.chapterCode, amountCents: Math.max(100, Math.round(l.amountCents * 0.95)) })),
      });
    });
    requested
      .sort((a, b) => a.createdOn.localeCompare(b.createdOn))
      .forEach((request, n) => {
        const id = rng.id();
        const createdAt = at(request.createdOn, `08:${pad(n % 60, 2)}:00`);
        const decided = request.status !== "pending" && request.status !== "cancelled";
        const decidedAt = at(earlier(addDays(request.createdOn, 1), today), "15:00:00");
        const createdById = managers[n % managers.length]!;
        rows.requests.push({
          id,
          tenantId,
          projectId: seed.id,
          number: n + 1,
          kind: request.kind,
          description: request.description,
          neededBy: addDays(request.createdOn, rng.int(10, 40)),
          subcontractorId: request.order?.company.id ?? null,
          status: request.status,
          decidedById: decided ? ctx.userId : null,
          decidedAt: decided ? decidedAt : null,
          decisionNote: request.status === "rejected" ? "Todavía no: se pide con su capítulo." : null,
          orderId: request.order?.id ?? null,
          createdById,
          createdAt,
          updatedAt: createdAt,
        });
        for (const line of request.lines) rows.requestLines.push({ ...line, id: rng.id(), tenantId, requestId: id });
        const amountCents = request.lines.reduce((sum, l) => sum + l.amountCents, 0);
        const log = (action: string, detail: Record<string, unknown>, when: Date, userId: string, note: string | null = null) =>
          rows.requestEvents.push({ id: rng.id(), tenantId, requestId: id, action, detail, note, userId, createdAt: when });
        log("created", { number: n + 1, amountCents, lines: request.lines.length }, createdAt, createdById);
        if (request.status === "cancelled") log("cancelled", { from: "pending" }, decidedAt, createdById);
        if (decided) log(request.status === "rejected" ? "rejected" : "approved", {}, decidedAt, ctx.userId, request.status === "rejected" ? "Todavía no: se pide con su capítulo." : null);
        if (request.order) {
          const number = drafts.indexOf(request.order) + 1;
          log("ordered", { orderId: request.order.id, number }, at(request.order.createdOn, "09:45:00"), createdById);
        }
      });

    if (seed.actual.size === 0) continue;
    // Incidents and changes, numbered per kind, and the site's photos.
    const underWay = [...seed.actual.entries()];
    const counters = { issue: 0, change: 0 };
    const issueCount = rng.int(6, 18);
    for (let i = 0; i < issueCount; i++) {
      const [code, dates] = rng.pick(underWay);
      const kind = rng.chance(0.65) ? ("issue" as const) : ("change" as const);
      const occurredOn = earlier(addDays(dates.start, rng.int(0, 40)), today);
      const settled = seed.stage >= 7 || rng.chance(0.65);
      rows.issues.push({
        id: rng.id(),
        tenantId,
        projectId: seed.id,
        kind,
        number: ++counters[kind],
        occurredOn,
        chapterCode: code,
        description: rng.pick(ISSUE_TEXTS),
        party: rng.pick(["client", "subcontractor", "own", "other"] as const),
        costImpactCents: rng.chance(0.6) ? rng.int(20, 400) * 1000 : null,
        scheduleImpactDays: rng.chance(0.5) ? rng.int(1, 10) : null,
        status: settled ? "resolved" : rng.chance(0.5) ? "review" : "pending",
        createdById: rng.pick(managers),
        createdAt: at(occurredOn, "18:00:00"),
        updatedAt: at(occurredOn, "18:00:00"),
      });
    }
    const photoCount = rng.int(40, 120);
    for (let i = 0; i < photoCount; i++) {
      const [code, dates] = rng.pick(underWay);
      const id = rng.id();
      const takenOn = earlier(addDays(dates.start, rng.int(0, 45)), today);
      const visible = rng.chance(0.9);
      rows.photos.push({
        id,
        tenantId,
        projectId: seed.id,
        caption: rng.chance(0.5) ? `Capítulo ${code}` : null,
        pathname: `${folder}photos/${id}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: rng.int(900_000, 4_000_000),
        chapterCode: code,
        takenOn,
        thumbSizeBytes: rng.int(15_000, 40_000),
        visibleToClient: visible,
        clientNotifiedAt: visible ? at(takenOn, "19:00:00") : null,
        uploadedById: rng.pick(managers),
        createdAt: at(takenOn, `19:${pad(i % 60, 2)}:00`),
        updatedAt: at(takenOn, `19:${pad(i % 60, 2)}:00`),
      });
    }
  }

  await insertAll(projectDocuments, rows.projectDocuments);
  await insertAll(purchaseOrders, rows.orders);
  await insertAll(purchaseOrderLines, rows.orderLines, 1000);
  await insertAll(purchaseOrderMilestones, rows.milestones, 1000);
  await insertAll(purchaseOrderDocuments, rows.orderDocuments, 1000);
  await insertAll(purchaseOrderDocumentVersions, rows.orderDocumentVersions, 1000);
  // A credit note names its invoice: invoices first.
  await insertAll(purchaseInvoices, rows.invoices.filter((i) => i.kind === "invoice"));
  await insertAll(purchaseInvoices, rows.invoices.filter((i) => i.kind !== "invoice"));
  await insertAll(purchaseInvoiceLines, rows.invoiceLines, 1000);
  await insertAll(purchaseInvoiceFiles, rows.invoiceFiles, 1000);
  await insertAll(purchasePayments, rows.payments, 1000);
  await insertAll(purchaseOrderEvents, rows.orderEvents, 1000);
  await insertAll(purchaseRequests, rows.requests);
  await insertAll(purchaseRequestLines, rows.requestLines, 1000);
  await insertAll(purchaseRequestEvents, rows.requestEvents, 1000);
  await insertAll(subcontractorAssignments, rows.assignments);
  await insertAll(subcontractorDocuments, documents, 1000);
  await insertAll(subcontractorDocumentVersions, versions, 1000);
  await insertAll(subcontractorAudit, audits, 1000);
  // Written past the services: the companies' stored CAE values are worked out again on the first read.
  await forgetCae(tenantId);
  await insertAll(obraIssues, rows.issues);
  await insertAll(projectPhotos, rows.photos);

  const counts: VolumeCounts = {
    projects: seeds.length,
    started: started.length,
    budgets: seeds.filter((s) => s.stage >= 3).length,
    orders: rows.orders.length,
    invoices: rows.invoices.length,
    payments: rows.payments.length,
    requests: rows.requests.length,
    companies: companies.length,
    workers: workers.length,
    documents: documents.length,
    assignments: rows.assignments.length,
    issues: rows.issues.length,
    photos: rows.photos.length,
  };
  log(`${shape.slug}: ${JSON.stringify(counts)}`);
  return { tenantId, adminId: ctx.userId, counts };
}

// ─── The dataset ─────────────────────────────────────────────────────────────

/**
 * Replaces the two volume tenants. `scale` 1 is the full dataset (about ten
 * times a mid-size builder); a test passes a small fraction. Returns each
 * tenant's id, its admin and what was made.
 */
export async function seedVolume({ scale = 1, log = () => {} }: { scale?: number; log?: (line: string) => void } = {}) {
  assertVolumeTarget(process.env.POSTGRES_URL);
  if (!(scale > 0 && scale <= 2)) throw new Error("scale must be between 0 and 2");
  const of = (full: number, least: number) => Math.max(least, Math.round(full * scale));
  await db.delete(tenants).where(inArray(tenants.slug, Object.values(VOLUME_SLUGS)));
  // One hash for every account: the documented dev password, on a local database only.
  const passwordHash = await hashPassword("vitah2026");
  const rng = randomness(20261114);
  const big = await seedTenant(
    {
      slug: VOLUME_SLUGS.big,
      name: "Volumen Constructora",
      domain: "volumen.test",
      refPrefix: "VOL",
      projects: of(60, 2),
      companies: of(150, 6),
      workers: of(1200, 8),
    },
    rng,
    passwordHash,
    log,
  );
  const small = await seedTenant(
    {
      slug: VOLUME_SLUGS.small,
      name: "Volumen Reformas",
      domain: "reformas.volumen.test",
      refPrefix: "REF",
      projects: of(4, 2),
      companies: of(8, 6),
      workers: of(40, 6),
    },
    rng,
    passwordHash,
    log,
  );
  return { big, small };
}
