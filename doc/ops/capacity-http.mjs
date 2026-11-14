#!/usr/bin/env node
// Times the portal's pages over HTTP against the volume dataset, as its admin
// (see capacity.md). The portal must be running as a production build on a
// scratch database filled by `pnpm db:seed:volume`:
//
//   cd apps/web
//   export POSTGRES_URL=postgres://vitah:vitah_dev@localhost:4432/vitah_volume
//   export NEXTAUTH_SECRET=any-local-secret AUTH_TRUST_HOST=true
//   npx next build && npx next start --port 3210 &
//   node ../../doc/ops/capacity-http.mjs http://localhost:3210 5 [out.json]
//
// For each page: the status, the time to first byte and in full (median of the
// runs after a warm-up), the HTML's size (as sent and gzipped) and the size of
// its RSC payload (what a navigation inside the portal downloads). Needs curl.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";

const base = (process.argv[2] ?? "http://localhost:3210").replace(/\/$/, "");
const runs = Number(process.argv[3] ?? 5);
const out = process.argv[4];
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("Only a local portal is measured");

const dir = mkdtempSync(join(tmpdir(), "capacity-http-"));
const jar = join(dir, "cookies");
const curl = (args) => execFileSync("curl", ["-s", "-b", jar, "-c", jar, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const json = (path) => JSON.parse(curl([`${base}${path}`]));

// Sign in as the volume dataset's admin, through the app's own credentials login.
const { csrfToken } = json("/api/auth/csrf");
curl([
  "-o", "/dev/null",
  "-X", "POST",
  "--data-urlencode", `csrfToken=${csrfToken}`,
  "--data-urlencode", "email=admin@volumen.test",
  "--data-urlencode", "password=vitah2026",
  "--data-urlencode", `callbackUrl=${base}/dashboard`,
  `${base}/api/auth/callback/credentials`,
]);
const projects = json("/api/v1/projects");
if (!Array.isArray(projects)) throw new Error(`Could not sign in: ${JSON.stringify(projects)}`);

// The busiest obra (an obra handed over has every order), the supplier owed most and the largest company.
const project = projects.find((p) => p.ref === "VOL-002") ?? projects[0];
const supplier = json("/api/v1/purchases/suppliers").suppliers[0];
const company = [...json("/api/v1/subcontractors")].sort((a, b) => b.workers - a.workers)[0];
const p = `/dashboard/projects/${project.id}`;

const pages = [
  "/dashboard/projects",
  "/dashboard/compras",
  "/dashboard/compras/facturas",
  "/dashboard/compras/pagos",
  "/dashboard/compras/solicitudes",
  "/dashboard/compras/proveedores",
  `/dashboard/compras/proveedores/${supplier.id}`,
  "/dashboard/subcontratas/empresas",
  `/dashboard/subcontratas/empresas/${company.id}`,
  "/dashboard/subcontratas/trabajadores",
  `/dashboard/subcontratas/trabajadores?obra=${project.id}`,
  p,
  `${p}/compras`,
  `${p}/compras?vista=pedidos`,
  `${p}/compras/nuevo`,
  `${p}/obra`,
  `${p}/obra/costes`,
  `${p}/obra/planificacion`,
  `${p}/budget`,
  // A later page, a filter and the suppliers' breakdown of the paged lists.
  "/dashboard/compras?page=3&estado=done",
  "/dashboard/compras?vista=proveedores",
  "/dashboard/compras/facturas?estado=open&q=f26",
  "/dashboard/subcontratas/trabajadores?acceso=blocked",
  "/api/v1/budgets",
  // Without ?page: everything, as before the lists were paged.
  "/api/v1/purchases",
  "/api/v1/purchases/invoices",
  "/api/v1/purchases/payments",
  "/api/v1/subcontractors/workers",
  "/api/v1/purchases?page=1",
  "/api/v1/purchases/invoices?page=1",
  "/api/v1/purchases/payments?page=1",
  "/api/v1/subcontractors/workers?page=1",
  "/api/v1/purchases/counts",
];

const WRITE = "%{http_code} %{time_starttransfer} %{time_total} %{size_download}";
const timed = (path, headers = []) => {
  const [status, ttfb, total, bytes] = curl(["-o", "/dev/null", "-w", WRITE, ...headers.flatMap((h) => ["-H", h]), `${base}${path}`]).split(" ");
  return { status: Number(status), ttfb: Number(ttfb) * 1000, total: Number(total) * 1000, bytes: Number(bytes) };
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const kb = (bytes) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);
const label = (path) => path.replace(project.id, "[id]").replace(supplier.id, "[id]").replace(company.id, "[id]");

const results = [];
for (const path of pages) {
  timed(path);
  const samples = Array.from({ length: runs }, () => timed(path));
  const api = path.startsWith("/api/");
  results.push({
    path: label(path),
    status: samples[0].status,
    ttfb: median(samples.map((s) => s.ttfb)),
    total: median(samples.map((s) => s.total)),
    bytes: samples[0].bytes,
    gzip: timed(path, ["Accept-Encoding: gzip"]).bytes,
    rsc: api ? null : timed(path, ["RSC: 1"]).bytes,
  });
}
rmSync(dir, { recursive: true, force: true });

const load = loadavg().map((v) => v.toFixed(2)).join(" ");
console.log(`${base}; median of ${runs} runs after a warm-up; load average ${load}.\n`);
console.log("| Page | Status | TTFB (ms) | Total (ms) | HTML / JSON | gzipped | RSC payload |");
console.log("|---|--:|--:|--:|--:|--:|--:|");
for (const r of results) {
  console.log(`| \`${r.path}\` | ${r.status} | ${Math.round(r.ttfb)} | ${Math.round(r.total)} | ${kb(r.bytes)} | ${kb(r.gzip)} | ${r.rsc === null ? "" : kb(r.rsc)} |`);
}
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), runs, load, results }, null, 2));
