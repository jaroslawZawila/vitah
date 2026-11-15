import Feather from "@react-native-vector-icons/feather";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { MobilePhoto, PhotoSize } from "@repo/core/contract";
import { colors } from "../constants/theme";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";

/**
 * The image of a photo (grids use the thumbnail), fetched with the client's
 * token. expo-image, not React Native's Image: RN's new architecture drops
 * `source.headers`, so the API answered 401. Photos never change (new id per
 * upload), so they're kept in expo-image's disk cache, wiped on sign-out: those
 * already seen show offline, the rest a placeholder. A photo that failed tries
 * again when its list reloads (a new `photo` object: the connection is back).
 */
export function PhotoImage({
  photo,
  size,
  style,
  contentFit = "cover",
}: {
  photo: MobilePhoto;
  size: PhotoSize;
  style: object;
  contentFit?: "cover" | "contain";
}) {
  const { token } = useAuth();
  const { t } = useI18n();
  const uri = api.photoUrl(photo.id, size);
  // Offline, a photo never downloaded can't load: a quiet placeholder, not an error.
  const [failed, setFailed] = useState<{ photo: MobilePhoto; uri: string } | null>(null);
  if (failed?.photo === photo && failed.uri === uri) {
    return (
      <View style={[style, styles.placeholder]} accessibilityLabel={t("photos.notSaved")}>
        <Feather name="image" size={size === "thumb" ? 22 : 40} color={colors.muted} />
      </View>
    );
  }
  return (
    <Image
      onError={() => setFailed({ photo, uri })}
      source={{
        uri,
        headers: { Authorization: `Bearer ${token}` },
      }}
      cachePolicy="disk"
      contentFit={contentFit}
      transition={150}
      style={style}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
