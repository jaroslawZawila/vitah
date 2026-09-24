"use server";

import { auth } from "../../auth";
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
import { revalidatePath } from "next/cache";
import { logActivity } from "../../lib/activity";

// --- Auth helpers ---

async function requireAuth() {
  const session = await auth();
  const user = session?.user;
  if (!user?.tenantId) {
    throw new Error("Unauthorized");
  }
  return { tenantId: user.tenantId, userId: user.id!, user };
}

// --- Projects ---

export async function getProjects() {
  const session = await auth();
  const user = session?.user;
  if (!user?.tenantId) return [];

  return db.query.projects.findMany({
    where: eq(projects.tenantId, user.tenantId),
    with: { advisor: { columns: { id: true, name: true } } },
    orderBy: [desc(projects.createdAt)],
  });
}

export async function getProject(id: string) {
  const session = await auth();
  const user = session?.user;
  if (!user?.tenantId) return null;

  return db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.tenantId, user.tenantId)),
    with: {
      advisor: { columns: { id: true, name: true } },
      client: { columns: { id: true, name: true, email: true } },
      milestones: { orderBy: [asc(projectMilestones.sortOrder)] },
      qualityChecks: { orderBy: [asc(projectQualityChecks.createdAt)] },
      tasks: { orderBy: [desc(projectTasks.createdAt)] },
      materialOrders: { orderBy: [desc(projectMaterialOrders.createdAt)] },
      invoices: { orderBy: [desc(projectInvoices.dueDate)] },
      documents: { orderBy: [asc(projectDocuments.category)] },
      activityLog: { orderBy: [desc(projectActivityLog.createdAt)] },
    },
  });
}

export type ProjectWithRelations = NonNullable<Awaited<ReturnType<typeof getProject>>>;

export async function createProject(
  _prevState: { error?: string; success?: boolean; id?: string } | null,
  formData: FormData,
) {
  const { tenantId, userId } = await requireAuth();

  const ref = formData.get("ref") as string;
  const clientName = formData.get("clientName") as string;
  const areaM2 = parseInt(formData.get("areaM2") as string, 10);
  const type = formData.get("type") as "unifamiliar" | "adosado" | "duplex";
  const location = formData.get("location") as string;
  const budgetTotal = Math.round(parseFloat(formData.get("budgetTotal") as string) * 100);
  const qualityLevel = (formData.get("qualityLevel") as string) || "standard";

  if (!ref || !clientName || !areaM2 || !type || !location) {
    return { error: "missing_fields" };
  }

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.tenantId, tenantId), eq(projects.ref, ref)),
  });
  if (existing) {
    return { error: "ref_exists" };
  }

  const [created] = await db
    .insert(projects)
    .values({
      tenantId,
      ref,
      clientName,
      areaM2,
      type,
      location,
      budgetTotal,
      qualityLevel,
    })
    .returning({ id: projects.id });

  if (created) {
    await logActivity(tenantId, created.id, userId, "project_created", `Proyecto ${ref} creado`);

    // Auto-create H1–H10 milestones
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
    await db.insert(projectMilestones).values(
      MILESTONES.map((m, i) => ({
        tenantId,
        projectId: created.id,
        code: m.code,
        name: m.name,
        sortOrder: i + 1,
      })),
    );
  }

  revalidatePath("/dashboard/projects");
  return { success: true, id: created?.id };
}

export async function updateProject(id: string, data: Record<string, unknown>) {
  const { tenantId, userId } = await requireAuth();

  const allowedFields: Record<string, string> = {
    clientName: "client_name",
    areaM2: "area_m2",
    type: "type",
    phase: "phase",
    progressPct: "progress_pct",
    budgetTotal: "budget_total",
    location: "location",
    qualityLevel: "quality_level",
    constructionWeekCurrent: "construction_week_current",
    constructionWeekTotal: "construction_week_total",
  };

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(data)) {
    if (key in allowedFields) {
      updateData[key] = value;
    }
  }

  // Handle date fields separately
  if (data.startDate) updateData.startDate = new Date(data.startDate as string);
  if (data.expectedDeliveryDate) updateData.expectedDeliveryDate = new Date(data.expectedDeliveryDate as string);

  await db
    .update(projects)
    .set(updateData)
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));

  await logActivity(tenantId, id, userId, "project_updated", "Proyecto actualizado");
  revalidatePath(`/dashboard/projects/${id}`);
  revalidatePath("/dashboard/projects");
}

export async function deleteProject(id: string) {
  const { tenantId } = await requireAuth();
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));
  revalidatePath("/dashboard/projects");
}

// --- Milestones ---

