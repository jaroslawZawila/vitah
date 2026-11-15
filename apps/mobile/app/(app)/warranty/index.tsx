import Feather from "@react-native-vector-icons/feather";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  MAX_WARRANTY_DESCRIPTION,
  MAX_WARRANTY_PHOTOS,
  WARRANTY_KINDS,
  WARRANTY_ROOMS,
  warrantyRef,
  type MobileWarranty,
  type WarrantyKind,
  type WarrantyRoom,
} from "@repo/core/contract";
import { Button } from "../../../components/button";
import { LoadState } from "../../../components/load-state";
import { PushedScreen } from "../../../components/pushed-screen";
import { colors, radius, spacing, type } from "../../../constants/theme";
import { api, type ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { formatMediumDate } from "../../../lib/format";
import { useI18n, type MessageKey } from "../../../lib/i18n";
import { useProject, useProjectData } from "../../../lib/use-project";
import { newIdempotencyKey, pickedPhoto, useReloadWithHome, type PickedPhoto } from "../../../lib/warranty";

// Solicitud de garantía — doc/mobile-app-design/A-Warranty.dc.html: the LOE
// periods, then the claim (type, room, description, photos, urgent) with the
// send button in the bottom bar. Before hand-over it only explains when the
// guarantee starts. Reached from Inicio's "Garantía" shortcut.

const getWarranty = (token: string, projectId: string | null) => api.getWarranty(token, projectId);

export default function WarrantyScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { data, error, retry, reload } = useProjectData(getWarranty);
  useReloadWithHome(reload);
  const draft = useClaimDraft(reload);
  const warranty = data?.warranty;
  const claims = warranty?.claims.length ?? 0;

  return (
    <PushedScreen
      back={t("common.back")}
      action={
        claims > 0 && (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/warranty/claims")}
            style={({ pressed }) => [styles.myClaims, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.link}>{t("warranty.myClaims", { count: claims })}</Text>
          </Pressable>
        )
      }
      footer={
        warranty?.handedOver && (
          <View style={{ flex: 1 }}>
            <Button title={t("warranty.send")} onPress={() => void draft.send()} loading={draft.sending !== null} />
          </View>
        )
      }
    >
      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" style={type.display}>
          {t("warranty.title")}
        </Text>
        <Text style={[type.subhead, { lineHeight: 22 }]}>{t("warranty.intro")}</Text>
      </View>
      <LoadState
        loaded={data !== undefined}
        error={error}
        loadingLabel={t("warranty.loading")}
        failedText={t("warranty.loadFailed")}
        onRetry={retry}
      />
      {data !== undefined &&
        (!warranty ? (
          <Text style={type.subhead}>{t("warranty.noProject")}</Text>
        ) : (
          <>
            <Coverage warranty={warranty} />
            {warranty.handedOver ? (
              <ClaimFields draft={draft} />
            ) : (
              <Text style={[type.row, { lineHeight: 22 }]}>{t("warranty.notHandedOver")}</Text>
            )}
          </>
        ))}
    </PushedScreen>
  );
}

/** The three LOE periods: 1 year finishes, 3 years systems, 10 years structure, with their end once handed over. */
function Coverage({ warranty }: { warranty: MobileWarranty }) {
  const { t, language } = useI18n();
  return (
    <View style={styles.periods}>
      {warranty.coverage.map((period) => (
        <View key={period.scope} style={styles.period}>
          <Text style={styles.years}>{t("warranty.years", { count: period.years })}</Text>
          <Text style={styles.scope}>{t(`warranty.scope.${period.scope}`, undefined, "")}</Text>
          {period.endsOn && (
            <Text style={[styles.scope, !period.active && { color: colors.destructive }]}>
              {t(period.active ? "warranty.until" : "warranty.expired", { date: formatMediumDate(period.endsOn, language) })}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

/** What went wrong, as the form says it. */
type FormError = { key: MessageKey; params?: Record<string, string> };

/** The API's codes the form has a text for; any other reads as the generic one. */
const KNOWN = new Set<string>([
  "missing_fields",
  "invalid_input",
  "network_error",
  "timeout",
  "server_error",
  "not_handed_over",
  "too_many_open_claims",
  "too_many_claims_today",
  "project_not_found",
  "file_too_large",
  "invalid_file_type",
]);
const errorOf = (code: ApiError): FormError => ({
  key: (KNOWN.has(code) ? `warranty.errors.${code}` : "warranty.errors.generic") as MessageKey,
});

type Draft = ReturnType<typeof useClaimDraft>;

/**
 * iOS: a picker presented while the alert that asked for it is still closing
 * may never show. Untested on a device: a common remedy, not a measured one.
 */
const ALERT_CLOSE_MS = Platform.OS === "ios" ? 350 : 0;

/**
 * The claim being written. Sending creates it (with a key, so a retry after
 * a lost answer is the same claim), then uploads each photo, one request
 * each. Whatever fails, what the client typed and picked stays, and sending
 * again goes on from where it stopped.
 */
function useClaimDraft(onSent: () => unknown) {
  const router = useRouter();
  const { token, signOut } = useAuth();
  const shown = useProject().projectId;
  // The home the claim is about: the one shown when the form opened, even if
  // another is shown meanwhile (a tapped push).
  const [projectId, setProjectId] = useState(shown);
  if (projectId === undefined && shown !== undefined) setProjectId(shown);
  const { t } = useI18n();
  const [kind, setKind] = useState<WarrantyKind | null>(null);
  const [room, setRoom] = useState<WarrantyRoom | null>(null);
  const [description, setDescription] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<FormError | null>(null);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  // The claim once the server has it (its photos may still be on their way): its fields no longer change.
  const [sent, setSent] = useState<{ claimId: string; number: number } | null>(null);
  // Renewed with every edit: only a retry of the very same claim reuses it.
  const createKey = useRef(newIdempotencyKey());
  const photoKeys = useRef(new Map<string, string>());
  // The photos the server has: they stay; the others can still be removed or swapped.
  const [uploaded, setUploaded] = useState<ReadonlySet<string>>(new Set());
  // Sending goes on when the client leaves; only the screen they are on says "sent" and opens the claim.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      createKey.current = newIdempotencyKey();
    };

  function addPhotos(assets: ImagePicker.ImagePickerAsset[]) {
    const fitting = assets.map(pickedPhoto);
    if (fitting.some((photo) => photo === null)) Alert.alert(t("warranty.photoTooLarge"));
    setPhotos((list) =>
      [...list, ...fitting.filter((photo): photo is PickedPhoto => photo !== null)].slice(0, MAX_WARRANTY_PHOTOS),
    );
  }

  async function pick(source: "camera" | "library") {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      // A phone's photo comes down to 1–3 MB, under the 4 MB a photo may take.
      quality: 0.6,
      // iOS: a JPEG, never HEIC (the server takes JPEG, PNG and WebP).
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    };
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return Alert.alert(t("warranty.cameraDenied"));
        const result = await ImagePicker.launchCameraAsync(options);
        if (!result.canceled) addPhotos(result.assets);
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          ...options,
          allowsMultipleSelection: true,
          selectionLimit: MAX_WARRANTY_PHOTOS - photos.length,
        });
        if (!result.canceled) addPhotos(result.assets);
      }
    } catch {
      Alert.alert(t(source === "camera" ? "warranty.cameraDenied" : "warranty.libraryDenied"));
    }
  }

  function choosePhoto() {
    const later = (source: "camera" | "library") => () => void setTimeout(() => void pick(source), ALERT_CLOSE_MS);
    Alert.alert(t("warranty.addPhoto"), undefined, [
      { text: t("warranty.camera"), onPress: later("camera") },
      { text: t("warranty.library"), onPress: later("library") },
      { text: t("warranty.cancel"), style: "cancel" },
    ]);
  }

  /** Stops sending with `problem` shown; a rejected session signs out. */
  async function stop(code: ApiError, problem: FormError = errorOf(code)) {
    setSending(null);
    if (code === "unauthorized") await signOut();
    else setError(problem);
  }

  async function send() {
    if (!token || sending) return;
    if (!sent && (!kind || !room || !description.trim())) return setError({ key: "warranty.errors.missing_fields" });
    setError(null);
    setSending({ done: 0, total: 0 });

    let claim = sent;
    if (!claim) {
      const result = await api.createWarrantyClaim(
        token,
        projectId ?? null,
        { kind: kind!, room: room!, description: description.trim(), urgent },
        createKey.current,
      );
      if (!result.ok) return stop(result.error);
      claim = result.data;
      setSent(claim);
    }

    const toUpload = photos.filter((photo) => !uploaded.has(photo.uri));
    for (const [index, photo] of toUpload.entries()) {
      setSending({ done: index + 1, total: toUpload.length });
      const key = photoKeys.current.get(photo.uri) ?? newIdempotencyKey();
      photoKeys.current.set(photo.uri, key);
      const result = await api.addWarrantyPhoto(token, claim.claimId, photo, key);
      if (result.ok) {
        setUploaded((done) => new Set(done).add(photo.uri));
        continue;
      }
      // Worth another try: the claim is in, a photo isn't yet.
      if (result.error === "network_error" || result.error === "timeout" || result.error === "server_error") {
        return stop(result.error, { key: "warranty.errors.photos_failed", params: { ref: warrantyRef(claim.number) } });
      }
      // The client can swap that photo for another.
      if (result.error === "file_too_large" || result.error === "invalid_file_type" || result.error === "unauthorized") {
        return stop(result.error);
      }
      // Refused for good (staff started on it, or it has all its photos): the claim stands as it is.
      break;
    }

    setSending(null);
    void onSent();
    if (!focused.current) return;
    Alert.alert(t("warranty.sent", { ref: warrantyRef(claim.number) }), t("warranty.sentText"));
    router.replace(`/warranty/${claim.claimId}`);
  }

  return {
    kind,
    room,
    description,
    urgent,
    photos,
    error,
    sending,
    /** Sent (or on its way): the fields no longer change. */
    locked: sent !== null || sending !== null,
    /** A photo that can still be removed: none while sending, never one the server has. */
    removable: (uri: string) => sending === null && !uploaded.has(uri),
    setKind: edited(setKind),
    setRoom: edited(setRoom),
    setDescription: edited(setDescription),
    setUrgent: edited(setUrgent),
    removePhoto: (uri: string) => setPhotos((list) => list.filter((photo) => photo.uri !== uri)),
    choosePhoto,
    send,
  };
}

/** The claim's fields: type and room chips, description, photos and the urgent switch. */
function ClaimFields({ draft }: { draft: Draft }) {
  const { t } = useI18n();
  const { locked, photos, sending, error } = draft;
  // The claim's fields lock once it is sent; photos not yet uploaded can still be swapped.
  const canAddPhoto = photos.length < MAX_WARRANTY_PHOTOS && sending === null;
  return (
    <View style={{ gap: 22 }}>
      <Choice
        label={t("warranty.kindLabel")}
        options={WARRANTY_KINDS}
        text={(option) => t(`warranty.kind.${option}`)}
        value={draft.kind}
        onChange={draft.setKind}
        disabled={locked}
      />
      <Choice
        label={t("warranty.roomLabel")}
        options={WARRANTY_ROOMS}
        text={(option) => t(`warranty.room.${option}`)}
        value={draft.room}
        onChange={draft.setRoom}
        disabled={locked}
      />
      <View style={{ gap: 10 }}>
        <Text style={styles.label}>{t("warranty.descriptionLabel")}</Text>
        <TextInput
          accessibilityLabel={t("warranty.descriptionLabel")}
          value={draft.description}
          onChangeText={draft.setDescription}
          editable={!locked}
          multiline
          maxLength={MAX_WARRANTY_DESCRIPTION}
          placeholder={t("warranty.descriptionPlaceholder")}
          placeholderTextColor={colors.faint}
          style={styles.textarea}
        />
      </View>
      <View style={{ gap: 10 }}>
        <Text style={styles.label}>{t("warranty.photosLabel")}</Text>
        <View style={styles.photos}>
          {canAddPhoto && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("warranty.addPhoto")}
              onPress={draft.choosePhoto}
              style={({ pressed }) => [styles.photo, styles.addPhoto, pressed && { opacity: 0.6 }]}
            >
              <Feather name="camera" size={22} color={colors.verdeOlivaLight} />
            </Pressable>
          )}
          {photos.map((photo, index) => (
            <View key={photo.uri} style={styles.photo}>
              <Image source={{ uri: photo.uri }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
              {draft.removable(photo.uri) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("warranty.removePhoto", { number: index + 1 })}
                  onPress={() => draft.removePhoto(photo.uri)}
                  style={styles.remove}
                >
                  <View style={styles.removeDot}>
                    <Feather name="x" size={14} color={colors.blancoCalido} />
                  </View>
                </Pressable>
              )}
            </View>
          ))}
        </View>
        <Text style={type.meta}>{t("warranty.photosHint", { max: MAX_WARRANTY_PHOTOS })}</Text>
      </View>
      <View style={styles.urgent}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.row}>{t("warranty.urgent")}</Text>
          <Text style={type.meta}>{t("warranty.urgentHint")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("warranty.urgent")}
          value={draft.urgent}
          disabled={locked}
          onValueChange={draft.setUrgent}
          trackColor={{ false: colors.chipBorder, true: colors.verdeOliva }}
          thumbColor={draft.urgent ? "#f5f4f0" : colors.muted}
          ios_backgroundColor={colors.chipBorder}
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(error.key, error.params)}
        </Text>
      )}
      {sending && sending.total > 0 && (
        <Text accessibilityLiveRegion="polite" style={type.meta}>
          {t("warranty.sending", sending)}
        </Text>
      )}
    </View>
  );
}

