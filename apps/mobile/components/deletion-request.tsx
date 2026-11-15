import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { AppLanguage } from "@repo/core/contract";
import { colors, spacing, type } from "../constants/theme";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { spanishDayUtc } from "../lib/dates";
import { formatMediumDate } from "../lib/format";
import { useI18n } from "../lib/i18n";

/** The day (in Spain) of an ISO moment, as "12 nov 2026". */
const dayOf = (iso: string, language: AppLanguage) =>
  formatMediumDate(new Date(spanishDayUtc(new Date(iso))).toISOString().slice(0, 10), language);

/**
 * The foot of Perfil: a quiet row to ask for the account to be deleted
 * (../app/account-deletion.tsx), or, once asked, since when, and a way to
 * withdraw it. `requestedAt` is what the server says; `onChanged` loads it again.
 */
export function DeletionRequestFoot({
  requestedAt,
  onChanged,
}: {
  requestedAt: string | null;
  onChanged: () => Promise<unknown>;
}) {
  const router = useRouter();
  const { token, signOut } = useAuth();
  const { t, language } = useI18n();
  const [withdrawing, setWithdrawing] = useState(false);
  const [failed, setFailed] = useState(false);

  async function withdraw() {
    if (!token) return;
    setWithdrawing(true);
    setFailed(false);
    const result = await api.withdrawDeletion(token);
    if (result.ok) await onChanged();
    else if (result.error === "unauthorized") await signOut();
    else setFailed(true);
    setWithdrawing(false);
  }

  if (!requestedAt) {
    return (
      <Pressable
        onPress={() => router.push("/account-deletion")}
        accessibilityRole="button"
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.quiet}>{t("account.deletion.row")}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ gap: 3 }}>
        <Text style={type.row}>{t("account.deletion.requested", { date: dayOf(requestedAt, language) })}</Text>
        <Text style={type.meta}>{t("account.deletion.requestedHint")}</Text>
      </View>
      <Pressable
        onPress={() => void withdraw()}
        disabled={withdrawing}
        accessibilityRole="button"
        accessibilityState={{ busy: withdrawing }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      >
        {withdrawing ? (
          <ActivityIndicator color={colors.verdeOlivaLight} />
        ) : (
          <Text style={styles.link}>{t("account.deletion.withdraw")}</Text>
        )}
      </Pressable>
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("account.deletion.withdrawFailed")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, justifyContent: "center", alignItems: "flex-start" },
  quiet: { fontSize: 14, color: colors.muted },
  link: { fontSize: 15, color: colors.verdeOlivaLight },
  error: { color: colors.error, fontSize: 13 },
});
