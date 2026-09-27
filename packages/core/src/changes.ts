import { db, projects, sql } from "@repo/db";
import { CHANGE_AREAS, type ChangeArea, type MobileChanges } from "./contract";
import { clientProjectWhere, projectInTenant } from "./project-client";

// ─── Change counters ─────────────────────────────────────────────────────────
// What the client's app polls while it is open (GET /api/mobile/changes): one
// counter per part of the app, bumped after every write to that part. The app
// then reloads the part through its own endpoint. A write names only what it
// wrote; which counters each part of the app reads is declared once, below.
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNS = {
  project: "projectRev",
  obra: "obraRev",
  photos: "photosRev",
  documents: "documentsRev",
} as const satisfies Record<ChangeArea, keyof typeof projects.$inferSelect>;

/** The counters each part of the app reads: the obra also shows the project's dates and its photos. */
const READS: Record<ChangeArea, readonly ChangeArea[]> = {
  project: ["project"],
  obra: ["obra", "project", "photos"],
  photos: ["photos"],
  documents: ["documents"],
};

// Counters only go up, so a sum of them moves whenever one of them does.
const reading = Object.fromEntries(
  CHANGE_AREAS.map((area) => [
    area,
    sql<number>`${sql.join(
      READS[area].map((read) => projects[COLUMNS[read]]),
      sql` + `,
    )}`.mapWith(Number),
  ]),
);

/**
 * Tells the client's app that these parts of the project changed. Call it
 * after the write. Never fails the caller: the write has already succeeded,
 * and the app still reloads everything when it next comes to the foreground.
 */
export async function markChanged(
  tenantId: string,
  projectId: string,
  areas: readonly ChangeArea[],
) {
  try {
    const set = Object.fromEntries(
      areas.map((area) => [COLUMNS[area], sql`${projects[COLUMNS[area]]} + 1`]),
    );
    await db.update(projects).set(set).where(projectInTenant(tenantId, projectId));
  } catch (error) {
    console.error("Failed to mark changes of project", projectId, error);
  }
}

/**
 * The counters of the client's project; null when none is attached. Called
 * with the client's own identity (from their mobile token).
 */
export async function getClientChanges(
  tenantId: string,
  clientUserId: string,
): Promise<MobileChanges | null> {
  const [row] = await db
    .select({ projectId: projects.id, ...reading })
    .from(projects)
    .where(clientProjectWhere(tenantId, clientUserId));
  return (row as MobileChanges | undefined) ?? null;
}
