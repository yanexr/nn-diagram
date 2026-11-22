/**
 * Reading and changing Tailwind classes from the property panel.
 *
 * Setting a value removes the group's current class and merges the new one
 * with tailwind-merge, so other conflicting classes are replaced too.
 * Variants such as `dark:` are left alone.
 */
import { twMerge } from "tailwind-merge";
import { WEB_FONTS } from "@nn-diagram/viewer";
import type { ColorValue } from "./panels/controls";

export type ClassGroup =
  | "fill"
  | "stroke"
  | "strokeWidth"
  | "strokeStyle"
  | "radius"
  | "textColor"
  | "fontSize"
  | "fontWeight"
  | "fontStyle"
  | "fontFamily"
  | "textAlign"
  | "alignItems"
  | "justify"
  | "padding"
  | "opacity"
  | "lineHeight"
  | "tracking"
  | "overflow"
  | "edgeColor"
  | "edgeWidth";

const PATTERNS: Record<ClassGroup, RegExp> = {
  fill: /^bg-(?!(?:none|gradient|linear|radial|conic|clip|origin|repeat|no-repeat|fixed|local|scroll|blend|auto|cover|contain|center|top|bottom|left|right)\b)(.+)$/,
  stroke: /^border-(?!(?:\d|\[\d|x\b|y\b|t\b|r\b|b\b|l\b|s\b|e\b|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing)).+$/,
  strokeWidth: /^border(?:-(\d+|\[[\d.]+px\]))?$/,
  strokeStyle: /^border-(solid|dashed|dotted|double|none)$/,
  radius: /^rounded(?:-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[.+\]))?$/,
  textColor: /^text-(?!(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)\b)(?!\[\d)(.+)$/,
  fontSize: /^text-(xs|sm|base|lg|xl|\dxl|\[\d.+\])$/,
  fontWeight: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  fontStyle: /^(italic|not-italic)$/,
  fontFamily: new RegExp(`^(font-(sans|serif|mono)|${WEB_FONTS.map((f) => f.cls).join("|")})$`),
  textAlign: /^text-(left|center|right|justify)$/,
  alignItems: /^items-(start|center|end|baseline|stretch)$/,
  justify: /^justify-(start|center|end|between|around|evenly)$/,
  padding: /^p-(.+)$/,
  opacity: /^opacity-(.+)$/,
  lineHeight: /^leading-(.+)$/,
  tracking: /^tracking-(.+)$/,
  overflow: /^overflow-(hidden|visible|clip)$/,
  edgeColor: /^text-(?!(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify)\b)(?!\[\d)(.+)$/,
  edgeWidth: /^stroke-(\d+(?:\.\d+)?|\[[\d.]+px\])$/,
};

/** True for classes with a variant prefix like `dark:` or `hover:` (colons inside [...] do not count). */
function isVariant(cls: string): boolean {
  return cls.replace(/\[[^\]]*\]/g, "").includes(":");
}

export function splitClasses(className: string | undefined): string[] {
  return (className ?? "").split(/\s+/).filter(Boolean);
}

/** Sets (or with null removes) the class of a group. */
export function setClass(className: string | undefined, group: ClassGroup, value: string | null): string {
  const kept = splitClasses(className).filter((c) => isVariant(c) || !PATTERNS[group].test(c));
  if (!value) return kept.join(" ");
  return twMerge(kept.join(" "), value);
}

/** The class of a group currently on the element (ignores variants like dark:). */
export function getClass(className: string | undefined, group: ClassGroup): string | null {
  const classes = splitClasses(className).filter((c) => !isVariant(c));
  for (let i = classes.length - 1; i >= 0; i--) if (PATTERNS[group].test(classes[i])) return classes[i];
  return null;
}

/** bg-red-200/50 → { token: "red-200", alpha: 50 }; border-[#ff0000] → { token: "#ff0000", alpha: 100 }. */
export function colorOf(cls: string | null): ColorValue | null {
  if (!cls) return null;
  const m = /^[a-z]+-(\[[^\]]+\]|[a-z]+(?:-\d+)?)(?:\/(\d+))?$/.exec(cls);
  if (!m) return null;
  const token = m[1].startsWith("[") ? m[1].slice(1, -1) : m[1];
  // The theme's own color at some opacity, e.g. bg-[color:var(--nnd-fill)]/50.
  if (token.startsWith("color:var(--nnd-")) return { token: "theme", alpha: m[2] ? Number(m[2]) : 100 };
  return { token, alpha: m[2] ? Number(m[2]) : 100 };
}

/** CSS variable holding the theme color of each color property. */
export const THEME_COLOR_VAR = {
  bg: "var(--nnd-fill)",
  border: "var(--nnd-line)",
  text: "var(--nnd-text,var(--nnd-fg))",
  edge: "var(--nnd-edge)",
} as const;

/**
 * Class for a color. "theme" keeps the theme color (no class at 100 %, the
 * theme variable with an opacity otherwise); `themeVar` overrides the variable.
 */
export function colorClass(prefix: "bg" | "border" | "text", value: ColorValue, themeVar: string = THEME_COLOR_VAR[prefix]): string | null {
  const t = value.token;
  if (t === "theme") return value.alpha >= 100 ? null : `${prefix}-[color:${themeVar}]/${Math.round(value.alpha)}`;
  const base = t.startsWith("#") || t.startsWith("rgb") ? `${prefix}-[${t.replace(/\s+/g, "")}]` : `${prefix}-${t}`;
  return value.alpha < 100 && t !== "transparent" ? `${base}/${Math.round(value.alpha)}` : base;
}

/** Pixel value of an arbitrary class like rounded-[6px], border-[3px], text-[13px]. */
export function pxOf(cls: string | null, named: Record<string, number> = {}): number | null {
  if (!cls) return null;
  const arb = /\[(\d*\.?\d+)px\]/.exec(cls);
  if (arb) return Number(arb[1]);
  const key = cls.replace(/^[a-z]+-?/, "");
  return key in named ? named[key] : null;
}
