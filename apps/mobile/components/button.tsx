import {
  ActivityIndicator,
  Pressable,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radius, spacing } from "../constants/theme";

const variants = {
  primary: { backgroundColor: colors.verdeOliva, borderColor: colors.verdeOliva },
  secondary: { backgroundColor: "transparent", borderColor: colors.inputBorder },
} as const;

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: keyof typeof variants;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          ...variants[variant],
          borderWidth: 1,
          borderRadius: radius.md,
          borderCurve: "continuous",
          minHeight: 50,
          paddingHorizontal: spacing.lg,
          alignItems: "center",
          justifyContent: "center",
          opacity: inactive ? 0.6 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.blancoCalido} />
      ) : (
        <Text style={{ color: colors.blancoCalido, fontSize: 16, fontWeight: "500", letterSpacing: 0.5 }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
