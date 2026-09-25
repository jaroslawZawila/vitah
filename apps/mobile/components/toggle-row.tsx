import Feather from "@expo/vector-icons/Feather";
import { StyleSheet, Switch, Text, View } from "react-native";
import { colors, type } from "../constants/theme";

/** A settings row with a switch: A-Settings.dc.html (Face ID, notifications). */
export function ToggleRow({
  icon,
  label,
  hint,
  value,
  disabled = false,
  onChange,
}: {
  icon?: keyof typeof Feather.glyphMap;
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={[styles.row, hint ? { minHeight: 60 } : null]}>
      {icon && <Feather name={icon} size={20} color={colors.muted} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, color: colors.blancoCalido }}>{label}</Text>
        {hint && <Text style={[type.subhead, { fontSize: 13 }]}>{hint}</Text>}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.chipBorder, true: colors.verdeOliva }}
        thumbColor={value ? "#f5f4f0" : colors.muted}
        ios_backgroundColor={colors.chipBorder}
      />
    </View>
  );
}

export const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
});
