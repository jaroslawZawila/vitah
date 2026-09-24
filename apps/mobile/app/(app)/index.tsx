import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../../lib/auth";
import { api, type Project } from "../../lib/api";
import { useRouter } from "expo-router";
import { colors } from "../../constants/colors";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  manager: "Gestor",
  viewer: "Visor",
};

export default function HomeScreen() {
  const { user, token, signOut } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void api.getProjects(token).then((result) => {
      if (result.data) {
        setProjects(result.data);
      } else if (result.error === "unauthorized") {
        void handleSignOut();
      } else {
        setError(result.error ?? "request_failed");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSignOut() {
    await signOut();
    router.replace("/sign-in");
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerLogo}>ViTAH</Text>
        <TouchableOpacity onPress={handleSignOut} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.welcomeLabel}>BIENVENIDO</Text>
        <Text style={styles.userName}>{user?.name ?? user?.email}</Text>
        <Text style={styles.userRole}>
          {user?.role ? (ROLE_LABELS[user.role] ?? user.role) : ""}
        </Text>

        <Text style={styles.sectionLabel}>PROYECTOS</Text>
        {error ? (
          <Text style={styles.cardSubtitle}>No se pudieron cargar los proyectos</Text>
        ) : projects === null ? (
          <ActivityIndicator color={colors.verdeOliva} />
        ) : (
          <FlatList
            data={projects}
            keyExtractor={(p) => p.id}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <Text style={styles.cardSubtitle}>Sin proyectos</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {item.ref} · {item.clientName}
                </Text>
                <Text style={styles.cardSubtitle}>
                  {item.location} · {item.progressPct}%
                </Text>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.grafito,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
  },
  headerLogo: {
    color: colors.blancoCalido,
    fontSize: 22,
    fontWeight: "300",
    letterSpacing: 6,
  },
  signOutText: {
    color: colors.muted,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  welcomeLabel: {
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 8,
  },
  userName: {
    color: colors.blancoCalido,
    fontSize: 30,
    fontWeight: "300",
    marginBottom: 4,
  },
  userRole: {
    color: colors.verdeOliva,
    fontSize: 13,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 40,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 12,
  },
  separator: {
    height: 12,
  },
  card: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  cardTitle: {
    color: colors.blancoCalido,
    fontSize: 18,
    fontWeight: "400",
    marginBottom: 6,
  },
  cardSubtitle: {
    color: colors.muted,
    fontSize: 14,
  },
});
