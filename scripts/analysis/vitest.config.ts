import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["scripts/analysis/*.test.ts"], environment: "node" } });
