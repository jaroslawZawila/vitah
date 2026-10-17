// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { EMPTY_COMPANY_DRAFT } from "../../components/fields/draft";
import { EMPTY_COMPANY_FLOW, documentsComplete, obraComplete, type CompanyFlowDraft } from "./draft";
import NewCompanyScreen from "./NewCompanyScreen";
import { COMPANY_STEPS } from "./steps";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../../actions/subcontractors", () => ({
  createSubcontractorAction: vi.fn(),
  uploadSubcontractorDocumentAction: vi.fn(),
}));
const actions = await import("../../../../actions/subcontractors");

const projects = [
  {
    id: "p-1",
    ref: "VTH-26-001",
    address: "Caviedes",
    obraStage: 6,
    chapters: [
      { code: "09", name: "Urbanización" },
      { code: "10", name: "Carpintería exterior e interior" },
    ],
  },
];

const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      <NewCompanyScreen options={{ projects }} />
    </NextIntlClientProvider>,
  );
}

const next = () => userEvent.click(screen.getByRole("button", { name: "Siguiente" }));

async function fillData() {
  await userEvent.type(screen.getByLabelText("Razón social"), "Carpintería Metálica Liébana S.L.");
  await userEvent.type(screen.getByLabelText("CIF"), "B39654322");
  await userEvent.type(screen.getByLabelText("Domicilio social"), "Polígono La Vega, nave 12");
  await userEvent.type(screen.getByLabelText("Código postal"), "39570");
  await userEvent.type(screen.getByLabelText("Municipio"), "Potes");
}

beforeEach(() => {
  vi.mocked(actions.createSubcontractorAction).mockReset().mockResolvedValue({ success: true, id: "c-1" });
  vi.mocked(actions.uploadSubcontractorDocumentAction).mockReset().mockResolvedValue({ success: true });
  router.push.mockReset();
});

describe("COMPANY_STEPS", () => {
  const flow = (patch: Partial<CompanyFlowDraft>): CompanyFlowDraft => ({ ...EMPTY_COMPANY_FLOW, ...patch });

  it("needs valid company details before moving on", () => {
    const data = COMPANY_STEPS[0]!;
    const filled = flow({
      legalName: "X S.L.",
      taxId: "B39654322",
      address: "C/ Mayor 1",
      postalCode: "39570",
      city: "Potes",
    });
    expect(data.isComplete(filled)).toBe(true);
    expect(data.isComplete({ ...filled, taxId: "B39654321" })).toBe(false);
    expect(data.isComplete({ ...filled, postalCode: "99999" })).toBe(false);
  });

  it("refuses what Ley 32/2006 doesn't allow", () => {
    const activity = COMPANY_STEPS[1]!;
    expect(activity.isComplete(flow({ kind: "self_employed", subcontractsFurther: true }))).toBe(false);
    expect(activity.isComplete(flow({ headcount: "3", permanentCount: "4" }))).toBe(false);
    expect(activity.isComplete(flow({ ...EMPTY_COMPANY_DRAFT, headcount: "12", permanentCount: "3" }))).toBe(true);
  });

  it("needs a date for files that expire and a reason for 'No aplica'", () => {
    const doc = { file: pdf("tgss.pdf"), issuedAt: "", expiresAt: "", notApplicable: false, reason: "" };
    expect(documentsComplete(flow({ documents: { cert_tgss: doc } }))).toBe(false);
    expect(documentsComplete(flow({ documents: { cert_tgss: { ...doc, issuedAt: "2026-10-15" } } }))).toBe(true);
    expect(documentsComplete(flow({ documents: { evaluacion_riesgos: doc } }))).toBe(true);
    expect(
      documentsComplete(flow({ documents: { doc_maquinaria: { ...doc, file: null, notApplicable: true } } })),
    ).toBe(false);
  });

  it("checks the obra's dates only when an obra is chosen", () => {
    const obra = { ...EMPTY_COMPANY_FLOW.obra, plannedStart: "2026-12-01", plannedEnd: "2026-11-01" };
    expect(obraComplete(flow({ obra }))).toBe(true);
    expect(obraComplete(flow({ obra: { ...obra, projectId: "p-1" } }))).toBe(false);
  });
});

