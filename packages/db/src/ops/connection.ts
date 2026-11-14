// Shared by the migration runner and the drift check: both take a database
// URL from the environment (never the shared `db` client) and must never
// print it.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Returns a function that strips connection details from a message: the URLs
 * themselves, their passwords and hosts, and their user where Postgres quotes
 * it (`password authentication failed for user "…"`). Use it on everything
 * printed that came from an error.
 */
export function redactor(...urls: (string | undefined)[]): (text: string) => string {
  const secrets = new Set<string>();
  const users = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    secrets.add(url);
    try {
      const parsed = new URL(url);
      for (const part of [parsed.password, parsed.hostname]) {
        // Not "localhost" and the like: they say nothing, and hiding a short
        // common word would mangle the rest of the message.
        if (part.length >= 6 && part !== "localhost") secrets.add(part);
      }
      if (parsed.password.length >= 4) secrets.add(decodeURIComponent(parsed.password));
      if (parsed.username) users.add(decodeURIComponent(parsed.username));
    } catch {
      // Not a URL: hidden whole, above.
    }
  }
  const longestFirst = [...secrets].sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const secret of longestFirst) out = out.split(secret).join("***");
    for (const user of users) out = out.split(`"${user}"`).join('"***"');
    return out.replace(/\bpostgres(?:ql)?:\/\/[^\s"'`)]+/gi, "postgres://***");
  };
}

/** The message of anything thrown, as text. */
export function errorMessage(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map(errorMessage).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/** `url` pointing at another database of the same server. */
export function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

function adminClient(serverUrl: string) {
  const url = new URL(serverUrl);
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/postgres";
  return postgres(url.toString(), { max: 1, onnotice: () => {} });
}

const SCRATCH_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Creates an empty, uniquely named database on the server of `serverUrl`
 * (whose own database, default `postgres`, is only used to issue the
 * CREATE) and returns its URL and how to drop it.
 */
export async function createScratchDatabase(
  serverUrl: string,
  prefix: string,
): Promise<{ name: string; url: string; drop: () => Promise<void> }> {
  const name = `${prefix}_${randomBytes(6).toString("hex")}`;
  if (!SCRATCH_NAME.test(name)) throw new Error(`Invalid scratch database name "${name}"`);
  const admin = adminClient(serverUrl);
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return {
    name,
    url: withDatabase(serverUrl, name),
    drop: async () => {
      const client = adminClient(serverUrl);
      try {
        await client.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await client.end();
      }
    },
  };
}

/** Drops every database of the server whose name starts with `prefix`. */
export async function dropScratchDatabases(serverUrl: string, prefix: string): Promise<string[]> {
  if (!SCRATCH_NAME.test(prefix)) throw new Error(`Invalid scratch database prefix "${prefix}"`);
  const admin = adminClient(serverUrl);
  try {
    const rows = await admin<{ datname: string }[]>`
      select datname from pg_database where starts_with(datname, ${prefix})`;
    for (const { datname } of rows) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    return rows.map((row) => row.datname);
  } finally {
    await admin.end();
  }
}

/** Builds the schema of `schema.ts` in the database at `url` (`drizzle-kit push`). */
export function pushSchema(url: string): void {
  execFileSync(resolve(packageRoot, "node_modules/.bin/drizzle-kit"), ["push", "--force"], {
    cwd: packageRoot,
    env: { ...process.env, POSTGRES_URL: url },
    stdio: "pipe",
  });
}
