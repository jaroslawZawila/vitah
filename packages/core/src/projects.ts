import {
  db,
  projects,
  projectMilestones,
  projectQualityChecks,
  projectTasks,
  projectMaterialOrders,
  projectInvoices,
  projectDocuments,
  projectActivityLog,
  eq,
  and,
  desc,
  asc,
} from "@repo/db";
import type { Ctx } from "./context";
import { invalid, notFound } from "./errors";

// Every function here takes `ctx` and filters by `ctx.tenantId`.
// Mutations return the affected projectId so callers can revalidate caches.

type ProjectType = typeof projects.$inferInsert.type;
type ProjectPhase = NonNullable<typeof projects.$inferInsert.phase>;

const PROJECT_TYPES: readonly ProjectType[] = ["unifamiliar", "adosado", "duplex"];
const PROJECT_PHASES: readonly ProjectPhase[] = [
  "showroom",
  "budget",
  "technical",
  "review",
  "dossier",
  "logistics",
  "construction",
  "certified",
];

const MILESTONES = [
  { code: "H1", name: "Cimentación" },
  { code: "H2", name: "Estructura metálica" },
  { code: "H3", name: "Sellado cubierta" },
  { code: "H4", name: "Bio-Skin" },
  { code: "H5", name: "Carpintería exterior" },
  { code: "H6", name: "Pre-instalaciones MEP" },
  { code: "H7", name: "Tabiquería" },
  { code: "H8", name: "Acabados interiores" },
  { code: "H9", name: "Instalaciones finales" },
  { code: "H10", name: "Entrega" },
];

// --- Helpers ---

async function logActivity(
  ctx: Ctx,
  projectId: string,
  action: string,
  detail: string,
) {
  await db.insert(projectActivityLog).values({
    tenantId: ctx.tenantId,
    projectId,
    userId: ctx.userId,
    action,
    detail,
  });
}

/** Throws not_found unless the project exists in the caller's tenant. */
async function assertProject(ctx: Ctx, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.tenantId, ctx.tenantId)),
    columns: { id: true },
  });
  if (!project) throw notFound();
}

// Input parsing: API bodies and form values arrive as unknown / strings.

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function date(value: unknown): Date | undefined {
  const s = str(value);
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw invalid("invalid_date");
  return d;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

// --- Projects ---

export async function listProjects(ctx: Ctx) {
  return db.query.projects.findMany({
    where: eq(projects.tenantId, ctx.tenantId),
    with: { advisor: { columns: { id: true, name: true } } },
    orderBy: [desc(projects.createdAt)],
  });
}

export async function getProject(ctx: Ctx, id: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)),
    with: {
      advisor: { columns: { id: true, name: true } },
      milestones: { orderBy: [asc(projectMilestones.sortOrder)] },
      qualityChecks: { orderBy: [asc(projectQualityChecks.createdAt)] },
      tasks: { orderBy: [desc(projectTasks.createdAt)] },
      materialOrders: { orderBy: [desc(projectMaterialOrders.createdAt)] },
      invoices: { orderBy: [desc(projectInvoices.dueDate)] },
      documents: { orderBy: [asc(projectDocuments.category)] },
      activityLog: { orderBy: [desc(projectActivityLog.createdAt)] },
    },
  });
  return project ?? null;
}

export type ProjectListItem = Awaited<ReturnType<typeof listProjects>>[number];
export type ProjectWithRelations = NonNullable<Awaited<ReturnType<typeof getProject>>>;

/**
 * Body: { ref, clientName, areaM2, type, location, budgetTotal?, qualityLevel? }
 * `budgetTotal` is in euros; stored in cents.
 */
