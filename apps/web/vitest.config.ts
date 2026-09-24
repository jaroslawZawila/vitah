import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { testDatabase } from "@repo/db/vitest";

process.env.NEXTAUTH_SECRET = "test-secret";

export default defineConfig({
  plugins: [react()],
  test: {
    ...testDatabase("vitah_web_test"),
    setupFiles: ["./test/setup.ts"],
  },
});
