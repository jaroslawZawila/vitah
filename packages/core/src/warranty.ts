import {
  and,
  asc,
  count,
  db,
  desc,
  eq,
  gt,
  inArray,
  obraHitos,
  projects,
  sql,
  users,
  warrantyClaimEvents,
  warrantyClaimPhotos,
  warrantyClaims,
  type SQL,
} from "@repo/db";
import { toCalendarDate } from "./calendar";
import { markChanged } from "./changes";
import { resolveClientProject } from "./client-projects";
import { requireEditor, type Ctx } from "./context";
import {
  canCancelClaim,
  HANDED_OVER_STAGE,
  MAX_OPEN_WARRANTY_CLAIMS,
  MAX_PHOTO_BYTES,
  MAX_WARRANTY_CLAIMS_PER_DAY,
  MAX_WARRANTY_PHOTOS,
  OPEN_WARRANTY_STATUSES,
  STAGE_HITOS,
  warrantyCoverage,
  type HandoverSource,
  type MobileWarranty,
  type MobileWarrantyClaim,
  type MobileWarrantyEvent,
  type PhotoSize,
  type ProjectWarranty,
  type WarrantyClaim,
  type WarrantyClaimSummary,
  type WarrantyCoverageInfo,
  type WarrantyError,
  type WarrantyEvent,
  type WarrantyEventDetail,
} from "./contract";
import { CoreError } from "./errors";
import { idempotent } from "./idempotency";
import { changesOf, parse } from "./inputs/fields";
import { claimChangesSchema, claimPhotoSchema, newClaimSchema } from "./inputs/warranty";
import { notifyProjectClient } from "./notifications";
import { todayInSpain } from "./obra-calc";
import { userName } from "./obra-data";
import { openPhotoFile, PHOTO_EXTENSIONS, readImage, THUMBNAIL, thumbPath } from "./photo-image";
import { clientDates } from "./planning-calc";
import { approvedPlanDates } from "./planning-data";
import { inLiveProject, projectInTenant, type Tx } from "./project-client";
import { projectFolder, requireProject, storeFiles } from "./project-files";

// ─── Garantía: after-sales warranty claims ───────────────────────────────────
// The first thing the client writes: from the app, the client of a handed-over
// home sends a claim (kind, room, description, urgent) and up to four photos,
// one request each (the body limit is 4.5 MB); they may cancel it while
// nobody has started on it. Staff move it on and answer on the project's
// Garantía tab; the client is pushed ("messages" toggle) and the app reloads
// it (the `project` counter: a claim is part of the home's own record, and
// changes are rare). What the client writes is capped: a few open claims per
// home, a few a day, four photos each, only for a home that is theirs and
// handed over. A client reads only the claims they sent. Nothing is deleted:
// every step goes to warranty_claim_events.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<WarrantyError, number> = {
  missing_fields: 400,
  invalid_input: 400,
  invalid_date: 400,
  missing_file: 400,
  invalid_file_type: 400,
  visit_required: 400,
  reason_required: 400,
  file_too_large: 413,
  not_handed_over: 409,
  too_many_open_claims: 409,
  too_many_photos: 409,
  claim_closed: 409,
  claim_cancelled: 409,
  idempotency_key_reused: 409,
  too_many_claims_today: 429,
  project_not_found: 404,
  not_found: 404,
  forbidden: 403,
};

