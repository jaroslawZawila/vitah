import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../components/button";
import { PushedScreen } from "../components/pushed-screen";
import { colors, spacing, type } from "../constants/theme";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";

// Pushed from the foot of Perfil: what asking for the account to be deleted
// means, and the button that asks. Not in the mockups: drawn like the other
// pushed screens (back link, title, text, the action in the bottom bar).
// Accounts are the builder's, so this only asks; Perfil then shows the request
// and lets the client withdraw it.

const POINTS = ["account.deletion.told", "account.deletion.meanwhile", "account.deletion.kept"] as const;

export default function AccountDeletionScreen() {
  const router = useRouter();
  const { token, signOut } = useAuth();
  const { t } = useI18n();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!token) return <Redirect href="/sign-in" />;

  async function confirm() {
    if (!token) return;
    setSending(true);
    setFailed(false);
    const result = await api.requestDeletion(token);
    setSending(false);
    if (result.ok) router.back();
    else if (result.error === "unauthorized") await signOut();
    else setFailed(true);
  }

  return (
    <PushedScreen
      back={t("tabs.profile")}
      footer={
        <Button
          title={t("account.deletion.confirm")}
          onPress={() => void confirm()}
          loading={sending}
          style={{ flex: 1 }}
        />
      }
    >
      <View style={{ gap: spacing.md }}>
        <Text accessibilityRole="header" style={type.display}>
          {t("account.deletion.title")}
        </Text>
        <Text style={styles.text}>{t("account.deletion.intro")}</Text>
      </View>
      <View style={{ gap: spacing.md }}>
        {POINTS.map((key) => (
          <View key={key} style={styles.point}>
            <View style={styles.dot} />
            <Text style={[styles.text, { flex: 1 }]}>{t(key)}</Text>
          </View>
        ))}
      </View>
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("account.deletion.failed")}
        </Text>
      )}
    </PushedScreen>
  );
}

const styles = StyleSheet.create({
  text: { ...type.subhead, lineHeight: 22 },
  point: { flexDirection: "row", gap: 12 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 9, backgroundColor: colors.verdeOlivaLight },
  error: { color: colors.error, fontSize: 13 },
});
