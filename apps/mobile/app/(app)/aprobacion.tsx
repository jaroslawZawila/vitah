import Feather from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { BudgetApprovalStatus, MobileApproval } from "@repo/core/contract";
import { Button } from "../../components/button";
import { LoadState } from "../../components/load-state";
import { SectionLabel, obraStyles } from "../../components/obra-parts";
import { PushedScreen } from "../../components/pushed-screen";
import { card, colors, spacing, type } from "../../constants/theme";
import type { ApiError } from "../../lib/api";
import { api } from "../../lib/api";
import { changeNumber, signedMoney } from "../../lib/approval";
import { useAuth } from "../../lib/auth";
import { useDocuments } from "../../lib/documents";
import { formatMoney, formatShare } from "../../lib/format";
import { openDocumentCopy } from "../../lib/hito-files";
import { useI18n } from "../../lib/i18n";
import { useApproval } from "../../lib/use-approval";
import { useObra } from "../../lib/use-obra";

// A change to the contract for the client to approve or reject — no mockup:
// the language of A-Hito.dc.html and A-Obra-Pagos.dc.html (doc/mobile-app-
// design/README.md › "Cambio para aprobar"). Pushed from Inicio's card or a
// push. The client's answer is evidence of consent; their team registers
// the acceptance afterwards.

type Step = "review" | "approve" | "reject";
/** What the answer screen says once the server has it. */
type Done = Extract<BudgetApprovalStatus, "approved" | "rejected">;

/** The error codes the screen words; anything else is "failed". */
const ERRORS = ["wrong_password", "too_many_attempts", "approval_closed", "missing_fields"] as const;
type FormError = (typeof ERRORS)[number] | "failed";
const formError = (error: ApiError): FormError =>
  (ERRORS as readonly string[]).includes(error) ? (error as FormError) : "failed";
/** The longest reason the server takes (core `inputs/budget-approvals.ts`); a longer one would be refused. */
const MAX_REASON = 1_000;

export default function ApprovalScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { approval, error, retry, reload } = useApproval();
  const [done, setDone] = useState<Done | null>(null);

  if (done) {
    return (
      <PushedScreen
        back={t("approval.back")}
        footer={<Button title={t("approval.backHome")} style={{ flex: 1 }} onPress={() => router.navigate("/")} />}
      >
        <View style={{ gap: 12 }}>
          <Feather name={done === "approved" ? "check-circle" : "x-circle"} size={32} color={colors.verdeOlivaLight} />
          <Text accessibilityRole="header" style={type.display}>
            {t(`approval.done.${done}`)}
          </Text>
          <Text style={[type.subhead, { lineHeight: 22 }]}>{t(`approval.done.${done}Text`)}</Text>
        </View>
      </PushedScreen>
    );
  }

  if (!approval) {
    return (
      <PushedScreen back={t("approval.back")}>
        <LoadState
          loaded={approval !== undefined}
          error={error}
          loadingLabel={t("approval.loading")}
          failedText={t("approval.loadFailed")}
          onRetry={retry}
        />
        {approval === null && <Text style={type.subhead}>{t("approval.none")}</Text>}
      </PushedScreen>
    );
  }
  // A new request (replaced, or another home's from a push) starts afresh.
  return <Request key={approval.id} approval={approval} onDone={setDone} onClosed={reload} />;
}

