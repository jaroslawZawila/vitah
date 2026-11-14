// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectOption, SubcontractorDetail, SubcontractorDoc } from "@repo/core/contract";
import en from "../../../../../messages/en.json";
import es from "../../../../../messages/es.json";
import CompanyScreen from "./CompanyScreen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/dashboard/subcontratas/empresas/c-1",
}));
vi.mock("../../../../actions/subcontractors", () => ({
  assignSubcontractorAction: vi.fn(),
  markNotApplicableAction: vi.fn(),
  rejectSubcontractorDocumentAction: vi.fn(),
  removeSubcontractorAssignmentAction: vi.fn(),
  requestSubcontractorDocumentsAction: vi.fn(),
  uploadSubcontractorDocumentAction: vi.fn(),
  validateSubcontractorDocumentAction: vi.fn(),
}));
const actions = await import("../../../../actions/subcontractors");

const pssAdhesion: SubcontractorDoc = {
  id: "d-1",
  requirementId: "adhesion_pss",
  workerId: null,
  projectId: "p-1",
  status: "validated",
  state: "validated",
  daysLeft: null,
  issuedAt: "2026-09-20",
  expiresAt: null,
  notApplicableReason: null,
  requestedAt: null,
  current: null,
  versions: [],
};

const projects: ProjectOption[] = [
  { id: "p-1", ref: "VTH-26-001", address: "Caviedes", obraStage: 6, chapters: [{ code: "13", name: "Electricidad e iluminación" }] },
];

const company: SubcontractorDetail = {
  id: "c-1",
  kind: "company",
  suppliesOnly: false,
  legalName: "Electricidad Saja S.L.",
  taxId: "B39123450",
  address: "C/ Ramón y Cajal 14",
  postalCode: "39300",
  city: "Torrelavega",
  province: "Cantabria",
  reaRegion: "cantabria",
  reaNumber: "39-0004217",
  phone: null,
  email: null,
  legalRep: null,
  siteContact: null,
  siteContactPhone: null,
  trades: ["electrical"],
  isInstaller: false,
  installerReg: null,
  headcount: 12,
  permanentCount: 6,
  subcontractsFurther: false,
  chainLevel: 1,
  preventionMode: "external_service",
  preventionEntity: null,
  preventionValidUntil: null,
  machinery: [],
  status: { status: "apta", expired: [], pending: [] },
  lowPermanentShare: false,
  documents: [],
  assignments: [
    {
      projectId: "p-1",
      projectRef: "VTH-26-001",
      projectAddress: "Caviedes",
      chapterCodes: ["13"],
      plannedStart: "2026-10-05",
      plannedEnd: "2026-12-20",
      bookOrder: 7,
      bookDate: "2026-09-20",
      cssInformed: true,
      pssAdhesion,
      workers: { ok: 2, pending: 0, blocked: 0 },
    },
  ],
  workers: [],
  history: [],
  canManage: true,
};

function renderScreen(locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <CompanyScreen company={company} projects={projects} orders={[]} initialTab="obras" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.removeSubcontractorAssignmentAction).mockReset().mockResolvedValue({ success: true });
  vi.restoreAllMocks();
});

describe("CompanyScreen › removing the company from an obra", () => {
  it("says what happens before removing: it leaves the obra, its assignment is kept", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Quitar de la obra" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "¿Quitar a la empresa de VTH-26-001? Dejará de aparecer en esa obra; el registro de su asignación se conserva.",
    );
    expect(actions.removeSubcontractorAssignmentAction).toHaveBeenCalledWith("c-1", "p-1");
  });

  it("says the same in English, and removes nothing when declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderScreen("en");

    await userEvent.click(screen.getByRole("button", { name: "Remove from site" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Remove the company from VTH-26-001? It will no longer appear on that site; the record of its assignment is kept.",
    );
    expect(actions.removeSubcontractorAssignmentAction).not.toHaveBeenCalled();
  });
});
