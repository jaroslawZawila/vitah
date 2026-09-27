import Feather from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MobileObra, MobilePhase } from "@repo/core/contract";
import { LoadState } from "../../../components/load-state";
import { Bar, BigPct, Marker, obraStyles } from "../../../components/obra-parts";
import { card, colors, radius, spacing, type } from "../../../constants/theme";
import {
  formatDayMonth,
  formatMediumDate,
  formatMoney,
  formatMonthYear,
  formatShortMonth,
} from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";
import { currentPhaseIndex, nextPayment, phaseName } from "../../../lib/obra";
import { useObra } from "../../../lib/use-obra";
import { usePhotos } from "../../../lib/use-photos";
import { useProject } from "../../../lib/use-project";

// Tab "Obra" — doc/mobile-app-design/A-Progress.dc.html: everything on one
// screen (no scrolling on a standard phone); a phase opens A-Fase.

export default function ObraScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { project } = useProject();
  const { obra, error, refreshing, refresh, retry } = useObra();
  const photos = usePhotos();
  const loaded = obra !== undefined;

  // The phase screens show the chapters' photos: refresh them too.
  function refreshAll() {
    refresh();
    photos.refresh();
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.grafito }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.lg,
      }}
      refreshControl={
        loaded ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={colors.verdeOliva}
            colors={[colors.verdeOliva]}
          />
        ) : undefined
      }
    >
      <View style={{ gap: 4 }}>
        {project && (
          <Text style={type.label}>
            {[project.ref, project.address.split(",")[0]?.toUpperCase()].filter(Boolean).join(" · ")}
          </Text>
        )}
        <Text accessibilityRole="header" style={[type.display, { fontSize: 28 }]}>
          {t("obra.title")}
        </Text>
      </View>

      <LoadState
        loaded={loaded}
        error={error}
        loadingLabel={t("obra.loading")}
        failedText={t("obra.loadFailed")}
        onRetry={retry}
      />
      {loaded && error && (
        <Text accessibilityRole="alert" style={[type.subhead, styles.gap, { color: colors.error }]}>
          {t("home.refreshFailed")}
        </Text>
      )}
      {obra === null && <Text style={[type.subhead, styles.gap]}>{t("home.noProject")}</Text>}
      {obra?.phases.length === 0 && <Text style={[type.subhead, styles.gap]}>{t("obra.noBudget")}</Text>}
      {obra && obra.phases.length > 0 && <Progress obra={obra} />}
    </ScrollView>
  );
}

function Progress({ obra }: { obra: MobileObra }) {
  const router = useRouter();
  const { t, language } = useI18n();
  const { term } = obra;
  const due = nextPayment(obra);

  return (
    <>
      <View style={styles.hero}>
        <BigPct value={obra.progressPct} size={80} />
        {term && (
          <View style={{ gap: 10 }}>
            <Figure
              label={t("obra.week")}
              value={`${t("obra.weekValue", { week: term.week, total: term.totalWeeks })} · ${
                term.lateDays > 0 ? t("obra.late", { count: term.lateDays }) : t("obra.onTime")
              }`}
            />
            <Figure label={t("obra.delivery")} value={formatMediumDate(term.completionDate, language)} />
          </View>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/obra/pagos")}
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <View style={styles.dot} />
          <Text style={[type.row, { fontSize: 14 }]} numberOfLines={1}>
            {due?.dueOn
              ? t("obra.nextPayment", {
                  amount: formatMoney(due.totalCents, language),
                  date: formatDayMonth(due.dueOn, language),
                })
              : t("obra.payments", { amount: formatMoney(obra.paidCents, language) })}
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.muted} />
      </Pressable>

      <Text accessibilityRole="header" style={[type.label, { marginTop: 18, marginBottom: 6 }]}>
        {t("obra.phases", { current: currentPhaseIndex(obra) + 1, total: obra.phases.length })}
      </Text>
      {obra.phases.map((phase, index) => (
        <PhaseRow
          key={phase.key}
          phase={phase}
          current={phase.key === obra.currentPhaseKey}
          last={index === obra.phases.length - 1}
          completionDate={term?.completionDate ?? null}
          onPress={() => router.push({ pathname: "/obra/fase/[key]", params: { key: phase.key } })}
        />
      ))}
    </>
  );
}

/** A small label over a figure, aligned right. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: "flex-end", gap: 2 }}>
      <Text style={obraStyles.smallLabel}>{label}</Text>
      <Text style={type.body}>{value}</Text>
    </View>
  );
}

function PhaseRow({
  phase,
  current,
  last,
  completionDate,
  onPress,
}: {
  phase: MobilePhase;
  current: boolean;
  last: boolean;
  completionDate: string | null;
  onPress: () => void;
}) {
  const { t, language } = useI18n();
  const name = phaseName(phase, t);
  const done = phase.status === "done";
  // Done: the month it closed. The handover: its date. Otherwise: its %.
  const right = done
    ? phase.finishedOn && formatShortMonth(phase.finishedOn, language)
    : last && completionDate
      ? formatMonthYear(completionDate, language)
      : phase.progressPct > 0
        ? `${phase.progressPct} %`
        : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, right].filter(Boolean).join(", ")}
      accessibilityHint={t("obra.phaseHint")}
      onPress={onPress}
      style={({ pressed }) => [current ? styles.currentRow : styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.rowTop}>
        <Marker state={done ? "done" : current ? "current" : "todo"} last={last} />
        <Text
          style={[type.row, { flex: 1 }, !done && !current && phase.progressPct === 0 && { color: colors.muted }]}
          numberOfLines={1}
        >
          {name}
        </Text>
        {right && <Text style={current ? styles.currentPct : type.meta}>{right}</Text>}
        {current && <Feather name="chevron-right" size={16} color={colors.muted} />}
      </View>
      {current && <Bar pct={phase.progressPct} style={{ marginLeft: 34, marginRight: 30 }} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: spacing.lg },
  hero: { marginTop: 20, height: 90, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: {
    marginTop: 18,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.lg,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.blancoCalido },
  row: { minHeight: 44, justifyContent: "center", borderBottomWidth: 1, borderColor: colors.divider },
  currentRow: {
    ...card,
    borderRadius: radius.lg,
    borderColor: colors.currentBorder,
    marginHorizontal: -12,
    marginVertical: 4,
    paddingHorizontal: 12,
    minHeight: 64,
    justifyContent: "center",
    gap: 9,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  currentPct: { fontSize: 15, color: colors.verdeOlivaLight },
});
