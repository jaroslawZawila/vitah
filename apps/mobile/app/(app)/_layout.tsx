import { Redirect, Stack } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "../../lib/auth";
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
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.grafito },
        headerTintColor: colors.blancoCalido,
        headerTitleStyle: { fontWeight: "300" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.grafito },
      }}
    />
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
