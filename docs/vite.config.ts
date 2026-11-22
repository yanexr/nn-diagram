import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served from GitHub Pages at https://yanexr.github.io/nn-diagram/.
export default defineConfig({
  base: "/nn-diagram/",
  plugins: [react()],
  build: {
    // The viewer compiles Tailwind classes in the browser, so its chunk is large.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "index.html"), editor: resolve(import.meta.dirname, "editor/index.html") },
    },
  },
});
