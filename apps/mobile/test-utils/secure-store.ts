import * as SecureStore from "expo-secure-store";

/** The in-memory SecureStore from test-utils/setup.ts. */
export const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
