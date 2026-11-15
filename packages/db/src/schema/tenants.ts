// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { notNegative } from "./checks";

// --- Tenants ---

export const tenants = pgTable(
  "tenants",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    slug: text("slug").unique().notNull(),
    active: boolean("active").default(true).notNull(),
    // Monthly spend cap for AI calls, in US cents (Claude bills in USD); null = no limit.
    aiMonthlyLimitCents: integer("ai_monthly_limit_cents"),
    // The company's letterhead on budget PDFs: { name, tagline, address, phone }.
    letterhead: jsonb("letterhead"),
    // The office the client's app shows on Contacto (packages/core/src/contact.ts),
    // set by an admin on the portal's "Contacto para clientes"; null = not given.
    officeAddress: text("office_address"),
    officePhone: text("office_phone"),
    officeEmail: text("office_email"),
    // Opening hours as staff write them, e.g. "Lunes a viernes · 9:00 – 18:00".
    officeHours: text("office_hours"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    aiLimitCheck: notNegative("tenants_ai_monthly_limit_cents_check", table.aiMonthlyLimitCents),
  }),
);
