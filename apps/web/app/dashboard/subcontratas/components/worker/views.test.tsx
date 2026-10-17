// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { workerAccess } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import AccessCard from "./AccessCard";
import WorkerForm from "./WorkerForm";
import { emptyWorkerDraft, type WorkerFormDraft } from "./draft";

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

const companies = [{ id: "c-1", legalName: "Cubiertas Besaya S.L.", kind: "company" as const, status: "apta" as const }];

function Form({ onSubmit, canManage = true }: { onSubmit: (draft: WorkerFormDraft) => void; canManage?: boolean }) {
  const [draft, setDraft] = useState(emptyWorkerDraft("c-1"));
  return (
    <WorkerForm
      draft={draft}
      onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      companies={companies}
      canManage={canManage}
      pending={false}
      submitLabel="Registrar trabajador"
      onSubmit={() => onSubmit(draft)}
    />
  );
}

describe("WorkerForm", () => {
  it("submits the worker's details", async () => {
    const onSubmit = vi.fn();
    wrap(<Form onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Nombre"), "Marcos");
    await userEvent.type(screen.getByLabelText("Apellidos"), "Revuelta Gil");
    await userEvent.type(screen.getByLabelText("DNI / NIE"), "72458018Z");
    expect(screen.getByText("✓ Letra de control correcta")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Categoría"), "specialist_labourer");
    await userEvent.selectOptions(screen.getByLabelText("Oficio según convenio"), "roofing");
    await userEvent.selectOptions(screen.getByLabelText("Tipo de contrato"), "permanent_site");
    await userEvent.type(screen.getByLabelText("Nº de TPC"), "39-0123456");
    await userEvent.click(screen.getByRole("button", { name: "Casco" }));
    await userEvent.click(screen.getByRole("button", { name: "Arnés anticaídas" }));
    await userEvent.click(screen.getByLabelText(/Recurso preventivo/));
    await userEvent.click(screen.getByRole("button", { name: "Registrar trabajador" }));

    expect(onSubmit).toHaveBeenCalledWith({
      ...emptyWorkerDraft("c-1"),
      firstName: "Marcos",
      surnames: "Revuelta Gil",
      idDocument: "72458018Z",
      category: "specialist_labourer",
      trade: "roofing",
      contractType: "permanent_site",
      tpcNumber: "39-0123456",
      ppeItems: ["helmet", "harness"],
      roles: ["preventive_resource"],
    });
  });

  it("flags a DNI whose letter is wrong and won't submit it", async () => {
    const onSubmit = vi.fn();
    wrap(<Form onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("DNI / NIE"), "72458018A");

    expect(screen.getByText("El DNI/NIE no es válido (letra de control).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar trabajador" })).toBeDisabled();
  });

  it("is read-only for viewers", () => {
    wrap(<Form onSubmit={vi.fn()} canManage={false} />);
    expect(screen.getByLabelText("Nombre")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Registrar trabajador" })).not.toBeInTheDocument();
  });
});

describe("AccessCard", () => {
  it("lists the six rules with what fails", async () => {
    const onObra = vi.fn();
    const access = workerAccess({ company: "bloqueada", docs: new Map(), roles: [], today: "2026-10-17" });
    wrap(<AccessCard access={access} obras={[{ projectId: "p-1", projectRef: "VTH-26-001" }]} obraId="" onObra={onObra} />);

    expect(screen.getByText("Bloqueado", { selector: "span.font-heading" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("Empresa bloqueada")).toBeInTheDocument();
    expect(screen.getByText("Falta: Alta en la Seguridad Social")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Comprobar en"), "p-1");
    expect(onObra).toHaveBeenCalledWith("p-1");
  });
});
