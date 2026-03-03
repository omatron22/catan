import { defineConfig } from "tsup";
import path from "path";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Only bundle our app code (shared/server engine); keep node_modules external
  external: ["socket.io"],
  esbuildOptions(options) {
    options.alias = {
      "@": path.resolve(__dirname, "../src"),
    };
  },
});
