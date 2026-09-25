import Feather from "@expo/vector-icons/Feather";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "../../constants/theme";
import { useAuth } from "../../lib/auth";
import { DocumentsProvider } from "../../lib/documents";
import { PUSH_NOTIFICATIONS } from "../../lib/features";
import { useI18n } from "../../lib/i18n";
import { usePushNotifications } from "../../lib/push";
import { PhotosProvider } from "../../lib/use-photos";
import { ProjectProvider } from "../../lib/use-project";

export default function AppLayout() {
  const { token, isLoading } = useAuth();
  const { t, language } = useI18n();
  usePushNotifications(PUSH_NOTIFICATIONS ? token : null, language);

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
    // Above the tabs: one copy of the client's data for every tab, and
    // documents sync on app open whichever tab is shown.
    <ProjectProvider>
    <PhotosProvider>
    <DocumentsProvider>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.grafito },
          headerTintColor: colors.blancoCalido,
          headerTitleStyle: { fontWeight: "300" },
          headerShadowVisible: false,
          sceneStyle: { backgroundColor: colors.grafito },
          tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.divider },
          tabBarActiveTintColor: colors.blancoCalido,
          tabBarInactiveTintColor: colors.inactive,
          tabBarLabelStyle: { fontSize: 10 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t("tabs.home"),
            headerShown: false,
            tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="photos"
          options={{
            title: t("tabs.photos"),
            headerShown: false,
            tabBarIcon: ({ color }) => <Feather name="image" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="documents"
          options={{
            title: t("tabs.documents"),
            headerShown: false,
            tabBarIcon: ({ color }) => <Feather name="file-text" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t("tabs.profile"),
            headerShown: false,
            tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} />,
          }}
        />
      </Tabs>
    </DocumentsProvider>
    </PhotosProvider>
    </ProjectProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.grafito,
    justifyContent: "center",
    alignItems: "center",
  },
});
