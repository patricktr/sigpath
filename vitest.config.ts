import { defineConfig } from "vitest/config";

// Unit tests run on pure domain/flow logic (no DOM), so a plain node environment is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
