import Feather, { type FeatherIconName } from "@react-native-vector-icons/feather";
import { Tabs } from "expo-router";
import { colors } from "../../../constants/theme";
import { useI18n, type MessageKey } from "../../../lib/i18n";

// The 5-tab bar of doc/mobile-app-design: Inicio · Obra · Fotos · Documentos · Perfil.

const TABS: { name: string; title: MessageKey; icon: FeatherIconName }[] = [
  { name: "index", title: "tabs.home", icon: "home" },
  { name: "obra", title: "tabs.obra", icon: "layers" },
  { name: "photos", title: "tabs.photos", icon: "image" },
  { name: "documents", title: "tabs.documents", icon: "file-text" },
  { name: "profile", title: "tabs.profile", icon: "user" },
];

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        // Every tab draws its own title.
        headerShown: false,
        sceneStyle: { backgroundColor: colors.grafito },
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.divider },
        tabBarActiveTintColor: colors.blancoCalido,
        tabBarInactiveTintColor: colors.inactive,
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(title),
            tabBarIcon: ({ color }) => <Feather name={icon} size={22} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
