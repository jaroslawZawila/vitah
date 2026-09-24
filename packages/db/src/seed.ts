import bcrypt from "bcryptjs";
const { hash } = bcrypt;
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

async function seed() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL environment variable is not set");
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  const tenantName = process.env.SEED_TENANT_NAME ?? "ViTAH Santander";
  const tenantSlug = tenantName.toLowerCase().replace(/\s+/g, "-");
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@vitah.es";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "vitah2026";
  const name = process.env.SEED_ADMIN_NAME ?? "ViTAH Admin";

  // Create or find tenant
  const [insertedTenant] = await db
    .insert(schema.tenants)
    .values({ name: tenantName, slug: tenantSlug })
    .onConflictDoNothing({ target: schema.tenants.slug })
    .returning({ id: schema.tenants.id });

  let tenantId: string;
  if (insertedTenant) {
    tenantId = insertedTenant.id;
    console.log(`Created tenant "${tenantName}"`);
  } else {
    // Tenant already exists — look it up
    const existing = await db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.slug, tenantSlug),
      columns: { id: true },
    });
    if (!existing) {
      console.error("Could not find existing tenant");
      await client.end();
      process.exit(1);
    }
    tenantId = existing.id;
    console.log(`Tenant "${tenantName}" already exists, continuing with project seed...`);
  }

  // Create or find admin user
  const passwordHash = await hash(password, 12);

  let [adminUser] = await db
    .insert(schema.users)
    .values({
      tenantId: tenantId,
      email,
      name,
      passwordHash,
      role: "admin",
      active: true,
    })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });

  if (!adminUser) {
    const existingUser = await db.query.users.findFirst({
      where: (u, { eq, and }) => and(eq(u.tenantId, tenantId), eq(u.email, email)),
      columns: { id: true },
    });
    adminUser = existingUser ?? undefined;
  }

  console.log(`Admin user: ${email}`);

  // --- Seed Projects ---

  const PROJECTS_DATA = [
    {
      ref: "VTH-26-001",
      clientName: "García Ruiz",
      areaM2: 140,
      type: "unifamiliar" as const,
      phase: "showroom" as const,
      progressPct: 12,
      budgetTotal: 28500000,
      location: "Santander",
      qualityLevel: "standard",
      startDate: new Date("2026-03-10"),
      expectedDeliveryDate: new Date("2027-01-15"),
    },
    {
      ref: "VTH-26-002",
      clientName: "Martínez López",
      areaM2: 98,
      type: "adosado" as const,
      phase: "technical" as const,
      progressPct: 38,
      budgetTotal: 19800000,
      location: "Camargo",
      qualityLevel: "premium",
      startDate: new Date("2026-02-01"),
      expectedDeliveryDate: new Date("2026-12-20"),
    },
    {
      ref: "VTH-26-003",
      clientName: "Torres Const.",
      areaM2: 175,
      type: "duplex" as const,
      phase: "construction" as const,
      progressPct: 62,
      budgetTotal: 34000000,
      location: "Torrelavega",
      qualityLevel: "luxury",
      constructionWeekCurrent: 10,
      constructionWeekTotal: 22,
      startDate: new Date("2026-01-06"),
      expectedDeliveryDate: new Date("2026-08-05"),
    },
    {
      ref: "VTH-25-047",
      clientName: "Rodríguez Blanco",
      areaM2: 120,
      type: "unifamiliar" as const,
      phase: "certified" as const,
      progressPct: 100,
      budgetTotal: 24500000,
      location: "Castro Urdiales",
      qualityLevel: "standard",
      startDate: new Date("2025-04-15"),
      expectedDeliveryDate: new Date("2025-12-20"),
    },
    {
      ref: "VTH-26-004",
      clientName: "Fernández Díaz",
      areaM2: 160,
      type: "unifamiliar" as const,
      phase: "dossier" as const,
      progressPct: 52,
      budgetTotal: 31000000,
      location: "Santander",
      qualityLevel: "premium",
      startDate: new Date("2026-01-20"),
      expectedDeliveryDate: new Date("2026-11-30"),
    },
    {
      ref: "VTH-26-005",
      clientName: "Blanco Herrero",
      areaM2: 135,
      type: "unifamiliar" as const,
      phase: "budget" as const,
      progressPct: 25,
      budgetTotal: 26500000,
      location: "Santander",
      qualityLevel: "standard",
      startDate: new Date("2026-04-01"),
      expectedDeliveryDate: new Date("2027-03-15"),
    },
  ];

  const insertedProjects = await db
    .insert(schema.projects)
    .values(
      PROJECTS_DATA.map((p) => ({
        ...p,
        tenantId: tenantId,
        advisorId: adminUser?.id,
      })),
    )
    .returning({ id: schema.projects.id, ref: schema.projects.ref });

  console.log(`Seeded ${insertedProjects.length} projects`);

  // Build a map of ref → id for seeding related data
  const projectMap = new Map(insertedProjects.map((p) => [p.ref, p.id]));

  // --- Seed Milestones (H1–H10 for construction-phase project VTH-26-003) ---

  const MILESTONES = [
    { code: "H1", name: "Cimentación", sortOrder: 1 },
    { code: "H2", name: "Estructura metálica", sortOrder: 2 },
    { code: "H3", name: "Sellado cubierta", sortOrder: 3 },
    { code: "H4", name: "Bio-Skin", sortOrder: 4 },
    { code: "H5", name: "Carpintería exterior", sortOrder: 5 },
    { code: "H6", name: "Pre-instalaciones MEP", sortOrder: 6 },
    { code: "H7", name: "Tabiquería", sortOrder: 7 },
    { code: "H8", name: "Acabados interiores", sortOrder: 8 },
    { code: "H9", name: "Instalaciones finales", sortOrder: 9 },
    { code: "H10", name: "Entrega", sortOrder: 10 },
  ];

  const constructionProjectId = projectMap.get("VTH-26-003");
  if (constructionProjectId) {
    const milestoneValues = MILESTONES.map((m) => ({
      tenantId: tenantId,
      projectId: constructionProjectId,
      code: m.code,
      name: m.name,
      sortOrder: m.sortOrder,
      status:
        m.sortOrder <= 5
          ? ("completed" as const)
          : m.sortOrder === 6
            ? ("in_progress" as const)
            : ("pending" as const),
      completionDate: m.sortOrder <= 5 ? new Date(`2026-0${m.sortOrder}-15`) : null,
      photoCount: m.sortOrder <= 5 ? [6, 12, 8, 9, 11][m.sortOrder - 1]! : 0,
    }));

    const insertedMilestones = await db
      .insert(schema.projectMilestones)
      .values(milestoneValues)
      .returning({ id: schema.projectMilestones.id, code: schema.projectMilestones.code });

    console.log(`Seeded ${insertedMilestones.length} milestones for VTH-26-003`);

    // --- Seed Quality Checks for VTH-26-003 ---

    await db.insert(schema.projectQualityChecks).values([
      {
        tenantId: tenantId,
        projectId: constructionProjectId,
        name: "Tolerancia replanteo",
        detail: "Desviación máxima ±5mm",
        measuredValue: "±3mm",
        result: "pass" as const,
        checkedAt: new Date("2026-02-20"),
      },
      {
        tenantId: tenantId,
        projectId: constructionProjectId,
        name: "Aplomado estructura",
        detail: "Desviación máx. 0.2%",
        measuredValue: "0.12%",
        result: "pass" as const,
        checkedAt: new Date("2026-03-10"),
      },
      {
        tenantId: tenantId,
        projectId: constructionProjectId,
        name: "Blower Door test",
        detail: "Objetivo < 0.6 ACH@50Pa",
        measuredValue: null,
        result: "pending" as const,
      },
      {
        tenantId: tenantId,
        projectId: constructionProjectId,
        name: "Validación sellado Thermochip",
        detail: "Continuidad de la envolvente",
        measuredValue: "OK",
        result: "pass" as const,
        checkedAt: new Date("2026-04-05"),
      },
      {
        tenantId: tenantId,
        projectId: constructionProjectId,
        name: "Verificación pre-instalaciones MEP",
        detail: "Pasos y registros conforme a proyecto",
        measuredValue: null,
        result: "pending" as const,
      },
    ]);

    console.log("Seeded 5 quality checks for VTH-26-003");
  }

  // --- Seed Tasks across multiple projects ---

  const TASKS = [
    {
      projectRef: "VTH-26-002",
      title: "Cálculos estructurales",
      department: "structural",
      priority: "high" as const,
      status: "in_process" as const,
      dueDate: new Date("2026-06-01"),
    },
    {
      projectRef: "VTH-26-004",
      title: "Revisión de cliente",
      department: "architecture",
      priority: "high" as const,
      status: "pending" as const,
      dueDate: new Date("2026-05-28"),
    },
    {
      projectRef: "VTH-26-005",
      title: "Proyecto básico",
      department: "architecture",
      priority: "medium" as const,
      status: "pending" as const,
      dueDate: new Date("2026-06-15"),
    },
    {
      projectRef: "VTH-26-002",
      title: "Licencia de obra",
      department: "documentation",
      priority: "medium" as const,
      status: "in_review" as const,
      dueDate: new Date("2026-06-10"),
    },
    {
      projectRef: "VTH-26-003",
      title: "Documentación as-built",
      department: "documentation",
      priority: "low" as const,
      status: "in_process" as const,
      dueDate: new Date("2026-08-01"),
    },
    {
      projectRef: "VTH-26-001",
      title: "Diseño conceptual Digital Twin",
      department: "bim",
      priority: "medium" as const,
      status: "pending" as const,
      dueDate: new Date("2026-06-20"),
    },
    {
      projectRef: "VTH-26-003",
      title: "Verificación instalaciones MEP",
      department: "installations",
      priority: "high" as const,
      status: "in_process" as const,
      dueDate: new Date("2026-05-30"),
    },
  ];

  const taskValues = TASKS.map((t) => ({
    tenantId: tenantId,
    projectId: projectMap.get(t.projectRef)!,
    title: t.title,
    department: t.department,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate,
    assigneeId: adminUser?.id,
  }));

  await db.insert(schema.projectTasks).values(taskValues);
  console.log(`Seeded ${TASKS.length} tasks`);

  // --- Seed Material Orders ---

  const ORDERS = [
    {
      projectRef: "VTH-26-003",
      materialDescription: "Perfiles HEB 200 (estructura principal)",
      supplier: "ArcelorMittal",
      quantity: "12.5 Tn",
      orderDate: new Date("2026-02-15"),
      eta: new Date("2026-03-08"),
      status: "delivered" as const,
      jitWeek: "Sem 9",
    },
    {
      projectRef: "VTH-26-003",
      materialDescription: "Panel Thermochip TAH (cubierta)",
      supplier: "Thermochip SL",
      quantity: "280 m²",
      orderDate: new Date("2026-03-20"),
      eta: new Date("2026-04-10"),
      status: "delivered" as const,
      jitWeek: "Sem 11",
    },
    {
      projectRef: "VTH-26-003",
      materialDescription: "Carpintería aluminio RPT",
      supplier: "Technal",
      quantity: "18 unidades",
      orderDate: new Date("2026-04-01"),
      eta: new Date("2026-05-15"),
      status: "in_transit" as const,
      jitWeek: "Sem 14",
    },
    {
      projectRef: "VTH-26-003",
      materialDescription: "Conductos climatización VMC",
      supplier: "Zehnder Group",
      quantity: "1 lote",
      orderDate: new Date("2026-04-20"),
      eta: new Date("2026-06-10"),
      status: "confirmed" as const,
      jitWeek: "Sem 18",
    },
    {
      projectRef: "VTH-26-002",
      materialDescription: "Perfiles IPE 180 (estructura)",
      supplier: "ArcelorMittal",
      quantity: "8.2 Tn",
      orderDate: new Date("2026-05-10"),
      eta: new Date("2026-06-15"),
      status: "ordered" as const,
      jitWeek: "Sem 12",
    },
    {
      projectRef: "VTH-26-004",
      materialDescription: "Aislamiento SATE (fachada)",
      supplier: "STO Ibérica",
      quantity: "320 m²",
      status: "pending" as const,
      jitWeek: "Sem 16",
    },
  ];

  await db.insert(schema.projectMaterialOrders).values(
    ORDERS.map((o) => ({
      tenantId: tenantId,
      projectId: projectMap.get(o.projectRef)!,
      materialDescription: o.materialDescription,
      supplier: o.supplier,
      quantity: o.quantity,
      orderDate: o.orderDate ?? null,
      eta: o.eta ?? null,
      status: o.status,
      jitWeek: o.jitWeek,
    })),
  );
  console.log(`Seeded ${ORDERS.length} material orders`);

  // --- Seed Invoices ---

  const INVOICES = [
    {
      projectRef: "VTH-26-003",
      amount: 4250000,
      description: "Certificación H5 — Carpintería exterior",
      dueDate: new Date("2026-05-15"),
      status: "due_soon" as const,
    },
    {
      projectRef: "VTH-26-002",
      amount: 1800000,
      description: "Anticipo proyecto técnico",
      dueDate: new Date("2026-05-28"),
      status: "issued" as const,
    },
    {
      projectRef: "VTH-26-004",
      amount: 1750000,
      description: "Honorarios dossier + licencias",
      dueDate: new Date("2026-06-05"),
      status: "issued" as const,
    },
    {
      projectRef: "VTH-25-047",
      amount: 2450000,
      description: "Certificación final — entrega",
      dueDate: new Date("2025-12-15"),
      status: "paid" as const,
      paidAt: new Date("2025-12-10"),
    },
    {
      projectRef: "VTH-26-001",
      amount: 850000,
      description: "Anticipo configuración showroom",
      dueDate: new Date("2026-04-15"),
      status: "paid" as const,
      paidAt: new Date("2026-04-12"),
    },
  ];

  await db.insert(schema.projectInvoices).values(
    INVOICES.map((inv) => ({
      tenantId: tenantId,
      projectId: projectMap.get(inv.projectRef)!,
      amount: inv.amount,
      description: inv.description,
      dueDate: inv.dueDate,
      status: inv.status,
      paidAt: inv.paidAt ?? null,
    })),
  );
  console.log(`Seeded ${INVOICES.length} invoices`);

  // --- Seed Documents ---

  const DOCUMENTS = [
    { projectRef: "VTH-26-003", category: "basic_project" as const, fileName: "Proyecto_Basico_VTH-26-003.pdf", fileUrl: "/docs/VTH-26-003/pb.pdf", fileSizeBytes: 2400000 },
    { projectRef: "VTH-26-003", category: "construction_plans" as const, fileName: "Planos_Estructura.pdf", fileUrl: "/docs/VTH-26-003/struct.pdf", fileSizeBytes: 8900000 },
    { projectRef: "VTH-26-003", category: "construction_plans" as const, fileName: "Planos_Instalaciones.pdf", fileUrl: "/docs/VTH-26-003/mep.pdf", fileSizeBytes: 5200000 },
    { projectRef: "VTH-26-003", category: "licenses" as const, fileName: "Licencia_Obra.pdf", fileUrl: "/docs/VTH-26-003/lic.pdf", fileSizeBytes: 450000 },
    { projectRef: "VTH-26-003", category: "quality_control" as const, fileName: "Informe_QC_H1-H5.pdf", fileUrl: "/docs/VTH-26-003/qc.pdf", fileSizeBytes: 1200000 },
    { projectRef: "VTH-26-003", category: "certifications" as const, fileName: "EnerPHit_Prelim.pdf", fileUrl: "/docs/VTH-26-003/enerphit.pdf", fileSizeBytes: 680000 },
    { projectRef: "VTH-26-003", category: "warranties" as const, fileName: "Garantia_Estructura_50a.pdf", fileUrl: "/docs/VTH-26-003/warranty.pdf", fileSizeBytes: 320000 },
    { projectRef: "VTH-25-047", category: "certifications" as const, fileName: "Certificado_nZEB_A+.pdf", fileUrl: "/docs/VTH-25-047/nzeb.pdf", fileSizeBytes: 520000 },
    { projectRef: "VTH-25-047", category: "building_book" as const, fileName: "Libro_Edificio_Completo.pdf", fileUrl: "/docs/VTH-25-047/book.pdf", fileSizeBytes: 15600000 },
    { projectRef: "VTH-26-002", category: "basic_project" as const, fileName: "Proyecto_Basico_VTH-26-002.pdf", fileUrl: "/docs/VTH-26-002/pb.pdf", fileSizeBytes: 1800000 },
  ];

  await db.insert(schema.projectDocuments).values(
    DOCUMENTS.map((d) => ({
      tenantId: tenantId,
      projectId: projectMap.get(d.projectRef)!,
      category: d.category,
      fileName: d.fileName,
      fileUrl: d.fileUrl,
      fileSizeBytes: d.fileSizeBytes,
      uploadedById: adminUser?.id,
    })),
  );
  console.log(`Seeded ${DOCUMENTS.length} documents`);

  // --- Seed Activity Log ---

  const ACTIVITIES = [
    { projectRef: "VTH-26-003", action: "milestone_completed", detail: "Hito H5 (Carpintería exterior) completado", createdAt: new Date("2026-05-10") },
    { projectRef: "VTH-26-003", action: "qc_passed", detail: "Validación sellado Thermochip — OK", createdAt: new Date("2026-04-05") },
    { projectRef: "VTH-26-003", action: "order_delivered", detail: "Panel Thermochip TAH entregado", createdAt: new Date("2026-04-10") },
    { projectRef: "VTH-26-002", action: "task_created", detail: "Tarea: Cálculos estructurales asignada", createdAt: new Date("2026-05-01") },
    { projectRef: "VTH-26-004", action: "phase_changed", detail: "Fase cambiada a Dossier", createdAt: new Date("2026-04-28") },
    { projectRef: "VTH-26-001", action: "invoice_paid", detail: "Factura anticipo configuración — pagada", createdAt: new Date("2026-04-12") },
    { projectRef: "VTH-25-047", action: "project_certified", detail: "Proyecto certificado nZEB Clase A+", createdAt: new Date("2025-12-20") },
  ];

  await db.insert(schema.projectActivityLog).values(
    ACTIVITIES.map((a) => ({
      tenantId: tenantId,
      projectId: projectMap.get(a.projectRef)!,
      userId: adminUser?.id,
      action: a.action,
      detail: a.detail,
      createdAt: a.createdAt,
    })),
  );
  console.log(`Seeded ${ACTIVITIES.length} activity log entries`);

  // --- Seed a mobile app client for VTH-26-001 (same password as the admin) ---

  const clientEmail = "cliente@vitah.es";
  const [demoClient] = await db
    .insert(schema.users)
    .values({ tenantId, email: clientEmail, name: "Cliente Demo", passwordHash, role: "client" })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });

  if (demoClient) {
    await db
      .update(schema.projects)
      .set({ clientUserId: demoClient.id })
      .where(eq(schema.projects.id, projectMap.get("VTH-26-001")!));
    console.log(`Mobile app client: ${clientEmail} (project VTH-26-001)`);
  }

  console.log("Seed completed successfully!");
  await client.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
