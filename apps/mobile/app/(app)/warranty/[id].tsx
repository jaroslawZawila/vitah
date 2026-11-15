import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  canCancelClaim,
  warrantyRef,
  type MobileWarrantyClaim,
  type MobileWarrantyEvent,
} from "@repo/core/contract";
import { Button } from "../../../components/button";
import { LoadState } from "../../../components/load-state";
import { SectionLabel } from "../../../components/obra-parts";
import { PushedScreen } from "../../../components/pushed-screen";
import { card, colors, radius, type } from "../../../constants/theme";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { formatMediumDate, formatShortDate } from "../../../lib/format";
import { useI18n, type Translate } from "../../../lib/i18n";
import { useClientData } from "../../../lib/use-client-data";
import { useReloadWithHome } from "../../../lib/warranty";

// One warranty claim (from Mis solicitudes, or a push about it): its status,
// the visit day and the builder's answer, what the client sent, and its
// history. The client may cancel it while nobody has started on it.

export default function WarrantyClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, signOut } = useAuth();
  const { t, language } = useI18n();
  const fetch = useCallback((token: string) => api.getWarrantyClaim(token, id), [id]);
  const { data: claim, error, retry, reload } = useClientData(fetch);
  useReloadWithHome(reload);
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    if (!token) return;
    setCancelling(true);
    const result = await api.cancelWarrantyClaim(token, id);
    setCancelling(false);
    if (result.ok) return void reload();
    if (result.error === "unauthorized") return void (await signOut());
    Alert.alert(t(result.error === "claim_closed" ? "warranty.claim.claimClosed" : "warranty.claim.cancelFailed"));
    if (result.error === "claim_closed") void reload();
  }

  function askCancel() {
    Alert.alert(t("warranty.claim.cancelTitle"), t("warranty.claim.cancelText"), [
      { text: t("warranty.claim.keep"), style: "cancel" },
      { text: t("warranty.claim.cancelConfirm"), style: "destructive", onPress: () => void cancel() },
    ]);
  }

  return (
    <PushedScreen
      back={t("warranty.claim.back")}
      footer={
        claim &&
        canCancelClaim(claim.status) && (
          <View style={{ flex: 1 }}>
            <Button title={t("warranty.claim.cancel")} variant="secondary" onPress={askCancel} loading={cancelling} />
          </View>
        )
      }
    >
      <LoadState
        loaded={claim !== undefined}
        // A claim that isn't theirs (or no longer is) fails like a lost connection: one message, with a retry.
        error={error}
        loadingLabel={t("warranty.claim.loading")}
        failedText={t("warranty.claim.loadFailed")}
        onRetry={retry}
      />
      {claim && (
        <>
          <View style={{ gap: 8 }}>
            <Text style={type.label}>
              {t("warranty.claim.label", { ref: warrantyRef(claim.number), date: formatShortDate(claim.createdAt, language) })}
            </Text>
            <Text accessibilityRole="header" style={[type.display, { lineHeight: 36 }]}>
              {t(`warranty.kind.${claim.kind}`, undefined, "")} · {t(`warranty.room.${claim.room}`, undefined, "")}
            </Text>
            <View style={styles.pills}>
              {!!t(`warranty.status.${claim.status}`, undefined, "") && (
                <Text style={styles.pill}>{t(`warranty.status.${claim.status}`, undefined, "")}</Text>
              )}
              {claim.urgent && <Text style={[styles.pill, styles.urgent]}>{t("warranty.claim.urgent")}</Text>}
            </View>
          </View>

          {(claim.visitOn || claim.answer) && (
            <View style={styles.answer}>
              {claim.visitOn && (
                <View style={{ gap: 6 }}>
                  <SectionLabel>{t("warranty.claim.visit")}</SectionLabel>
                  <Text style={styles.visit}>{formatMediumDate(claim.visitOn, language)}</Text>
                </View>
              )}
              {claim.answer && (
                <View style={{ gap: 6 }}>
                  <SectionLabel>{t("warranty.claim.answer")}</SectionLabel>
                  <Text selectable style={[type.row, { lineHeight: 22 }]}>
                    {claim.answer}
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={{ gap: 10 }}>
            <SectionLabel>{t("warranty.claim.description")}</SectionLabel>
            <Text selectable style={[type.row, { lineHeight: 22 }]}>
              {claim.description}
            </Text>
          </View>

          {claim.photoIds.length > 0 && (
            <View style={{ gap: 10 }}>
              <SectionLabel>{t("warranty.claim.photos")}</SectionLabel>
              <View style={styles.photos}>
                {claim.photoIds.map((photoId) => (
                  <Image
                    key={photoId}
                    source={{ uri: api.warrantyPhotoUrl(claim.id, photoId, "thumb"), headers: { Authorization: `Bearer ${token}` } }}
                    cachePolicy="disk"
                    contentFit="cover"
                    style={styles.photo}
                    accessibilityIgnoresInvertColors
                  />
                ))}
              </View>
            </View>
          )}

          <History claim={claim} />
        </>
      )}
    </PushedScreen>
  );
}

/** One step in words: what happened and who did it, the client or ViTAH; unknown steps are left out. */
function eventText(t: Translate, event: MobileWarrantyEvent, language: "es" | "en") {
  if (event.action !== "updated") return t(`warranty.claim.event.${event.action}`, undefined, "");
  const { status, visitOn, answered } = event.detail;
  return [
    status && t(`warranty.status.${status.to}`, undefined, ""),
    visitOn &&
      (visitOn.to
        ? t("warranty.claim.event.visit", { date: formatMediumDate(visitOn.to, language) })
        : t("warranty.claim.event.visitCleared")),
    answered && t("warranty.claim.event.answer"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function History({ claim }: { claim: MobileWarrantyClaim }) {
  const { t, language } = useI18n();
  const steps = [...claim.events]
    .reverse()
    .map((event) => ({ event, text: eventText(t, event, language) }))
    .filter(({ text }) => text);
  return (
    <View style={{ gap: 4 }}>
      <SectionLabel>{t("warranty.claim.history")}</SectionLabel>
      {steps.map(({ event, text }) => (
        <View key={event.id} style={styles.step}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.row}>{text}</Text>
            <Text style={type.meta}>{event.byClient ? t("warranty.claim.byYou") : t("warranty.claim.byBuilder")}</Text>
          </View>
          <Text style={type.meta}>{formatShortDate(event.at, language)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  pill: {
    fontSize: 13,
    color: colors.blancoCalido,
    borderWidth: 1,
    borderColor: colors.blancoCalido,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  urgent: { color: colors.destructive, borderColor: colors.destructive },
  answer: { ...card, paddingHorizontal: 24, paddingVertical: 22, gap: 18 },
  visit: { fontSize: 22, fontWeight: "300", color: colors.blancoCalido },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photo: { width: "32%", aspectRatio: 1, borderRadius: radius.md },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
});
