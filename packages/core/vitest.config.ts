import { defineConfig } from "vitest/config";
import { testDatabase } from "@repo/db/vitest";

export default defineConfig({
  test: testDatabase("vitah_core_test"),
});
