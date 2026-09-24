import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Button } from "../../components/button";
import { colors, spacing, type } from "../../constants/theme";
import type { Project } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate } from "../../lib/format";
import { useProject } from "../../lib/use-project";

export default function ProjectScreen() {
  const { user, signOut } = useAuth();
  const { project, error, refreshing, refresh, retry } = useProject();
  const loaded = project !== undefined;
  const firstName = user?.name?.split(" ")[0];

  return (
    <>
      <Stack.Screen
        options={{
          title: "Mi proyecto",
          headerRight: () => (
            <Pressable
              onPress={signOut}
              accessibilityRole="button"
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={type.subhead}>Salir</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: colors.grafito }}
        contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, gap: spacing.xl }}
        refreshControl={
          loaded ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.verdeOliva}
              colors={[colors.verdeOliva]}
            />
          ) : undefined
        }
      >
        {!loaded && !error && (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <ActivityIndicator
              color={colors.verdeOliva}
              size="large"
              accessibilityLabel="Cargando tu proyecto"
            />
          </View>
        )}

        {!loaded && error && (
          <View style={{ flex: 1, justifyContent: "center", gap: spacing.lg }}>
            <Text selectable style={[type.body, { textAlign: "center" }]}>
              No hemos podido cargar tu proyecto. Comprueba tu conexión.
            </Text>
            <Button title="Reintentar" variant="secondary" onPress={retry} />
          </View>
        )}

        {loaded && (
          <View style={{ gap: spacing.sm }}>
            <Text style={type.label}>{firstName ? `Hola, ${firstName}` : "Hola"}</Text>
            {project === null && (
              <Text style={type.subhead}>
                Todavía no tienes un proyecto asignado. Tu asesor de ViTAH lo activará en cuanto
                esté listo.
              </Text>
            )}
          </View>
        )}

        {loaded && error && (
          <Text selectable accessibilityRole="alert" style={[type.subhead, { color: colors.error }]}>
            No se ha podido actualizar. Desliza hacia abajo para reintentarlo.
          </Text>
        )}

        {project && <ProjectDetails project={project} />}
      </ScrollView>
    </>
  );
}

function ProjectDetails({ project }: { project: Project }) {
  return (
    <View style={{ gap: spacing.xl }}>
      <View style={{ gap: spacing.sm }}>
        <Text style={type.label}>Proyecto</Text>
        <Text selectable style={[type.display, { fontVariant: ["tabular-nums"] }]}>
          {project.ref}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={type.label}>Dirección</Text>
        <Text selectable style={type.title}>
          {project.address}
        </Text>
      </View>

      <View style={{ borderTopWidth: 1, borderColor: colors.inputBorder }}>
        <DateRow label="Inicio de obra" date={project.startDate} />
        <DateRow label="Finalización prevista" date={project.completionDate} />
      </View>
    </View>
  );
}

function DateRow({ label, date }: { label: string; date: string | null }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "center",
        gap: spacing.sm,
        minHeight: 56,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderColor: colors.inputBorder,
      }}
    >
      <Text style={type.subhead}>{label}</Text>
      <Text selectable style={[type.body, !date && { color: colors.muted }]}>
        {date ? formatDate(date) : "Por confirmar"}
      </Text>
    </View>
  );
}
