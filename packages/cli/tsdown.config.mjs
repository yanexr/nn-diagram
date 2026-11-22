import { defineConfig } from "tsdown";

export default defineConfig([
  {
    // The command line tool (Node).
    entry: { cli: "src/cli.ts" },
    format: "esm",
    platform: "node",
    dts: false,
    outExtensions: () => ({ js: ".js" }),
    // The format package is small; bundling it keeps the CLI to two runtime dependencies.
    deps: { alwaysBundle: [/^@nn-diagram\//] },
  },
  {
    // The page `render` loads in a headless browser: the viewer's renderer
    // with React, bundled into one script.
    entry: { "render-page": "src/render-page.ts" },
    format: "iife",
    platform: "browser",
    dts: false,
    clean: false,
    minify: true,
    deps: { alwaysBundle: [/.*/] },
    define: { "process.env.NODE_ENV": '"production"' },
    // React's and lucide's "use client" markers mean nothing in a plain script.
    inputOptions: { onLog: (level, log, handler) => log.code !== "MODULE_LEVEL_DIRECTIVE" && handler(level, log) },
  },
]);
