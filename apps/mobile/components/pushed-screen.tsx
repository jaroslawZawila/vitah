import Feather from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../constants/theme";

/**
 * A screen pushed over the tabs (no tab bar): a back link with the previous
 * screen's name, then the content. `footer` is a fixed bottom action bar.
 */
export function PushedScreen({
  back,
  children,
  footer,
}: {
  back: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.grafito }}>
      <ScrollView
        contentContainerStyle={{
          gap: 30,
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xl,
        }}
      >
        <Pressable
          accessibilityRole="button"
          // Opened directly (a link, a restored app): nothing to go back to.
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/obra"))}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <Feather name="chevron-left" size={22} color={colors.blancoCalido} />
          <Text style={styles.backText}>{back}</Text>
        </Pressable>
        {children}
      </ScrollView>
      {footer && <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>{footer}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, marginLeft: -8, marginBottom: -18 },
  backText: { fontSize: 15, color: colors.blancoCalido },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.tabBar,
    borderTopWidth: 1,
    borderColor: colors.divider,
  },
});
