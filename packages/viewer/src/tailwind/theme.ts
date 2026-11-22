/**
 * Default diagram theme ("paper"). Compiled together with the diagram's
 * Tailwind classes. Everything is scoped to `.nnd-root`, and dark mode is
 * `.nnd-root.nnd-dark`.
 *
 * Variants set CSS variables (--nnd-fill, --nnd-line, --nnd-text) that the
 * base element styles read. Tailwind utilities on an element (bg-red-100,
 * border-blue-500, text-white …) override them because utilities are in a
 * later cascade layer.
 */
import { WEB_FONT_THEME } from "./fonts";
import { PALETTE } from "@nn-diagram/format";

const c = (color: string, shade: number) => `var(--color-${color}-${shade})`;
/** Neutral grays (Tailwind's `gray` leans blue). */
const n = (shade: number) => c("neutral", shade);

/*
 * Colors follow the look of paper figures: soft pastel fills with a quieter,
 * slightly darker outline of the same hue, near-black text. Fills take a
 * little chroma out of the 100 shades and outlines mix the 400/500 shades
 * toward gray, so no hue turns neon (lime, cyan, fuchsia). Dark mode keeps
 * a gentle glow: tinted fills over the page and brighter outlines.
 */
function paletteVariant(name: string, color: string): string {
  return `
  .nnd-v-${name} {
    --nnd-fill: color-mix(in oklab, ${c(color, 100)} 82%, ${n(100)});
    --nnd-line: color-mix(in oklab, ${c(color, 500)} 62%, ${n(400)});
    --nnd-text: ${n(900)};
    --nnd-accent: ${c(color, 500)};
  }
  .nnd-dark .nnd-v-${name}, .nnd-dark.nnd-v-${name} {
    --nnd-fill: color-mix(in oklab, ${c(color, 500)} 20%, var(--nnd-page));
    --nnd-line: color-mix(in oklab, ${c(color, 400)} 68%, var(--nnd-page));
    --nnd-text: ${n(100)};
  }
  .nnd-v-panel-${name} {
    --nnd-fill: color-mix(in oklab, ${c(color, 50)} 88%, ${n(50)});
    --nnd-line: color-mix(in oklab, ${c(color, 200)} 80%, ${n(300)});
    --nnd-text: ${n(900)};
    --nnd-accent: ${c(color, 500)};
  }
  .nnd-dark .nnd-v-panel-${name}, .nnd-dark.nnd-v-panel-${name} {
    --nnd-fill: color-mix(in oklab, ${c(color, 500)} 8%, var(--nnd-page));
    --nnd-line: color-mix(in oklab, ${c(color, 400)} 32%, var(--nnd-page));
    --nnd-text: ${n(100)};
  }
  /* Doubled class: must beat .nnd-edge, which sets the default color later in the sheet. */
  .nnd-ev-${name}.nnd-ev-${name} { --nnd-edge: color-mix(in oklab, ${c(color, 600)} 85%, ${n(500)}); }
  .nnd-dark .nnd-ev-${name}.nnd-ev-${name} { --nnd-edge: color-mix(in oklab, ${c(color, 400)} 85%, ${n(400)}); }`;
}

const PANEL_SELECTOR = ["panel", ...PALETTE.map((p) => `panel-${p}`)].map((v) => `.nnd-box.nnd-v-${v}`).join(", ");

