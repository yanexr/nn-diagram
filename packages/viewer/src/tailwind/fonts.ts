/**
 * Curated open-source fonts (Google Fonts, SIL OFL). A diagram uses one with
 * its class (`font-inter`); the font is loaded only then, so diagrams look
 * the same everywhere and exports can embed it.
 */
export interface WebFont {
  /** Tailwind class, e.g. "font-inter". */
  cls: string;
  label: string;
  family: string;
  fallback: string;
  /** Google Fonts axes, e.g. "wght@400;700". */
  axes: string;
}

const UPRIGHT = "wght@400;500;600;700";
const ITALIC = "ital,wght@0,400;0,500;0,600;0,700;1,400;1,700";

export const WEB_FONTS: WebFont[] = [
  { cls: "font-inter", label: "Inter", family: "Inter", fallback: "sans-serif", axes: ITALIC },
  { cls: "font-geist", label: "Geist", family: "Geist", fallback: "sans-serif", axes: UPRIGHT },
  { cls: "font-plex-sans", label: "IBM Plex Sans", family: "IBM Plex Sans", fallback: "sans-serif", axes: ITALIC },
  { cls: "font-space-grotesk", label: "Space Grotesk", family: "Space Grotesk", fallback: "sans-serif", axes: UPRIGHT },
  { cls: "font-source-serif", label: "Source Serif", family: "Source Serif 4", fallback: "serif", axes: ITALIC },
  { cls: "font-plex-serif", label: "IBM Plex Serif", family: "IBM Plex Serif", fallback: "serif", axes: ITALIC },
  { cls: "font-math", label: "STIX Two (math)", family: "STIX Two Text", fallback: '"Latin Modern Roman", "Cambria Math", serif', axes: ITALIC },
  { cls: "font-jetbrains-mono", label: "JetBrains Mono", family: "JetBrains Mono", fallback: "monospace", axes: ITALIC },
  { cls: "font-plex-mono", label: "IBM Plex Mono", family: "IBM Plex Mono", fallback: "monospace", axes: ITALIC },
  { cls: "font-caveat", label: "Caveat (handwritten)", family: "Caveat", fallback: "cursive", axes: UPRIGHT },
];

/** `@theme` variables that define the font classes. */
export const WEB_FONT_THEME = WEB_FONTS.map((f) => `  --${f.cls}: "${f.family}", ${f.fallback};`).join("\n");

const byClass = new Map(WEB_FONTS.map((f) => [f.cls, f]));

/**
 * Adds the stylesheets of the fonts used by these Tailwind candidates
 * (`font-inter`, `md:font-inter`, …) and calls `onLoad` once they are ready.
 * The link is CORS-enabled so exports can read and embed the font files.
 */
export function loadWebFonts(candidates: string[], onLoad: () => void): void {
  if (typeof document === "undefined") return;
  for (const c of candidates) {
    const font = byClass.get(c.slice(c.lastIndexOf(":") + 1));
    if (!font) continue;
    const id = `nnd-${font.cls}`;
    if (document.getElementById(id)) continue;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.crossOrigin = "anonymous";
    link.href = `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, "+")}:${font.axes}&display=swap`;
    link.onload = () => {
      // Text is measured for layout: re-measure once the font files are in.
      void document.fonts.load(`16px "${font.family}"`).then(onLoad, onLoad);
    };
    document.head.appendChild(link);
  }
}
