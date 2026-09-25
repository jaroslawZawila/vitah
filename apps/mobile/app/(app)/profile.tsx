import Feather from "@expo/vector-icons/Feather";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLanguage } from "@repo/core/contract";
import { NotificationSettings } from "../../components/notification-settings";
import { ToggleRow, styles as rowStyles } from "../../components/toggle-row";
import { colors, spacing, type } from "../../constants/theme";
import { useAppLock } from "../../lib/app-lock";
import { useAuth } from "../../lib/auth";
import { PUSH_NOTIFICATIONS } from "../../lib/features";
import { useI18n } from "../../lib/i18n";

// Tab "Perfil" — doc/mobile-app-design/A-Settings.dc.html. Help and privacy
// links are left out until those pages exist; notifications until push is
// set up (PUSH_NOTIFICATIONS in lib/features.ts).

const LANGUAGES: { id: AppLanguage; label: string }[] = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token, signOut } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const lock = useAppLock();
  const displayName = user?.name || user?.email || "";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.grafito }}
      contentContainerStyle={{
        gap: 26,
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xl,
      }}
    >
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.initial}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text accessibilityRole="header" style={type.title} numberOfLines={2}>
            {displayName}
          </Text>
          {user?.name ? <Text style={[type.subhead, { fontSize: 14 }]}>{user.email}</Text> : null}
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <Text style={type.label}>{t("profile.language")}</Text>
        <View style={styles.segmented} accessibilityRole="radiogroup">
          {LANGUAGES.map((option) => {
            const selected = option.id === language;
            return (
              <Pressable
                key={option.id}
                onPress={() => setLanguage(option.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, selected && { color: colors.grafito }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <Text style={[type.label, styles.sectionLabel]}>{t("profile.account")}</Text>
        <Pressable
          onPress={() => router.push("/password")}
          accessibilityRole="button"
          style={({ pressed }) => [rowStyles.row, pressed && { opacity: 0.6 }]}
        >
          <Feather name="lock" size={20} color={colors.muted} />
          <Text style={styles.rowText}>{t("profile.changePassword")}</Text>
          <Feather name="chevron-right" size={18} color={colors.muted} />
        </Pressable>
        {lock.available && (
          <ToggleRow
            icon="smile"
            label={t("profile.biometricLock", { method: t(`biometrics.${lock.method}`) })}
            value={lock.enabled}
            onChange={(on) => void lock.setEnabled(on)}
          />
        )}
      </View>

      {PUSH_NOTIFICATIONS && token && <NotificationSettings token={token} />}

      <Pressable
        onPress={() => void signOut()}
        accessibilityRole="button"
        style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.signOutText}>{t("profile.signOut")}</Text>
      </Pressable>

      <Text style={styles.version}>
        {t("profile.version", { version: Constants.expoConfig?.version ?? "" })}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontSize: 22, fontWeight: "300", color: colors.blancoCalido },
  sectionLabel: { marginBottom: 6 },
  segmented: {
    flexDirection: "row",
    padding: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 10,
  },
  segment: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  segmentSelected: { backgroundColor: colors.blancoCalido },
  segmentText: { fontSize: 15, color: colors.blancoCalido },
  rowText: { flex: 1, fontSize: 15, color: colors.blancoCalido },
  signOut: { minHeight: 52, justifyContent: "center" },
  signOutText: { fontSize: 15, color: colors.destructive },
  version: { textAlign: "center", fontSize: 10, letterSpacing: 3, color: colors.faint },
});
