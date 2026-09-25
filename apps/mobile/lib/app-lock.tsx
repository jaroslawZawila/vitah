import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/button";
import { colors, spacing, type } from "../constants/theme";
import { useAuth } from "./auth";
import { useI18n } from "./i18n";

// "Acceso con Face ID" (Perfil): when on, the app asks for Face ID, Touch ID
// or a fingerprint when it opens and when it returns after a minute away.
// The choice is kept on this phone only and cleared on sign-out.

const LOCK_KEY = "vitah_app_lock";
const RELOCK_AFTER_MS = 60_000;

export type BiometricMethod = "faceId" | "touchId" | "face" | "fingerprint" | "other";

type AppLockValue = {
  /** The phone has biometrics set up. */
  available: boolean;
  method: BiometricMethod;
  enabled: boolean;
  /** Turning it on asks for biometrics first; returns whether it changed. */
  setEnabled: (on: boolean) => Promise<boolean>;
};

const AppLockContext = createContext<AppLockValue | null>(null);

async function detectMethod(): Promise<{ available: boolean; method: BiometricMethod }> {
  const [hardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  const { FACIAL_RECOGNITION, FINGERPRINT } = LocalAuthentication.AuthenticationType;
  const ios = Platform.OS === "ios";
  const method: BiometricMethod = types.includes(FACIAL_RECOGNITION)
    ? ios
      ? "faceId"
      : "face"
    : types.includes(FINGERPRINT)
      ? ios
        ? "touchId"
        : "fingerprint"
      : "other";
  return { available: hardware && enrolled, method };
}

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { token, isLoading, signOut } = useAuth();
  const { t } = useI18n();
  const [biometrics, setBiometrics] = useState({ available: false, method: "other" as BiometricMethod });
  const [enabled, setEnabledState] = useState<boolean | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    void detectMethod().then(setBiometrics).catch(() => {});
    // On with the setting read, before anything renders: the app opens locked
    // (turning the lock on later doesn't lock straight away).
    void SecureStore.getItemAsync(LOCK_KEY)
      .then((value) => {
        setLocked(value === "1");
        setEnabledState(value === "1");
      })
      .catch(() => setEnabledState(false));
  }, []);

  // Signed out: the next person on this phone starts without the lock.
  useEffect(() => {
    if (!isLoading && !token && enabled !== undefined) {
      setLocked(false);
      if (enabled) {
        setEnabledState(false);
        void SecureStore.deleteItemAsync(LOCK_KEY).catch(() => {});
      }
    }
  }, [isLoading, token, enabled]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "background") backgroundedAt.current = Date.now();
      if (status === "active" && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (enabled && token && away >= RELOCK_AFTER_MS) setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [enabled, token]);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: t("lock.prompt") });
    if (result.success) setLocked(false);
  }, [t]);

  // Ask straight away when the lock screen appears (once signed in).
  useEffect(() => {
    if (locked && token) void unlock();
  }, [locked, token, unlock]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (on) {
        const method = t(`biometrics.${biometrics.method}`);
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: t("profile.biometricPrompt", { method }),
        });
        if (!result.success) return false;
        await SecureStore.setItemAsync(LOCK_KEY, "1");
      } else {
        await SecureStore.deleteItemAsync(LOCK_KEY);
      }
      setEnabledState(on);
      return true;
    },
    [biometrics.method, t],
  );

  const value = useMemo(
    () => ({ ...biometrics, enabled: enabled === true, setEnabled }),
    [biometrics, enabled, setEnabled],
  );

  // Nothing renders until we know whether to lock, so no data shows first.
  if (enabled === undefined) return null;

  return (
    <AppLockContext value={value}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={locked}
        importantForAccessibility={locked ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {locked && (
        <View style={styles.lock}>
          <Text style={styles.logo}>ViTAH</Text>
          <Text accessibilityRole="header" style={[type.subhead, { textAlign: "center" }]}>
            {t("lock.title")}
          </Text>
          <View style={{ alignSelf: "stretch", gap: spacing.sm }}>
            <Button title={t("lock.unlock")} onPress={() => void unlock()} />
            <Button title={t("lock.signOut")} variant="secondary" onPress={() => void signOut()} />
          </View>
        </View>
      )}
    </AppLockContext>
  );
}

export function useAppLock(): AppLockValue {
  const ctx = use(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used within AppLockProvider");
  return ctx;
}

const styles = StyleSheet.create({
  lock: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.grafito,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    padding: spacing.xl,
  },
  logo: { fontSize: 44, fontWeight: "300", letterSpacing: 14, color: colors.blancoCalido },
});
