import Feather from "@expo/vector-icons/Feather";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLanguage, NotificationPrefs } from "@repo/core/contract";
import { colors, spacing, type } from "../../constants/theme";
import { api } from "../../lib/api";
import { useAppLock } from "../../lib/app-lock";
import { useAuth } from "../../lib/auth";
import { useI18n, type MessageKey } from "../../lib/i18n";
import { notificationsAllowed, registerForPush } from "../../lib/push";
import { useClientData } from "../../lib/use-client-data";

// Tab "Perfil" — doc/mobile-app-design/A-Settings.dc.html. Help and privacy
// links are left out until those pages exist.

const LANGUAGES: { id: AppLanguage; label: string }[] = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];

const NOTIFICATIONS: { id: keyof NotificationPrefs; label: MessageKey; hint: MessageKey }[] = [
  { id: "progress", label: "profile.progress", hint: "profile.progressHint" },
  { id: "documents", label: "profile.documents", hint: "profile.documentsHint" },
  { id: "messages", label: "profile.messages", hint: "profile.messagesHint" },
];

const getSettings = (token: string) => api.getSettings(token);

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
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
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

      {token && <Notifications token={token} />}

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

/** The three notification toggles, saved to the server as they change. */
function Notifications({ token }: { token: string }) {
  const { t, language } = useI18n();
  const { data: saved } = useClientData(getSettings);
  // What the client last set here, else what the server has.
  const [edited, setEdited] = useState<NotificationPrefs>();
  const prefs = edited ?? saved?.notifications;
  const [failed, setFailed] = useState(false);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    void notificationsAllowed().then(setAllowed).catch(() => {});
  }, []);

  async function toggle(id: keyof NotificationPrefs, on: boolean) {
    if (!prefs) return;
    // Only this switch: another may be saving at the same time.
    const set = (value: boolean) =>
      setEdited((current) => ({ ...(current ?? prefs), [id]: value }));
    set(on);
    setFailed(false);
    // Turning one on is the moment to ask for permission, if never asked.
    if (on && !allowed) {
      setAllowed((await registerForPush(token, language, { ask: true })) === "registered");
    }
    const result = await api.updateSettings(token, { [id]: on });
    set(result.ok ? result.data.notifications[id] : !on);
    if (!result.ok) setFailed(true);
  }

  return (
    <View>
      <Text style={[type.label, styles.sectionLabel]}>{t("profile.notifications")}</Text>
      {!allowed && (
        <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
          <Text style={[type.subhead, { fontSize: 13 }]}>{t("profile.notificationsOff")}</Text>
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link">
            <Text style={styles.link}>{t("profile.openSettings")}</Text>
          </Pressable>
        </View>
      )}
      {NOTIFICATIONS.map((item) => (
        <ToggleRow
          key={item.id}
          label={t(item.label)}
          hint={t(item.hint)}
          value={prefs?.[item.id] ?? false}
          disabled={!prefs}
          onChange={(on) => void toggle(item.id, on)}
        />
      ))}
      {failed && (
        <Text accessibilityRole="alert" style={[type.subhead, styles.error]}>
          {t("profile.saveFailed")}
        </Text>
      )}
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  value,
  disabled = false,
  onChange,
}: {
  icon?: keyof typeof Feather.glyphMap;
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={[styles.row, hint ? { minHeight: 60 } : null]}>
      {icon && <Feather name={icon} size={20} color={colors.muted} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, color: colors.blancoCalido }}>{label}</Text>
        {hint && <Text style={[type.subhead, { fontSize: 13 }]}>{hint}</Text>}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.chipBorder, true: colors.verdeOliva }}
        thumbColor={value ? "#f5f4f0" : colors.muted}
        ios_backgroundColor={colors.chipBorder}
      />
    </View>
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
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
  rowText: { flex: 1, fontSize: 15, color: colors.blancoCalido },
  link: { fontSize: 15, color: colors.verdeOlivaLight },
  error: { color: colors.error, fontSize: 13, paddingTop: spacing.sm },
  signOut: { minHeight: 52, justifyContent: "center" },
  signOutText: { fontSize: 15, color: colors.destructive },
  version: { textAlign: "center", fontSize: 10, letterSpacing: 3, color: colors.faint },
});