export async function createProject(ctx: Ctx, input: Record<string, unknown>) {
  const ref = str(input.ref);
  const clientName = str(input.clientName);
  const areaM2 = num(input.areaM2);
  const type = oneOf(input.type, PROJECT_TYPES);
  const location = str(input.location);
  const budgetTotal = Math.round((num(input.budgetTotal) ?? 0) * 100);
  const qualityLevel = str(input.qualityLevel) ?? "standard";

  if (!ref || !clientName || !areaM2 || !type || !location) {
    throw invalid("missing_fields");
  }

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.tenantId, ctx.tenantId), eq(projects.ref, ref)),
    columns: { id: true },
  });
  if (existing) throw invalid("ref_exists");

  const [created] = await db
    .insert(projects)
    .values({
      tenantId: ctx.tenantId,
      ref,
      clientName,
      areaM2: Math.round(areaM2),
      type,
      location,
      budgetTotal,
      qualityLevel,
    })
    .returning({ id: projects.id });

  if (!created) throw new Error("Project insert returned no row");

  await logActivity(ctx, created.id, "project_created", `Proyecto ${ref} creado`);

  // Auto-create H1–H10 milestones
  await db.insert(projectMilestones).values(
    MILESTONES.map((m, i) => ({
      tenantId: ctx.tenantId,
      projectId: created.id,
      code: m.code,
      name: m.name,
      sortOrder: i + 1,
    })),
  );

  return { id: created.id };
}

/**
 * Partial update. Unknown keys are ignored; `budgetTotal` is in cents
 * (same unit as returned by getProject).
 */
export async function updateProject(ctx: Ctx, id: string, input: Record<string, unknown>) {
  const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };

  const clientName = str(input.clientName);
  if (clientName) set.clientName = clientName;
  const location = str(input.location);
  if (location) set.location = location;
  const qualityLevel = str(input.qualityLevel);
  if (qualityLevel) set.qualityLevel = qualityLevel;
  const type = oneOf(input.type, PROJECT_TYPES);
  if (type) set.type = type;
  const phase = oneOf(input.phase, PROJECT_PHASES);
  if (phase) set.phase = phase;

  const ints = [
    "areaM2",
    "progressPct",
    "budgetTotal",
    "constructionWeekCurrent",
    "constructionWeekTotal",
  ] as const;
  for (const key of ints) {
    const n = num(input[key]);
    if (n !== undefined) set[key] = Math.round(n);
  }

  const startDate = date(input.startDate);
  if (startDate) set.startDate = startDate;
  const expectedDeliveryDate = date(input.expectedDeliveryDate);
  if (expectedDeliveryDate) set.expectedDeliveryDate = expectedDeliveryDate;

  const updated = await db
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)))
    .returning({ id: projects.id });
  if (updated.length === 0) throw notFound();

  await logActivity(ctx, id, "project_updated", "Proyecto actualizado");
  return { projectId: id };
}

export async function deleteProject(ctx: Ctx, id: string) {
  const deleted = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)))
    .returning({ id: projects.id });
  if (deleted.length === 0) throw notFound();
  return { projectId: id };
}

// --- Milestones ---

