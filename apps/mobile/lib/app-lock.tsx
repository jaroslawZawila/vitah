import * as LocalAuthentication from "expo-local-authentication";
import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/button";
import { colors, spacing, type } from "../constants/theme";
import { useAuth } from "./auth";
import { useI18n } from "./i18n";

// "Acceso biométrico" (Perfil): with it on, the client gets in with their
// fingerprint or face instead of the password. Signed out, the sign-in screen
// offers it (see signInWithBiometrics in ./auth); signed in, the app asks for
// it when it opens and when it returns after a minute away.

const RELOCK_AFTER_MS = 60_000;

type AppLockValue = {
  /** The phone has biometrics set up. */
  available: boolean;
  enabled: boolean;
  /** Turning it on asks for biometrics first; returns whether it changed. */
  setEnabled: (on: boolean) => Promise<boolean>;
};

const AppLockContext = createContext<AppLockValue | null>(null);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { token, isLoading, biometric, enableBiometrics, disableBiometrics, signOut } = useAuth();
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [locked, setLocked] = useState(false);
  const [openChecked, setOpenChecked] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  // Decided in the same render the session is restored, so nothing shows
  // before the lock. Only at launch: turning it on later doesn't lock.
  if (!isLoading && !openChecked) {
    setOpenChecked(true);
    if (token && biometric) setLocked(true);
  }

  useEffect(() => {
    void Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])
      .then(([hardware, enrolled]) => setAvailable(hardware && enrolled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) setLocked(false);
  }, [token]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "background") backgroundedAt.current = Date.now();
      if (status === "active" && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (biometric && token && away >= RELOCK_AFTER_MS) setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [biometric, token]);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: t("lock.prompt") });
    if (result.success) setLocked(false);
  }, [t]);

  // Ask straight away when the lock screen appears.
  useEffect(() => {
    if (locked && token) void unlock();
  }, [locked, token, unlock]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (on) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: t("profile.biometricPrompt"),
        });
        if (!result.success) return false;
        await enableBiometrics();
      } else {
        await disableBiometrics();
      }
      return true;
    },
    [enableBiometrics, disableBiometrics, t],
  );

  const value = useMemo(
    () => ({ available, enabled: biometric, setEnabled }),
    [available, biometric, setEnabled],
  );

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