function Request({
  approval,
  onDone,
  onClosed,
}: {
  approval: MobileApproval;
  onDone: (status: Done) => void;
  /** The request is no longer open: reload to show what is. */
  onClosed: () => unknown;
}) {
  const { token, signOut } = useAuth();
  const { t, language } = useI18n();
  const { reload: reloadObra } = useObra();
  const documents = useDocuments();
  const [step, setStep] = useState<Step>("review");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [sending, setSending] = useState(false);
  const money = (cents: number) => formatMoney(cents, language);
  const vat = (cents: number) => Math.round((cents * approval.vatRateBp) / 10_000);

  async function send() {
    if (!token) return;
    const body =
      step === "approve" ? { decision: "approve" as const, password } : { decision: "reject" as const, reason: reason.trim() };
    if ((step === "approve" && !password) || (step === "reject" && !reason.trim())) {
      setError("missing_fields");
      return;
    }
    setSending(true);
    setError(null);
    const result = await api.decideApproval(token, approval.id, body);
    setSending(false);
    if (result.ok) {
      // Inicio's card goes: the server moved the obra's counter.
      void reloadObra();
      onDone(result.data.approval.status === "approved" ? "approved" : "rejected");
    } else if (result.error === "unauthorized") {
      await signOut();
    } else {
      setError(formError(result.error));
      if (result.error === "wrong_password") setPassword("");
      if (result.error === "approval_closed") void onClosed();
    }
  }

  async function openPdf() {
    if (!token || !approval.documentId) return;
    try {
      const local = documents.documents?.find((d) => d.id === approval.documentId);
      if (local && (await documents.open(local))) return;
      await openDocumentCopy(token, approval.documentId);
    } catch {
      Alert.alert(t("approval.openFailed"));
    }
  }

  const cancel = () => {
    setStep("review");
    setError(null);
    setPassword("");
  };
  const footer =
    step === "review" ? (
      <>
        <View style={{ flex: 1 }}>
          <Button title={t("approval.reject")} variant="secondary" onPress={() => setStep("reject")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t("approval.approve")} onPress={() => setStep("approve")} />
        </View>
      </>
    ) : (
      <>
        <View style={{ flex: 1 }}>
          <Button title={t("approval.cancel")} variant="secondary" onPress={cancel} disabled={sending} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title={step === "approve" ? t("approval.confirmApprove") : t("approval.confirmReject")}
            onPress={() => void send()}
            loading={sending}
          />
        </View>
      </>
    );

  return (
    <PushedScreen back={t("approval.back")} footer={footer}>
      <View style={{ gap: 8 }}>
        <Text style={type.label}>{t("approval.label", { number: approval.revisionNumber })}</Text>
        <Text accessibilityRole="header" style={[type.display, { lineHeight: 34 }]}>
          {t("approval.title")}
        </Text>
      </View>

      {approval.changeReason && (
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("approval.reason")}</SectionLabel>
          <Text style={[type.row, { lineHeight: 22 }]}>{approval.changeReason}</Text>
        </View>
      )}

      {approval.message && (
        <View style={styles.message}>
          <Text style={obraStyles.smallLabel}>{t("approval.message")}</Text>
          <Text style={[type.row, { lineHeight: 22 }]}>{approval.message}</Text>
        </View>
      )}

      <View style={styles.amounts}>
        <View style={obraStyles.between}>
          <Text style={type.meta}>{t("approval.before")}</Text>
          <Text style={type.row}>{money(approval.beforeCents)}</Text>
        </View>
        <View style={obraStyles.between}>
          <Text style={type.meta}>{t("approval.after")}</Text>
          <Text style={type.row}>{money(approval.afterCents)}</Text>
        </View>
        <View style={[obraStyles.between, styles.total]}>
          <Text style={type.label}>{t("approval.difference")}</Text>
          <Text style={styles.totalAmount}>{signedMoney(approval.differenceCents, language)}</Text>
        </View>
        <Text style={type.meta}>
          {t("approval.vatNote", {
            rate: formatShare(approval.vatRateBp, language),
            amount: signedMoney(approval.differenceCents + vat(approval.differenceCents), language),
          })}
        </Text>
      </View>

      {approval.changes.length > 0 && (
        <View>
          <SectionLabel>{t("approval.changes")}</SectionLabel>
          {approval.changes.map((change) => (
            <View key={change.number} style={obraStyles.checkRow}>
              <Text style={[type.row, { flex: 1, paddingVertical: 12, lineHeight: 21 }]}>
                <Text style={{ color: colors.muted }}>{t("approval.changeRef", { number: changeNumber(change.number) })}</Text>{" "}
                {change.description}
              </Text>
            </View>
          ))}
        </View>
      )}

      {approval.options.length > 0 && (
        <View>
          <SectionLabel>{t("approval.options")}</SectionLabel>
          {approval.options.map((option) => (
            <View key={option.name} style={obraStyles.checkRow}>
              <Text style={[type.row, { flex: 1 }]}>{option.name}</Text>
              <Text style={type.meta}>{signedMoney(option.priceCents, language)}</Text>
            </View>
          ))}
        </View>
      )}

      {approval.documentId && (
        <View>
          <SectionLabel>{t("approval.document")}</SectionLabel>
          <Pressable
            accessibilityRole="button"
            onPress={() => void openPdf()}
            style={({ pressed }) => [styles.docRow, pressed && { opacity: 0.6 }]}
          >
            <Feather name="file-text" size={22} color={colors.verdeOlivaLight} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.row}>{t("approval.documentName", { number: approval.revisionNumber })}</Text>
              <Text style={type.meta}>{t("approval.documentMeta")}</Text>
            </View>
            <Feather name="download" size={20} color={colors.muted} />
          </Pressable>
        </View>
      )}

      {step === "approve" && (
        <Field
          label={t("approval.password")}
          hint={t("approval.passwordHint")}
          value={password}
          onChange={setPassword}
          secure
        />
      )}
      {step === "reject" && (
        <Field
          label={t("approval.rejectReason")}
          hint={t("approval.rejectHint")}
          value={reason}
          onChange={setReason}
          maxLength={MAX_REASON}
        />
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(`approval.errors.${error}`)}
        </Text>
      )}

      <Text style={type.meta}>{t("approval.consent")}</Text>
    </PushedScreen>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  secure = false,
  maxLength,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
  maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.label, { letterSpacing: 2.2 }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        secureTextEntry={secure}
        maxLength={maxLength}
        multiline={!secure}
        autoCapitalize={secure ? "none" : "sentences"}
        autoCorrect={!secure}
        autoFocus
        style={[styles.input, !secure && styles.multiline, focused && { borderColor: colors.verdeOliva }]}
      />
      <Text style={type.meta}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  message: { ...card, padding: 20, gap: 8 },
  amounts: { ...card, paddingHorizontal: 24, paddingVertical: 22, gap: 12 },
  total: { borderTopWidth: 1, borderColor: colors.surfaceBorder, paddingTop: 14 },
  totalAmount: { fontSize: 26, fontWeight: "300", color: colors.blancoCalido },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    borderBottomWidth: 1,
    borderColor: colors.divider,
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
  multiline: { height: 104, paddingTop: 14, textAlignVertical: "top" },
  error: { color: colors.error, fontSize: 13 },
});
