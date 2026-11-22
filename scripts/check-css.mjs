// Fails when a prebuilt stylesheet reads a CSS variable that nothing defines.
// Runs after the Tailwind step in the viewer and editor builds:
//   node ../../scripts/check-css.mjs dist/styles.css
import { readFileSync } from "node:fs";

// Set at runtime by Base UI (inline styles) or optional with a fallback.
const RUNTIME = new Set(["--anchor-width", "--anchor-height", "--available-width", "--available-height", "--transform-origin"]);

const file = process.argv[2];
const css = readFileSync(file, "utf8");
const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const missing = new Set();
for (const m of css.matchAll(/var\((--[\w-]+)\s*([,)])/g)) {
  const [, name, next] = m;
  if (next === "," || defined.has(name) || RUNTIME.has(name)) continue; // has a fallback, or defined
  missing.add(name);
}
if (missing.size) {
  console.error(`${file} uses undefined CSS variables: ${[...missing].join(", ")}`);
  process.exit(1);
}
