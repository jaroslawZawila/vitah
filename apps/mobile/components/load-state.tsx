import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "../constants/theme";
import { useI18n } from "../lib/i18n";
import { Button } from "./button";

/**
 * Before a tab's first load: a spinner, or (once it failed) what went wrong
 * with a retry. Nothing once `loaded`.
 */
export function LoadState({
  loaded,
  error,
  loadingLabel,
  failedText,
  onRetry,
}: {
  loaded: boolean;
  error: boolean;
  loadingLabel: string;
  failedText: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (loaded) return null;
  return error ? (
    <View style={[styles.center, { gap: spacing.lg }]}>
      <Text selectable style={[type.body, { textAlign: "center" }]}>
        {failedText}
      </Text>
      <Button title={t("common.retry")} variant="secondary" onPress={onRetry} />
    </View>
  ) : (
    <View style={styles.center}>
      <ActivityIndicator color={colors.verdeOliva} size="large" accessibilityLabel={loadingLabel} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center" },
});
