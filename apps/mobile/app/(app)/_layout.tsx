import Feather from "@expo/vector-icons/Feather";
import { Redirect, Tabs } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "../../lib/auth";
import { DocumentsProvider } from "../../lib/documents";
import { colors } from "../../constants/theme";

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
    // Above the tabs so documents sync on app open, whichever tab is shown.
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
            tabBarLabel: "Inicio",
            tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="documents"
          options={{
            title: "Documentos",
            headerShown: false,
            tabBarIcon: ({ color }) => <Feather name="file-text" size={22} color={color} />,
          }}
        />
      </Tabs>
    </DocumentsProvider>
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
