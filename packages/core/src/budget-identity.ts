import { and, clientProfiles, db, eq, projects, users } from "@repo/db";
import { IDENTITY_FIELDS, type BudgetIdentity, type BudgetTexts, type IdentityField } from "./contract";
import { foldAccents } from "./format";
import { projectInTenant, type Tx } from "./project-client";

// ─── Budget: the client and the address it names ──────────────────────────────
// The project is the one source of truth for who the client is and where the
// home is: its address, and its client's first name and surnames. A new draft
// (by hand, by the AI, or copied from the revision before) takes both from it
// (`withProjectIdentity`). The draft's own text stays where the project has
// nothing, and where it already names the project's value and says more ("D.
// Fernando Barcenilla, en calidad de autopromotor…", the plot and the
// province): that difference is deliberate. Any other difference shows on the
// draft (`compareIdentity`), which can then take the project's data
// (`budgetService.takeProjectData`). Nothing is ever written to the project, and
// issued revisions never change: they were given to the client.
// ─────────────────────────────────────────────────────────────────────────────

/** The project's client and address, as the budget's cover should name them; null where it has none. */
export type ProjectIdentity = Pick<BudgetIdentity, "client" | "address">;

const SOURCE = { promoter: "client", site: "address" } as const satisfies Record<IdentityField, keyof ProjectIdentity>;

/** Lower case, without accents, split at anything that is not a letter or a digit. */
const words = (text: string) =>
  foldAccents(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Whether a cover `text` names `value`: the same once case, accents,
 * punctuation and spaces are set aside, or every word of it, in its order,
 * among more (a title, a capacity, the plot, the province). The order counts:
 * "Polígono 104, Parcela 501" is not "Polígono 501, Parcela 104".
 */
export function namesValue(text: string, value: string): boolean {
  const wanted = words(value);
  const found = words(text);
  if (wanted.join("") === found.join("")) return true;
  let from = 0;
  return wanted.every((word) => {
    const at = found.indexOf(word, from);
    from = at + 1;
    return at >= 0;
  });
}

const projectValue = (identity: ProjectIdentity, field: IdentityField) => identity[SOURCE[field]]?.trim() || null;

/** Which cover fields differ from the project's data, and which name what the project lacks. */
export function compareIdentity(cover: BudgetTexts["cover"], identity: ProjectIdentity): BudgetIdentity {
  const differs = IDENTITY_FIELDS.filter((field) => {
    const value = projectValue(identity, field);
    return value !== null && !namesValue(cover[field], value);
  });
  const projectLacks = IDENTITY_FIELDS.filter((field) => projectValue(identity, field) === null && cover[field].trim() !== "");
  return { client: projectValue(identity, "promoter"), address: projectValue(identity, "site"), differs, projectLacks };
}

/** The cover with the project's client and address where it doesn't already name them. */
export function withProjectIdentity(cover: BudgetTexts["cover"], identity: ProjectIdentity): BudgetTexts["cover"] {
  const { differs } = compareIdentity(cover, identity);
  return { ...cover, ...Object.fromEntries(differs.map((field) => [field, projectValue(identity, field)!])) };
}

/** The project's address and its client's name (the client's profile, else their account's name). */
export async function projectIdentity(tenantId: string, projectId: string, tx: Tx | typeof db = db): Promise<ProjectIdentity> {
  const [row] = await tx
    .select({
      address: projects.address,
      firstName: clientProfiles.firstName,
      surnames: clientProfiles.surnames,
      name: users.name,
    })
    .from(projects)
    .leftJoin(users, and(eq(users.id, projects.clientUserId), eq(users.tenantId, tenantId)))
    .leftJoin(clientProfiles, eq(clientProfiles.userId, users.id))
    .where(projectInTenant(tenantId, projectId));
  if (!row) return { client: null, address: null };
  const profile = [row.firstName, row.surnames].filter(Boolean).join(" ").trim();
  return { client: profile || row.name?.trim() || null, address: row.address.trim() || null };
}
