import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Les tests de base partagent une base locale : pas de parallélisme entre fichiers.
    fileParallelism: false,
  },
});
