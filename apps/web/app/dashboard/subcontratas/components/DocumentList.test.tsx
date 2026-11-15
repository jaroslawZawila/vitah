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
});
