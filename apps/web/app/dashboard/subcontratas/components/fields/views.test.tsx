// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import messages from "../../../../../messages/es.json";
import ActivityFields from "./ActivityFields";
import CompanyDataFields from "./CompanyDataFields";
import { EMPTY_COMPANY_DRAFT, type CompanyFormDraft } from "./draft";

// The field groups are controlled views; a small harness holds the draft.

let latest: CompanyFormDraft = EMPTY_COMPANY_DRAFT;

function Harness({ initial = {}, which }: { initial?: Partial<CompanyFormDraft>; which: "data" | "activity" }) {
  const [draft, setDraft] = useState({ ...EMPTY_COMPANY_DRAFT, ...initial });
  latest = draft;
  const onChange = (patch: Partial<CompanyFormDraft>) => setDraft((d) => ({ ...d, ...patch }));
  return which === "data" ? <CompanyDataFields draft={draft} onChange={onChange} /> : <ActivityFields draft={draft} onChange={onChange} />;
}

const renderFields = (which: "data" | "activity", initial?: Partial<CompanyFormDraft>) =>
  render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      <Harness which={which} initial={initial} />
    </NextIntlClientProvider>,
  );

describe("CompanyDataFields", () => {
  it("checks the CIF's control digit as it is typed", async () => {
    renderFields("data");
    const cif = screen.getByLabelText("CIF");

    await userEvent.type(cif, "B39123451");
    expect(screen.getByText("El CIF/NIF no es válido (dígito de control).")).toBeInTheDocument();
    expect(cif).toHaveAttribute("aria-invalid", "true");

    await userEvent.clear(cif);
    await userEvent.type(cif, "B-39123450");
    expect(screen.getByText("✓ Dígito de control correcto")).toBeInTheDocument();
  });

  it("asks a self-employed worker for a name and a NIF", async () => {
    renderFields("data");
    await userEvent.click(screen.getByLabelText("Autónomo"));

    expect(screen.getByLabelText("Nombre y apellidos")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("NIF"), "72145836B");
    expect(screen.getByText("✓ Dígito de control correcto")).toBeInTheDocument();
  });

  it("fills the province and the REA region from the postal code", async () => {
    renderFields("data");
    expect(screen.getByText("Se calcula con el código postal")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Código postal"), "39300");

    expect(screen.getByLabelText("Provincia")).toHaveValue("Cantabria");
    expect(screen.getByText("Cantabria", { selector: "div" })).toBeInTheDocument();
    expect(latest.province).toBe("Cantabria");
  });

  it("keeps a province typed by hand", async () => {
    renderFields("data", { province: "Santander" });
    await userEvent.type(screen.getByLabelText("Código postal"), "39300");
    expect(screen.getByLabelText("Provincia")).toHaveValue("Santander");
  });
});

describe("ActivityFields", () => {
  it("warns under 30 % permanent staff (Ley 32/2006)", async () => {
    renderFields("activity");
    await userEvent.type(screen.getByLabelText("Plantilla total"), "12");
    await userEvent.type(screen.getByLabelText("Nº de indefinidos"), "3");

    expect(screen.getByText("25 %")).toBeInTheDocument();
    expect(screen.getByText(/Menos del 30 % de la plantilla es indefinida/)).toBeInTheDocument();
  });

  it("flags more permanent staff than the workforce", async () => {
    renderFields("activity", { headcount: "5", permanentCount: "6" });
    expect(screen.getByText("Hay más indefinidos que plantilla.")).toBeInTheDocument();
  });

  it("doesn't let the self-employed subcontract", () => {
    renderFields("activity", { kind: "self_employed" });

    expect(screen.getByLabelText("Sí")).toBeDisabled();
    expect(screen.getByText("Un autónomo no puede subcontratar (Ley 32/2006, art. 5.2.e).")).toBeInTheDocument();
  });

  it("toggles trades and picks a prevention mode", async () => {
    renderFields("activity");
    await userEvent.click(screen.getByRole("button", { name: "Cubiertas" }));
    await userEvent.click(screen.getByRole("button", { name: "Electricidad" }));
    await userEvent.click(screen.getByRole("button", { name: "Cubiertas" }));
    await userEvent.click(screen.getByLabelText(/Servicio de prevención ajeno/));

    expect(screen.getByRole("button", { name: "Electricidad" })).toHaveAttribute("aria-pressed", "true");
    expect(latest).toMatchObject({ trades: ["electrical"], preventionMode: "external_service" });
  });

  it("asks for the Industry number only of licensed installers", async () => {
    renderFields("activity");
    expect(screen.queryByLabelText("Nº de registro de Industria")).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Es instalador habilitado"));
    expect(screen.getByLabelText("Nº de registro de Industria")).toBeInTheDocument();
  });
});
