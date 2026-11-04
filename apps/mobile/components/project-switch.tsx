import Feather from "@react-native-vector-icons/feather";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLanguage } from "@repo/core/contract";
import { colors, radius, spacing, type } from "../constants/theme";
import type { Project } from "../lib/api";
import { formatMediumDate, formatMonthYear } from "../lib/format";
import { useI18n, type Translate } from "../lib/i18n";
import { useProject } from "../lib/use-project";
import { Bar, Marker } from "./obra-parts";

// Switching between a client's homes — doc/mobile-app-design/A-Viviendas.dc.html.
// With one home none of this shows: the app looks as it always did.

/** The street part of an address: "Calle Castelar 12, 39004 Santander" → "Calle Castelar 12". */
export const street = (address: string) => address.split(",")[0]?.trim() ?? address;

/** "En obra · entrega 15 ene 2027", "Entregada · jun 2025", "En preparación · inicio 10 mar 2026". */
export function homeStatus(project: Project, t: Translate, language: AppLanguage): string {
  if (project.handedOver) {
    return project.completionDate
      ? t("homes.status.handedOverOn", { date: formatMonthYear(project.completionDate, language) })
      : t("homes.status.handedOver");
  }
  if (project.progressPct !== null) {
    return project.completionDate
      ? t("homes.status.buildingUntil", { date: formatMediumDate(project.completionDate, language) })
      : t("homes.status.building");
  }
  return project.startDate
    ? t("homes.status.preparingFrom", { date: formatMediumDate(project.startDate, language) })
    : t("homes.status.preparing");
}

/** The client has more than one home: the switch shows. */
export function useSeveralHomes() {
  const { projects } = useProject();
  return (projects?.length ?? 0) > 1;
}

/** "Mis viviendas": every home of the client; picking one shows it everywhere in the app. */
export function ProjectSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { project: shown, projects = [], select } = useProject();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text accessibilityRole="header" style={type.title}>
                {t("homes.title")}
              </Text>
              <Text style={type.meta}>{t("homes.hint")}</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              style={styles.close}
            >
              <Feather name="x" size={20} color={colors.muted} />
            </Pressable>
          </View>
          <View style={{ gap: 10 }} accessibilityRole="radiogroup">
            {projects.map((home) => {
              const selected = home.id === shown?.id;
              return (
                <Pressable
                  key={home.id}
                  onPress={() => {
                    select(home.id);
                    onClose();
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.row,
                    selected && { borderColor: colors.verdeOliva },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Marker state={selected ? "current" : "todo"} />
                  <HomeText home={home} selected={selected}>
                    {home.progressPct !== null && <Bar pct={home.progressPct} style={{ marginTop: 4 }} />}
                  </HomeText>
                  {home.progressPct !== null && (
                    <Text style={styles.pct}>{`${home.progressPct} %`}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** A home's ref (green when shown), street and status, e.g. in "Mis viviendas" and "Tu otra vivienda". */
export function HomeText({
  home,
  selected = false,
  children,
}: {
  home: Project;
  selected?: boolean;
  children?: React.ReactNode;
}) {
  const { t, language } = useI18n();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={[type.label, selected && { color: colors.verdeOlivaLight }]}>{home.ref}</Text>
      <Text style={type.row}>{street(home.address)}</Text>
      <Text style={type.meta}>{homeStatus(home, t, language)}</Text>
      {children}
    </View>
  );
}

/**
 * A tab's eyebrow line. With several homes it names the one shown, in green
 * with a chevron, and opens "Mis viviendas"; `after` follows it (e.g. "24
 * documentos"). With one home: the eyebrow as before — the ref and street
 * (`withAddress`) or just `after`.
 */
export function ProjectEyebrow({ withAddress = false, after }: { withAddress?: boolean; after?: string }) {
  const { t } = useI18n();
  const { project } = useProject();
  const several = useSeveralHomes();
  const [open, setOpen] = useState(false);
  const name = project && [project.ref, withAddress && street(project.address).toUpperCase()].filter(Boolean).join(" · ");

  if (!several || !name) {
    const text = withAddress ? name : after;
    return text ? <Text style={type.label}>{text}</Text> : null;
  }
  return (
    <View style={styles.eyebrow}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("homes.switch", { name })}
        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
        style={({ pressed }) => [styles.eyebrow, { gap: 6 }, pressed && { opacity: 0.6 }]}
      >
        <Text style={[type.label, { color: colors.verdeOlivaLight }]}>{name}</Text>
        <Feather name="chevron-down" size={14} color={colors.verdeOlivaLight} />
      </Pressable>
      {after ? <Text style={type.label}>{` · ${after}`}</Text> : null}
      <ProjectSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10, 10, 9, 0.62)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.surfaceBorder,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: spacing.lg,
    gap: 18,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.markerTodo },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  close: { width: 44, height: 44, marginTop: -6, marginRight: -10, alignItems: "center", justifyContent: "center" },
  row: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.grafito,
  },
  pct: { fontSize: 15, color: colors.verdeOlivaLight, paddingTop: 18 },
  eyebrow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
});
