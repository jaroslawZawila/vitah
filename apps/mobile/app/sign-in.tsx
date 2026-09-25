import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { colors } from "../constants/theme";
import { Button } from "../components/button";

export default function SignInScreen() {
  const {
    signIn,
    signInWithBiometrics,
    biometric,
    signedOut,
    token,
    isLoading: authLoading,
  } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // With biometric sign-in on, ask straight away (once) when the app opens
  // signed out, but not right after the client signs out themselves.
  const asked = useRef(false);
  useEffect(() => {
    if (!authLoading && !token && biometric && !signedOut && !asked.current) {
      asked.current = true;
      void handleBiometricSignIn();
    }
  });

  async function handleBiometricSignIn() {
    setError("");
    const result = await signInWithBiometrics(t("signIn.biometricPrompt"));
    if (result.error === "expired") setError(t("signIn.sessionExpired"));
  }

  if (authLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.verdeOliva} size="large" />
      </View>
    );
  }

  if (token) {
    return <Redirect href="/" />;
  }

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError(t("signIn.missingFields"));
      return;
    }
    setLoading(true);
    setError("");
    const result = await signIn(email.trim(), password);
    setLoading(false);
    if (result.error) {
      setError(t("signIn.invalidCredentials"));
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.inner}>
          {/* Logo */}
          <View style={styles.logoSection}>
            <Text style={styles.logo}>ViTAH</Text>
            <Text style={styles.tagline}>{t("signIn.tagline")}</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder={t("signIn.email")}
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
              returnKeyType="next"
            />
            <TextInput
              style={styles.input}
              placeholder={t("signIn.password")}
              placeholderTextColor={colors.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
              returnKeyType="go"
              onSubmitEditing={handleSignIn}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Button
              title={t("signIn.submit")}
              onPress={handleSignIn}
              loading={loading}
              style={{ marginTop: 4 }}
            />
            {biometric && (
              <Button
                title={t("signIn.biometric")}
                variant="secondary"
                onPress={() => void handleBiometricSignIn()}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.grafito,
  },
  splash: {
    flex: 1,
    backgroundColor: colors.grafito,
    justifyContent: "center",
    alignItems: "center",
  },
  kav: {
    flex: 1,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logoSection: {
    alignItems: "center",
    marginBottom: 64,
  },
  logo: {
    color: colors.blancoCalido,
    fontSize: 48,
    fontWeight: "300",
    letterSpacing: 14,
    marginBottom: 10,
  },
  tagline: {
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.blancoCalido,
    fontSize: 16,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: "center",
  },
});
