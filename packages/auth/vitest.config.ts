import { defineConfig } from "vitest/config";
import { testDatabase } from "@repo/db/vitest";

process.env.NEXTAUTH_SECRET = "test-secret";

export default defineConfig({
  test: testDatabase("vitah_auth_test"),
});
