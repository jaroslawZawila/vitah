import Feather from "@expo/vector-icons/Feather";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../components/button";
import { colors, spacing, type } from "../constants/theme";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { isStrongPassword } from "@repo/core/contract";
import type { Messages } from "../messages/es";
import { passwordStrength } from "../lib/password-strength";

// Pushed from Perfil — doc/mobile-app-design/A-Password.dc.html. No tab bar;
// the primary action sits at the bottom.

type FormError = keyof Messages["password"]["errors"];

export default function PasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, signOut } = useAuth();
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [saving, setSaving] = useState(false);
  const strength = passwordStrength(next);

  if (!token) return <Redirect href="/sign-in" />;

  async function save() {
    const problem: FormError | null =
      !current || !next || !repeat
        ? "missing_fields"
        : !isStrongPassword(next)
          ? "weak_password"
          : next !== repeat
            ? "mismatch"
            : null;
    setError(problem);
    if (problem || !token) return;

    setSaving(true);
    const result = await api.changePassword(token, current, next);
    setSaving(false);
    if (result.ok) {
      Alert.alert(t("password.saved"));
      router.back();
    } else if (result.error === "unauthorized") {
      await signOut();
    } else if (result.error === "wrong_password" || result.error === "weak_password") {
      setError(result.error);
    } else {
      setError("failed");
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.grafito }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: 26,
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={8}
          style={styles.back}
        >
          <Feather name="chevron-left" size={24} color={colors.blancoCalido} />
        </Pressable>

        <View style={{ gap: spacing.sm }}>
          <Text accessibilityRole="header" style={type.display}>
            {t("password.title")}
          </Text>
          <Text style={[type.subhead, { lineHeight: 22 }]}>{t("password.rule")}</Text>
        </View>

        <View style={{ gap: 20, flexGrow: 1 }}>
          <Field label={t("password.current")} value={current} onChange={setCurrent} />
          <View style={{ gap: spacing.sm }}>
            <Field
              label={t("password.new")}
              value={next}
              onChange={setNext}
              valid={isStrongPassword(next)}
            />
            {strength && (
              <View style={{ gap: spacing.sm }} accessibilityLiveRegion="polite">
                <View style={styles.meter}>
                  {[0, 1, 2, 3].map((i) => (
                    <View
                      key={i}
                      style={[styles.bar, i < strength.bars && { backgroundColor: colors.verdeOlivaLight }]}
                    />
                  ))}
                </View>
                <Text
                  style={{
                    fontSize: 13,
                    color: strength.bars >= 3 ? colors.verdeOlivaLight : colors.muted,
                  }}
                >
                  {t(`password.strength.${strength.label}`)}
                </Text>
              </View>
            )}
          </View>
          <Field label={t("password.repeat")} value={repeat} onChange={setRepeat} />
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {t(`password.errors.${error}`)}
            </Text>
          )}
        </View>

        <Button title={t("password.save")} onPress={() => void save()} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  valid = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  valid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.label, { letterSpacing: 2.2 }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, (focused || valid) && { borderColor: colors.verdeOliva }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    width: 44,
    height: 44,
    marginLeft: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    height: 52,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 8,
    color: colors.blancoCalido,
    fontSize: 16,
  },
  meter: { flexDirection: "row", gap: 4 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.chipBorder },
  error: { color: colors.error, fontSize: 13 },
});
