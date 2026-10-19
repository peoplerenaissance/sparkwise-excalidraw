import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./setupTests.ts"],
    globals: true,
    environment: "jsdom",
    // Since v2 hooks run in "stack" order (after-hooks reversed). Match upstream
    // excalidraw and run them in parallel so RTL cleanup precedes test-level
    // afterEach hooks, as the existing snapshots expect.
    sequence: { hooks: "parallel" },
    coverage: {
      reporter: ["text", "json-summary", "json", "html"],
      // v4 measures only the files a test imports unless `include` is set, so
      // list the sources (untested modules count against the totals) and
      // leave out the test helpers.
      include: ["excalidraw-app/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
      exclude: ["**/tests/**", "**/*.test.{ts,tsx}", "**/*.d.ts"],
      // v4 maps V8 coverage through the AST, which reports lower figures for
      // the same tests and files (v3: 70.7% lines, 81.1% branches, 68.6%
      // functions; v4: 66.1%, 59.7%, 64.9%). Each threshold keeps the margin
      // it had below the v3 figure.
      thresholds: {
        lines: 61,
        branches: 48,
        functions: 59,
        statements: 61,
      },
    },
  },
});
