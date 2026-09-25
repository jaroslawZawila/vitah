import React, { createContext, use, useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "./auth";
import {
  documentFile,
  markSeen,
  readDocuments,
  syncDocuments,
  type LocalDocument,
} from "./document-store";
import { openPdf } from "./open-pdf";

type DocumentsState = {
  /** `undefined` until the local copies have been read. */
  documents: LocalDocument[] | undefined;
  syncing: boolean;
  /** The last sync couldn't reach the server; showing local copies. */
  offline: boolean;
};

type DocumentsContextValue = DocumentsState & {
  sync: () => Promise<void>;
  /** Opens a downloaded document; returns false if it isn't on the phone. */
  open: (doc: LocalDocument) => Promise<boolean>;
};

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

/**
 * Keeps the client's documents on the phone: shows local copies straight
 * away, and syncs on app open and whenever the app returns to the foreground.
 */
export function DocumentsProvider({ children }: { children: React.ReactNode }) {
  const { token, signOut } = useAuth();
  const [state, setState] = useState<DocumentsState>({
    documents: undefined,
    syncing: true,
    offline: false,
  });
  const running = useRef(false);

  const sync = useCallback(async () => {
    if (!token || running.current) return;
    running.current = true;
    setState((s) => ({ ...s, syncing: true }));
    try {
      const result = await syncDocuments(token);
      if ("documents" in result) {
        setState({ documents: result.documents, syncing: false, offline: false });
      } else if (result.error === "unauthorized") {
        await signOut();
      } else if (result.error !== "signed_out") {
        setState((s) => ({ ...s, syncing: false, offline: true }));
      }
    } catch {
      setState((s) => ({ ...s, syncing: false, offline: true }));
    } finally {
      running.current = false;
    }
  }, [token, signOut]);

  useEffect(() => {
    void readDocuments().then((documents) =>
      setState((s) => (s.documents === undefined ? { ...s, documents } : s)),
    );
    void sync();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") void sync();
    });
    return () => subscription.remove();
  }, [sync]);

  const open = useCallback(async (doc: LocalDocument) => {
    const file = documentFile(doc.id);
    if (!file.exists) return false;
    await markSeen(doc.id);
    setState((s) => ({
      ...s,
      documents: s.documents?.map((d) => (d.id === doc.id ? { ...d, isNew: false } : d)),
    }));
    await openPdf(file);
    return true;
  }, []);

  return <DocumentsContext value={{ ...state, sync, open }}>{children}</DocumentsContext>;
}

export function useDocuments(): DocumentsContextValue {
  const ctx = use(DocumentsContext);
  if (!ctx) throw new Error("useDocuments must be used within DocumentsProvider");
  return ctx;
}
