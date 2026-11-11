import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  base: "./",
  // The panel shows this, so the version comes from package.json instead of
  // being typed into the HTML a second time.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
  },
  // MediaPipe's WASM glue calls importScripts, so the tracker worker must be a
  // classic worker. Vite emits workers as IIFE with this setting.
  worker: {
    format: "iife",
  },
});
