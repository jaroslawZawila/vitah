// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

// ─── Garantía: after-sales warranty claims ───────────────────────────────────
// The client of a handed-over home asks the builder, from the app, to fix
// something under the LOE guarantee (Ley 38/1999, art. 17: 1 year finishes, 3
// years habitability, 10 years structure, from the reception). Staff answer it
// on the project's Garantía tab. Dates are YYYY-MM-DD, times ISO.

/** What a claim is about: the chips of doc/mobile-app-design/A-Warranty.dc.html. */
export const WARRANTY_KINDS = ["finishes", "plumbing", "electrical", "carpentry", "damp", "other"] as const;
export type WarrantyKind = (typeof WARRANTY_KINDS)[number];

/** Where in the home (the description says which one when there are several). */
export const WARRANTY_ROOMS = ["bathroom", "kitchen", "living_room", "bedroom", "hall", "exterior", "other"] as const;
export type WarrantyRoom = (typeof WARRANTY_ROOMS)[number];

/** received → in_review → scheduled → resolved, or rejected (with a reason), or cancelled by the client. */
export const WARRANTY_STATUSES = ["received", "in_review", "scheduled", "resolved", "rejected", "cancelled"] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/** What staff may set: any status but the client's own `cancelled` (corrections included). */
export const STAFF_WARRANTY_STATUSES = ["received", "in_review", "scheduled", "resolved", "rejected"] as const;
export type StaffWarrantyStatus = (typeof STAFF_WARRANTY_STATUSES)[number];

/** Still waiting for the builder: what the cap on open claims counts. */
export const OPEN_WARRANTY_STATUSES: readonly WarrantyStatus[] = ["received", "in_review", "scheduled"];

/** The client may cancel a claim only while nobody has started on it. */
export const canCancelClaim = (status: WarrantyStatus) => status === "received";

export const WARRANTY_EVENT_ACTIONS = ["created", "photo_added", "updated", "cancelled"] as const;
export type WarrantyEventAction = (typeof WARRANTY_EVENT_ACTIONS)[number];

// ─── Limits on what the client writes ────────────────────────────────────────

/** Photos per claim (each at most MAX_PHOTO_BYTES, one request each). */
export const MAX_WARRANTY_PHOTOS = 4;
export const MAX_WARRANTY_DESCRIPTION = 2000;
export const MAX_WARRANTY_ANSWER = 2000;
/** Claims of a home still waiting for the builder at once. */
export const MAX_OPEN_WARRANTY_CLAIMS = 5;
/** Claims a home may send in 24 hours, cancelled ones included. */
export const MAX_WARRANTY_CLAIMS_PER_DAY = 3;

// ─── Coverage (LOE art. 17) ──────────────────────────────────────────────────

export type WarrantyScope = "finishes" | "habitability" | "structure";
export const WARRANTY_PERIODS: readonly { scope: WarrantyScope; years: number }[] = [
  { scope: "finishes", years: 1 },
  { scope: "habitability", years: 3 },
  { scope: "structure", years: 10 },
];

/**
 * Where the hand-over day comes from, the most certain first: the day H9's
 * acta (the reception) was signed, else the day H9 was paid (against the keys),
 * else the hand-over date the client was told (the approved plan's end, else
 * the project's completion date).
 */
export type HandoverSource = "acta" | "payment" | "planned";

/** One guarantee period: until when it runs (null without a hand-over day), and whether it still does. */
export type WarrantyCoverage = { scope: WarrantyScope; years: number; endsOn: string | null; active: boolean };

/** `date` plus `years`, YYYY-MM-DD; 29 February becomes 28 February in a common year. */
export function addYears(date: string, years: number) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const year = y + years;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** The three periods from the hand-over day; all still running without one (they start at hand-over). */
export function warrantyCoverage(handoverOn: string | null, today: string): WarrantyCoverage[] {
  return WARRANTY_PERIODS.map(({ scope, years }) => {
    const endsOn = handoverOn ? addYears(handoverOn, years) : null;
    return { scope, years, endsOn, active: endsOn === null || endsOn >= today };
  });
}

/** A claim's reference: GAR-001. */
export const warrantyRef = (number: number) => `GAR-${String(number).padStart(3, "0")}`;

// ─── What the API answers ────────────────────────────────────────────────────

/** A claim as listed, for the client and for staff. */
export type WarrantyClaimSummary = {
  id: string;
  number: number;
  kind: WarrantyKind;
  room: WarrantyRoom;
  description: string;
  urgent: boolean;
  status: WarrantyStatus;
  /** The day staff will visit, once they set one. */
  visitOn: string | null;
  /** The builder's last answer to the client (a rejection's reason). */
  answer: string | null;
  answeredAt: string | null;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
};

/** What changed in one step of a claim: each field's before and after. */
export type WarrantyChange<T> = { from: T; to: T };
export type WarrantyEventDetail = {
  status?: WarrantyChange<WarrantyStatus>;
  visitOn?: WarrantyChange<string | null>;
  answer?: WarrantyChange<string | null>;
};

/**
 * What changed in one step, as the client sees it: of the builder's answer only
 * whether the step gave one (`answered`; false when it cleared it). The answer
 * itself is the claim's `answer`, never a text it replaced.
 */
export type MobileWarrantyEventDetail = Omit<WarrantyEventDetail, "answer"> & { answered?: boolean };

/** One step of a claim, as the client sees it: by them or by the builder, never a staff member's name. */
export type MobileWarrantyEvent = {
  id: string;
  action: WarrantyEventAction;
  at: string;
  byClient: boolean;
  detail: MobileWarrantyEventDetail;
};

/** One step of a claim, as staff see it: who did it, and every answer's text. */
export type WarrantyEvent = Omit<MobileWarrantyEvent, "detail"> & { detail: WarrantyEventDetail; by: string | null };

/** The home's hand-over and its guarantee, for the client and for staff. */
export type WarrantyCoverageInfo = {
  /** Stage 8: the guarantee runs and claims can be sent. */
  handedOver: boolean;
  handoverOn: string | null;
  handoverSource: HandoverSource | null;
  coverage: WarrantyCoverage[];
};

/** GET /api/mobile/warranty: the home's coverage and its claims, newest first. */
export type MobileWarranty = WarrantyCoverageInfo & { claims: WarrantyClaimSummary[] };

/** GET /api/mobile/warranty/:id: a claim with its photos and history (oldest first). */
export type MobileWarrantyClaim = WarrantyClaimSummary & {
  photoIds: string[];
  events: MobileWarrantyEvent[];
};

/** GET /api/v1/projects/:id/warranty. */
export type ProjectWarranty = WarrantyCoverageInfo & { claims: WarrantyClaimSummary[] };

/** GET /api/v1/projects/:id/warranty/:claimId: who sent it, its photos and its whole history. */
export type WarrantyClaim = WarrantyClaimSummary & {
  createdBy: string | null;
  photoIds: string[];
  events: WarrantyEvent[];
};

/** Error codes of the warranty service (`{ error: code }` in the API). */
export type WarrantyError =
  | "missing_fields"
  | "invalid_input"
  | "invalid_date"
  | "not_handed_over"
  | "too_many_open_claims"
  | "too_many_claims_today"
  | "too_many_photos"
  | "missing_file"
  | "file_too_large"
  | "invalid_file_type"
  | "claim_closed"
  | "claim_cancelled"
  | "visit_required"
  | "reason_required"
  | "idempotency_key_reused"
  | "project_not_found"
  | "not_found"
  | "forbidden";