export async function updateMilestoneStatus(
  milestoneId: string,
  status: "pending" | "in_progress" | "completed",
) {
  const { tenantId, userId } = await requireAuth();

  const milestone = await db.query.projectMilestones.findFirst({
    where: and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.tenantId, tenantId)),
  });
  if (!milestone) throw new Error("Not found");

  await db
    .update(projectMilestones)
    .set({
      status,
      completionDate: status === "completed" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(projectMilestones.id, milestoneId));

  await logActivity(
    tenantId,
    milestone.projectId,
    userId,
    "milestone_updated",
    `Hito ${milestone.code} (${milestone.name}) → ${status}`,
  );
  revalidatePath(`/dashboard/projects/${milestone.projectId}`);
}

// --- Quality Checks ---

export async function createQualityCheck(
  projectId: string,
  data: { name: string; detail: string; milestoneId?: string },
) {
  const { tenantId, userId } = await requireAuth();
  await db.insert(projectQualityChecks).values({
    tenantId,
    projectId,
    name: data.name,
    detail: data.detail,
    milestoneId: data.milestoneId ?? null,
  });
  await logActivity(tenantId, projectId, userId, "qc_created", `QC: ${data.name}`);
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function updateQualityCheck(
  id: string,
  data: { result?: "pending" | "pass" | "fail"; measuredValue?: string },
) {
  const { tenantId, userId } = await requireAuth();

  const qc = await db.query.projectQualityChecks.findFirst({
    where: and(eq(projectQualityChecks.id, id), eq(projectQualityChecks.tenantId, tenantId)),
  });
  if (!qc) throw new Error("Not found");

  await db
    .update(projectQualityChecks)
    .set({
      ...data,
      checkedAt: data.result && data.result !== "pending" ? new Date() : qc.checkedAt,
      updatedAt: new Date(),
    })
    .where(eq(projectQualityChecks.id, id));

  await logActivity(
    tenantId,
    qc.projectId,
    userId,
    data.result === "pass" ? "qc_passed" : data.result === "fail" ? "qc_failed" : "qc_updated",
    `QC: ${qc.name} → ${data.result ?? "updated"}`,
  );
  revalidatePath(`/dashboard/projects/${qc.projectId}`);
}

export async function deleteQualityCheck(id: string) {
  const { tenantId } = await requireAuth();
  const qc = await db.query.projectQualityChecks.findFirst({
    where: and(eq(projectQualityChecks.id, id), eq(projectQualityChecks.tenantId, tenantId)),
  });
  if (!qc) throw new Error("Not found");

  await db.delete(projectQualityChecks).where(eq(projectQualityChecks.id, id));
  revalidatePath(`/dashboard/projects/${qc.projectId}`);
}

// --- Tasks ---

export async function createTask(
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
  const { tenantId, userId } = await requireAuth();
  await db.insert(projectTasks).values({
    tenantId,
    projectId,
    title: data.title,
    description: data.description ?? null,
    department: data.department,
    priority: data.priority ?? "medium",
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    assigneeId: data.assigneeId ?? null,
  });
  await logActivity(tenantId, projectId, userId, "task_created", `Tarea: ${data.title}`);
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function updateTask(
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
  const { tenantId, userId } = await requireAuth();
  const task = await db.query.projectTasks.findFirst({
    where: and(eq(projectTasks.id, id), eq(projectTasks.tenantId, tenantId)),
  });
  if (!task) throw new Error("Not found");

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.department !== undefined) updateData.department = data.department;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;

  await db.update(projectTasks).set(updateData).where(eq(projectTasks.id, id));
  await logActivity(tenantId, task.projectId, userId, "task_updated", `Tarea: ${task.title}`);
  revalidatePath(`/dashboard/projects/${task.projectId}`);
}

export async function deleteTask(id: string) {
  const { tenantId } = await requireAuth();
  const task = await db.query.projectTasks.findFirst({
    where: and(eq(projectTasks.id, id), eq(projectTasks.tenantId, tenantId)),
  });
  if (!task) throw new Error("Not found");

  await db.delete(projectTasks).where(eq(projectTasks.id, id));
  await logActivity(tenantId, task.projectId, "", "task_deleted", `Tarea eliminada: ${task.title}`);
  revalidatePath(`/dashboard/projects/${task.projectId}`);
}

// --- Material Orders ---

export async function createOrder(
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
  const { tenantId, userId } = await requireAuth();
  await db.insert(projectMaterialOrders).values({
    tenantId,
    projectId,
    materialDescription: data.materialDescription,
    supplier: data.supplier,
    quantity: data.quantity ?? null,
    orderDate: data.orderDate ? new Date(data.orderDate) : null,
    eta: data.eta ? new Date(data.eta) : null,
    jitWeek: data.jitWeek ?? null,
  });
  await logActivity(tenantId, projectId, userId, "order_created", `Pedido: ${data.materialDescription}`);
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function updateOrder(
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
  const { tenantId, userId } = await requireAuth();
  const order = await db.query.projectMaterialOrders.findFirst({
    where: and(eq(projectMaterialOrders.id, id), eq(projectMaterialOrders.tenantId, tenantId)),
  });
  if (!order) throw new Error("Not found");

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.materialDescription !== undefined) updateData.materialDescription = data.materialDescription;
  if (data.supplier !== undefined) updateData.supplier = data.supplier;
  if (data.quantity !== undefined) updateData.quantity = data.quantity;
  if (data.orderDate !== undefined) updateData.orderDate = data.orderDate ? new Date(data.orderDate) : null;
  if (data.eta !== undefined) updateData.eta = data.eta ? new Date(data.eta) : null;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.jitWeek !== undefined) updateData.jitWeek = data.jitWeek;

  await db.update(projectMaterialOrders).set(updateData).where(eq(projectMaterialOrders.id, id));
  await logActivity(tenantId, order.projectId, userId, "order_updated", `Pedido actualizado: ${order.materialDescription}`);
  revalidatePath(`/dashboard/projects/${order.projectId}`);
}

