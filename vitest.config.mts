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
      // Since v2, empty lines are ignored by default, which shifts the numbers;
      // keep the previous behavior (same as upstream excalidraw).
      ignoreEmptyLines: false,
      thresholds: {
        lines: 66,
        branches: 70,
        functions: 63,
        statements: 66,
      },
    },
  },
});
