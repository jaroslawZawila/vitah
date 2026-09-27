import Feather from "@expo/vector-icons/Feather";
import { useLocalSearchParams } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { HitoFileKind } from "@repo/core/contract";
import { Button } from "../../../../components/button";
import { CheckMark, SectionLabel, obraStyles } from "../../../../components/obra-parts";
import { PhotoImage } from "../../../../components/photo-image";
import { PushedScreen } from "../../../../components/pushed-screen";
import { card, colors, radius, type } from "../../../../constants/theme";
import { useAuth } from "../../../../lib/auth";
import { formatMediumDate, formatMoney, formatShare } from "../../../../lib/format";
import { openHitoFile } from "../../../../lib/hito-files";
import { useI18n } from "../../../../lib/i18n";
import { useObra } from "../../../../lib/use-obra";
import { usePhotos } from "../../../../lib/use-photos";

// A payment hito — doc/mobile-app-design/A-Hito.dc.html: amount with VAT, due
// date, what it covers, the acta's photos, and the signed acta and invoice
// (read-only: the acta is signed on paper, PROCESS.md §8.4).

export default function PagoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const { t, language } = useI18n();
  const { obra } = useObra();
  const { byId } = usePhotos();
  const hito = obra?.hitos.find((h) => h.id === id);

  if (!obra || !hito) {
    return (
      <PushedScreen back={t("pago.back")}>
        {obra !== undefined && <Text style={type.subhead}>{t("pago.notFound")}</Text>}
      </PushedScreen>
    );
  }

  const open = async (kind: HitoFileKind) => {
    if (!token) return;
    try {
      await openHitoFile(token, hito.id, kind);
    } catch {
      Alert.alert(t("pago.openFailed"));
    }
  };

  const actaPhotos = hito.photoIds.flatMap((photoId) => byId.get(photoId) ?? []);
  const status =
    hito.status === "paid" && hito.paidOn
      ? t("pago.paid", { date: formatMediumDate(hito.paidOn, language) })
      : hito.dueOn
        ? t("pago.due", { date: formatMediumDate(hito.dueOn, language) })
        : t(`hitoStatus.${hito.status}`);
  const documents = [
    hito.actaSignedOn && { kind: "acta" as const, name: t("pago.actaFile", { code: hito.code }), date: hito.actaSignedOn },
    hito.invoicedOn && { kind: "invoice" as const, name: t("pago.invoiceFile", { code: hito.code }), date: hito.invoicedOn },
  ].filter((doc) => !!doc);

  return (
    <PushedScreen
      back={t("pago.back")}
      footer={
        <>
          <View style={{ flex: 1 }}>
            <Button
              title={t("pago.contact")}
              variant="secondary"
              onPress={() => Alert.alert(t("home.comingSoon"), t("home.comingSoonText"))}
            />
          </View>
          {hito.invoicedOn && (
            <View style={{ flex: 1 }}>
              <Button title={t("pago.seeInvoice")} onPress={() => void open("invoice")} />
            </View>
          )}
        </>
      }
    >
      <View style={{ gap: 8 }}>
        <Text style={type.label}>
          {t("pago.label", { code: hito.code, pct: formatShare(hito.pctBp, language) })}
        </Text>
        <Text accessibilityRole="header" style={[type.display, { lineHeight: 34 }]}>
          {hito.name}
        </Text>
        <Text style={styles.pill}>{status}</Text>
      </View>

      <View style={styles.amounts}>
        <View style={obraStyles.between}>
          <Text style={type.meta}>{t("pago.amount")}</Text>
          <Text style={type.row}>{formatMoney(hito.amountCents, language)}</Text>
        </View>
        <View style={obraStyles.between}>
          <Text style={type.meta}>{t("pago.vat", { rate: formatShare(obra.vatRateBp, language) })}</Text>
          <Text style={type.row}>{formatMoney(hito.vatCents, language)}</Text>
        </View>
        <View style={[obraStyles.between, styles.total]}>
          <Text style={type.label}>{t("pago.total")}</Text>
          <Text style={styles.totalAmount}>{formatMoney(hito.totalCents, language)}</Text>
        </View>
        {hito.paidOn && hito.paidAmountCents !== null ? (
          <View style={obraStyles.between}>
            <Text style={type.meta}>{t("pagos.paidOn", { date: formatMediumDate(hito.paidOn, language) })}</Text>
            <Text style={[type.row, { color: colors.verdeOlivaLight }]}>
              {formatMoney(hito.paidAmountCents, language)}
            </Text>
          </View>
        ) : (
          <Text style={type.meta}>{t("pago.transfer")}</Text>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>{t("pago.includes")}</SectionLabel>
        <Text style={[type.row, { lineHeight: 22 }]}>{hito.scope}</Text>
        {hito.chapters.map((chapter) => (
          <View key={chapter.code} style={obraStyles.checkRow}>
            <Text style={[type.row, { flex: 1 }]}>
              <Text style={{ color: colors.muted }}>{chapter.code}</Text> {chapter.name}
            </Text>
            {chapter.progressPct === 100 ? (
              <CheckMark done />
            ) : (
              <Text style={type.meta}>{chapter.progressPct} %</Text>
            )}
          </View>
        ))}
      </View>

      {(actaPhotos.length > 0 || hito.actaSignedOn) && (
        <View style={{ gap: 12 }}>
          <View style={obraStyles.between}>
            <SectionLabel>{t("pago.acta")}</SectionLabel>
            {actaPhotos.length > 0 && (
              <Text style={type.meta}>{t("pago.actaPhotos", { count: actaPhotos.length })}</Text>
            )}
          </View>
          <View style={styles.photos}>
            {actaPhotos.map((photo) => (
              <PhotoImage key={photo.id} photo={photo} size="thumb" style={styles.photo} />
            ))}
          </View>
          {hito.actaSignedOn && (
            <Text style={type.meta}>
              {t("pago.signed", { date: formatMediumDate(hito.actaSignedOn, language) })}
            </Text>
          )}
        </View>
      )}

      {documents.length > 0 && (
        <View>
          <SectionLabel>{t("pago.documents")}</SectionLabel>
          {documents.map((doc) => (
            <Pressable
              key={doc.kind}
              accessibilityRole="button"
              onPress={() => void open(doc.kind)}
              style={({ pressed }) => [styles.docRow, pressed && { opacity: 0.6 }]}
            >
              <Feather name="file-text" size={22} color={colors.verdeOlivaLight} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.row}>{doc.name}</Text>
                <Text style={type.meta}>
                  {t("pago.fileDate", { date: formatMediumDate(doc.date, language) })}
                </Text>
              </View>
              <Feather name="download" size={20} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      )}

      <Text style={type.meta}>{t("pago.notConform")}</Text>
    </PushedScreen>
  );
}

const styles = StyleSheet.create({
  pill: {
    ...obraStyles.status,
    alignSelf: "flex-start",
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.blancoCalido,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  amounts: { ...card, paddingHorizontal: 24, paddingVertical: 22, gap: 12 },
  total: { borderTopWidth: 1, borderColor: colors.surfaceBorder, paddingTop: 14 },
  totalAmount: { fontSize: 26, fontWeight: "300", color: colors.blancoCalido },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photo: { width: "32%", aspectRatio: 1, borderRadius: radius.md },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
});
