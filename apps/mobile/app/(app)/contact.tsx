import Feather, { type FeatherIconName } from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileOffice, MobileSiteManager } from "@repo/core/contract";
import { LoadState } from "../../components/load-state";
import { PushedScreen } from "../../components/pushed-screen";
import { card, colors, type } from "../../constants/theme";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useProjectData } from "../../lib/use-project";

// Contacto — doc/mobile-app-design/A-Contact.dc.html: the site manager of the
// home shown (call, email) and the builder's office. Pushed from Inicio's
// shortcut and a payment's "Contactar"; its last row opens Garantía. Loads each time it opens. Not built:
// the mockup's "Mensaje" action and site-visit booking (no messaging or visits
// on the platform yet).

const getContact = (token: string, projectId: string | null) => api.getContact(token, projectId);

/** A phone number as the dialer takes it: digits and a leading +. */
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** "Javier Ruiz" → "JR"; one word (or an email) → its first letter. */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export default function ContactScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, error, retry } = useProjectData(getContact);

  /** Opens the dialer or the mail app; says so when the phone can't. */
  const open = (url: string, value: string) => {
    Linking.openURL(url).catch(() => Alert.alert(t("contact.openFailed", { value })));
  };

  return (
    <PushedScreen back={t("contact.back")}>
      <Text accessibilityRole="header" style={type.display}>
        {t("contact.title")}
      </Text>
      <LoadState
        loaded={data !== undefined}
        error={error}
        loadingLabel={t("contact.loading")}
        failedText={t("contact.loadFailed")}
        onRetry={retry}
      />
      {data && !data.siteManager && !data.office && <Text style={type.subhead}>{t("contact.empty")}</Text>}
      {data?.siteManager && <SiteManagerCard manager={data.siteManager} open={open} />}
      {data?.office && <Office office={data.office} open={open} />}
      {data && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate("/warranty")}
          style={({ pressed }) => [styles.row, styles.lastRow, pressed && { opacity: 0.6 }]}
        >
          <Feather name="shield" size={20} color={colors.muted} />
          <Text style={[type.row, { flex: 1 }]}>{t("contact.warranty")}</Text>
          <Feather name="chevron-right" size={18} color={colors.muted} />
        </Pressable>
      )}
    </PushedScreen>
  );
}

type Open = (url: string, value: string) => void;

function SiteManagerCard({ manager, open }: { manager: MobileSiteManager; open: Open }) {
  const { t } = useI18n();
  // An action whose data is missing isn't drawn.
  const actions = [
    manager.phone && {
      key: "call",
      icon: "phone" as const,
      label: t("contact.call"),
      a11y: t("contact.callName", { name: manager.name }),
      onPress: () => open(telUrl(manager.phone!), manager.phone!),
    },
    {
      key: "email",
      icon: "mail" as const,
      label: t("contact.email"),
      a11y: t("contact.emailName", { name: manager.name }),
      onPress: () => open(`mailto:${manager.email}`, manager.email),
    },
  ].filter((action) => !!action);

  return (
    <View style={styles.card}>
      <View style={styles.who}>
        <View style={styles.avatar}>
          <Text style={styles.initials}>{initials(manager.name)}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[type.label, { color: colors.verdeOlivaLight }]}>{t("contact.siteManager")}</Text>
          <Text style={styles.name}>{manager.name}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.a11y}
            onPress={action.onPress}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
          >
            <Feather name={action.icon} size={22} color={colors.verdeOlivaLight} />
            <Text style={[type.row, { fontSize: 13 }]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type Row = { key: string; icon: FeatherIconName; text: string; a11y?: string; onPress?: () => void };

function Office({ office, open }: { office: MobileOffice; open: Open }) {
  const { t } = useI18n();
  const rows: Row[] = [
    office.address && { key: "address", icon: "map-pin" as const, text: office.address },
    office.phone && {
      key: "phone",
      icon: "phone" as const,
      text: office.phone,
      a11y: t("contact.callOffice", { phone: office.phone }),
      onPress: () => open(telUrl(office.phone!), office.phone!),
    },
    office.email && {
      key: "email",
      icon: "mail" as const,
      text: office.email,
      a11y: t("contact.emailOffice", { email: office.email }),
      onPress: () => open(`mailto:${office.email}`, office.email!),
    },
    office.hours && { key: "hours", icon: "clock" as const, text: office.hours },
  ].filter((row) => !!row);

  return (
    <View>
      <Text accessibilityRole="header" style={[type.label, { marginBottom: 6 }]}>
        {t("contact.office", { name: office.name })}
      </Text>
      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        const content = (
          <>
            <Feather name={row.icon} size={20} color={colors.muted} />
            <Text style={[type.row, { flex: 1 }]}>{row.text}</Text>
          </>
        );
        return row.onPress ? (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityLabel={row.a11y}
            onPress={row.onPress}
            style={({ pressed }) => [styles.row, last && styles.lastRow, pressed && { opacity: 0.6 }]}
          >
            {content}
          </Pressable>
        ) : (
          <View key={row.key} style={[styles.row, last && styles.lastRow]}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...card, padding: 22, gap: 20 },
  who: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.verdeOscuro,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { fontSize: 20, fontWeight: "300", letterSpacing: 1.2, color: colors.blancoCalido },
  name: { fontSize: 18, fontWeight: "400", color: colors.blancoCalido },
  actions: { flexDirection: "row", gap: 8 },
  action: {
    flex: 1,
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
  lastRow: { borderBottomWidth: 0 },
});
