import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isAwaitingPayment, type Hito } from "@repo/core/contract";
import { LoadState } from "../../../components/load-state";
import { Bar, Marker, SectionLabel, SegmentedBar, obraStyles } from "../../../components/obra-parts";
import { PushedScreen } from "../../../components/pushed-screen";
import { card, colors, radius, type } from "../../../constants/theme";
import { formatDayMonth, formatMediumDate, formatMoney, formatShare } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";
import { nextPayment, paidCount } from "../../../lib/obra";
import { useObra } from "../../../lib/use-obra";

// Payments — doc/mobile-app-design/A-Obra-Pagos.dc.html: what is paid, the
// next payment, and the H0–H9 timeline. Pushed from the Obra tab.

export default function PagosScreen() {
  const router = useRouter();
  const { t, language } = useI18n();
  const { obra, error, retry } = useObra();
  if (!obra) {
    return (
      <PushedScreen back={t("pagos.back")}>
        <LoadState
          loaded={obra !== undefined}
          error={error}
          loadingLabel={t("obra.loading")}
          failedText={t("obra.loadFailed")}
          onRetry={retry}
        />
        {obra === null && <Text style={type.subhead}>{t("home.noProject")}</Text>}
      </PushedScreen>
    );
  }

  const due = nextPayment(obra);
  const open = (hito: Hito) => router.push({ pathname: "/obra/pago/[id]", params: { id: hito.id } });

  return (
    <PushedScreen back={t("pagos.back")}>
      <Text accessibilityRole="header" style={type.display}>
        {t("pagos.title")}
      </Text>

      <View style={styles.summary}>
        <View style={{ gap: 6 }}>
          <Text style={type.label}>{t("pagos.paid")}</Text>
          <Text style={styles.paid}>{formatMoney(obra.paidCents, language)}</Text>
          <Text style={type.meta}>
            {t("pagos.ofTotal", {
              total: formatMoney(obra.totalCents, language),
              count: paidCount(obra),
              hitos: obra.hitos.length,
            })}
          </Text>
        </View>
        <SegmentedBar
          fills={obra.hitos.map((hito) => ({
            key: hito.id,
            pct: hito.status === "paid" || isAwaitingPayment(hito.status) ? 100 : 0,
            color: hito.status === "paid" ? undefined : colors.blancoCalido,
          }))}
        />
        {due?.dueOn && (
          <Pressable
            accessibilityRole="button"
            onPress={() => open(due)}
            style={({ pressed }) => [styles.next, pressed && { opacity: 0.7 }]}
          >
            <View style={{ gap: 4, flex: 1 }}>
              <Text style={[obraStyles.smallLabel, { color: colors.verdeOlivaLight }]}>
                {t("pagos.nextPayment", { date: formatDayMonth(due.dueOn, language) })}
              </Text>
              <Text style={type.row}>
                {t("pagos.nextAmount", { code: due.code, amount: formatMoney(due.totalCents, language) })}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>

      <View>
        <SectionLabel>{t("pagos.hitos")}</SectionLabel>
        <View style={{ marginTop: 14 }}>
          {obra.hitos.map((hito, index) => (
            <TimelineRow
              key={hito.id}
              hito={hito}
              last={index === obra.hitos.length - 1}
              onPress={() => open(hito)}
            />
          ))}
        </View>
      </View>

      <Text style={type.meta}>{t("pagos.note", { rate: formatShare(obra.vatRateBp, language) })}</Text>
    </PushedScreen>
  );
}

function TimelineRow({ hito, last, onPress }: { hito: Hito; last: boolean; onPress: () => void }) {
  const { t, language } = useI18n();
  const title = `${hito.code} · ${hito.name}`;
  const paid = hito.status === "paid";
  const owed = isAwaitingPayment(hito.status);
  const active = hito.status === "active" || hito.status === "ready";
  const share = t("pagos.share", {
    pct: formatShare(hito.pctBp, language),
    amount: formatMoney(hito.amountCents, language),
  });

  return (
    <View style={styles.timelineRow}>
      <View style={styles.rail}>
        <Marker
          size={24}
          state={paid ? "done" : owed || active ? "current" : "todo"}
          color={owed ? colors.blancoCalido : colors.verdeOlivaLight}
          last={last}
        />
        {!last && <View style={[styles.line, paid && { backgroundColor: colors.verdeOlivaDark }]} />}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={({ pressed }) => [{ flex: 1, paddingBottom: last ? 0 : 20 }, pressed && { opacity: 0.7 }]}
      >
        {owed ? (
          <View style={styles.toPayCard}>
            <View style={obraStyles.between}>
              <Text style={[type.row, { fontSize: 16, flex: 1 }]}>{title}</Text>
              <Text style={obraStyles.status}>{t("pagos.toPay")}</Text>
            </View>
            <View style={obraStyles.between}>
              <Text style={type.meta}>{share}</Text>
              <Text style={type.row}>{formatMoney(hito.totalCents, language)}</Text>
            </View>
            {hito.actaSignedOn && hito.dueOn && (
              <Text style={type.meta}>
                {t("pagos.actaSigned", {
                  date: formatMediumDate(hito.actaSignedOn, language),
                  due: formatMediumDate(hito.dueOn, language),
                })}
              </Text>
            )}
            <View style={[obraStyles.between, styles.seeActa]}>
              <Text style={styles.link}>{t("pagos.seeActa")}</Text>
              <Feather name="chevron-right" size={18} color={colors.verdeOlivaLight} />
            </View>
          </View>
        ) : (
          <View style={{ gap: active ? 10 : 3 }}>
            <View style={obraStyles.between}>
              <Text style={[type.row, !paid && !active && { color: colors.muted }, { flex: 1 }]}>{title}</Text>
              {active ? (
                <Text style={[obraStyles.status, { color: colors.verdeOlivaLight }]}>{t("pagos.inProgress")}</Text>
              ) : (
                <Text style={type.meta}>{formatMoney(hito.amountCents, language)}</Text>
              )}
            </View>
            {active && <Bar pct={hito.readyPct} style={{ height: 3 }} />}
            <Text style={type.meta}>
              {paid && hito.paidOn
                ? t("pagos.paidOn", { date: formatMediumDate(hito.paidOn, language) })
                : active
                  ? [hito.billingMoment, ...hito.chapters.map((c) => `${c.name} ${c.progressPct} %`)].join(" · ")
                  : hito.billingMoment}
            </Text>
            {active && <Text style={type.meta}>{share}</Text>}
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { ...card, padding: 24, gap: 20 },
  paid: { fontSize: 40, fontWeight: "200", color: colors.blancoCalido },
  next: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingTop: 16,
  },
  timelineRow: { flexDirection: "row", gap: 16 },
  rail: { width: 24, alignItems: "center" },
  line: { flex: 1, width: 1, minHeight: 22, backgroundColor: colors.chipBorder },
  toPayCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.markerTodo,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
  },
  seeActa: { borderTopWidth: 1, borderColor: colors.surfaceBorder, paddingTop: 10, alignItems: "center" },
  link: { fontSize: 14, color: colors.verdeOlivaLight },
});
