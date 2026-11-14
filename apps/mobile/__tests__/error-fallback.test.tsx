import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Component, type ReactNode } from "react";
import { Text } from "react-native";
import { ErrorFallback } from "../components/error-fallback";
import { reportError } from "../lib/report-error";
import { secureStore } from "../test-utils/secure-store";

jest.mock("../lib/report-error", () => ({ reportError: jest.fn(async () => {}) }));

/** What Expo Router wraps a route that exports `ErrorBoundary` in (its `Try`). */
class Try extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  retry = () => new Promise<void>((resolve) => this.setState({ error: undefined }, resolve));
  render() {
    const { error } = this.state;
    return error ? <ErrorFallback error={error} retry={this.retry} /> : this.props.children;
  }
}

let broken = true;
function Screen() {
  if (broken) throw new TypeError("Cannot read property 'hitos' of undefined");
  return <Text>Avance de obra</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  secureStore.clear();
  broken = true;
  // React logs what a boundary catches.
  jest.spyOn(console, "error").mockImplementation(() => {});
  // A Spanish phone, wherever the tests run.
  jest
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockReturnValue({ locale: "es-ES" } as Intl.ResolvedDateTimeFormatOptions);
});
afterEach(() => jest.restoreAllMocks());

describe("ErrorFallback", () => {
  it("shows a calm message instead of the broken screen, and reports the error as fatal", async () => {
    render(
      <Try>
        <Screen />
      </Try>,
    );

    expect(screen.getByRole("header", { name: "Algo no ha ido bien" })).toBeOnTheScreen();
    expect(screen.getByText("La app ha tenido un problema inesperado. Vuelve a intentarlo.")).toBeOnTheScreen();
    expect(screen.getByText("ViTAH")).toBeOnTheScreen();
    // Nothing technical.
    expect(screen.queryByText(/hitos|TypeError|undefined/)).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "Cannot read property 'hitos' of undefined" }), {
      fatal: true,
    });
    await act(async () => {}); // The stored language is read.
  });

  it("tries the screen again", async () => {
    render(
      <Try>
        <Screen />
      </Try>,
    );
    broken = false;

    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Reintentar" })));

    expect(screen.getByText("Avance de obra")).toBeOnTheScreen();
    expect(screen.queryByText("Algo no ha ido bien")).toBeNull();
  });

  it("speaks the language the client chose in the app", async () => {
    secureStore.set("vitah_language", "en");

    render(<ErrorFallback error={new Error("boom")} retry={async () => {}} />);

    expect(await screen.findByRole("header", { name: "Something went wrong" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Try again" })).toBeOnTheScreen();
  });

  it("reports each error once, not on every render", async () => {
    const error = new Error("boom");
    const view = render(<ErrorFallback error={error} retry={async () => {}} />);
    view.rerender(<ErrorFallback error={error} retry={async () => {}} />);
    await act(async () => {});

    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
