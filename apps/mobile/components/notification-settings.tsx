import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { NotificationPrefs } from "@repo/core/contract";
import { colors, spacing, type } from "../constants/theme";
import { api } from "../lib/api";
import { useI18n, type MessageKey } from "../lib/i18n";
import { notificationsAllowed, registerForPush } from "../lib/push";
import { useClientData } from "../lib/use-client-data";
import { ToggleRow } from "./toggle-row";

// Perfil's "Notificaciones" section (A-Settings.dc.html). Shown only when
// PUSH_NOTIFICATIONS (lib/features.ts) is on.

const NOTIFICATIONS: { id: keyof NotificationPrefs; label: MessageKey; hint: MessageKey }[] = [
  { id: "progress", label: "profile.progress", hint: "profile.progressHint" },
  { id: "documents", label: "profile.documents", hint: "profile.documentsHint" },
  { id: "messages", label: "profile.messages", hint: "profile.messagesHint" },
];

const getSettings = (token: string) => api.getSettings(token);

/** The three notification toggles, saved to the server as they change. */
export function NotificationSettings({ token }: { token: string }) {
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
      <Text style={[type.label, { marginBottom: 6 }]}>{t("profile.notifications")}</Text>
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

const styles = StyleSheet.create({
  link: { fontSize: 15, color: colors.verdeOlivaLight },
  error: { color: colors.error, fontSize: 13, paddingTop: spacing.sm },
});
