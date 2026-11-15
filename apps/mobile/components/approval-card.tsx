import Feather from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { card, colors, type } from "../constants/theme";
import { signedMoney } from "../lib/approval";
import { useI18n } from "../lib/i18n";
import { useApproval } from "../lib/use-approval";

/**
 * Inicio: a change to the contract waiting for the client's answer, below the
 * project card (nothing when there is none). Opens the approval screen.
 */
export function ApprovalCard() {
  const router = useRouter();
  const { t, language } = useI18n();
  const { approval } = useApproval();
  if (!approval) return null;

  const label = t("approval.cardLabel", { number: approval.revisionNumber });
  const title = approval.changeReason ?? t("approval.cardTitle");
  return (
    <Pressable
      onPress={() => router.push("/aprobacion")}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${title}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[type.row, { fontSize: 16, lineHeight: 22 }]}>{title}</Text>
        <Text style={type.meta}>
          {t("approval.cardDifference", { amount: signedMoney(approval.differenceCents, language) })}
        </Text>
        <Text style={styles.link}>{t("approval.cardOpen")}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.verdeOlivaLight} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // An action waiting: the current phase's border, as on the Obra tab.
  card: { ...card, borderColor: colors.verdeOliva, padding: 22, flexDirection: "row", alignItems: "center", gap: 12 },
  label: { ...type.label, fontSize: 10, letterSpacing: 2, color: colors.verdeOlivaLight },
  link: { fontSize: 14, color: colors.verdeOlivaLight, marginTop: 2 },
});
