import React, { createContext, use, useState, useEffect, useCallback } from "react";
import { Image } from "expo-image";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { api, type AuthUser } from "./api";
import { clearDocuments } from "./document-store";
import { retryPendingRemoval, unregisterPush } from "./push";

const TOKEN_KEY = "vitah_token";
const USER_KEY = "vitah_user";
/**
 * "Acceso biométrico" (Perfil): the session saved for signing back in with
 * biometrics after signing out. `{ token, user }` as JSON; kept on sign-out,
 * dropped when turned off, when it expires, or when another client signs in.
 */
const BIOMETRIC_KEY = "vitah_biometric_session";

type Session = { token: string; user: AuthUser };

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  /** A session is saved for biometric sign-in. */
  biometric: boolean;
  /** Signed out by the client just now (not opened signed out): don't ask for biometrics at once. */
  signedOut?: boolean;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  /** Asks for biometrics, then restores the saved session. */
  signInWithBiometrics: (
    promptMessage: string,
  ) => Promise<{ error?: "cancelled" | "expired" | "unavailable" }>;
  /** Saves the current session for biometric sign-in (after the caller checked biometrics). */
  enableBiometrics: () => Promise<void>;
  disableBiometrics: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readSession(key: string): Promise<Session | null> {
  const json = await SecureStore.getItemAsync(key);
  return json ? (JSON.parse(json) as Session) : null;
}

async function saveSession({ token, user }: Session) {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    isLoading: true,
    biometric: false,
  });

  useEffect(() => {
    async function restore() {
      try {
        const [token, userJson, biometric] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
          SecureStore.getItemAsync(BIOMETRIC_KEY),
        ]);
        const user = token && userJson ? (JSON.parse(userJson) as AuthUser) : null;
        setState({ token: user && token, user, isLoading: false, biometric: !!biometric });
      } catch {
        setState((s) => ({ ...s, isLoading: false }));
      }
    }
    void restore();
    void retryPendingRemoval().catch(() => {});
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error?: string }> => {
      const result = await api.signIn(email, password);
      if (!result.ok) return { error: result.error };

      const session = result.data;
      await saveSession(session);
      // Keep biometric sign-in for the same client (with the fresh token);
      // drop another client's.
      const saved = await readSession(BIOMETRIC_KEY).catch(() => null);
      const biometric = saved?.user.id === session.user.id;
      if (biometric) {
        await SecureStore.setItemAsync(BIOMETRIC_KEY, JSON.stringify(session));
      } else if (saved) {
        await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
      }
      setState({ token: session.token, user: session.user, isLoading: false, biometric });
      return {};
    },
    [],
  );

  const signInWithBiometrics = useCallback(async (promptMessage: string) => {
    const saved = await readSession(BIOMETRIC_KEY).catch(() => null);
    if (!saved) return { error: "unavailable" as const };
    const check = await LocalAuthentication.authenticateAsync({ promptMessage });
    if (!check.success) return { error: "cancelled" as const };

    // Offline is fine (the app works from its saved data); a rejected
    // session means the password is needed again.
    const result = await api.getProject(saved.token);
    if (!result.ok && result.error === "unauthorized") {
      await SecureStore.deleteItemAsync(BIOMETRIC_KEY).catch(() => {});
      setState((s) => ({ ...s, biometric: false }));
      return { error: "expired" as const };
    }
    await saveSession(saved);
    setState({ token: saved.token, user: saved.user, isLoading: false, biometric: true });
    return {};
  }, []);

  const enableBiometrics = useCallback(async () => {
    if (!state.token || !state.user) return;
    const session: Session = { token: state.token, user: state.user };
    await SecureStore.setItemAsync(BIOMETRIC_KEY, JSON.stringify(session));
    setState((s) => ({ ...s, biometric: true }));
  }, [state.token, state.user]);

  const disableBiometrics = useCallback(async () => {
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY).catch(() => {});
    setState((s) => ({ ...s, biometric: false }));
  }, []);

  const signOut = useCallback(async () => {
    // While the token still works: stop this phone getting the client's pushes.
    if (state.token) await unregisterPush(state.token).catch(() => {});
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    // The phone may be shared: don't leave the client's documents or photos behind.
    clearDocuments();
    await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]);
    // Biometric sign-in stays on: it's how the client gets back in.
    setState((s) => ({ ...s, token: null, user: null, isLoading: false, signedOut: true }));
  }, [state.token]);

  return (
    <AuthContext
      value={{
        ...state,
        signIn,
        signInWithBiometrics,
        enableBiometrics,
        disableBiometrics,
        signOut,
      }}
    >
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
