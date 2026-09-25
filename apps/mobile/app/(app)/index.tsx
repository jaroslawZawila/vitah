import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../components/button";
import { PhotoImage } from "../../components/photo-image";
import { card, colors, radius, spacing, type } from "../../constants/theme";
import type { Project } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { daysUntil } from "../../lib/dates";
import { formatMediumDate, formatShortDate } from "../../lib/format";
import { useI18n, type MessageKey } from "../../lib/i18n";
import type { PhotoWeek } from "../../lib/photo-weeks";
import { usePhotos } from "../../lib/use-photos";
import { useProject } from "../../lib/use-project";

// Tab "Inicio" — doc/mobile-app-design/A-Home.dc.html. Construction progress
// (the %, the phase bar and "Ver avance detallado") and the notifications
// bell are left out until phases and push exist; Garantía and Contactar say
// they're coming soon.

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
  const loaded = project !== undefined;
  const firstName = user?.name?.split(" ")[0];

  function refreshAll() {
    refresh();
    photos.refresh();
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

      {!loaded && !error && (
        <View style={styles.center}>
          <ActivityIndicator
            color={colors.verdeOliva}
            size="large"
            accessibilityLabel={t("home.loading")}
          />
        </View>
      )}

      {!loaded && error && (
        <View style={[styles.center, { gap: spacing.lg }]}>
          <Text selectable style={[type.body, { textAlign: "center" }]}>
            {t("home.loadFailed")}
          </Text>
          <Button title={t("common.retry")} variant="secondary" onPress={retry} />
        </View>
      )}

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

      {loaded && (error || photos.error) && (
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
  const { t, language } = useI18n();
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

      {days !== null && days >= 0 && (
        <View accessible accessibilityLabel={`${days} ${t("home.daysToDelivery", { count: days })}`}>
          <Text style={styles.hero}>{days}</Text>
          <Text style={styles.heroLabel}>{t("home.daysToDelivery", { count: days })}</Text>
        </View>
      )}

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
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={type.label}>
          {t("home.latestUpdate")}
        </Text>
        <Pressable onPress={openPhotos} accessibilityRole="link" style={styles.link}>
          <Text style={styles.linkText}>{t("home.seePhotos")}</Text>
        </Pressable>
      </View>
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
  center: { flex: 1, justifyContent: "center" },
  wordmark: { fontSize: 16, fontWeight: "400", letterSpacing: 6.4, color: colors.blancoCalido },
  card: { ...card, padding: spacing.lg, gap: 22 },
  ref: { ...type.label, color: colors.verdeOlivaLight },
  hero: { fontSize: 72, fontWeight: "200", lineHeight: 76, color: colors.blancoCalido },
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
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { minHeight: 44, justifyContent: "center" },
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
