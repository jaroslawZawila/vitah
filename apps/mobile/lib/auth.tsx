import React, {
  createContext,
  use,
  useState,
  useEffect,
  useCallback,
} from "react";
import { Image } from "expo-image";
import * as SecureStore from "expo-secure-store";
import { api, type AuthUser } from "./api";
import { clearDocuments } from "./document-store";
import { retryPendingRemoval, unregisterPush } from "./push";

const TOKEN_KEY = "vitah_token";
const USER_KEY = "vitah_user";

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    isLoading: true,
  });

  useEffect(() => {
    async function restore() {
      try {
        const [token, userJson] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (token && userJson) {
          setState({ token, user: JSON.parse(userJson) as AuthUser, isLoading: false });
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
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

      const { token, user } = result.data;
      await Promise.all([
        SecureStore.setItemAsync(TOKEN_KEY, token),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
      ]);
      setState({ token, user, isLoading: false });
      return {};
    },
    []
  );

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
    setState({ token: null, user: null, isLoading: false });
  }, [state.token]);

  return (
    <AuthContext value={{ ...state, signIn, signOut }}>
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
