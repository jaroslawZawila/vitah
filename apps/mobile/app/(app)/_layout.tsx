import { Redirect, Stack } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "../../constants/theme";
import { useAuth } from "../../lib/auth";
import { DocumentsProvider } from "../../lib/documents";
import { useI18n } from "../../lib/i18n";
import { LiveUpdates } from "../../lib/live-updates";
import { usePushNotifications } from "../../lib/push";
import { PhotosProvider } from "../../lib/use-photos";
import { ProjectProvider, useProject } from "../../lib/use-project";
import { ObraProvider } from "../../lib/use-obra";

// The tabs are always the screen under a pushed one (a phase, a payment).
export const unstable_settings = { initialRouteName: "(tabs)" };

export default function AppLayout() {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.verdeOliva} size="large" />
      </View>
    );
  }

  if (!token) {
    return <Redirect href="/sign-in" />;
  }

  return (
    // Above the tabs and the screens pushed over them (a phase, a payment):
    // the client's homes and one copy of the data of the home shown for all,
    // and documents sync on app open whichever tab is shown. LiveUpdates
    // reloads what staff change while the app is open.
    <ProjectProvider>
    <PhotosProvider>
    <DocumentsProvider>
      <ObraProvider>
        <LiveUpdates />
        <PushNotifications />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.grafito } }} />
      </ObraProvider>
    </DocumentsProvider>
    </PhotosProvider>
    </ProjectProvider>
  );
}

/** Registers the phone for pushes; a tapped one opens its tab, on its home. */
function PushNotifications() {
  const { token } = useAuth();
  const { language } = useI18n();
  const { select } = useProject();
  const show = useCallback((projectId: string) => select(projectId, false), [select]);
  usePushNotifications(token, language, show);
  return null;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.grafito,
    justifyContent: "center",
    alignItems: "center",
  },
});
