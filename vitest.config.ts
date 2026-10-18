import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "dominio",
          include: ["domain/**/*.test.ts", "generation/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "backend",
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
