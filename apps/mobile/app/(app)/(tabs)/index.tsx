import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LoadState } from "../../../components/load-state";
import { BigPct, SectionHeader, SegmentedBar } from "../../../components/obra-parts";
import { PhotoImage } from "../../../components/photo-image";
import { card, colors, radius, spacing, type } from "../../../constants/theme";
import type { MobileObra } from "@repo/core/contract";
import type { Project } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { daysUntil } from "../../../lib/dates";
import { formatMediumDate, formatShortDate } from "../../../lib/format";
import { useI18n, type MessageKey } from "../../../lib/i18n";
import { currentPhaseIndex, phaseName } from "../../../lib/obra";
import type { PhotoWeek } from "../../../lib/photo-weeks";
import { useObra } from "../../../lib/use-obra";
import { usePhotos } from "../../../lib/use-photos";
import { useProject } from "../../../lib/use-project";

// Tab "Inicio" — doc/mobile-app-design/A-Home.dc.html. The notifications
// bell is left out until push is on; Garantía and Contactar say they're
// coming soon.

/** "Buenos días" until noon, "Buenas tardes" until 8 pm, then "Buenas noches". */
export function greetingKey(hour: number): MessageKey {
  if (hour < 12) return "home.greeting.morning";
  if (hour < 20) return "home.greeting.afternoon";
  return "home.greeting.evening";
}

/** "Ana, tu casa avanza." with a project; "Hola, Ana" while there is none. */
function headline(t: ReturnType<typeof useI18n>["t"], hasProject: boolean, name?: string) {
  if (hasProject) return name ? t("home.headline", { name }) : t("home.headlineNoName");
  return name ? t("home.helloName", { name }) : t("home.hello");
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useI18n();
  const { project, error, refreshing, refresh, retry } = useProject();
  const photos = usePhotos();
  const obra = useObra();
  const loaded = project !== undefined;
  const firstName = user?.name?.split(" ")[0];

  function refreshAll() {
    refresh();
    photos.refresh();
    obra.refresh();
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.grafito }}
      contentContainerStyle={{
        flexGrow: 1,
        gap: 28,
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xl,
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
      <Text style={styles.wordmark}>ViTAH</Text>

      <LoadState
        loaded={loaded}
        error={error}
        loadingLabel={t("home.loading")}
        failedText={t("home.loadFailed")}
        onRetry={retry}
      />

      {loaded && (
        <View style={{ gap: 6 }}>
          <Text style={type.label}>{t(greetingKey(new Date().getHours()))}</Text>
          <Text accessibilityRole="header" style={[type.display, { lineHeight: 34 }]}>
            {headline(t, !!project, firstName)}
          </Text>
          {project === null && (
            <Text style={[type.subhead, { marginTop: spacing.sm }]}>{t("home.noProject")}</Text>
          )}
        </View>
      )}

      {loaded && (error || photos.error || obra.error) && (
        <Text selectable accessibilityRole="alert" style={[type.subhead, { color: colors.error }]}>
          {t("home.refreshFailed")}
        </Text>
      )}

      {project && <ProjectCard project={project} />}
      {project && <LatestUpdate weeks={photos.weeks} />}
      {project && <Shortcuts />}
    </ScrollView>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const router = useRouter();
  const { t, language } = useI18n();
  const { obra } = useObra();
  // The construction progress, once the obra has phases.
  const progress = obra?.phases.length ? obra : null;
  const days = project.completionDate ? daysUntil(project.completionDate) : null;
  const date = (value: string | null) => (value ? formatMediumDate(value, language) : t("home.notSet"));

  return (
    <View style={styles.card}>
      <View style={{ gap: 6 }}>
        <Text selectable style={styles.ref}>
          {project.ref}
        </Text>
        <Text selectable style={[type.row, { lineHeight: 21 }]}>
          {project.address}
        </Text>
      </View>

      <View style={styles.heroRow}>
        {progress && <BigPct value={progress.progressPct} />}
        {days !== null && days >= 0 && (
          <View
            accessible
            accessibilityLabel={`${days} ${t("home.daysToDelivery", { count: days })}`}
            style={progress ? styles.daysAside : undefined}
          >
            <Text style={progress ? styles.daysSmall : styles.hero}>{days}</Text>
            <Text style={styles.heroLabel}>{t("home.daysToDelivery", { count: days })}</Text>
          </View>
        )}
      </View>

      {progress && <PhaseBar obra={progress} />}

      <View style={styles.dates}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.dateLabel}>{t("home.start")}</Text>
          <Text style={styles.dateValue}>{date(project.startDate)}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.dateLabel}>{t("home.delivery")}</Text>
          <Text style={styles.dateValue}>{date(project.completionDate)}</Text>
        </View>
      </View>

      {progress && (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.navigate("/obra")}
          style={({ pressed }) => [styles.progressLink, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.linkText, { fontSize: 14 }]}>{t("home.seeProgress")}</Text>
          <Feather name="chevron-right" size={18} color={colors.verdeOlivaLight} />
        </Pressable>
      )}
    </View>
  );
}

