import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "../components/button";

describe("Button", () => {
  it("calls onPress", () => {
    const onPress = jest.fn();
    render(<Button title="Reintentar" onPress={onPress} />);

    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));

    expect(onPress).toHaveBeenCalled();
  });

  it("shows a spinner and ignores presses while loading", () => {
    const onPress = jest.fn();
    render(<Button title="Iniciar sesión" onPress={onPress} loading />);

    const button = screen.getByRole("button", { name: "Iniciar sesión" });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    expect(screen.queryByText("Iniciar sesión")).not.toBeOnTheScreen();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("ignores presses while disabled", () => {
    const onPress = jest.fn();
    render(<Button title="Guardar" variant="secondary" onPress={onPress} disabled />);

    fireEvent.press(screen.getByRole("button", { name: "Guardar" }));

    expect(onPress).not.toHaveBeenCalled();
  });
});
