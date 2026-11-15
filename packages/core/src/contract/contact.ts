// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

// ─── Contact (the app's Contacto screen) ─────────────────────────────────────
// Who the client calls: their project's site manager (one of the builder's
// staff users, picked on the project's General tab) and the builder's office
// (set by an admin on the portal's "Contacto para clientes"). ../contact.ts.

/** The site manager as the client's app shows them: only what the client may call or write to. */
export type MobileSiteManager = { name: string; phone: string | null; email: string };

/** The builder's office as the app shows it: `name` is the company's; each field null when not given. */
export type MobileOffice = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Opening hours as staff wrote them, e.g. "Lunes a viernes · 9:00 – 18:00". */
  hours: string | null;
};

/**
 * GET /api/mobile/contact (`?projectId=`): the site manager of that home (null
 * when none is assigned, or they are no longer active staff) and the office
 * (null when the builder gave none of its fields).
 */
export type MobileContact = { siteManager: MobileSiteManager | null; office: MobileOffice | null };

/** The office fields staff edit (GET/PUT /api/v1/tenant/contact). */
export type OfficeContact = Omit<MobileOffice, "name">;

/** A staff user who may be a project's site manager: an active one of the tenant. */
export type SiteManagerOption = { id: string; name: string | null; email: string; phone: string | null };

/** GET /api/v1/projects/:id/site-manager: the one assigned (null: none, or no longer active) and who may be. */
export type ProjectSiteManager = { siteManager: SiteManagerOption | null; options: SiteManagerOption[] };

/** Error codes of the contact service (`{ error: code }` in the API). */
export type ContactError =
  | "missing_fields"
  | "invalid_input"
  | "invalid_phone"
  | "invalid_email"
  | "project_not_found"
  | "user_not_found"
  | "forbidden";
