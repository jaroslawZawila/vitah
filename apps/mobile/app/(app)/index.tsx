import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { Button } from "../../components/button";
import { colors, spacing, type } from "../../constants/theme";
import type { Project } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useProject } from "../../lib/use-project";

export default function ProjectScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { project, error, refreshing, refresh, retry } = useProject();
  const loaded = project !== undefined;
  const firstName = user?.name?.split(" ")[0];

  return (
    <>
      <Tabs.Screen options={{ title: t("home.title") }} />
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
              accessibilityLabel={t("home.loading")}
            />
          </View>
        )}

        {!loaded && error && (
          <View style={{ flex: 1, justifyContent: "center", gap: spacing.lg }}>
            <Text selectable style={[type.body, { textAlign: "center" }]}>
              {t("home.loadFailed")}
            </Text>
            <Button title={t("common.retry")} variant="secondary" onPress={retry} />
          </View>
        )}

        {loaded && (
          <View style={{ gap: spacing.sm }}>
            <Text style={type.label}>{firstName ? t("home.helloName", { name: firstName }) : t("home.hello")}</Text>
            {project === null && (
              <Text style={type.subhead}>
                {t("home.noProject")}
              </Text>
            )}
          </View>
        )}

        {loaded && error && (
          <Text selectable accessibilityRole="alert" style={[type.subhead, { color: colors.error }]}>
            {t("home.refreshFailed")}
          </Text>
        )}

        {project && <ProjectDetails project={project} />}
      </ScrollView>
    </>
  );
}

function ProjectDetails({ project }: { project: Project }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: spacing.xl }}>
      <View style={{ gap: spacing.sm }}>
        <Text style={type.label}>{t("home.project")}</Text>
        <Text selectable style={[type.display, { fontVariant: ["tabular-nums"] }]}>
          {project.ref}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={type.label}>{t("home.address")}</Text>
        <Text selectable style={type.title}>
          {project.address}
        </Text>
      </View>

      <View style={{ borderTopWidth: 1, borderColor: colors.inputBorder }}>
        <DateRow label={t("home.start")} date={project.startDate} />
        <DateRow label={t("home.completion")} date={project.completionDate} />
      </View>
    </View>
  );
}

function DateRow({ label, date }: { label: string; date: string | null }) {
  const { t, language } = useI18n();
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
        {date ? formatDate(date, language) : t("home.notSet")}
      </Text>
    </View>
  );
}
