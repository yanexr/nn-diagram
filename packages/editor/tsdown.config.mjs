import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/loader.tsx"],
  format: "esm",
  platform: "browser",
  dts: { tsc: { eager: true } },
  // The shared shadcn components are internal: bundled, not a dependency.
  deps: { alwaysBundle: [/^@nn-diagram\/ui/] },
  // React Server Components frameworks (Next.js) treat the package as client code.
  banner: { js: '"use client";' },
});
