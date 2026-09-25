import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppLockProvider } from "../lib/app-lock";
import { AuthProvider } from "../lib/auth";
import { I18nProvider } from "../lib/i18n";

export default function RootLayout() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppLockProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }} />
        </AppLockProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
