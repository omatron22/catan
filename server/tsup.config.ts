import { defineConfig } from "tsup";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  external: ["socket.io"],
  esbuildOptions(options) {
    options.alias = {
      "@": path.resolve(__dirname, "../src"),
    };
  },
});
