import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static PWA build (D9). The two LGPL WASM modules (OCCT, planegcs) stay as
// separate, replaceable .wasm assets — they are imported with ?url, never inlined.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    assetsInlineLimit: (file) => (file.endsWith(".wasm") ? false : undefined),
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: { exclude: ["replicad-opencascadejs", "@salusoft89/planegcs"] },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
