import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
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
