// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { SubcontractorDoc } from "@repo/core/contract";
import messages from "../../../../messages/es.json";
import DocumentList from "./DocumentList";

const doc = (requirementId: SubcontractorDoc["requirementId"]): SubcontractorDoc => ({
  id: `d-${requirementId}`,
  requirementId,
  workerId: null,
  projectId: null,
  status: null,
  state: "missing",
  daysLeft: null,
  issuedAt: null,
  expiresAt: null,
  notApplicableReason: null,
  requestedAt: null,
  current: null,
  versions: [],
});

describe("DocumentList", () => {
  it("names each document and its legal basis, never its internal id", () => {
    const handler = vi.fn();
    const { container } = render(
      <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
        <DocumentList
          groups={[{ key: "mandatory", title: "Obligatorios", documents: [doc("rea_subcontrata"), doc("cert_aeat_contratistas")] }]}
          subcontractorId="c-1"
          kind="company"
          canManage
          onUpload={handler}
          onValidate={handler}
          onReject={handler}
          onNotApplicable={handler}
          onRequest={handler}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Certificado AEAT de contratistas")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/rea_subcontrata|cert_aeat_contratistas/);
  });

  it("names each figure in its cell for the phone's layout, where the table's headings are hidden", () => {
    const handler = vi.fn();
    const current = {
      id: "v-1",
      version: 2,
      filename: "rea.pdf",
      sizeBytes: 1000,
      issuedAt: "2026-01-10",
      expiresAt: "2029-01-10",
      uploadedBy: "Ana",
      uploadedAt: "2026-01-11T09:00:00.000Z",
      outcome: "validated" as const,
      reviewedBy: "Luis",
      reviewedAt: "2026-01-12T09:00:00.000Z",
      rejectReason: null,
    };
    render(
      <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
        <DocumentList
          groups={[
            {
              key: "mandatory",
              title: "Obligatorios",
              documents: [{ ...doc("rea_subcontrata"), state: "validated", issuedAt: "2026-01-10", expiresAt: "2029-01-10", current, versions: [current] }],
            },
          ]}
          subcontractorId="c-1"
          kind="company"
          canManage
          onUpload={handler}
          onValidate={handler}
          onReject={handler}
          onNotApplicable={handler}
          onRequest={handler}
        />
      </NextIntlClientProvider>,
    );
    const cells = screen.getAllByRole("cell");
    for (const [label, text] of [
      ["Emitido", "10 ene 2026"],
      ["Caduca", "10 ene 2029"],
      ["Versión", "v2"],
      ["Validado por", "Luis"],
    ]) {
      const cell = cells.find((c) => c.textContent?.startsWith(label!));
      expect(cell?.textContent).toContain(text);
    }
  });
});
