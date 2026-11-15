import Feather from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { warrantyRef, type WarrantyClaimSummary } from "@repo/core/contract";
import { LoadState } from "../../../components/load-state";
import { PushedScreen } from "../../../components/pushed-screen";
import { colors, spacing, type } from "../../../constants/theme";
import { api } from "../../../lib/api";
import { formatShortDate } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";
import { useProjectData } from "../../../lib/use-project";
import { useReloadWithHome } from "../../../lib/warranty";

// Mis solicitudes (A-Warranty's top link): the client's warranty claims for the
// home shown, newest first, with their status and the builder's last answer.

const getWarranty = (token: string, projectId: string | null) => api.getWarranty(token, projectId);

export default function WarrantyClaimsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { data, error, retry, reload } = useProjectData(getWarranty);
  useReloadWithHome(reload);
  const claims = data?.warranty?.claims;

  return (
    <PushedScreen back={t("warranty.claims.back")}>
      <Text accessibilityRole="header" style={type.display}>
        {t("warranty.claims.title")}
      </Text>
      <LoadState
        loaded={data !== undefined}
        error={error}
        loadingLabel={t("warranty.loading")}
        failedText={t("warranty.loadFailed")}
        onRetry={retry}
      />
      {data !== undefined &&
        (!claims?.length ? (
          <Text style={type.subhead}>{t("warranty.claims.empty")}</Text>
        ) : (
          <View>
            {claims.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} onPress={() => router.push(`/warranty/${claim.id}`)} />
            ))}
          </View>
        ))}
    </PushedScreen>
  );
}

/** One claim: its number and kind, status and day, and the builder's last answer. */
function ClaimRow({ claim, onPress }: { claim: WarrantyClaimSummary; onPress: () => void }) {
  const { t, language } = useI18n();
  // A status from a newer server reads as nothing rather than as a wrong one.
  const status = t(`warranty.status.${claim.status}`, undefined, "");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={type.row}>
          {warrantyRef(claim.number)} · {t(`warranty.kind.${claim.kind}`, undefined, "")}
        </Text>
        <Text style={type.meta}>
          {[status, t("warranty.claims.sentOn", { date: formatShortDate(claim.createdAt, language) }), claim.urgent && t("warranty.claims.urgent")]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {claim.answer && (
          <Text style={[type.meta, { color: colors.blancoCalido }]} numberOfLines={2}>
            {t("warranty.claims.answer", { text: claim.answer })}
          </Text>
        )}
      </View>
      <Feather name="chevron-right" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 68,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
});
