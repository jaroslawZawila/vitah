import { render, waitFor } from "@testing-library/react-native";
import RootLayout, { ErrorBoundary } from "../app/_layout";
import { ErrorFallback } from "../components/error-fallback";
import { installGlobalErrorHandlers } from "../lib/global-errors";
import { setReportScreen, setReportSession } from "../lib/report-error";
import { secureStore } from "../test-utils/secure-store";

let mockSegments = ["(app)", "obra", "pago", "[id]"];
jest.mock("expo-router", () => ({ Stack: () => null, useSegments: () => mockSegments }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("../lib/api", () => ({ api: {} }));
jest.mock("../lib/global-errors", () => ({ installGlobalErrorHandlers: jest.fn() }));
jest.mock("../lib/report-error", () => ({
  reportError: jest.fn(async () => {}),
  setReportScreen: jest.fn(),
  setReportSession: jest.fn(),
}));

beforeEach(() => secureStore.clear());

describe("RootLayout", () => {
  it("catches what no screen does: global handlers on start, and the fallback as its error boundary", () => {
    // Installed when the app's first module loads, before anything renders.
    expect(installGlobalErrorHandlers).toHaveBeenCalledTimes(1);
    expect(ErrorBoundary).toBe(ErrorFallback);
  });

  it("tells the reporter the route shown by its name, never its ids", async () => {
    const view = render(<RootLayout />);
    await waitFor(() => expect(setReportScreen).toHaveBeenLastCalledWith("/(app)/obra/pago/[id]"));

    mockSegments = ["sign-in"];
    view.rerender(<RootLayout />);
    await waitFor(() => expect(setReportScreen).toHaveBeenLastCalledWith("/sign-in"));
  });

  it("tells the reporter who is signed in, and when nobody is", async () => {
    secureStore.set("vitah_token", "stored-token");
    secureStore.set("vitah_user", JSON.stringify({ id: "u", email: "ana@example.com", name: "Ana", role: "client", tenantId: "t" }));

    render(<RootLayout />);

    expect(setReportSession).toHaveBeenCalledWith(null);
    await waitFor(() => expect(setReportSession).toHaveBeenLastCalledWith("stored-token"));
  });
});
