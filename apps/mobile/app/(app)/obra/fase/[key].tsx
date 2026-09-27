import { useLocalSearchParams, useRouter } from "expo-router";
import type { Hito } from "@repo/core/contract";
import { StyleSheet, Text, View } from "react-native";
import {
  Bar,
  BigPct,
  CheckMark,
  LinkCard,
  SectionHeader,
  SectionLabel,
  obraStyles,
} from "../../../../components/obra-parts";
import { PhotoImage } from "../../../../components/photo-image";
import { PushedScreen } from "../../../../components/pushed-screen";
import { colors, radius, type } from "../../../../constants/theme";
import { formatMoney, formatShortDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { phaseName } from "../../../../lib/obra";
import { useObra } from "../../../../lib/use-obra";
import { usePhotos } from "../../../../lib/use-photos";

// A phase of the Obra tab — doc/mobile-app-design/A-Fase.dc.html: its budget
// chapters, latest photos, what is left to close it and its payment.

export default function FaseScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const { t, language } = useI18n();
  const { obra } = useObra();
  const { byId } = usePhotos();
  const index = obra?.phases.findIndex((p) => p.key === key) ?? -1;
  const phase = obra?.phases[index];

  if (!obra || !phase) {
    return (
      <PushedScreen back={t("phase.back")}>
        {obra !== undefined && <Text style={type.subhead}>{t("phase.notFound")}</Text>}
      </PushedScreen>
    );
  }

  // One hito (its payment card), or for the pre-construction phase several.
  const hitos = phase.hitoIds.flatMap((id) => obra.hitos.find((h) => h.id === id) ?? []);
  const hito = hitos.length === 1 ? hitos[0] : undefined;
  const phasePhotos = phase.photoIds.flatMap((id) => byId.get(id) ?? []);
  const openPago = (id: string) => router.push({ pathname: "/obra/pago/[id]", params: { id } });

  return (
    <PushedScreen back={t("phase.back")}>
      <View style={{ gap: 8 }}>
        <Text style={[type.label, { color: colors.verdeOlivaLight }]}>
          {t("phase.label", {
            current: index + 1,
            total: obra.phases.length,
            status: t(`phase.status.${phase.status}`),
          })}
        </Text>
        <Text accessibilityRole="header" style={[type.display, { lineHeight: 34 }]}>
          {phaseName(phase, t)}
        </Text>
        <Text style={[type.subhead, { lineHeight: 22 }]}>{hito?.scope ?? t("phase.preScope")}</Text>
      </View>

      <View style={{ gap: 14 }}>
        <BigPct value={phase.progressPct} />
        <Bar pct={phase.progressPct} style={{ height: 3 }} />
      </View>

      {phase.chapters.length > 0 && (
        <View style={{ gap: 18 }}>
          <SectionLabel>{t("phase.chapters")}</SectionLabel>
          {phase.chapters.map((chapter) => (
            <View key={chapter.code} style={{ gap: 6 }}>
              <View style={obraStyles.between}>
                <Text style={[type.row, { flex: 1 }]}>{chapter.name}</Text>
                <Text style={styles.pct}>{chapter.progressPct} %</Text>
              </View>
              <Text style={type.meta}>
                {t("phase.chapter", { code: chapter.code, amount: formatMoney(chapter.totalCents, language) })}
              </Text>
              <Bar pct={chapter.progressPct} />
            </View>
          ))}
        </View>
      )}

      {phasePhotos.length > 0 && (
        <View style={{ gap: 12 }}>
          <SectionHeader
            label={t("phase.photos")}
            link={t("phase.seeAll", { count: phase.photoCount })}
            onPress={() => router.navigate("/photos")}
          />
          <View style={styles.photos}>
            {phasePhotos.map((photo, i) => (
              <PhotoImage key={photo.id} photo={photo} size="thumb" style={i === 0 ? styles.photoBig : styles.photoSmall} />
            ))}
          </View>
          <Text style={type.meta}>
            {[phasePhotos[0]!.caption, formatShortDate(phasePhotos[0]!.uploadedAt, language)].filter(Boolean).join(" · ")}
          </Text>
        </View>
      )}

      {phase.checks.length > 0 && (
        <View>
          <SectionLabel>{t("phase.toClose")}</SectionLabel>
          {phase.checks.map((check) => (
            <View key={check.id} style={obraStyles.checkRow}>
              <CheckMark done={check.done} />
              <Text style={[type.row, { flex: 1 }]}>{check.label}</Text>
            </View>
          ))}
        </View>
      )}

      {hito && <PaymentCard hito={hito} onPress={() => openPago(hito.id)} />}

      {hitos.length > 1 && (
        <View style={{ gap: 12 }}>
          <SectionLabel>{t("phase.payments")}</SectionLabel>
          {hitos.map((h) => {
            const title = `${h.code} · ${h.name}`;
            return (
              <LinkCard key={h.id} onPress={() => openPago(h.id)} label={title}>
                <Text style={type.row}>{title}</Text>
                <Text style={type.meta}>
                  {`${formatMoney(h.amountCents, language)} ${t("phase.plusVat")} · ${t(`hitoStatus.${h.status}`)}`}
                </Text>
              </LinkCard>
            );
          })}
        </View>
      )}
    </PushedScreen>
  );
}

/** "Pago al cerrar la fase · H4": the phase's payment, opening it. */
function PaymentCard({ hito, onPress }: { hito: Hito; onPress: () => void }) {
  const { t, language } = useI18n();
  const label = t("phase.payment", { code: hito.code });
  return (
    <LinkCard onPress={onPress} label={label}>
      <Text style={obraStyles.smallLabel}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: "300", color: colors.blancoCalido }}>
        {formatMoney(hito.amountCents, language)} <Text style={type.meta}>{t("phase.plusVat")}</Text>
      </Text>
      <Text style={type.meta}>{t("phase.withActa")}</Text>
    </LinkCard>
  );
}

const styles = StyleSheet.create({
  pct: { fontSize: 15, color: colors.verdeOlivaLight },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 6, height: 182 },
  photoBig: { width: "64%", height: "100%", borderRadius: radius.lg },
  photoSmall: { width: "33%", height: 88, borderRadius: radius.lg },
});

