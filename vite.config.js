import { defineConfig } from "vite";

// base "./" keeps every asset URL relative, so the export works at a gateway subpath or an ENS name.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2020" },
});