function fail(code: WarrantyError): never {
  throw new CoreError(code, STATUS[code]);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Hand-over and coverage ──────────────────────────────────────────────────

type HomeRow = { id: string; obraStage: number; startDate: Date | null; completionDate: Date | null };

/**
 * The home's hand-over day and its three guarantee periods. The guarantee runs
 * from the reception (LOE art. 17): the day H9's acta was signed, else the day
 * H9 was paid (against the keys), else the hand-over date the client was told.
 */
async function coverageOf(tenantId: string, home: HomeRow): Promise<WarrantyCoverageInfo> {
  const today = todayInSpain();
  if (home.obraStage < HANDED_OVER_STAGE) {
    return { handedOver: false, handoverOn: null, handoverSource: null, coverage: warrantyCoverage(null, today) };
  }
  const [h9] = await db
    .select({ actaSignedOn: obraHitos.actaSignedOn, paidOn: obraHitos.paidOn })
    .from(obraHitos)
    .where(and(eq(obraHitos.tenantId, tenantId), eq(obraHitos.projectId, home.id), eq(obraHitos.code, STAGE_HITOS[7]!)));
  const covered = (handoverOn: string | null, handoverSource: HandoverSource | null) => ({
    handedOver: true,
    handoverOn,
    handoverSource,
    coverage: warrantyCoverage(handoverOn, today),
  });
  if (h9?.actaSignedOn) return covered(h9.actaSignedOn, "acta");
  if (h9?.paidOn) return covered(h9.paidOn, "payment");
  const { completionDate } = clientDates(await approvedPlanDates(tenantId, home.id), {
    startDate: toCalendarDate(home.startDate),
    completionDate: toCalendarDate(home.completionDate),
  });
  return covered(completionDate, completionDate ? "planned" : null);
}

// ─── Reading claims ──────────────────────────────────────────────────────────

// The claim named by its table: Drizzle leaves a lone table's columns unqualified, which the subquery would read as its own.
const photoCount = sql<number>`(select count(*) from warranty_claim_photos wp where wp.claim_id = warranty_claims.id)`.mapWith(Number);

type ClaimRow = typeof warrantyClaims.$inferSelect;

function toSummary(claim: ClaimRow, photos: number): WarrantyClaimSummary {
  return {
    id: claim.id,
    number: claim.number,
    kind: claim.kind,
    room: claim.room,
    description: claim.description,
    urgent: claim.urgent,
    status: claim.status,
    visitOn: claim.visitOn,
    answer: claim.answer,
    answeredAt: claim.answeredAt?.toISOString() ?? null,
    photoCount: photos,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
  };
}

/** The claims `where` picks, newest first. */
async function summaries(where: SQL | undefined) {
  const rows = await db
    .select({ claim: warrantyClaims, photos: photoCount })
    .from(warrantyClaims)
    .where(where)
    .orderBy(desc(warrantyClaims.createdAt), desc(warrantyClaims.number));
  return rows.map(({ claim, photos }) => toSummary(claim, photos));
}

/** A claim's photos, in the order they came, and its history, oldest first, with who did each step. */
async function claimParts(tenantId: string, claim: ClaimRow) {
  const [photos, events] = await Promise.all([
    db
      .select({ id: warrantyClaimPhotos.id })
      .from(warrantyClaimPhotos)
      .where(and(eq(warrantyClaimPhotos.claimId, claim.id), eq(warrantyClaimPhotos.tenantId, tenantId)))
      .orderBy(asc(warrantyClaimPhotos.createdAt), asc(warrantyClaimPhotos.id)),
    db
      .select({ event: warrantyClaimEvents, by: userName })
      .from(warrantyClaimEvents)
      .leftJoin(users, eq(users.id, warrantyClaimEvents.userId))
      .where(and(eq(warrantyClaimEvents.claimId, claim.id), eq(warrantyClaimEvents.tenantId, tenantId)))
      .orderBy(asc(warrantyClaimEvents.createdAt), asc(warrantyClaimEvents.id)),
  ]);
  return {
    photoIds: photos.map((p) => p.id),
    events: events.map(
      ({ event, by }): WarrantyEvent => ({
        id: event.id,
        action: event.action,
        at: event.createdAt.toISOString(),
        // The client's own steps; a step by a user since deleted is the builder's (only staff are).
        byClient: event.userId !== null && event.userId === claim.createdById,
        detail: event.detail as WarrantyEventDetail,
        by,
      }),
    ),
  };
}

// ─── Staff (the project's Garantía tab) ──────────────────────────────────────

/** The project's claim, by its id; not found once its project is deleted. */
const claimInProject = (ctx: Ctx, projectId: string, claimId: string) =>
  and(
    eq(warrantyClaims.id, claimId),
    eq(warrantyClaims.projectId, projectId),
    eq(warrantyClaims.tenantId, ctx.tenantId),
    inLiveProject(warrantyClaims.projectId),
  );

/** The project's hand-over, guarantee and claims, newest first; every staff member reads them. */
export async function listClaims(ctx: Ctx, projectId: string): Promise<ProjectWarranty> {
  const home = await requireProject(ctx.tenantId, projectId);
  const [info, claims] = await Promise.all([
    coverageOf(ctx.tenantId, home),
    summaries(and(eq(warrantyClaims.projectId, projectId), eq(warrantyClaims.tenantId, ctx.tenantId))),
  ]);
  return { ...info, claims };
}

/** One claim with who sent it, its photos and its whole history. */
export async function getClaim(ctx: Ctx, projectId: string, claimId: string): Promise<WarrantyClaim> {
  const [row] = await db
    .select({ claim: warrantyClaims, photos: photoCount, by: userName })
    .from(warrantyClaims)
    .leftJoin(users, eq(users.id, warrantyClaims.createdById))
    .where(claimInProject(ctx, projectId, claimId));
  if (!row) fail("not_found");
  return { ...toSummary(row.claim, row.photos), createdBy: row.by, ...(await claimParts(ctx.tenantId, row.claim)) };
}

/** The claim, locked until the transaction ends: a client's cancel and staff's change never cross. */
async function lockClaim(tx: Tx, where: SQL | undefined) {
  const [claim] = await tx.select().from(warrantyClaims).where(where).for("update");
  if (!claim) fail("not_found");
  return claim;
}

/**
 * Staff move a claim on and answer the client. Body: { status?, visitOn?,
 * answer? } — scheduled needs a visit day, rejected an answer (the reason);
 * a cancelled claim stays as the client left it. The client is pushed when
 * the status, the visit day of a scheduled visit or the answer changes.
 */
export async function updateClaim(ctx: Ctx, projectId: string, claimId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const result = await db.transaction(async (tx) => {
    const claim = await lockClaim(tx, claimInProject(ctx, projectId, claimId));
    if (claim.status === "cancelled") fail("claim_cancelled");
    const changes = changesOf(parse(claimChangesSchema, input));
    const next = { status: claim.status, visitOn: claim.visitOn, answer: claim.answer, ...changes };
    if (next.status === "scheduled" && !next.visitOn) fail("visit_required");
    if (next.status === "rejected" && !next.answer) fail("reason_required");

    const detail: WarrantyEventDetail = {};
    if (next.status !== claim.status) detail.status = { from: claim.status, to: next.status };
    if (next.visitOn !== claim.visitOn) detail.visitOn = { from: claim.visitOn, to: next.visitOn };
    if (next.answer !== claim.answer) detail.answer = { from: claim.answer, to: next.answer };
    if (Object.keys(detail).length === 0) return null;

    await tx
      .update(warrantyClaims)
      .set({ ...next, ...(detail.answer ? { answeredAt: next.answer ? new Date() : null } : {}) })
      .where(eq(warrantyClaims.id, claim.id));
    await tx.insert(warrantyClaimEvents).values({ tenantId: ctx.tenantId, claimId, userId: ctx.userId, action: "updated", detail });
    // The push goes to the home's client now: only if they sent it (a claim of a client since removed is out of their reach).
    const [home] = await tx.select({ clientUserId: projects.clientUserId }).from(projects).where(projectInTenant(ctx.tenantId, projectId));
    return { claim, next, detail, toAuthor: claim.createdById !== null && claim.createdById === home?.clientUserId };
  });
  if (result) {
    const { claim, next, detail, toAuthor } = result;
    await markChanged(ctx.tenantId, projectId, ["project"]);
    const visitMoved = next.status === "scheduled" && detail.visitOn !== undefined;
    if (toAuthor && (detail.status || visitMoved || (detail.answer && next.answer))) {
      await notifyProjectClient(ctx.tenantId, projectId, {
        kind: "warranty",
        claimId,
        number: claim.number,
        status: detail.status || visitMoved ? next.status : null,
        visitOn: next.visitOn,
      });
    }
  }
  return { claimId };
}

const photoFile = {
  contentType: warrantyClaimPhotos.contentType,
  sizeBytes: warrantyClaimPhotos.sizeBytes,
  pathname: warrantyClaimPhotos.pathname,
  thumbSizeBytes: warrantyClaimPhotos.thumbSizeBytes,
};

/** A claim's photo (or its thumbnail), for staff of the project's tenant. */
export async function openClaimPhoto(ctx: Ctx, projectId: string, claimId: string, photoId: string, size: PhotoSize = "full") {
  const [photo] = await db
    .select(photoFile)
    .from(warrantyClaimPhotos)
    .innerJoin(warrantyClaims, eq(warrantyClaims.id, warrantyClaimPhotos.claimId))
    .where(and(eq(warrantyClaimPhotos.id, photoId), claimInProject(ctx, projectId, claimId)));
  return openPhotoFile(photo, size);
}

// ─── The client (mobile app) ─────────────────────────────────────────────────
// Called with the client's own identity (from their mobile token, which the
// API re-checks is still active on every request), not a staff `Ctx`.

/** A claim the client sent, on a home that is still theirs (and not deleted). */
const clientClaim = (tenantId: string, clientUserId: string, claimId: string) =>
  and(
    eq(warrantyClaims.id, claimId),
    eq(warrantyClaims.tenantId, tenantId),
    eq(warrantyClaims.createdById, clientUserId),
    sql`exists (select 1 from projects ch where ch.id = ${warrantyClaims.projectId} and ch.tenant_id = ${tenantId} and ch.client_user_id = ${clientUserId} and ch.deleted_at is null)`,
  );

/** Whose request a client's write is, for its idempotency key. */
const asCaller = (tenantId: string, clientUserId: string) => ({ tenantId, userId: clientUserId });

/**
 * What a client's write is on, for its idempotency key: the client too, so one
 * client's key never answers another's request on the same claim or home
 * (keys are the tenant's; a home changes client).
 */
const keyTarget = (clientUserId: string, target: Record<string, string>) => ({ ...target, clientUserId });

/** The home's (`projectId`, else the default one) hand-over, guarantee and the client's claims; null without a home. */
export async function getClientWarranty(
  tenantId: string,
  clientUserId: string,
  projectId?: string | null,
): Promise<MobileWarranty | null> {
  const home = await resolveClientProject(tenantId, clientUserId, projectId);
  if (!home) return null;
  const [info, claims] = await Promise.all([
    coverageOf(tenantId, home),
    summaries(
      and(eq(warrantyClaims.projectId, home.id), eq(warrantyClaims.tenantId, tenantId), eq(warrantyClaims.createdById, clientUserId)),
    ),
  ]);
  return { ...info, claims };
}

/**
 * One of the client's claims, with its photos and its history: no staff names
 * ("the builder"), and of the builder's answer only whether a step gave one
 * (`answered`): the answer stands on the claim, never the texts it replaced.
 */
export async function getClientClaim(tenantId: string, clientUserId: string, claimId: string): Promise<MobileWarrantyClaim> {
  const [row] = await db
    .select({ claim: warrantyClaims, photos: photoCount })
    .from(warrantyClaims)
    .where(clientClaim(tenantId, clientUserId, claimId));
  if (!row) fail("not_found");
  const { photoIds, events } = await claimParts(tenantId, row.claim);
  return {
    ...toSummary(row.claim, row.photos),
    photoIds,
    events: events.map(({ by: _, detail: { answer, ...detail }, ...event }): MobileWarrantyEvent => ({
      ...event,
      detail: answer === undefined ? detail : { ...detail, answered: answer.to !== null },
    })),
  };
}

/**
 * The client sends a claim about their home `projectId` (else their default
 * one), once it is handed over. Body: { kind, room, description, urgent?,
 * idempotencyKey? (sent again with the same key, it is one claim with one
 * number) }. At most MAX_OPEN_WARRANTY_CLAIMS waiting at once and
 * MAX_WARRANTY_CLAIMS_PER_DAY a day per home. → { claimId, number }
 */
export async function createClientClaim(
  tenantId: string,
  clientUserId: string,
  projectId: string | null | undefined,
  input: Record<string, unknown>,
) {
  const home = await resolveClientProject(tenantId, clientUserId, projectId);
  if (!home) fail("project_not_found");
  if (home.obraStage < HANDED_OVER_STAGE) fail("not_handed_over");
  const caller = asCaller(tenantId, clientUserId);
  const created = await idempotent<{ claimId: string; number: number }>(
    caller,
    "warranty.claim.create",
    keyTarget(clientUserId, { projectId: home.id }),
    input,
    async (once) => {
      const values = parse(newClaimSchema, input);
      return db.transaction((tx) =>
        once(tx, async () => {
          // One claim of the home at a time: the caps and the number hold under concurrent sends.
          // `no key update`: rows that only point at the home are still written meanwhile.
          const [locked] = await tx.select({ id: projects.id }).from(projects).where(projectInTenant(tenantId, home.id)).for("no key update");
          if (!locked) fail("project_not_found");
          const ofHome = and(eq(warrantyClaims.projectId, home.id), eq(warrantyClaims.tenantId, tenantId));
          const [[open], [today], [last]] = await Promise.all([
            tx.select({ n: count() }).from(warrantyClaims).where(and(ofHome, inArray(warrantyClaims.status, [...OPEN_WARRANTY_STATUSES]))),
            tx.select({ n: count() }).from(warrantyClaims).where(and(ofHome, gt(warrantyClaims.createdAt, new Date(Date.now() - DAY_MS)))),
            tx.select({ n: sql<number>`coalesce(max(${warrantyClaims.number}), 0)`.mapWith(Number) }).from(warrantyClaims).where(ofHome),
          ]);
          if (open!.n >= MAX_OPEN_WARRANTY_CLAIMS) fail("too_many_open_claims");
          if (today!.n >= MAX_WARRANTY_CLAIMS_PER_DAY) fail("too_many_claims_today");
          const [claim] = await tx
            .insert(warrantyClaims)
            .values({ ...values, tenantId, projectId: home.id, number: last!.n + 1, createdById: clientUserId })
            .returning({ id: warrantyClaims.id, number: warrantyClaims.number });
          await tx.insert(warrantyClaimEvents).values({ tenantId, claimId: claim!.id, userId: clientUserId, action: "created" });
          return { claimId: claim!.id, number: claim!.number };
        }),
      );
    },
  );
  await markChanged(tenantId, home.id, ["project"]);
  return created;
}

/**
 * The client adds a photo to their claim while nobody has started on it.
 * Body (multipart): { file, idempotencyKey? } — a JPEG, PNG or WebP (read from
 * its bytes) of at most MAX_PHOTO_BYTES; MAX_WARRANTY_PHOTOS per claim. One
 * request per photo: several would not fit Vercel's 4.5 MB body. → { photoId }
 */
export async function addClientClaimPhoto(
  tenantId: string,
  clientUserId: string,
  claimId: string,
  input: Record<string, unknown>,
) {
  const where = clientClaim(tenantId, clientUserId, claimId);
  const [found] = await db
    .select({ projectId: warrantyClaims.projectId, status: warrantyClaims.status, photos: photoCount })
    .from(warrantyClaims)
    .where(where);
  if (!found) fail("not_found");
  const added = await idempotent<{ photoId: string }>(
    asCaller(tenantId, clientUserId),
    "warranty.photo.add",
    keyTarget(clientUserId, { claimId }),
    input,
    async (once) => {
      // The cheap refusals first (unlocked; checked again below): no image is
      // decoded or stored for a claim that can't take it. A retry of a photo
      // that went in got its answer above, before these.
      if (!canCancelClaim(found.status)) fail("claim_closed");
      if (found.photos >= MAX_WARRANTY_PHOTOS) fail("too_many_photos");
      const { file } = parse(claimPhotoSchema, input);
      if (!(file instanceof Blob) || file.size === 0) fail("missing_file");
      if (file.size > MAX_PHOTO_BYTES) fail("file_too_large");
      const image = await readImage(file);
      if (!image) fail("invalid_file_type");

      const photoId = crypto.randomUUID();
      const pathname = `${projectFolder(tenantId, found.projectId)}warranty/${claimId}/${photoId}.${PHOTO_EXTENSIONS[image.contentType]}`;
      let result: { photoId: string } | undefined;
      await storeFiles(
        [
          { pathname, body: file, contentType: image.contentType },
          { pathname: thumbPath(pathname), body: image.thumbnail, contentType: THUMBNAIL.contentType },
        ],
        () =>
          db.transaction(async (tx) => {
            result = await once(tx, async () => {
              const claim = await lockClaim(tx, where);
              if (!canCancelClaim(claim.status)) fail("claim_closed");
              const [photos] = await tx.select({ n: count() }).from(warrantyClaimPhotos).where(eq(warrantyClaimPhotos.claimId, claimId));
              if (photos!.n >= MAX_WARRANTY_PHOTOS) fail("too_many_photos");
              await tx.insert(warrantyClaimPhotos).values({
                id: photoId,
                tenantId,
                claimId,
                pathname,
                contentType: image.contentType,
                sizeBytes: file.size,
                thumbSizeBytes: image.thumbnail.size,
                uploadedById: clientUserId,
              });
              await tx.insert(warrantyClaimEvents).values({ tenantId, claimId, userId: clientUserId, action: "photo_added" });
              return { photoId };
            });
          }),
      );
      return result!;
    },
  );
  await markChanged(tenantId, found.projectId, ["project"]);
  return added;
}

/**
 * The client cancels their claim while nobody has started on it (`claim_closed`
 * after); cancelling it again answers the same, for a retry.
 */
export async function cancelClientClaim(tenantId: string, clientUserId: string, claimId: string) {
  const projectId = await db.transaction(async (tx) => {
    const claim = await lockClaim(tx, clientClaim(tenantId, clientUserId, claimId));
    if (claim.status === "cancelled") return null;
    if (!canCancelClaim(claim.status)) fail("claim_closed");
    await tx.update(warrantyClaims).set({ status: "cancelled" }).where(eq(warrantyClaims.id, claimId));
    await tx.insert(warrantyClaimEvents).values({
      tenantId,
      claimId,
      userId: clientUserId,
      action: "cancelled",
      detail: { status: { from: claim.status, to: "cancelled" } } satisfies WarrantyEventDetail,
    });
    return claim.projectId;
  });
  if (projectId) await markChanged(tenantId, projectId, ["project"]);
  return { claimId };
}

/** A photo of one of the client's claims (or its thumbnail). */
export async function openClientClaimPhoto(
  tenantId: string,
  clientUserId: string,
  claimId: string,
  photoId: string,
  size: PhotoSize = "full",
) {
  const [photo] = await db
    .select(photoFile)
    .from(warrantyClaimPhotos)
    .innerJoin(warrantyClaims, eq(warrantyClaims.id, warrantyClaimPhotos.claimId))
    .where(and(eq(warrantyClaimPhotos.id, photoId), clientClaim(tenantId, clientUserId, claimId)));
  return openPhotoFile(photo, size);
}
