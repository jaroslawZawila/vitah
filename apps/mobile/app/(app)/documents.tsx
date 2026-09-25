import Feather from "@expo/vector-icons/Feather";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DocumentCategory } from "@repo/core/contract";
import { Button } from "../../components/button";
import { colors, radius, spacing, type } from "../../constants/theme";
import type { LocalDocument } from "../../lib/document-store";
import { useDocuments } from "../../lib/documents";
import { formatFileSize, formatShortDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const { documents, syncing, offline, sync, open } = useDocuments();
  const { t } = useI18n();
  const [picked, setCategory] = useState<DocumentCategory | null>(null);

  const categories = [...new Set(documents?.map((doc) => doc.category))];
  // Ignore a filter whose last document was removed by a sync.
  const category = picked && categories.includes(picked) ? picked : null;
  const shown = documents?.filter((doc) => !category || doc.category === category) ?? [];

  async function handleOpen(doc: LocalDocument) {
    if (!(await open(doc))) {
      Alert.alert(t("documents.unavailableTitle"), t("documents.unavailableText"));
      void sync();
    }
  }

  const header = (
    <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
      <View style={{ gap: spacing.sm }}>
        <Text style={type.label}>
          {t("documents.count", { count: documents?.length ?? 0 })}
        </Text>
        <Text accessibilityRole="header" style={type.display}>
          {t("documents.title")}
        </Text>
      </View>
      {offline && documents && documents.length > 0 && (
        <Text style={type.subhead}>{t("documents.offline")}</Text>
      )}
      {categories.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Chip label={t("documents.all")} selected={!category} onPress={() => setCategory(null)} />
            {categories.map((c) => (
              <Chip
                key={c}
                label={t(`documents.categories.${c}`)}
                selected={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.grafito }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.lg,
      }}
      data={shown}
      keyExtractor={(doc) => doc.id}
      renderItem={({ item }) => <DocumentRow doc={item} onPress={() => void handleOpen(item)} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Empty
          loading={documents === undefined || (syncing && documents.length === 0)}
          failed={offline}
          onRetry={() => void sync()}
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={syncing && documents !== undefined && documents.length > 0}
          onRefresh={() => void sync()}
          tintColor={colors.verdeOliva}
          colors={[colors.verdeOliva]}
        />
      }
    />
  );
}

function Empty({
  loading,
  failed,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator
          color={colors.verdeOliva}
          size="large"
          accessibilityLabel={t("documents.loading")}
        />
      </View>
    );
  }
  if (failed) {
    return (
      <View style={[styles.center, { gap: spacing.lg }]}>
        <Text style={[type.body, { textAlign: "center" }]}>
          {t("documents.loadFailed")}
        </Text>
        <Button title={t("common.retry")} variant="secondary" onPress={onRetry} />
      </View>
    );
  }
  return (
    <Text style={type.subhead}>
      {t("documents.empty")}
    </Text>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={{ top: 2, bottom: 2 }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && { color: colors.grafito }]}>{label}</Text>
    </Pressable>
  );
}

function DocumentRow({ doc, onPress }: { doc: LocalDocument; onPress: () => void }) {
  const { t, language } = useI18n();
  const meta = `${formatShortDate(doc.uploadedAt, language)} · ${formatFileSize(doc.sizeBytes, language)}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${doc.title}${doc.isNew ? t("documents.newLabel") : ""}, ${meta}`}
      accessibilityHint={t(doc.downloaded ? "documents.openHint" : "documents.notDownloadedHint")}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.tile}>
        <Text style={styles.tileText}>PDF</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={[type.body, { fontSize: 15, flexShrink: 1 }]} numberOfLines={2}>
            {doc.title}
          </Text>
          {doc.isNew && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{t("documents.new")}</Text>
            </View>
          )}
        </View>
        <Text style={[type.subhead, { fontSize: 13 }]}>{meta}</Text>
      </View>
      <Feather
        name={doc.downloaded ? "chevron-right" : "download"}
        size={20}
        color={colors.muted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center" },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  chipSelected: { backgroundColor: colors.blancoCalido, borderColor: colors.blancoCalido },
  chipText: { fontSize: 13, color: colors.blancoCalido },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 68,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
  tile: {
    width: 42,
    height: 48,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  tileText: { fontSize: 9, fontWeight: "500", color: colors.verdeOlivaLight },
  badge: {
    backgroundColor: colors.verdeOlivaLight,
    borderRadius: radius.md / 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, letterSpacing: 1.4, color: colors.grafito, fontWeight: "500" },
});
