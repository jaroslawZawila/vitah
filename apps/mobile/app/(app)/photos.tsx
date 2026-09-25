import Feather from "@expo/vector-icons/Feather";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MobilePhoto } from "@repo/core/contract";
import { Button } from "../../components/button";
import { colors, spacing, type } from "../../constants/theme";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatShortDate } from "../../lib/format";
import { groupByWeek, type PhotoWeek } from "../../lib/photo-weeks";
import { usePhotos } from "../../lib/use-photos";

// Tab "Fotos" — doc/mobile-app-design/A-Gallery.dc.html: photos grouped by
// week, the newest of each week large, the rest in a three-column grid.
// The mockup's phase names and filter chips need phases, which projects
// don't have yet.

export default function PhotosScreen() {
  const insets = useSafeAreaInsets();
  const { photos, error, refreshing, refresh, retry } = usePhotos();
  const [viewing, setViewing] = useState<MobilePhoto | null>(null);
  const weeks = useMemo(() => groupByWeek(photos ?? []), [photos]);

  const header = (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
      <Text style={type.label}>
        {photos?.length === 1 ? "1 foto" : `${photos?.length ?? 0} fotos`}
      </Text>
      <Text accessibilityRole="header" style={type.display}>
        Fotografías
      </Text>
      {error && photos && photos.length > 0 && (
        <Text style={type.subhead}>Sin conexión. No hemos podido actualizar las fotos.</Text>
      )}
    </View>
  );

  return (
    <>
      <FlatList
        style={{ flex: 1, backgroundColor: colors.grafito }}
        contentContainerStyle={{
          flexGrow: 1,
          gap: 28,
          paddingTop: insets.top + spacing.lg,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
        }}
        data={weeks}
        keyExtractor={(week) => week.key}
        renderItem={({ item }) => <Week week={item} onOpen={setViewing} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Empty loading={photos === undefined && !error} failed={error} onRetry={retry} />
        }
        refreshControl={
          photos !== undefined ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.verdeOliva}
              colors={[colors.verdeOliva]}
            />
          ) : undefined
        }
      />
      <Viewer photo={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

/** The image of a photo, fetched with the client's token. */
function PhotoImage({
  photo,
  style,
  resizeMode = "cover",
}: {
  photo: MobilePhoto;
  style: object;
  resizeMode?: "cover" | "contain";
}) {
  const { token } = useAuth();
  return (
    <Image
      source={{ uri: api.photoUrl(photo.id), headers: { Authorization: `Bearer ${token}` } }}
      resizeMode={resizeMode}
      style={style}
      accessibilityIgnoresInvertColors
    />
  );
}

function photoLabel(photo: MobilePhoto) {
  return photo.caption ?? `Foto del ${formatShortDate(photo.uploadedAt)}`;
}

function Week({ week, onOpen }: { week: PhotoWeek; onOpen: (photo: MobilePhoto) => void }) {
  const [first, ...rest] = week.photos;
  if (!first) return null;
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.weekHeader}>
        <Text accessibilityRole="header" style={[type.body, { fontSize: 15 }]}>
          Semana {week.week}
        </Text>
        <Text style={[type.subhead, { fontSize: 13 }]}>{formatShortDate(first.uploadedAt)}</Text>
      </View>
      <Tile photo={first} onPress={() => onOpen(first)} style={styles.lead}>
        {first.caption && (
          <View style={styles.captionPill}>
            <Text style={styles.captionText} numberOfLines={1}>
              {first.caption}
            </Text>
          </View>
        )}
      </Tile>
      {rest.length > 0 && (
        <View style={styles.grid}>
          {rest.map((photo) => (
            <Tile key={photo.id} photo={photo} onPress={() => onOpen(photo)} style={styles.small} />
          ))}
        </View>
      )}
    </View>
  );
}

function Tile({
  photo,
  onPress,
  style,
  children,
}: {
  photo: MobilePhoto;
  onPress: () => void;
  style: object;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={photoLabel(photo)}
      accessibilityHint="Abre la foto a pantalla completa"
      style={({ pressed }) => [style, styles.tile, pressed && { opacity: 0.7 }]}
    >
      <PhotoImage photo={photo} style={StyleSheet.absoluteFill} />
      {children}
    </Pressable>
  );
}

function Viewer({ photo, onClose }: { photo: MobilePhoto | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={photo !== null}
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape"]}
    >
      {photo && (
        <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.viewerBar}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              hitSlop={8}
              style={styles.close}
            >
              <Feather name="x" size={22} color={colors.blancoCalido} />
            </Pressable>
          </View>
          <PhotoImage
            photo={photo}
            resizeMode="contain"
            style={{ flex: 1, width: "100%" }}
          />
          <View style={{ padding: spacing.lg, gap: 4 }}>
            {photo.caption && <Text style={type.body}>{photo.caption}</Text>}
            <Text style={[type.subhead, { fontSize: 13 }]}>
              {formatShortDate(photo.uploadedAt)}
            </Text>
          </View>
        </View>
      )}
    </Modal>
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
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator
          color={colors.verdeOliva}
          size="large"
          accessibilityLabel="Cargando las fotos de tu obra"
        />
      </View>
    );
  }
  if (failed) {
    return (
      <View style={[styles.center, { gap: spacing.lg }]}>
        <Text style={[type.body, { textAlign: "center" }]}>
          No hemos podido cargar las fotos. Comprueba tu conexión.
        </Text>
        <Button title="Reintentar" variant="secondary" onPress={onRetry} />
      </View>
    );
  }
  return (
    <Text style={type.subhead}>
      Todavía no hay fotos. Aquí aparecerán las que comparta tu asesor de ViTAH sobre tu obra.
    </Text>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center" },
  weekHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  tile: { overflow: "hidden", backgroundColor: colors.surface },
  lead: { height: 220, borderRadius: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  // Three columns: a third of the row minus its share of the two gaps.
  small: { width: "31.8%", flexGrow: 1, maxWidth: "33.3%", height: 104, borderRadius: 10 },
  captionPill: {
    position: "absolute",
    left: 14,
    bottom: 12,
    maxWidth: "80%",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(20,20,19,0.72)",
  },
  captionText: { fontSize: 12, letterSpacing: 1, color: colors.blancoCalido },
  viewer: { flex: 1, backgroundColor: colors.grafito },
  viewerBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.sm },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
