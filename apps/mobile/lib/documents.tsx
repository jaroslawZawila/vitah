import React, { createContext, use, useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "./auth";
import {
  documentFile,
  markSeen,
  pruneDocuments,
  readDocuments,
  syncDocuments,
  type LocalDocument,
} from "./document-store";
import { openPdf } from "./open-pdf";
import { useProject } from "./use-project";

type DocumentsState = {
  /** `undefined` until the local copies have been read. */
  documents: LocalDocument[] | undefined;
  syncing: boolean;
  /** The last sync couldn't reach the server; showing local copies. */
  offline: boolean;
};

type DocumentsContextValue = DocumentsState & {
  sync: () => Promise<void>;
  /** Syncs without showing it, e.g. when the server says the documents changed. */
  reload: () => Promise<void>;
  /** Opens a downloaded document; returns false if it isn't on the phone. */
  open: (doc: LocalDocument) => Promise<boolean>;
};

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

const INITIAL: DocumentsState = { documents: undefined, syncing: true, offline: false };
/** A client without homes has no documents. */
const NONE: DocumentsState = { documents: [], syncing: false, offline: false };

/**
 * Keeps the documents of the home shown on the phone: shows local copies
 * straight away, and syncs on app open, when the client switches home and
 * whenever the app returns to the foreground.
 */
export function DocumentsProvider({ children }: { children: React.ReactNode }) {
  const { token, signOut } = useAuth();
  const { projectId, projects } = useProject();
  const [state, setState] = useState<DocumentsState>(INITIAL);
  // The home being synced, if any.
  const running = useRef<string | null>(null);
  // A change reported, or another home shown, while a sync runs: sync again after it.
  const again = useRef(false);
  // The home shown: a sync syncs it, and drops its answer if another is shown by then.
  const shown = useRef(projectId);
  shown.current = projectId;

  const run = useCallback(async (quiet: boolean): Promise<void> => {
    const home = shown.current;
    if (!token || !home) return;
    if (running.current) {
      if (quiet || running.current !== home) again.current = true;
      return;
    }
    running.current = home;
    if (!quiet) setState((s) => ({ ...s, syncing: true }));
    try {
      const result = await syncDocuments(token, home, () => shown.current === home);
      if (shown.current !== home) {
        // The client switched home meanwhile.
      } else if ("documents" in result) {
        setState({ documents: result.documents, syncing: false, offline: false });
      } else if (result.error === "unauthorized") {
        await signOut();
      } else if (result.error !== "signed_out") {
        setState((s) => ({ ...s, syncing: false, offline: true }));
      }
    } catch {
      if (shown.current === home) setState((s) => ({ ...s, syncing: false, offline: true }));
    } finally {
      running.current = null;
    }
    if (again.current) {
      again.current = false;
      await run(true);
    }
  }, [token, signOut]);
  const sync = useCallback(() => run(false), [run]);
  const reload = useCallback(() => run(true), [run]);

  useEffect(() => {
    if (projectId === undefined) return;
    if (projectId === null) {
      setState(NONE);
      return;
    }
    setState(INITIAL);
    void readDocuments(projectId).then((documents) => {
      if (shown.current === projectId) setState((s) => (s.documents === undefined ? { ...s, documents } : s));
    });
    void sync();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") void sync();
    });
    return () => subscription.remove();
  }, [sync, projectId]);

  // Copies of a home that is no longer the client's go.
  const homeIds = projects?.map((p) => p.id).join(",");
  useEffect(() => {
    if (homeIds !== undefined) pruneDocuments(homeIds ? homeIds.split(",") : []);
  }, [homeIds]);

  const open = useCallback(async (doc: LocalDocument) => {
    const home = shown.current;
    if (!home) return false;
    const file = documentFile(home, doc.id);
    if (!file.exists) return false;
    await markSeen(home, doc.id);
    setState((s) => ({
      ...s,
      documents: s.documents?.map((d) => (d.id === doc.id ? { ...d, isNew: false } : d)),
    }));
    await openPdf(file);
    return true;
  }, []);

  return <DocumentsContext value={{ ...state, sync, reload, open }}>{children}</DocumentsContext>;
}

export function useDocuments(): DocumentsContextValue {
  const ctx = use(DocumentsContext);
  if (!ctx) throw new Error("useDocuments must be used within DocumentsProvider");
  return ctx;
}
