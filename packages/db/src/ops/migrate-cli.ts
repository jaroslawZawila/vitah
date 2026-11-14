// pnpm db:sql:status | db:sql:migrate | db:sql:baseline [-- file.sql …] | db:sql:deploy
// The database comes from MIGRATE_URL, else POSTGRES_URL_NON_POOLING, else
// POSTGRES_URL (a pooled URL only for `status`). See packages/db/sql/README.md.

import { resolve } from "node:path";
import { errorMessage, packageRoot, redactor } from "./connection";
import {
  assertDirect,
  baseline,
  deployMigrations,
  migrate,
  migrationStatus,
  resolveTarget,
  type MigrationPlan,
} from "./migrate";

const USAGE = "Usage: migrate-cli.ts status | migrate | baseline [file.sql … | --except a.sql,b.sql] | deploy";

function printStatus(plan: MigrationPlan): void {
  const width = Math.max(0, ...plan.files.map((file) => file.filename.length));
  for (const file of plan.files) {
    const label = file.state === "changed" ? "CHANGED" : file.state;
    const when = file.appliedAt
      ? `${file.appliedAt.toISOString().slice(0, 16).replace("T", " ")} UTC${file.baseline ? " (baseline)" : ""}`
      : "";
    console.log(`${label.padEnd(8)}  ${file.filename.padEnd(width)}  ${when}`.trimEnd());
  }
  for (const name of plan.missing) {
    console.log(`${"recorded".padEnd(8)}  ${name}  (applied, but not a file of this checkout)`);
  }
  const count = (state: string) => plan.files.filter((file) => file.state === state).length;
  console.log(`\n${count("applied")} applied, ${count("pending")} pending, ${count("changed")} changed.`);
  for (const problem of plan.problems) console.error(`\n! ${problem}`);
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2).filter((arg) => arg !== "--");
  const dir = process.env.MIGRATIONS_DIR ?? resolve(packageRoot, "sql");
  const log = (line: string) => console.log(line);

  if (command === "deploy") {
    const result = await deployMigrations(process.env, { dir, log });
    if ("skipped" in result) console.log(`db:sql:deploy skipped: ${result.skipped}.`);
    return 0;
  }
  if (command !== "status" && command !== "migrate" && command !== "baseline") {
    console.error(USAGE);
    return 2;
  }

  const target = resolveTarget(process.env);
  if (!target) {
    console.error("No database: set MIGRATE_URL (or POSTGRES_URL_NON_POOLING, or POSTGRES_URL).");
    return 2;
  }
  console.log(`Database from ${target.source}.`);
  const options = { url: target.url, dir, log };

  if (command === "status") {
    const plan = await migrationStatus(options);
    printStatus(plan);
    return plan.problems.length > 0 ? 1 : 0;
  }
  // Anything that writes needs a direct connection; said with the variable's name.
  assertDirect(target.url, target.source);
  if (command === "migrate") await migrate(options);
  else {
    const at = args.indexOf("--except");
    const except = at === -1 ? [] : (args[at + 1] ?? "").split(",").filter(Boolean);
    const only = at === -1 ? args : args.filter((_, index) => index !== at && index !== at + 1);
    await baseline({ ...options, only, except });
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const redact = redactor(process.env.MIGRATE_URL, process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL);
    console.error(redact(errorMessage(error)));
    process.exit(1);
  },
);
