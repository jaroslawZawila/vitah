import Feather from "@react-native-vector-icons/feather";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { card, colors, type } from "../constants/theme";

// Pieces shared by the obra screens (Home's card, the Obra tab, a phase,
// payments, a payment) — doc/mobile-app-design A-Home, A-Progress, A-Fase,
// A-Obra-Pagos, A-Hito.

/** A thin progress bar. */
export function Bar({ pct, style }: { pct: number; style?: object }) {
  return (
    <View style={[styles.bar, style]}>
      <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, pct))}%` }]} />
    </View>
  );
}

/** One 4-pt segment per step, each filled to its %: Home's phases, the payments' hitos. */
export function SegmentedBar({ fills }: { fills: { key: string; pct: number; color?: string }[] }) {
  return (
    <View style={styles.segments}>
      {fills.map(({ key, pct, color }) => (
        <View key={key} style={styles.segment}>
          <View
            style={[styles.segmentFill, { width: `${pct}%` }, color ? { backgroundColor: color } : null]}
          />
        </View>
      ))}
    </View>
  );
}

export type MarkerState = "done" | "current" | "todo";

/**
 * A step on a timeline: done (filled, ✓), current (ring with a dot) or to do
 * (empty ring; `last` shows the key of the handover).
 */
export function Marker({
  state,
  size = 20,
  color = colors.verdeOlivaLight,
  last = false,
}: {
  state: MarkerState;
  size?: number;
  /** The current step's ring and dot. */
  color?: string;
  last?: boolean;
}) {
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (state === "done") {
    return (
      <View style={[styles.marker, circle, { backgroundColor: colors.verdeOlivaDark }]}>
        <Feather name="check" size={size * 0.6} color={colors.blancoCalido} />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.marker,
        circle,
        { borderWidth: 1.5, borderColor: state === "current" ? color : colors.markerTodo },
      ]}
    >
      {state === "current" && (
        <View style={{ width: size * 0.35, height: size * 0.35, borderRadius: size, backgroundColor: color }} />
      )}
      {state === "todo" && last && <Feather name="key" size={size * 0.5} color={colors.muted} />}
    </View>
  );
}

/** A big, thin "52%" (72 pt by default). */
export function BigPct({ value, size = 72 }: { value: number; size?: number }) {
  return (
    <Text
      style={[styles.big, { fontSize: size, lineHeight: size + 4 }]}
      accessibilityLabel={`${value} %`}
    >
      {value}
      <Text style={[styles.bigPct, { fontSize: size * 0.38 }]}>%</Text>
    </Text>
  );
}

/** An uppercase section label (11/500, wide tracking, muted). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={type.label}>
      {children}
    </Text>
  );
}

/** A section label with a link on the right, e.g. "Últimas fotos · Ver las 12". */
export function SectionHeader({
  label,
  link,
  onPress,
}: {
  label: string;
  link: string;
  onPress: () => void;
}) {
  return (
    <View style={obraStyles.between}>
      <SectionLabel>{label}</SectionLabel>
      <Pressable accessibilityRole="link" onPress={onPress} style={styles.link}>
        <Text style={styles.linkText}>{link}</Text>
      </Pressable>
    </View>
  );
}

/** A tappable card with a chevron: e.g. "Pago al cerrar la fase". */
export function LinkCard({
  onPress,
  children,
  label,
}: {
  onPress: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.linkCard, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, gap: 6 }}>{children}</View>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** A ✓ when done, an open ring when not (checklists). */
export function CheckMark({ done }: { done: boolean }) {
  return done ? (
    <Feather name="check" size={18} color={colors.verdeOlivaLight} />
  ) : (
    <View style={styles.ring} />
  );
}

export const obraStyles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
  /** Uppercase status text: "POR PAGAR", "EN CURSO". */
  status: { fontSize: 11, letterSpacing: 1.8, textTransform: "uppercase", color: colors.blancoCalido },
  /** A 10-pt label over a figure. */
  smallLabel: { ...type.label, fontSize: 10, letterSpacing: 2 },
});

const styles = StyleSheet.create({
  bar: { height: 2, borderRadius: 1, backgroundColor: colors.chipBorder, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: colors.verdeOlivaLight },
  segments: { flexDirection: "row", gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.chipBorder, overflow: "hidden" },
  segmentFill: { height: 4, backgroundColor: colors.verdeOlivaLight },
  marker: { alignItems: "center", justifyContent: "center" },
  big: { fontWeight: "200", color: colors.blancoCalido, letterSpacing: -1.5 },
  bigPct: { fontWeight: "300", color: colors.muted, letterSpacing: 0 },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { fontSize: 13, color: colors.verdeOlivaLight },
  linkCard: { ...card, padding: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  ring: { width: 12, height: 12, margin: 3, borderRadius: 6, borderWidth: 1.5, borderColor: colors.faint },
});
