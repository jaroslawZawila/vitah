// pnpm db:drift — compares the database at DRIFT_URL with what schema.ts
// defines. It builds schema.ts in a scratch database on a Postgres you
// control (DRIFT_SCRATCH_URL, default the local Docker one), reads both and
// prints what is missing, extra or different. The target is only ever read.
// See packages/db/sql/README.md.

import { resolve } from "node:path";
import { createScratchDatabase, errorMessage, packageRoot, pushSchema, redactor } from "./connection";
import { checkDrift, formatReport, readAllowList } from "./drift";

const LOCAL_SERVER = "postgres://vitah:vitah_dev@localhost:4432";

async function main(): Promise<number> {
  const targetUrl = process.env.DRIFT_URL?.trim();
  if (!targetUrl) {
    console.error("Set DRIFT_URL to the database to check (a direct connection, not a pooled one).");
    return 2;
  }
  const scratchServer = process.env.DRIFT_SCRATCH_URL?.trim() || LOCAL_SERVER;
  // The scratch database is created and dropped: never on the server under check, unless that is this machine.
  const [target, scratchHost] = [new URL(targetUrl), new URL(scratchServer)];
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(scratchHost.hostname);
  if (!local && target.host === scratchHost.host) {
    console.error("DRIFT_SCRATCH_URL is the server being checked: point it at a Postgres you can create databases on.");
    return 2;
  }
  const allow = await readAllowList(process.env.DRIFT_ALLOW ?? resolve(packageRoot, "drift-allow.json"));

  const scratch = await createScratchDatabase(scratchServer, "vitah_drift");
  try {
    console.log("Building schema.ts in a scratch database (drizzle-kit push)…");
    pushSchema(scratch.url);
    console.log("Reading the target (read-only)…\n");
    const report = await checkDrift(scratch.url, targetUrl, allow);
    console.log(formatReport(report));
    return report.drift.length > 0 ? 1 : 0;
  } finally {
    await scratch.drop();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const redact = redactor(process.env.DRIFT_URL, process.env.DRIFT_SCRATCH_URL);
    console.error(redact(errorMessage(error)));
    process.exit(2);
  },
);
