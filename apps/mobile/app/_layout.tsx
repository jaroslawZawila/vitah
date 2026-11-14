import { Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppLockProvider } from "../lib/app-lock";
import { AuthProvider } from "../lib/auth";
import { installGlobalErrorHandlers } from "../lib/global-errors";
import { I18nProvider } from "../lib/i18n";
import { setReportScreen } from "../lib/report-error";

// Errors no screen catches (outside rendering, unhandled rejections) are reported to the portal.
installGlobalErrorHandlers();

// A screen that throws while rendering shows this instead of closing the app.
export { ErrorFallback as ErrorBoundary } from "../components/error-fallback";

/** Tells the error reporter which route is shown: its name ("obra/pago/[id]"), never its ids. */
function ReportScreen() {
  const route = useSegments().join("/");
  useEffect(() => setReportScreen(`/${route}`), [route]);
  return null;
}

export default function RootLayout() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppLockProvider>
          <StatusBar style="light" />
          <ReportScreen />
          <Stack screenOptions={{ headerShown: false }} />
        </AppLockProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
