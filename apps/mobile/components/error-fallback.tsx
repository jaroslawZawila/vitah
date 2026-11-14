import type { ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "../constants/theme";
import { I18nProvider, useI18n } from "../lib/i18n";
import { reportError } from "../lib/report-error";
import { Button } from "./button";

/**
 * What the client sees when a screen breaks the whole app (the root layout's
 * `ErrorBoundary`): what happened, calmly, and a way to try again. Nothing
 * technical: the error itself goes to the portal's logs.
 */
export function ErrorFallback({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    void reportError(error, { fatal: true });
  }, [error]);

  return (
    // It stands in for the root layout, providers included: the language is its own to find.
    <I18nProvider>
      <Message onRetry={() => void retry()} />
    </I18nProvider>
  );
}

function Message({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.screen}>
      <Text style={styles.wordmark}>ViTAH</Text>
      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" style={type.title}>
          {t("appError.title")}
        </Text>
        <Text accessibilityRole="alert" style={[type.subhead, { lineHeight: 22 }]}>
          {t("appError.text")}
        </Text>
      </View>
      <Button title={t("common.retry")} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.grafito,
  },
  // The header wordmark of the mockups: 16 / 400, wide tracking.
  wordmark: { fontSize: 16, fontWeight: "400", letterSpacing: 6.4, color: colors.blancoCalido },
});
