import Feather from "@react-native-vector-icons/feather";
import { StyleSheet, Text, View } from "react-native";
import { colors, type } from "../constants/theme";
import { formatShortDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

/**
 * The quiet note over data kept on the phone while the network fails: "Sin
 * conexión · datos del 22 sept, 14:05". Nothing when online or without a date.
 */
export function OfflineNote({ offline, updatedAt }: { offline?: boolean; updatedAt?: string }) {
  const { t, language } = useI18n();
  if (!offline || !updatedAt) return null;
  return (
    <View style={styles.row} accessibilityRole="text">
      <Feather name="wifi-off" size={14} color={colors.muted} />
      <Text style={[type.meta, { flexShrink: 1 }]}>
        {t("common.offlineSince", { date: formatShortDateTime(updatedAt, language) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});

/** When the oldest of the parts shown without a connection was loaded; `undefined` when none is offline. */
export function offlineSince(...parts: { offline?: boolean; updatedAt?: string }[]) {
  return parts.flatMap((part) => (part.offline && part.updatedAt ? [part.updatedAt] : [])).sort()[0];
}
