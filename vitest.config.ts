import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    // Each test file gets its own worker (fresh module globals / DB).
    isolate: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
