// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { relations } from "drizzle-orm";
import { projectDocuments, projectPhotos } from "./project-files";
import { projects } from "./projects";
import { tenants } from "./tenants";
import { clientProfiles, users } from "./users";

// --- Relations ---

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  clientProfile: one(clientProfiles),
}));

export const clientProfilesRelations = relations(clientProfiles, ({ one }) => ({
  user: one(users, {
    fields: [clientProfiles.userId],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [projects.tenantId],
    references: [tenants.id],
  }),
  client: one(users, {
    fields: [projects.clientUserId],
    references: [users.id],
  }),
  documents: many(projectDocuments),
  photos: many(projectPhotos),
}));

export const projectDocumentsRelations = relations(projectDocuments, ({ one }) => ({
  project: one(projects, {
    fields: [projectDocuments.projectId],
    references: [projects.id],
  }),
}));

export const projectPhotosRelations = relations(projectPhotos, ({ one }) => ({
  project: one(projects, {
    fields: [projectPhotos.projectId],
    references: [projects.id],
  }),
}));