export async function updateMilestoneStatus(
  ctx: Ctx,
  milestoneId: string,
  status: "pending" | "in_progress" | "completed",
) {
  const milestone = await db.query.projectMilestones.findFirst({
    where: and(
      eq(projectMilestones.id, milestoneId),
      eq(projectMilestones.tenantId, ctx.tenantId),
    ),
  });
  if (!milestone) throw notFound();

  await db
    .update(projectMilestones)
    .set({
      status,
      completionDate: status === "completed" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(projectMilestones.id, milestoneId));

  await logActivity(
    ctx,
    milestone.projectId,
    "milestone_updated",
    `Hito ${milestone.code} (${milestone.name}) → ${status}`,
  );
  return { projectId: milestone.projectId };
}

// --- Quality Checks ---

export async function createQualityCheck(
  ctx: Ctx,
  projectId: string,
  data: { name: string; detail: string; milestoneId?: string },
) {
  await assertProject(ctx, projectId);
  await db.insert(projectQualityChecks).values({
    tenantId: ctx.tenantId,
    projectId,
    name: data.name,
    detail: data.detail,
    milestoneId: data.milestoneId ?? null,
  });
  await logActivity(ctx, projectId, "qc_created", `QC: ${data.name}`);
  return { projectId };
}

export async function updateQualityCheck(
  ctx: Ctx,
  id: string,
  data: { result?: "pending" | "pass" | "fail"; measuredValue?: string },
) {
  const qc = await db.query.projectQualityChecks.findFirst({
    where: and(eq(projectQualityChecks.id, id), eq(projectQualityChecks.tenantId, ctx.tenantId)),
  });
  if (!qc) throw notFound();

  await db
    .update(projectQualityChecks)
    .set({
      ...data,
      checkedAt: data.result && data.result !== "pending" ? new Date() : qc.checkedAt,
      updatedAt: new Date(),
    })
    .where(eq(projectQualityChecks.id, id));

  await logActivity(
    ctx,
    qc.projectId,
    data.result === "pass" ? "qc_passed" : data.result === "fail" ? "qc_failed" : "qc_updated",
    `QC: ${qc.name} → ${data.result ?? "updated"}`,
  );
  return { projectId: qc.projectId };
}

export async function deleteQualityCheck(ctx: Ctx, id: string) {
  const qc = await db.query.projectQualityChecks.findFirst({
    where: and(eq(projectQualityChecks.id, id), eq(projectQualityChecks.tenantId, ctx.tenantId)),
  });
  if (!qc) throw notFound();

  await db.delete(projectQualityChecks).where(eq(projectQualityChecks.id, id));
  return { projectId: qc.projectId };
}

// --- Tasks ---

export async function createTask(
  ctx: Ctx,
  projectId: string,
  data: {
    title: string;
    description?: string;
    department: string;
    priority?: "low" | "medium" | "high";
    dueDate?: string;
    assigneeId?: string;
  },
) {
  await assertProject(ctx, projectId);
  await db.insert(projectTasks).values({
    tenantId: ctx.tenantId,
    projectId,
    title: data.title,
    description: data.description ?? null,
    department: data.department,
    priority: data.priority ?? "medium",
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    assigneeId: data.assigneeId ?? null,
  });
  await logActivity(ctx, projectId, "task_created", `Tarea: ${data.title}`);
  return { projectId };
}

export async function updateTask(
  ctx: Ctx,
  id: string,
  data: {
    title?: string;
    description?: string;
    department?: string;
    priority?: "low" | "medium" | "high";
    status?: "pending" | "in_process" | "in_review" | "completed";
    dueDate?: string;
    assigneeId?: string | null;
  },
) {
  const task = await db.query.projectTasks.findFirst({
    where: and(eq(projectTasks.id, id), eq(projectTasks.tenantId, ctx.tenantId)),
  });
  if (!task) throw notFound();

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.department !== undefined) updateData.department = data.department;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;

  await db.update(projectTasks).set(updateData).where(eq(projectTasks.id, id));
  await logActivity(ctx, task.projectId, "task_updated", `Tarea: ${task.title}`);
  return { projectId: task.projectId };
}

export async function deleteTask(ctx: Ctx, id: string) {
  const task = await db.query.projectTasks.findFirst({
    where: and(eq(projectTasks.id, id), eq(projectTasks.tenantId, ctx.tenantId)),
  });
  if (!task) throw notFound();

  await db.delete(projectTasks).where(eq(projectTasks.id, id));
  await logActivity(ctx, task.projectId, "task_deleted", `Tarea eliminada: ${task.title}`);
  return { projectId: task.projectId };
}

// --- Material Orders ---

export async function createOrder(
  ctx: Ctx,
  projectId: string,
  data: {
    materialDescription: string;
    supplier: string;
    quantity?: string;
    orderDate?: string;
    eta?: string;
    jitWeek?: string;
  },
) {
  await assertProject(ctx, projectId);
  await db.insert(projectMaterialOrders).values({
    tenantId: ctx.tenantId,
    projectId,
    materialDescription: data.materialDescription,
    supplier: data.supplier,
    quantity: data.quantity ?? null,
    orderDate: data.orderDate ? new Date(data.orderDate) : null,
    eta: data.eta ? new Date(data.eta) : null,
    jitWeek: data.jitWeek ?? null,
  });
  await logActivity(ctx, projectId, "order_created", `Pedido: ${data.materialDescription}`);
  return { projectId };
}

export async function updateOrder(
  ctx: Ctx,
  id: string,
  data: {
    materialDescription?: string;
    supplier?: string;
    quantity?: string;
    orderDate?: string;
    eta?: string;
    status?: "pending" | "ordered" | "confirmed" | "in_transit" | "delivered";
    jitWeek?: string;
  },
) {
  const order = await db.query.projectMaterialOrders.findFirst({
    where: and(eq(projectMaterialOrders.id, id), eq(projectMaterialOrders.tenantId, ctx.tenantId)),
  });
  if (!order) throw notFound();

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.materialDescription !== undefined) updateData.materialDescription = data.materialDescription;
  if (data.supplier !== undefined) updateData.supplier = data.supplier;
  if (data.quantity !== undefined) updateData.quantity = data.quantity;
  if (data.orderDate !== undefined) updateData.orderDate = data.orderDate ? new Date(data.orderDate) : null;
  if (data.eta !== undefined) updateData.eta = data.eta ? new Date(data.eta) : null;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.jitWeek !== undefined) updateData.jitWeek = data.jitWeek;

  await db.update(projectMaterialOrders).set(updateData).where(eq(projectMaterialOrders.id, id));
  await logActivity(ctx, order.projectId, "order_updated", `Pedido actualizado: ${order.materialDescription}`);
  return { projectId: order.projectId };
}