/** One choice among chips (A-Warranty's type chips; the room too, as the app has no dropdown). */
function Choice<T extends string>({
  label,
  options,
  text,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly T[];
  text: (option: T) => string;
  value: T | null;
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <View style={{ gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const on = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled }}
              disabled={disabled}
              onPress={() => onChange(option)}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.chipText, on && { color: "#f5f4f0" }]}>{text(option)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  myClaims: { minHeight: 44, justifyContent: "center" },
  link: { fontSize: 14, color: colors.verdeOlivaLight },
  periods: { flexDirection: "row", gap: 8 },
  period: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  years: { fontSize: 22, fontWeight: "300", color: colors.blancoCalido },
  scope: { fontSize: 12, color: colors.muted },
  label: { ...type.label, letterSpacing: 2.4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.verdeOlivaDark, borderColor: colors.verdeOliva },
  chipText: { fontSize: 14, color: colors.blancoCalido },
  textarea: {
    minHeight: 112,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.md,
    color: colors.blancoCalido,
    fontSize: 16,
    lineHeight: 23,
    textAlignVertical: "top",
  },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  // Four to a row, as A-Warranty's grid.
  photo: { width: "23%", aspectRatio: 1, borderRadius: 10, overflow: "hidden", backgroundColor: colors.surface },
  addPhoto: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.markerTodo,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  // A 44 pt target in the tile's corner around the small round button.
  remove: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    padding: 4,
    alignItems: "flex-end",
  },
  removeDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.tabBar,
    alignItems: "center",
    justifyContent: "center",
  },
  urgent: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderColor: colors.divider,
    paddingTop: 14,
  },
  error: { fontSize: 14, lineHeight: 20, color: colors.destructive },
});