describe("NewCompanyScreen", () => {
  it("registers the company with its obra and 'No aplica' in one call, then uploads each file on its own", async () => {
    renderScreen();
    await fillData();
    expect(screen.getByText("CIF/NIF válido · REA en Cantabria")).toBeInTheDocument();
    await next();
    await next();

    await userEvent.upload(screen.getByLabelText("Archivo de «Inscripción en el REA»"), pdf("rea.pdf"));
    await userEvent.type(screen.getByLabelText("Emitido", { selector: "#doc-rea_subcontrata-issued" }), "2025-03-14");
    await userEvent.upload(screen.getByLabelText("Archivo de «Evaluación de riesgos y planificación preventiva»"), pdf("er.pdf"));
    const notApplicable = screen.getAllByLabelText("No aplica a esta empresa")[1]!;
    await userEvent.click(notApplicable);
    await userEvent.type(screen.getByLabelText("Motivo"), "No hace instalaciones");
    expect(screen.getByText("Obligatorios · 2 de 7 elegidos")).toBeInTheDocument();
    await next();

    await userEvent.selectOptions(screen.getByLabelText("Obra"), "p-1");
    await userEvent.click(screen.getByRole("button", { name: /Carpintería exterior/ }));
    await userEvent.type(screen.getByLabelText("Nº de orden"), "8");
    await next();

    expect(screen.getByText("Paso 5 de 5 · Revisión")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Registrar empresa" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/subcontratas/empresas/c-1"));
    expect(actions.createSubcontractorAction).toHaveBeenCalledWith(
      expect.objectContaining({
        legalName: "Carpintería Metálica Liébana S.L.",
        taxId: "B39654322",
        province: "Cantabria",
        assignment: expect.objectContaining({ projectId: "p-1", chapterCodes: ["10"], bookOrder: "8" }),
        notApplicable: [{ requirementId: "habilitacion_instalador", reason: "No hace instalaciones" }],
      }),
    );
    expect(vi.mocked(actions.createSubcontractorAction).mock.calls[0]![0]).not.toHaveProperty("documents");
    const uploads = vi.mocked(actions.uploadSubcontractorDocumentAction).mock.calls;
    expect(uploads.map(([id, data]) => [id, data.get("requirementId"), (data.get("file") as File).name])).toEqual([
      ["c-1", "rea_subcontrata", "rea.pdf"],
      ["c-1", "evaluacion_riesgos", "er.pdf"],
    ]);
    expect(uploads[0]![1].get("issuedAt")).toBe("2025-03-14");
  });

  it("goes back to the step whose field the server refused", async () => {
    vi.mocked(actions.createSubcontractorAction).mockResolvedValue({ error: "tax_id_exists" });
    renderScreen();
    await fillData();
    await next();
    await next();
    await next();
    await next();

    await userEvent.click(screen.getByRole("button", { name: "Registrar empresa" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay una empresa con ese CIF/NIF.");
    expect(screen.getByLabelText("CIF")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("says which uploads failed and links to the ficha", async () => {
    vi.mocked(actions.uploadSubcontractorDocumentAction).mockResolvedValue({ error: "file_too_large" });
    renderScreen();
    await fillData();
    await next();
    await next();
    await userEvent.upload(screen.getByLabelText("Archivo de «Evaluación de riesgos y planificación preventiva»"), pdf("er.pdf"));
    await next();
    await next();

    await userEvent.click(screen.getByRole("button", { name: "Registrar empresa" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/La empresa se ha registrado, pero/);
    expect(alert).toHaveTextContent("Evaluación de riesgos y planificación preventiva");
    expect(screen.getAllByRole("link", { name: "Ir a la ficha" })[0]).toHaveAttribute("href", "/dashboard/subcontratas/empresas/c-1");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("registers a material supplier in two steps: no CAE documents, no obra", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("radio", { name: "Proveedor de material" }));
    expect(screen.getByText("Sin CAE")).toBeInTheDocument();
    await fillData();
    await next();
    await next();

    expect(screen.getByText("Paso 3 de 3 · Revisión")).toBeInTheDocument();
    expect(screen.getAllByText("Proveedor de material").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Registrar empresa" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/subcontratas/empresas/c-1"));
    const input = vi.mocked(actions.createSubcontractorAction).mock.calls[0]![0];
    expect(input).toMatchObject({ kind: "company", suppliesOnly: true, legalName: "Carpintería Metálica Liébana S.L." });
    // Core refuses a supplier with an obra or "No aplica" documents.
    expect(input).not.toHaveProperty("assignment");
    expect(input).not.toHaveProperty("notApplicable");
    expect(actions.uploadSubcontractorDocumentAction).not.toHaveBeenCalled();
  });
});
