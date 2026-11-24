import type { Messages } from "./merge-messages";

// What each layout gives its client components of the translation catalogue (messages/{locale}.json),
// so a page sends the browser only the text its client components can show: the login page none of
// the portal's, a Subcontratas page none of Compras'. Server components don't need any of this:
// they read the whole catalogue on the server (getTranslations, or useTranslations without
// "use client").
//
// Keys are the layout's folder under app/ (route groups included); a level adds its paths to
// those of the levels above it (`<ClientMessages scope>` in that layout.tsx). A path is a top-level
// namespace ("purchasing") or a part of one ("construction.tabs"). Each level sends only what it
// adds, less what a level above already sent (`scopeMessages`), and the browser lays it over the
// messages above (`NestedMessages`): a page that renders only a deep layout anew (another chapter,
// another project) sends only that layout's part again.
//
// i18n/client-messages.test.ts checks this against the code: every `useTranslations("…")` a client
// component under a layout calls (and every `namespace` handed to FormError, FileSlot or useConfirm)
// is covered there, nothing is given that nothing under it reads, and a path sits at the deepest
// level that needs it (higher only when two of its sections or the level itself use it).

export const CLIENT_MESSAGES = {
  // Signed out: the login page and the root error / not-found pages.
  "": ["errorPages", "login"],
  // The portal's frame (rail, top bar, settings) and what several sections share.
  dashboard: ["account", "confirmDialog", "navigation", "pager", "sidebar", "topbar", "vatBasis", "wizard"],
  "dashboard/clients": ["clientsPage"],
  "dashboard/users": ["usersPage"],
  "dashboard/eliminados": ["deletedPage"],
  "dashboard/contacto": ["officeContactPage"],
  // The project list (its budget and stage pills) and a new project; every project's tabs below.
  "dashboard/projects": ["budget.revisionPill", "budgetsOverview.pill", "construction.scheduleStatus", "newProjectPage", "obra", "projectsPage"],
  "dashboard/projects/[id]": ["construction.photos", "projectDetailPage"],
  "dashboard/projects/[id]/budget": ["budget", "construction.filters"],
  "dashboard/projects/[id]/obra": [
    "construction",
    "subcontractors.companies.attention",
    "subcontractors.docState",
    "subcontractors.requirements",
  ],
  "dashboard/projects/[id]/obra/planificacion": ["planning"],
  "dashboard/projects/[id]/garantia": ["warranty"],
  // The chapter's orders (their pills).
  "dashboard/projects/[id]/obra/avance/[code]": ["purchasing.chapter", "purchasing.latePill", "purchasing.status"],
  "dashboard/projects/[id]/compras": [
    "construction.chapterState",
    "construction.filters",
    "construction.sources",
    "obraPicker",
    "planning",
    "purchasing",
    "subcontractors.errors",
    "subcontractors.fields.types",
    "subcontractors.requirements",
    "subcontractors.trades",
    "subcontractors.wizard.documents",
  ],
  "dashboard/compras": [
    "construction.filters",
    "obra",
    "purchasing",
    "subcontractors.errors",
    "subcontractors.fields.types",
    "subcontractors.wizard.documents",
  ],
  "dashboard/subcontratas": ["projectDetailPage", "subcontractors"],
  // A company's orders.
  "dashboard/subcontratas/empresas/[id]": [
    "purchasing.cae",
    "purchasing.kind",
    "purchasing.latePill",
    "purchasing.list",
    "purchasing.status",
  ],
} as const satisfies Record<string, readonly string[]>;

export type MessageScope = keyof typeof CLIENT_MESSAGES;

const levels = Object.keys(CLIENT_MESSAGES) as MessageScope[];
const isAbove = (level: MessageScope, scope: MessageScope) => level === "" || scope.startsWith(`${level}/`);

/** The paths the levels above a scope send. */
export function pathsAbove(scope: MessageScope): string[] {
  return levels.filter((level) => level !== scope && isAbove(level, scope)).flatMap((level) => CLIENT_MESSAGES[level]);
}

/** A scope's paths with those of the levels above it: what its client components can read. */
export function clientMessagePaths(scope: MessageScope): string[] {
  return [...pathsAbove(scope), ...CLIENT_MESSAGES[scope]];
}

/** What a scope's layout sends: its own paths of the catalogue, less what a level above sent. */
export function scopeMessages(messages: Messages, scope: MessageScope): Messages {
  return pathsAbove(scope).reduce(omitPath, pickMessages(messages, CLIENT_MESSAGES[scope]));
}

/** `messages` without one path, copying only the groups on the way to it. */
function omitPath(messages: Messages, path: string): Messages {
  const [key = "", ...rest] = path.split(".");
  if (!Object.hasOwn(messages, key)) return messages;
  const { [key]: inner, ...others } = messages;
  if (rest.length === 0) return others;
  if (typeof inner !== "object" || inner === null) return messages;
  const left = omitPath(inner as Messages, rest.join("."));
  return Object.keys(left).length ? { ...others, [key]: left } : others;
}

/** Only the given paths of the catalogue (never changing it): a path inside one already taken is skipped. */
export function pickMessages(messages: Messages, paths: readonly string[]): Messages {
  const picked: Messages = {};
  const sorted = [...new Set(paths)].sort((a, b) => a.split(".").length - b.split(".").length);
  const taken: string[] = [];
  for (const path of sorted) {
    if (taken.some((t) => path.startsWith(`${t}.`))) continue;
    taken.push(path);
    const keys = path.split(".");
    let from: unknown = messages;
    let to = picked;
    for (const [i, key] of keys.entries()) {
      from = from && typeof from === "object" ? (from as Messages)[key] : undefined;
      if (from === undefined) break;
      if (i === keys.length - 1) to[key] = from;
      else to = (to[key] ??= {}) as Messages;
    }
  }
  return picked;
}