export async function deleteOrder(id: string) {
  const { tenantId } = await requireAuth();
  const order = await db.query.projectMaterialOrders.findFirst({
    where: and(eq(projectMaterialOrders.id, id), eq(projectMaterialOrders.tenantId, tenantId)),
  });
  if (!order) throw new Error("Not found");

  await db.delete(projectMaterialOrders).where(eq(projectMaterialOrders.id, id));
  revalidatePath(`/dashboard/projects/${order.projectId}`);
}

// --- Invoices ---

export async function createInvoice(
  projectId: string,
  data: {
    amount: number;
    description?: string;
    dueDate: string;
  },
) {
  const { tenantId, userId } = await requireAuth();
  await db.insert(projectInvoices).values({
    tenantId,
    projectId,
    amount: Math.round(data.amount * 100),
    description: data.description ?? null,
    dueDate: new Date(data.dueDate),
  });
  await logActivity(tenantId, projectId, userId, "invoice_created", `Factura: ${data.description ?? "sin descripción"}`);
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function updateInvoice(
  id: string,
  data: {
    amount?: number;
    description?: string;
    dueDate?: string;
    status?: "draft" | "issued" | "due_soon" | "paid" | "overdue";
  },
) {
  const { tenantId, userId } = await requireAuth();
  const invoice = await db.query.projectInvoices.findFirst({
    where: and(eq(projectInvoices.id, id), eq(projectInvoices.tenantId, tenantId)),
  });
  if (!invoice) throw new Error("Not found");

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
    tenantId,
    invoice.projectId,
    userId,
    data.status === "paid" ? "invoice_paid" : "invoice_updated",
    `Factura ${data.status === "paid" ? "pagada" : "actualizada"}`,
  );
  revalidatePath(`/dashboard/projects/${invoice.projectId}`);
}

export async function deleteInvoice(id: string) {
  const { tenantId } = await requireAuth();
  const invoice = await db.query.projectInvoices.findFirst({
    where: and(eq(projectInvoices.id, id), eq(projectInvoices.tenantId, tenantId)),
  });
  if (!invoice) throw new Error("Not found");

  await db.delete(projectInvoices).where(eq(projectInvoices.id, id));
  revalidatePath(`/dashboard/projects/${invoice.projectId}`);
}

// --- Documents ---

export async function createDocument(
  projectId: string,
  data: {
    category: string;
    fileName: string;
    fileUrl: string;
    fileSizeBytes?: number;
  },
) {
  const { tenantId, userId } = await requireAuth();
  await db.insert(projectDocuments).values({
    tenantId,
    projectId,
    category: data.category as typeof projectDocuments.$inferInsert.category,
    fileName: data.fileName,
    fileUrl: data.fileUrl,
    fileSizeBytes: data.fileSizeBytes ?? null,
    uploadedById: userId,
  });
  await logActivity(tenantId, projectId, userId, "document_uploaded", `Documento: ${data.fileName}`);
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function deleteDocument(id: string) {
  const { tenantId } = await requireAuth();
  const doc = await db.query.projectDocuments.findFirst({
    where: and(eq(projectDocuments.id, id), eq(projectDocuments.tenantId, tenantId)),
  });
  if (!doc) throw new Error("Not found");

  await db.delete(projectDocuments).where(eq(projectDocuments.id, id));
  revalidatePath(`/dashboard/projects/${doc.projectId}`);
}
