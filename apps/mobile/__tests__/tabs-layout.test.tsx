import { render, screen } from "@testing-library/react-native";
import TabsLayout from "../app/(app)/(tabs)/_layout";

// A stand-in for expo-router's Tabs that lists each tab's route and title.
jest.mock("expo-router", () => {
  const { Text, View } = jest.requireActual("react-native");
  const Tabs = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Tabs.Screen = function Screen({ name, options }: { name: string; options: { title: string } }) {
    return <Text>{`${name}: ${options.title}`}</Text>;
  };
  return { Tabs };
});

describe("TabsLayout", () => {
  it("has the design's 5 tabs, in order", () => {
    render(<TabsLayout />);

    expect(screen.getAllByText(/: /).map((node) => node.props.children)).toEqual([
      "index: Inicio",
      "obra: Obra",
      "photos: Fotos",
      "documents: Documentos",
      "profile: Perfil",
    ]);
  });
});
