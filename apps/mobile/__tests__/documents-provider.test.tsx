import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as store from "../lib/document-store";
import { DocumentsProvider, useDocuments } from "../lib/documents";
import { openPdf } from "../lib/open-pdf";

const mockSignOut = jest.fn();
jest.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", signOut: mockSignOut }),
}));
jest.mock("../lib/document-store", () => ({
  readDocuments: jest.fn(),
  syncDocuments: jest.fn(),
  markSeen: jest.fn(),
  documentFile: jest.fn(),
}));
jest.mock("../lib/open-pdf", () => ({ openPdf: jest.fn() }));

const readDocuments = jest.mocked(store.readDocuments);
const syncDocuments = jest.mocked(store.syncDocuments);

const contract: store.LocalDocument = {
  id: "d1",
  title: "Contrato",
  category: "contract",
  sizeBytes: 1024,
  uploadedAt: "2026-09-22T10:00:00.000Z",
  downloaded: true,
  isNew: true,
};

let appStateListener: ((status: AppStateStatus) => void) | undefined;

const wrapper = ({ children }: { children: ReactNode }) => (
  <DocumentsProvider>{children}</DocumentsProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  readDocuments.mockResolvedValue([contract]);
  syncDocuments.mockResolvedValue({ documents: [contract] });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
});

describe("DocumentsProvider", () => {
  it("syncs on app open and shows the synced documents", async () => {
    const { result } = renderHook(useDocuments, { wrapper });

    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(syncDocuments).toHaveBeenCalledWith("tok");
    expect(result.current.documents).toEqual([contract]);
    expect(result.current.offline).toBe(false);
  });

  it("syncs again when the app returns to the foreground", async () => {
    const { result } = renderHook(useDocuments, { wrapper });
    await waitFor(() => expect(result.current.syncing).toBe(false));

    await act(async () => appStateListener?.("active"));

    expect(syncDocuments).toHaveBeenCalledTimes(2);
  });

  it("reloads without showing a sync", async () => {
    const { result } = renderHook(useDocuments, { wrapper });
    await waitFor(() => expect(result.current.syncing).toBe(false));

    const plans = { ...contract, id: "d2", title: "Planos" };
    let finish: (value: { documents: store.LocalDocument[] }) => void = () => {};
    syncDocuments.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    act(() => void result.current.reload());
    expect(result.current.syncing).toBe(false);

    await act(async () => finish({ documents: [plans, contract] }));
    expect(result.current.documents).toEqual([plans, contract]);
  });

  it("syncs again after a sync that was running when a change came", async () => {
    const { result } = renderHook(useDocuments, { wrapper });
    await waitFor(() => expect(result.current.syncing).toBe(false));

    const plans = { ...contract, id: "d2", title: "Planos" };
    let finish: (value: { documents: store.LocalDocument[] }) => void = () => {};
    syncDocuments.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    syncDocuments.mockResolvedValueOnce({ documents: [plans, contract] });
    act(() => void result.current.sync());
    act(() => void result.current.reload());
    expect(syncDocuments).toHaveBeenCalledTimes(2);

    await act(async () => finish({ documents: [contract] }));

    await waitFor(() => expect(result.current.documents).toEqual([plans, contract]));
    expect(syncDocuments).toHaveBeenCalledTimes(3);
  });

  it("shows the local copies when offline", async () => {
    syncDocuments.mockResolvedValue({ error: "network_error" });
    const { result } = renderHook(useDocuments, { wrapper });

    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(result.current.offline).toBe(true);
    expect(result.current.documents).toEqual([contract]);
  });

  it("signs out when the session was revoked", async () => {
    syncDocuments.mockResolvedValue({ error: "unauthorized" });
    renderHook(useDocuments, { wrapper });

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it("ignores a sync overtaken by sign-out", async () => {
    syncDocuments.mockResolvedValue({ error: "signed_out" });
    const { result } = renderHook(useDocuments, { wrapper });

    await waitFor(() => expect(syncDocuments).toHaveBeenCalled());
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(result.current.offline).toBe(false);
  });

  it("opens a downloaded document and marks it as seen", async () => {
    const file = { exists: true };
    jest.mocked(store.documentFile).mockReturnValue(file as never);
    const { result } = renderHook(useDocuments, { wrapper });
    await waitFor(() => expect(result.current.syncing).toBe(false));

    let opened = false;
    await act(async () => {
      opened = await result.current.open(contract);
    });

    expect(opened).toBe(true);
    expect(store.markSeen).toHaveBeenCalledWith("d1");
    expect(openPdf).toHaveBeenCalledWith(file);
    expect(result.current.documents?.[0]?.isNew).toBe(false);
  });

  it("does not open a document that isn't on the phone", async () => {
    jest.mocked(store.documentFile).mockReturnValue({ exists: false } as never);
    const { result } = renderHook(useDocuments, { wrapper });
    await waitFor(() => expect(result.current.syncing).toBe(false));

    let opened = true;
    await act(async () => {
      opened = await result.current.open(contract);
    });

    expect(opened).toBe(false);
    expect(openPdf).not.toHaveBeenCalled();
  });
});