export async function deleteOrder(ctx: Ctx, id: string) {
  const order = await db.query.projectMaterialOrders.findFirst({
    where: and(eq(projectMaterialOrders.id, id), eq(projectMaterialOrders.tenantId, ctx.tenantId)),
  });
  if (!order) throw notFound();

  await db.delete(projectMaterialOrders).where(eq(projectMaterialOrders.id, id));
  return { projectId: order.projectId };
}

// --- Invoices ---

export async function createInvoice(
  ctx: Ctx,
  projectId: string,
  data: {
    amount: number;
    description?: string;
    dueDate: string;
  },
) {
  await assertProject(ctx, projectId);
  await db.insert(projectInvoices).values({
    tenantId: ctx.tenantId,
    projectId,
    amount: Math.round(data.amount * 100),
    description: data.description ?? null,
    dueDate: new Date(data.dueDate),
  });
  await logActivity(ctx, projectId, "invoice_created", `Factura: ${data.description ?? "sin descripción"}`);
  return { projectId };
}

export async function updateInvoice(
  ctx: Ctx,
  id: string,
  data: {
    amount?: number;
    description?: string;
    dueDate?: string;
    status?: "draft" | "issued" | "due_soon" | "paid" | "overdue";
  },
) {
  const invoice = await db.query.projectInvoices.findFirst({
    where: and(eq(projectInvoices.id, id), eq(projectInvoices.tenantId, ctx.tenantId)),
  });
  if (!invoice) throw notFound();

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.amount !== undefined) updateData.amount = Math.round(data.amount * 100);
  if (data.description !== undefined) updateData.description = data.description;
  if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate);
  if (data.status !== undefined) {
    updateData.status = data.status;
    if (data.status === "paid") updateData.paidAt = new Date();
  }

  await db.update(projectInvoices).set(updateData).where(eq(projectInvoices.id, id));
  await logActivity(
    ctx,
    invoice.projectId,
    data.status === "paid" ? "invoice_paid" : "invoice_updated",
    `Factura ${data.status === "paid" ? "pagada" : "actualizada"}`,
  );
  return { projectId: invoice.projectId };
}

export async function deleteInvoice(ctx: Ctx, id: string) {
  const invoice = await db.query.projectInvoices.findFirst({
    where: and(eq(projectInvoices.id, id), eq(projectInvoices.tenantId, ctx.tenantId)),
  });
  if (!invoice) throw notFound();

  await db.delete(projectInvoices).where(eq(projectInvoices.id, id));
  return { projectId: invoice.projectId };
}

// --- Documents ---

export async function createDocument(
  ctx: Ctx,
  projectId: string,
  data: {
    category: string;
    fileName: string;
    fileUrl: string;
    fileSizeBytes?: number;
  },
) {
  await assertProject(ctx, projectId);
  await db.insert(projectDocuments).values({
    tenantId: ctx.tenantId,
    projectId,
    category: data.category as typeof projectDocuments.$inferInsert.category,
    fileName: data.fileName,
    fileUrl: data.fileUrl,
    fileSizeBytes: data.fileSizeBytes ?? null,
    uploadedById: ctx.userId,
  });
  await logActivity(ctx, projectId, "document_uploaded", `Documento: ${data.fileName}`);
  return { projectId };
}

export async function deleteDocument(ctx: Ctx, id: string) {
  const doc = await db.query.projectDocuments.findFirst({
    where: and(eq(projectDocuments.id, id), eq(projectDocuments.tenantId, ctx.tenantId)),
  });
  if (!doc) throw notFound();

  await db.delete(projectDocuments).where(eq(projectDocuments.id, id));
  return { projectId: doc.projectId };
}