export const DIAGRAM_THEME_CSS = /* css */ `
@custom-variant dark (&:where(.nnd-dark, .nnd-dark *));

@theme {
${WEB_FONT_THEME}
}

@layer base {
  .nnd-root {
    --nnd-page: #ffffff;
    /* Isolates diagrams from a host app that sets --nnd-accent for its UI. */
    --nnd-accent: var(--nnd-fg);
    --nnd-fg: ${n(900)};
    --nnd-muted: ${n(500)};
    --nnd-stroke: ${n(400)};
    --nnd-edge-default: ${n(800)};
    --nnd-select: #4f46e5;
    --font-sans: var(--nnd-font-sans, "Inter", ui-sans-serif, system-ui, sans-serif);
    --font-mono: var(--nnd-font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace);
    position: relative;
    color: var(--nnd-fg);
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.25;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .nnd-root.nnd-dark {
    --nnd-page: #141414;
    --nnd-fg: ${n(100)};
    --nnd-muted: ${n(400)};
    --nnd-stroke: ${n(500)};
    --nnd-edge-default: ${n(300)};
    --nnd-select: #818cf8;
    color-scheme: dark;
  }
  .nnd-root *, .nnd-root ::before, .nnd-root ::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0 solid var(--nnd-line, var(--nnd-stroke));
  }
  .nnd-root img, .nnd-root svg { display: block; }
  .nnd-root .katex { font-size: 1.1em; }
}

@layer components {
  .nnd-page { position: absolute; inset: 0; background: var(--nnd-page); }
  .nnd-node { position: absolute; }
  .nnd-children { position: absolute; left: 0; top: 0; width: 0; height: 0; }

  /* ---------- Box ---------- */
  .nnd-box {
    --nnd-fill: #ffffff;
    --nnd-line: ${n(400)};
    --nnd-text: var(--nnd-fg);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2px 6px;
    background-color: var(--nnd-fill);
    border-width: 1px;
    border-color: var(--nnd-line);
    border-radius: 3px;
    color: var(--nnd-text);
  }
  .nnd-dark .nnd-box { --nnd-fill: #1d1d1d; --nnd-line: ${n(500)}; }
  .nnd-box.nnd-shape-ellipse { border-radius: 50%; }
  /* The person icon fills its box; its label sits below it. */
  .nnd-box.nnd-shape-person { align-items: flex-end; }
  .nnd-shape-person > .nnd-label { max-width: none; white-space: nowrap; transform: translateY(calc(100% + 6px)); }
  /* Positioned so it paints above SVG outlines drawn behind it. */
  .nnd-label { position: relative; display: block; max-width: 100%; overflow-wrap: break-word; }
  /* Single glyphs (operator letters): the renderer shifts them so their ink is centered. */
  .nnd-glyph { line-height: 1; white-space: nowrap; }

  .nnd-v-default { --nnd-fill: #ffffff; --nnd-line: ${n(400)}; }
  .nnd-dark .nnd-v-default { --nnd-fill: #1d1d1d; --nnd-line: ${n(500)}; }
  .nnd-v-outline { --nnd-fill: transparent; }
  .nnd-dark .nnd-v-outline { --nnd-fill: transparent; }
  .nnd-v-ghost { --nnd-fill: transparent; --nnd-line: transparent; }
  .nnd-dark .nnd-v-ghost { --nnd-fill: transparent; --nnd-line: transparent; }
  .nnd-v-panel { --nnd-fill: ${n(50)}; --nnd-line: ${n(200)}; }
  .nnd-dark .nnd-v-panel { --nnd-fill: #191919; --nnd-line: ${n(700)}; }
  ${PANEL_SELECTOR} {
    align-items: flex-start;
    justify-content: flex-start;
    text-align: left;
    padding: 6px 10px;
    border-radius: 10px;
    font-weight: 600;
  }
  /* The bold weight is for the panel's own title, not for the shapes inside it. */
  ${PANEL_SELECTOR.split(", ").map((s) => `${s} > .nnd-children`).join(", ")} { font-weight: 400; }
  .nnd-v-muted { --nnd-fill: ${n(50)}; --nnd-line: ${n(300)}; --nnd-text: ${n(600)}; }
  .nnd-dark .nnd-v-muted { --nnd-fill: #1b1b1b; --nnd-line: ${n(600)}; --nnd-text: ${n(300)}; }
  ${PALETTE.map((p) => paletteVariant(p, p)).join("\n")}

  /* ---------- Text ---------- */
  .nnd-text { display: flex; align-items: center; color: var(--nnd-fg); white-space: nowrap; }
  .nnd-text.nnd-auto { white-space: nowrap; }
  .nnd-tv-title { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
  .nnd-tv-heading { font-size: 15px; font-weight: 600; }
  .nnd-tv-caption { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--nnd-muted); }
  .nnd-tv-label { font-size: 12px; color: var(--nnd-muted); }
  .nnd-tv-math { font-family: var(--font-math); font-style: italic; font-size: 15px; }

  /* ---------- SVG-drawn shapes ---------- */
  .nnd-svg-shape { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
  .nnd-svg-shape .nnd-fill { fill: var(--nnd-fill); stroke: var(--nnd-line); }

  /* ---------- Op ---------- */
  .nnd-op {
    --nnd-fill: #ffffff;
    --nnd-line: var(--nnd-fg);
    --nnd-text: var(--nnd-fg);
    display: flex; align-items: center; justify-content: center;
    border-radius: 9999px; border-width: 1px; border-color: var(--nnd-line);
    background: var(--nnd-fill); color: var(--nnd-text);
    font-size: 10px; font-weight: 700; line-height: 1;
  }
  .nnd-dark .nnd-op { --nnd-fill: #1d1d1d; }
  .nnd-op[class*="nnd-v-"]:not(.nnd-v-default) { --nnd-fill: var(--nnd-accent); --nnd-line: var(--nnd-accent); --nnd-text: #fff; }

  /* ---------- Tokens / Neurons / Cuboid ---------- */
  .nnd-token { flex: none; background: var(--tok); box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--tok) 70%, black); }
  .nnd-dark .nnd-token { background: var(--tok-dark); }
  .nnd-token-dot { position: absolute; left: 50%; top: 50%; width: 2.5px; height: 2.5px; margin: -1.25px 0 0 -1.25px; border-radius: 9999px; background: var(--nnd-muted); }
  .nnd-neurons { --nnd-fill: #ffffff; --nnd-line: ${n(500)}; }
  .nnd-dark .nnd-neurons { --nnd-fill: #1d1d1d; --nnd-line: ${n(400)}; }
  .nnd-box.nnd-cuboid { padding: 0; border-radius: 0; }
  .nnd-brace { color: var(--nnd-fg); }
  .nnd-image { overflow: hidden; }

  /* ---------- Icon ---------- */
  .nnd-icon { color: var(--nnd-fg); }
  .nnd-icon[class*="nnd-v-"]:not(.nnd-v-default):not(.nnd-v-muted) { color: var(--nnd-accent); }
  .nnd-icon.nnd-v-muted { color: var(--nnd-muted); }

  /* ---------- Table ---------- */
  /* Defaults in :where() (no specificity), so variants and utilities override them. */
  :where(.nnd-table) { --nnd-fill: #ffffff; --nnd-line: ${n(400)}; --nnd-text: var(--nnd-fg); }
  :where(.nnd-dark .nnd-table) { --nnd-fill: #1d1d1d; --nnd-line: ${n(500)}; }
  .nnd-table {
    background: var(--nnd-fill); border: 1px solid var(--nnd-line); color: var(--nnd-text);
    overflow: hidden; border-radius: 2px;
  }
  /* Inner lines take the table's stroke (color, width, style), also in colored cells. */
  .nnd-cell {
    position: absolute; display: flex; align-items: center; justify-content: center; text-align: center;
    padding: 1px 4px; overflow: hidden; border-width: 0; border-style: inherit; border-color: inherit; color: var(--nnd-text);
  }
  .nnd-cell[class*="nnd-v-"] { background: var(--nnd-fill); }
  /* Header: a tint over the table's fill (so it follows custom fills too), or over the row's color. */
  .nnd-cell-head { font-weight: 600; background: color-mix(in oklab, var(--nnd-line) 28%, transparent); }
  .nnd-cell-head[class*="nnd-v-"] { background: color-mix(in oklab, var(--nnd-line) 28%, var(--nnd-fill)); }

  /* ---------- Audio ---------- */
  /* Defaults in :where() (no specificity), so color variants and utilities override them. */
  :where(.nnd-audio-box) { --nnd-fill: #ffffff; --nnd-line: ${n(300)}; --nnd-text: var(--nnd-fg); --nnd-accent: ${c("indigo", 500)}; }
  :where(.nnd-dark .nnd-audio-box) { --nnd-fill: #1d1d1d; --nnd-line: ${n(600)}; --nnd-accent: ${c("indigo", 400)}; }
  .nnd-audio-box { background: var(--nnd-fill); border: 1px solid var(--nnd-line); border-radius: 10px; color: var(--nnd-text); }
  .nnd-audio-button {
    flex: none; display: flex; align-items: center; justify-content: center; border-radius: 9999px;
    background: var(--nnd-accent); color: #fff; cursor: pointer;
  }
  .nnd-audio-button:hover { filter: brightness(1.08); }
  .nnd-audio-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nnd-audio-bar { fill: color-mix(in oklab, var(--nnd-fg) 28%, transparent); }
  .nnd-audio-played { fill: var(--nnd-accent); }
  .nnd-audio-time { flex: none; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--nnd-muted); }

  /* ---------- Edges ---------- */
  .nnd-edge { --nnd-edge: var(--nnd-edge-default); color: var(--nnd-edge); stroke: currentColor; stroke-width: 1px; fill: none; }
  .nnd-edge .nnd-line { stroke-dasharray: var(--nnd-dash, none); stroke-linejoin: round; }
  .nnd-edge .nnd-head-fill { fill: currentColor; stroke: none; }
  .nnd-edge .nnd-head-open { fill: none; }
  .nnd-edge .nnd-head-hollow { fill: var(--nnd-page); }
  .nnd-ev-muted { --nnd-edge: ${n(400)}; }
  .nnd-dark .nnd-ev-muted { --nnd-edge: ${n(500)}; }
  .nnd-edge-label {
    position: absolute; transform: translate(-50%, -50%);
    font-size: 11px; line-height: 1.2; white-space: nowrap; padding: 0 3px; color: var(--nnd-fg);
  }

  /* ---------- Steps / highlighting ---------- */
  /* Nested dimmed elements do not multiply their opacity. Light pages need less dimming. */
  .nnd-dim { opacity: 0.35; transition: opacity 160ms ease; }
  .nnd-dark .nnd-dim { opacity: 0.25; }
  .nnd-dim .nnd-dim { opacity: 1; }
  .nnd-focus { transition: opacity 160ms ease; }
}
`;
