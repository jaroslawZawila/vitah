"use server";

// Thin portal adapters over @repo/core (packages/core/src/subcontractors.ts and
// subcontractor-workers.ts), behind the Subcontratas pages.

import {
  CoreError,
  subcontractorsService as svc,
  subcontractorWorkersService as workers,
  type AccessCheckInput,
  type AssignmentInput,
  type Ctx,
  type DocumentRequestInput,
  type SubcontractorChangesInput,
  type SubcontractorError,
  type SubcontractorInput,
  type WorkerChangesInput,
  type WorkerInput,
  type WorkerListQuery,
} from "@repo/core";
import { revalidatePath } from "next/cache";
import { requireSession } from "../../lib/access";
import { read as readWithAccess } from "./run";

export type SubcontractorState = { error?: SubcontractorError; success?: boolean; id?: string } | null;

/** A core read's data (`read` in ./run: a missing company or worker is the "No encontrado" page). */
async function read<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T | null> {
  return (await readWithAccess(fn))?.data ?? null;
}

/** Runs a core mutation; returns `{ error: code }` for expected failures. */
async function mutate(fn: (ctx: Ctx) => Promise<unknown>): Promise<SubcontractorState> {
  const ctx = await requireSession();
  const outcome = await attempt(() => fn(ctx));
  if (outcome.error) return { error: outcome.error };
  const result = outcome.result;
  // The rail's badges (dashboard layout) count companies, workers and expiries too.
  revalidatePath("/dashboard", "layout");
  const id = result && typeof result === "object" && "id" in result ? String(result.id) : undefined;
  return id ? { success: true, id } : { success: true };
}

export async function getSubcontractorsOverview() {
  return read((ctx) => svc.getOverview(ctx));
}

export async function getSubcontractorCounts() {
  return read((ctx) => svc.getCounts(ctx));
}

export async function getSubcontractor(subcontractorId: string) {
  return read((ctx) => svc.getSubcontractor(ctx, subcontractorId));
}

export async function getSubcontractorProjects() {
  return read((ctx) => svc.listProjectOptions(ctx));
}

export async function getSubcontractorList() {
  return read((ctx) => svc.listSubcontractors(ctx));
}

/** { id, legalName, kind } of every company: for pickers and filters. */
export async function getCompanyOptions() {
  return read((ctx) => svc.listCompanyOptions(ctx));
}

export async function getWorkers(projectId?: string | null) {
  return read((ctx) => workers.listWorkers(ctx, { projectId }));
}

/** One page of the workers, with the counts and KPIs of the whole list. */
export async function getWorkersPage(query: WorkerListQuery = {}) {
  return read((ctx) => workers.listWorkersPage(ctx, query));
}

export async function getWorker(workerId: string) {
  return read((ctx) => workers.getWorker(ctx, workerId));
}

export async function checkWorkerAccessAction(input: AccessCheckInput) {
  const ctx = await requireSession();
  return attempt(() => workers.checkAccess(ctx, input));
}

/** `{ result }`, or `{ error: code }` for an expected failure. */
async function attempt<T>(fn: () => Promise<T>): Promise<{ result: T; error?: never } | { error: SubcontractorError; result?: never }> {
  try {
    return { result: await fn() };
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as SubcontractorError };
    throw err;
  }
}

export async function createSubcontractorAction(input: SubcontractorInput) {
  return mutate((ctx) => svc.createSubcontractor(ctx, input));
}

export async function updateSubcontractorAction(subcontractorId: string, input: SubcontractorChangesInput) {
  return mutate((ctx) => svc.updateSubcontractor(ctx, subcontractorId, input));
}

/** Multipart: { requirementId, workerId?, projectId?, issuedAt?, expiresAt?, file }. */
export async function uploadSubcontractorDocumentAction(subcontractorId: string, formData: FormData) {
  return mutate((ctx) => svc.uploadDocument(ctx, subcontractorId, Object.fromEntries(formData)));
}

export async function validateSubcontractorDocumentAction(subcontractorId: string, documentId: string) {
  return mutate((ctx) => svc.validateDocument(ctx, subcontractorId, documentId));
}

export async function rejectSubcontractorDocumentAction(subcontractorId: string, documentId: string, reason: string) {
  return mutate((ctx) => svc.rejectDocument(ctx, subcontractorId, documentId, { reason }));
}

export async function markNotApplicableAction(subcontractorId: string, requirementId: string, reason: string) {
  return mutate((ctx) => svc.markNotApplicable(ctx, subcontractorId, { requirementId, reason }));
}

/** "Solicitar" / "Recordar": { requirementIds, workerId?, projectId? }. */
export async function requestSubcontractorDocumentsAction(subcontractorId: string, input: DocumentRequestInput) {
  return mutate((ctx) => svc.requestDocuments(ctx, subcontractorId, input));
}

export async function assignSubcontractorAction(
  subcontractorId: string,
  projectId: string,
  input: AssignmentInput,
) {
  return mutate((ctx) => svc.assignToProject(ctx, subcontractorId, projectId, input));
}

export async function removeSubcontractorAssignmentAction(subcontractorId: string, projectId: string) {
  return mutate((ctx) => svc.removeAssignment(ctx, subcontractorId, projectId));
}

export async function createWorkerAction(input: WorkerInput) {
  return mutate((ctx) => workers.createWorker(ctx, input));
}

export async function updateWorkerAction(workerId: string, input: WorkerChangesInput) {
  return mutate((ctx) => workers.updateWorker(ctx, workerId, input));
}
