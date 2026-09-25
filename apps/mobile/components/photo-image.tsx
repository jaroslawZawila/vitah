import { Image } from "expo-image";
import type { MobilePhoto, PhotoSize } from "@repo/core/contract";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * The image of a photo (grids use the thumbnail), fetched with the client's
 * token. expo-image, not React Native's Image: RN's new architecture drops
 * `source.headers`, so the API answered 401. Photos never change (new id per
 * upload), so they're kept in expo-image's disk cache, wiped on sign-out.
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
  return (
    <Image
      source={{
        uri: api.photoUrl(photo.id, size),
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

