/**
 * Compiles the Tailwind classes used in diagrams, in the browser.
 *
 * Diagram files are content, not source code, so a build step never sees
 * their classes. Instead we run Tailwind's compiler on the classes found in
 * the loaded documents and inject the result into one <style> element.
 *
 * The output is scoped to `.nnd-root` so it cannot change the host page,
 * which may use its own Tailwind build with a different theme.
 */
import { walk, type ElementNode } from "@nn-diagram/format";
import { compile } from "tailwindcss";
import { TAILWIND_THEME_CSS, TAILWIND_UTILITIES_CSS } from "./sources.generated";
import { loadWebFonts } from "./fonts";
import { DIAGRAM_THEME_CSS } from "./theme";

const STYLE_ID = "nn-diagram-styles";

const INPUT_CSS = `
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme) theme(static);
@import "tailwindcss/utilities.css" layer(utilities);
${DIAGRAM_THEME_CSS}
`;

type Compiler = Awaited<ReturnType<typeof compile>>;

let compilerPromise: Promise<Compiler> | null = null;
let queue: Promise<void> = Promise.resolve();
const known = new Set<string>();
let lastCss = "";
let cssVersion = 0;
const cssListeners = new Set<() => void>();

/** Subscribes to stylesheet updates (for layout that reads computed styles). */
export function subscribeCss(listener: () => void): () => void {
  cssListeners.add(listener);
  return () => cssListeners.delete(listener);
}
export const getCssVersion = () => cssVersion;

function getCompiler(): Promise<Compiler> {
  compilerPromise ??= compile(INPUT_CSS, {
    base: "/",
    loadStylesheet: async (id: string) => {
      if (id === "tailwindcss/theme.css") return { path: id, base: "/", content: TAILWIND_THEME_CSS };
      if (id === "tailwindcss/utilities.css") return { path: id, base: "/", content: TAILWIND_UTILITIES_CSS };
      throw new Error(`Diagram styles cannot import "${id}"`);
    },
  });
  return compilerPromise;
}

/** Finds the matching closing brace for the `{` at `open`. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return css.length - 1;
}

/** Moves theme variables onto `.nnd-root` and nests utilities under it. */
export function scopeCss(css: string): string {
  let out = css.replace(/:root,\s*:host/g, ".nnd-root");
  let from = 0;
  for (;;) {
    const at = out.indexOf("@layer utilities {", from);
    if (at === -1) break;
    const open = out.indexOf("{", at);
    const close = matchBrace(out, open);
    const body = out.slice(open + 1, close);
    const wrapped = `{\n.nnd-root {${body}}\n`;
    out = out.slice(0, open) + wrapped + out.slice(close);
    from = open + wrapped.length;
  }
  return out;
}

function inject(css: string): void {
  if (typeof document === "undefined" || css === lastCss) return;
  lastCss = css;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
  cssVersion++;
  for (const listener of cssListeners) listener();
}

/** Splits class strings into Tailwind candidates. */
export function classCandidates(classes: Iterable<string>): string[] {
  const out: string[] = [];
  for (const cls of classes) {
    for (const token of cls.split(/\s+/)) if (token) out.push(token);
  }
  return out;
}

export function collectClasses(root: ElementNode): string[] {
  const classes: string[] = [];
  walk(root, (node) => {
    const cls = node.props.className;
    if (typeof cls === "string") classes.push(cls);
  });
  return classes;
}

/**
 * Makes sure CSS exists for the given class strings. Resolves once the
 * stylesheet is updated. Calls are serialized; repeated classes are free.
 */
export function ensureClasses(classes: Iterable<string>): Promise<void> {
  const fresh = classCandidates(classes).filter((c) => !known.has(c));
  if (fresh.length === 0 && lastCss) return queue;
  for (const c of fresh) known.add(c);
  loadWebFonts(fresh, () => {
    cssVersion++;
    for (const listener of cssListeners) listener();
  });
  queue = queue.then(async () => {
    const compiler = await getCompiler();
    inject(scopeCss(compiler.build(fresh)));
  });
  return queue;
}

/** Returns the current diagram stylesheet text (used by exports). */
export function getDiagramCss(): string {
  return lastCss;
}
