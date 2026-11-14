import { defineConfig } from "vitest/config";

// The runner and the drift check are tested against scratch databases each
// test creates (and drops) on the local Postgres: see test/scratch.ts.
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Beside the other packages' suites in the commit gate, and some tests
    // start a `tsx` process: the default 5 s is too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