/** One segment per phase (done filled, the current one to its %), and which phase it is. */
function PhaseBar({ obra }: { obra: MobileObra }) {
  const { t } = useI18n();
  const current = currentPhaseIndex(obra);
  return (
    <View style={{ gap: 10 }}>
      <SegmentedBar
        fills={obra.phases.map((p) => ({
          key: p.key,
          pct: p.status === "done" ? 100 : p.key === obra.currentPhaseKey ? p.progressPct : 0,
        }))}
      />
      <Text style={[type.row, { fontSize: 13 }]}>
        {t("home.progress", {
          current: current + 1,
          total: obra.phases.length,
          name: phaseName(obra.phases[current]!, t),
        })}
      </Text>
    </View>
  );
}

/** The newest week of photos: its first photo, with the week's count. */
function LatestUpdate({ weeks }: { weeks: PhotoWeek[] }) {
  const router = useRouter();
  const { t, language } = useI18n();
  const week = weeks[0];
  const latest = week?.photos[0];
  if (!week || !latest) return null;

  const openPhotos = () => router.navigate("/photos");
  return (
    <View style={{ gap: 14 }}>
      <SectionHeader label={t("home.latestUpdate")} link={t("home.seePhotos")} onPress={openPhotos} />
      <Pressable
        onPress={openPhotos}
        accessibilityRole="button"
        style={({ pressed }) => [styles.updateCard, pressed && { opacity: 0.7 }]}
      >
        <PhotoImage photo={latest} size="thumb" style={{ height: 180 }} />
        <View style={{ paddingHorizontal: 18, paddingVertical: spacing.md, gap: 4 }}>
          <Text style={type.row}>
            {latest.caption ?? t("home.newPhotos")}
          </Text>
          <Text style={[type.subhead, { fontSize: 13 }]}>
            {`${formatShortDate(latest.uploadedAt, language)} · ${t("home.photoCount", { count: week.photos.length })}`}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

type Shortcut = {
  label: MessageKey;
  icon: keyof typeof Feather.glyphMap;
  /** A tab, or nothing yet ("Próximamente"). */
  href?: "/documents" | "/profile";
};

const SHORTCUTS: Shortcut[] = [
  { label: "tabs.documents", icon: "file-text", href: "/documents" },
  { label: "home.warranty", icon: "shield" },
  { label: "home.contact", icon: "message-circle" },
  { label: "home.settings", icon: "settings", href: "/profile" },
];

function Shortcuts() {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <View style={styles.shortcuts}>
      {SHORTCUTS.map(({ label, icon, href }) => (
        <Pressable
          key={label}
          onPress={() =>
            href ? router.navigate(href) : Alert.alert(t("home.comingSoon"), t("home.comingSoonText"))
          }
          accessibilityRole="button"
          accessibilityLabel={t(label)}
          style={({ pressed }) => [styles.shortcut, pressed && { opacity: 0.6 }]}
        >
          <Feather name={icon} size={22} color={colors.blancoCalido} />
          <Text style={[type.row, { fontSize: 14 }]}>{t(label)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { fontSize: 16, fontWeight: "400", letterSpacing: 6.4, color: colors.blancoCalido },
  card: { ...card, padding: spacing.lg, gap: 22 },
  ref: { ...type.label, color: colors.verdeOlivaLight },
  heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  hero: { fontSize: 72, fontWeight: "200", lineHeight: 76, color: colors.blancoCalido },
  daysAside: { alignItems: "flex-end", gap: 4, paddingBottom: 6 },
  daysSmall: { fontSize: 26, fontWeight: "300", color: colors.blancoCalido },
  progressLink: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderColor: colors.surfaceBorder,
    marginTop: -6,
  },
  heroLabel: { ...type.label, letterSpacing: 1.8 },
  dates: {
    flexDirection: "row",
    gap: 12,
    borderTopWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingTop: 18,
  },
  dateLabel: { ...type.label, fontSize: 10, letterSpacing: 2 },
  dateValue: type.row,
  linkText: { fontSize: 13, color: colors.verdeOlivaLight },
  updateCard: { ...card, overflow: "hidden" },
  shortcuts: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  shortcut: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 92,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.lg,
    justifyContent: "space-between",
  },
});
