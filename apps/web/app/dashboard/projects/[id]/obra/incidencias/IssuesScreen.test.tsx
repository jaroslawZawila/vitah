// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import messages from "../../../../../../messages/es.json";
import { TODAY, chapters, header, issues } from "../../../../../../test/construction-fixture";
import IssuesScreen from "./IssuesScreen";

vi.mock("../../../../../actions/construction", () => ({
  createIssueAction: vi.fn(),
  updateIssueAction: vi.fn(),
  addIssueFileAction: vi.fn(),
  deleteIssueFileAction: vi.fn(),
}));
const actions = await import("../../../../../actions/construction");

const options = chapters.map(({ code, name }) => ({ code, name }));

function renderScreen(props: Partial<Parameters<typeof IssuesScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <IssuesScreen projectId="p-1" header={header} issues={issues} chapters={options} today={TODAY} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

const records = () => screen.queryAllByRole("article").map((a) => a.getAttribute("aria-label"));

beforeEach(() => {
  for (const action of Object.values(actions)) (action as Mock).mockReset().mockResolvedValue({ success: true });
});

describe("IssuesScreen", () => {
  it("lists the records with their impact and attachments", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Incidencias y cambios" })).toBeInTheDocument();
    expect(records()).toEqual(["INC-007", "CAM-004", "INC-005"]);
    const record = within(screen.getByRole("article", { name: "INC-007" }));
    expect(record.getByText("06 · Envolvente térmica Thermochip")).toBeInTheDocument();
    expect(record.getByText("Subcontrata · Montajes Thermochip Norte")).toBeInTheDocument();
    expect(record.getByText("sin estimar")).toBeInTheDocument();
    expect(record.getByText("+3 d est.")).toBeInTheDocument();
    expect(record.getByText("En revisión")).toBeInTheDocument();
    expect(record.getByRole("link", { name: "albaran.pdf" })).toHaveAttribute("href", "/api/v1/projects/p-1/obra/issues/issue-7/files/file-1");
    expect(within(screen.getByRole("article", { name: "CAM-004" })).getByText("+2350 € est.")).toBeInTheDocument();
  });

  it("filters by kind, chapter and status", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: /Cambios\s*1/ }));
    expect(records()).toEqual(["CAM-004"]);
    await userEvent.click(screen.getByRole("button", { name: /Todos\s*3/ }));

    const list = within(screen.getByRole("region", { name: "Registros" }));
    await userEvent.selectOptions(list.getByRole("combobox", { name: "Capítulo" }), "06");
    expect(records()).toEqual(["INC-007", "INC-005"]);

    await userEvent.selectOptions(list.getByRole("combobox", { name: "Estado" }), "open");
    expect(records()).toEqual(["INC-007"]);
  });

  it("creates a record, then uploads its attachments", async () => {
    vi.mocked(actions.createIssueAction).mockResolvedValue({ success: true, issueId: "issue-new" });
    renderScreen();

    const form = within(screen.getByRole("form", { name: "Nuevo registro" }));
    await userEvent.selectOptions(form.getByLabelText("Capítulo afectado"), "04");
    await userEvent.type(form.getByLabelText("Descripción"), "Arqueta rota");
    await userEvent.selectOptions(form.getByLabelText("Parte relacionada"), "other");
    await userEvent.upload(form.getByLabelText(/Adjuntos/), [
      new File(["a"], "foto.jpg", { type: "image/jpeg" }),
      new File(["b"], "correo.eml", { type: "message/rfc822" }),
    ]);
    await userEvent.click(form.getByRole("button", { name: "Guardar registro" }));

    await waitFor(() => expect(actions.addIssueFileAction).toHaveBeenCalledTimes(2));
    expect(actions.createIssueAction).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({ kind: "issue", chapterCode: "04", description: "Arqueta rota", party: "other", occurredOn: TODAY }),
    );
    expect(vi.mocked(actions.addIssueFileAction).mock.calls.map(([, id, , data]) => [id, (data.get("file") as File).name])).toEqual([
      ["issue-new", "foto.jpg"],
      ["issue-new", "correo.eml"],
    ]);
  });

  it("after a failed attachment, saving again updates the record instead of creating another", async () => {
    vi.mocked(actions.createIssueAction).mockResolvedValue({ success: true, issueId: "issue-new" });
    vi.mocked(actions.addIssueFileAction).mockResolvedValueOnce({ error: "file_too_large" });
    renderScreen();

    const form = within(screen.getByRole("form", { name: "Nuevo registro" }));
    await userEvent.selectOptions(form.getByLabelText("Capítulo afectado"), "04");
    await userEvent.type(form.getByLabelText("Descripción"), "Arqueta rota");
    await userEvent.upload(form.getByLabelText(/Adjuntos/), new File(["a"], "plano.pdf", { type: "application/pdf" }));
    await userEvent.click(form.getByRole("button", { name: "Guardar registro" }));

    expect(await form.findByRole("alert")).toHaveTextContent("Un adjunto supera el máximo de 4 MB.");
    await userEvent.click(form.getByRole("button", { name: "Guardar registro" }));

    await waitFor(() => expect(actions.updateIssueAction).toHaveBeenCalledWith("p-1", "issue-new", expect.anything()));
    expect(actions.createIssueAction).toHaveBeenCalledTimes(1);
  });

  it("checks attachments and amounts before sending", async () => {
    renderScreen();

    const form = within(screen.getByRole("form", { name: "Nuevo registro" }));
    await userEvent.selectOptions(form.getByLabelText("Capítulo afectado"), "04");
    await userEvent.type(form.getByLabelText("Descripción"), "Arqueta rota");
    await userEvent.type(form.getByLabelText(/Impacto en coste/), "mucho");
    await userEvent.click(form.getByRole("button", { name: "Guardar registro" }));

    expect(await form.findByRole("alert")).toHaveTextContent("Revisa los valores introducidos");
    expect(actions.createIssueAction).not.toHaveBeenCalled();
  });

  it("shows why saving failed", async () => {
    vi.mocked(actions.createIssueAction).mockResolvedValue({ error: "unknown_chapter" });
    renderScreen();

    const form = within(screen.getByRole("form", { name: "Nuevo registro" }));
    await userEvent.selectOptions(form.getByLabelText("Capítulo afectado"), "04");
    await userEvent.type(form.getByLabelText("Descripción"), "Arqueta rota");
    await userEvent.click(form.getByRole("button", { name: "Guardar registro" }));

    expect(await form.findByRole("alert")).toHaveTextContent("Ese capítulo no está en el contrato.");
  });

  it("edits a record in the side form", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Editar CAM-004" }));
    const form = within(screen.getByRole("form", { name: "Editar CAM-004" }));
    expect(form.getByLabelText(/Impacto en coste/)).toHaveValue("2350,00");
    await userEvent.selectOptions(form.getByLabelText("Estado"), "review");
    await userEvent.click(form.getByRole("button", { name: "Guardar registro" }));

    expect(actions.updateIssueAction).toHaveBeenCalledWith(
      "p-1",
      "change-4",
      expect.objectContaining({ kind: "change", status: "review", costImpactCents: 235_000, scheduleImpactDays: 5 }),
    );
    await waitFor(() => expect(screen.getByRole("form", { name: "Nuevo registro" })).toBeInTheDocument());
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
  });
});
