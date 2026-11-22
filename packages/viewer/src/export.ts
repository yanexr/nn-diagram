/**
 * Exports: PNG (raster), SVG (vector, real selectable text, embedded fonts)
 * and PDF (vector, via the browser's print dialog).
 *
 * The diagram is rendered off-screen at 100% without the viewer's pan/zoom,
 * then converted. The SVG converter walks the rendered DOM and turns boxes,
 * borders, inline SVG and text runs into plain SVG elements, so the result
 * opens in Illustrator/Inkscape and can be included in LaTeX.
 */
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { ElementNode } from "@nn-diagram/format";
import { useDiagramLayout } from "./model";
import type { DiagramTheme } from "./render/context";
import { DiagramView } from "./render/DiagramView";
import { collectClasses, ensureClasses } from "./tailwind/engine";
import { loadIcons, usesIcons } from "./render/icons";

export type ExportFormat = "png" | "jpeg" | "webp" | "svg" | "pdf";

export const EXPORT_FORMATS: { value: ExportFormat; label: string; raster: boolean; alpha: boolean }[] = [
  { value: "png", label: "PNG", raster: true, alpha: true },
  { value: "jpeg", label: "JPEG", raster: true, alpha: false },
  { value: "webp", label: "WebP", raster: true, alpha: true },
  { value: "svg", label: "SVG", raster: false, alpha: true },
  { value: "pdf", label: "PDF", raster: false, alpha: false },
];

export interface ExportOptions {
  format: ExportFormat;
  theme?: DiagramTheme;
  baseUrl?: string;
  resolveAsset?: (src: string) => string | undefined;
  fileName?: string;
  /** Pixel ratio for raster formats (1× = one image pixel per diagram px). */
  scale?: number;
  /** Transparent instead of page-colored background (PNG, WebP, SVG). */
  transparent?: boolean;
  /** JPEG/WebP quality 0–1. */
  quality?: number;
}

// ------------------------------------------------------------- offscreen

function OffscreenDiagram({
  root,
  theme,
  baseUrl,
  resolveAsset,
  onReady,
}: {
  root: ElementNode;
  theme: DiagramTheme;
  baseUrl?: string;
  resolveAsset?: (src: string) => string | undefined;
  onReady: () => void;
}) {
  const { layout, routes, onMeasure } = useDiagramLayout(root);
  useEffect(() => {
    // Two frames: auto-size measurement and probed shape colors settle.
    let a = 0;
    const b = requestAnimationFrame(() => {
      a = requestAnimationFrame(onReady);
    });
    return () => {
      cancelAnimationFrame(b);
      cancelAnimationFrame(a);
    };
  }, [layout, routes, onReady]);
  if (!layout) return null;
  return createElement(DiagramView, { root, layout, routes, theme, baseUrl, resolveAsset, onMeasure });
}

export async function renderOffscreen(
  root: ElementNode,
  theme: DiagramTheme,
  baseUrl?: string,
  resolveAsset?: (src: string) => string | undefined,
): Promise<{ element: HTMLElement; dispose: () => void }> {
  await ensureClasses(collectClasses(root));
  if (usesIcons(root)) await loadIcons();
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none;contain:layout style;";
  document.body.appendChild(host);
  const reactRoot = createRoot(host);
  await new Promise<void>((resolve) => {
    let done = false;
    const onReady = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    reactRoot.render(createElement(OffscreenDiagram, { root, theme, baseUrl, resolveAsset, onReady }));
    setTimeout(onReady, 1500);
  });
  await document.fonts?.ready;
  const images = Array.from(host.querySelectorAll("img"));
  await Promise.all(images.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
  const videos = Array.from(host.querySelectorAll("video"));
  await Promise.all(
    videos.map(
      (v) =>
        new Promise<void>((resolve) => {
          if (v.readyState >= 2) return resolve();
          v.addEventListener("loadeddata", () => resolve(), { once: true });
          setTimeout(resolve, 2000);
        }),
    ),
  );
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const element = host.querySelector<HTMLElement>("[data-nnd-root]")!;
  return {
    element,
    dispose: () => {
      reactRoot.unmount();
      host.remove();
    },
  };
}

// ----------------------------------------------------------------- utils

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

let colorCtx: CanvasRenderingContext2D | null = null;

/** Normalizes any CSS color (oklch, color-mix, …) to #rrggbb or rgba(). */
export function normalizeColor(color: string): { value: string; alpha: number } {
  if (!color || color === "transparent" || color === "none") return { value: "none", alpha: 0 };
  colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const ctx = colorCtx!;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return { value: "none", alpha: 0 };
  const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  return { value: hex, alpha: Math.round((a / 255) * 1000) / 1000 };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f = (n: number) => String(Math.round(n * 100) / 100);

function paint(prop: "fill" | "stroke", color: string): string {
  const c = normalizeColor(color);
  if (c.value === "none") return `${prop}="none"`;
  return c.alpha < 1 ? `${prop}="${c.value}" ${prop}-opacity="${c.alpha}"` : `${prop}="${c.value}"`;
}

// ------------------------------------------------------------ DOM → SVG

interface FontUse {
  family: string;
  weight: string;
  style: string;
  chars: Set<number>;
}

class SvgWriter {
  out: string[] = [];
  private ids = 0;
  fonts = new Map<string, FontUse>();
  images: { el: HTMLImageElement; id: string }[] = [];
  clipId = 0;
  private measure = document.createElement("canvas").getContext("2d")!;
  private origin: DOMRect;

  constructor(readonly root: HTMLElement) {
    this.origin = root.getBoundingClientRect();
  }

  rel(r: DOMRect) {
    return { x: r.left - this.origin.left, y: r.top - this.origin.top, w: r.width, h: r.height };
  }

  walk(el: Element) {
    if (el.classList.contains("katex-mathml")) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const opacity = parseFloat(cs.opacity);
    if (opacity === 0) return;
    const rotate = (el as HTMLElement).dataset?.nndRotate;
    let groups = 0;
    if (opacity < 1) {
      this.out.push(`<g opacity="${f(opacity)}">`);
      groups++;
    }
    if (rotate) {
      const r = this.rel(el.getBoundingClientRect());
      this.out.push(`<g transform="rotate(${rotate} ${f(r.x + r.w / 2)} ${f(r.y + r.h / 2)})">`);
      groups++;
    }
    if (el instanceof SVGSVGElement) {
      this.svg(el);
    } else if (el instanceof HTMLVideoElement) {
      this.video(el, cs);
    } else if (el instanceof HTMLImageElement) {
      this.image(el, cs);
    } else if (el instanceof HTMLElement) {
      this.box(el, cs);
      const clip = cs.overflowX !== "visible" || cs.overflowY !== "visible";
      if (clip) {
        const r = this.rel(el.getBoundingClientRect());
        const id = `clip${this.clipId++}`;
        this.out.push(`<clipPath id="${id}"><rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}"/></clipPath><g clip-path="url(#${id})">`);
      }
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) this.text(child as Text, cs);
        else if (child.nodeType === Node.ELEMENT_NODE) this.walk(child as Element);
      }
      if (clip) this.out.push("</g>");
    }
    for (let i = 0; i < groups; i++) this.out.push("</g>");
  }

  box(el: HTMLElement, cs: CSSStyleDeclaration) {
    const r = this.rel(el.getBoundingClientRect());
    if (r.w <= 0 || r.h <= 0) return;
    const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.w / 2, r.h / 2);
    const isEllipse = cs.borderTopLeftRadius.endsWith("%") && parseFloat(cs.borderTopLeftRadius) >= 50;
    const bg = normalizeColor(cs.backgroundColor);
    const widths = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map((v) => parseFloat(v) || 0);
    const colors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
    const styles = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
    const shape = (x: number, y: number, w: number, h: number, rr: number) =>
      isEllipse
        ? `<ellipse cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" rx="${f(w / 2)}" ry="${f(h / 2)}"`
        : `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${rr > 0 ? ` rx="${f(rr)}"` : ""}`;
    if (bg.alpha > 0) this.out.push(`${shape(r.x, r.y, r.w, r.h, radius)} ${paint("fill", cs.backgroundColor)}/>`);
    const uniform = widths.every((w) => w === widths[0]) && colors.every((c) => c === colors[0]) && styles.every((s) => s === styles[0]);
    if (uniform) {
      const bw = widths[0];
      if (bw > 0 && styles[0] !== "none" && normalizeColor(colors[0]).alpha > 0) {
        const dash = styles[0] === "dashed" ? ` stroke-dasharray="${f(bw * 4)} ${f(bw * 3)}"` : styles[0] === "dotted" ? ` stroke-dasharray="${f(bw)} ${f(bw * 2)}"` : "";
        this.out.push(
          `${shape(r.x + bw / 2, r.y + bw / 2, r.w - bw, r.h - bw, Math.max(0, radius - bw / 2))} fill="none" ${paint("stroke", colors[0])} stroke-width="${f(bw)}"${dash}/>`,
        );
      }
    } else {
      // Individual sides (e.g. KaTeX fraction lines are bottom borders).
      const sides: [number, number, number, number][] = [
        [r.x, r.y, r.w, widths[0]],
        [r.x + r.w - widths[1], r.y, widths[1], r.h],
        [r.x, r.y + r.h - widths[2], r.w, widths[2]],
        [r.x, r.y, widths[3], r.h],
      ];
      sides.forEach(([x, y, w, h], i) => {
        if (widths[i] > 0 && styles[i] !== "none" && normalizeColor(colors[i]).alpha > 0) {
          this.out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${paint("fill", colors[i])}/>`);
        }
      });
    }
  }

  image(el: HTMLImageElement, cs: CSSStyleDeclaration) {
    const r = this.rel(el.getBoundingClientRect());
    const fit = cs.objectFit;
    const par = fit === "cover" ? "xMidYMid slice" : fit === "contain" ? "xMidYMid meet" : "none";
    const id = `img${this.images.length}`;
    this.images.push({ el, id });
    this.out.push(`<image x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" preserveAspectRatio="${par}" href="{{${id}}}"/>`);
  }

  video(el: HTMLVideoElement, cs: CSSStyleDeclaration) {
    const r = this.rel(el.getBoundingClientRect());
    let href = el.poster;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = el.videoWidth || r.w;
      canvas.height = el.videoHeight || r.h;
      canvas.getContext("2d")!.drawImage(el, 0, 0, canvas.width, canvas.height);
      href = canvas.toDataURL("image/jpeg", 0.9);
    } catch {
      /* cross-origin video: fall back to the poster */
    }
    if (!href) return;
    const fit = cs.objectFit;
    const par = fit === "cover" ? "xMidYMid slice" : fit === "contain" ? "xMidYMid meet" : "none";
    this.out.push(`<image x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" preserveAspectRatio="${par}" href="${esc(href)}"/>`);
  }

  svg(el: SVGSVGElement) {
    const r = this.rel(el.getBoundingClientRect());
    const vb = el.viewBox?.baseVal;
    let transform = `translate(${f(r.x)},${f(r.y)})`;
    if (vb && vb.width > 0 && vb.height > 0) {
      let sx = r.w / vb.width;
      let sy = r.h / vb.height;
      let tx = 0;
      let ty = 0;
      const par = (el.getAttribute("preserveAspectRatio") ?? "xMidYMid meet").trim();
      if (par !== "none") {
        const [align, mode = "meet"] = par.split(/\s+/);
        const k = mode === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
        if (align.includes("xMid")) tx = (r.w - vb.width * k) / 2;
        else if (align.includes("xMax")) tx = r.w - vb.width * k;
        if (align.includes("YMid")) ty = (r.h - vb.height * k) / 2;
        else if (align.includes("YMax")) ty = r.h - vb.height * k;
        sx = sy = k;
      }
      transform += ` translate(${f(tx)},${f(ty)}) scale(${f(sx)},${f(sy)}) translate(${f(-vb.x)},${f(-vb.y)})`;
    }
    this.out.push(`<g transform="${transform}">`);
    for (const child of Array.from(el.children)) this.svgNode(child);
    this.out.push("</g>");
  }

  /** Copies the mask a <g> references (label gaps in arrows) and returns its new id. */
  mask(el: Element): string | null {
    const ref = /url\(["']?#([^"')]+)/.exec(el.getAttribute("mask") ?? "")?.[1];
    const src = ref ? el.closest("svg")?.querySelector(`mask[id="${CSS.escape(ref)}"]`) : null;
    if (!src) return null;
    const id = `nnd-mask-${++this.ids}`;
    const region = ["maskUnits", "x", "y", "width", "height"].map((k) => src.getAttribute(k) !== null && `${k}="${esc(src.getAttribute(k)!)}"`).filter(Boolean);
    const rects = Array.from(src.querySelectorAll<SVGRectElement>("rect")).map(
      (r) => `<rect ${["x", "y", "width", "height", "rx", "fill"].map((k) => r.getAttribute(k) !== null && `${k}="${esc(r.getAttribute(k)!)}"`).filter(Boolean).join(" ")}/>`,
    );
    this.out.push(`<mask id="${id}" ${region.join(" ")}>${rects.join("")}</mask>`);
    return id;
  }

  svgNode(el: Element) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const tag = el.tagName.toLowerCase();
    if (el.classList.contains("nnd-hit")) return;
    const attrs: string[] = [];
    const transform = el.getAttribute("transform");
    if (transform) attrs.push(`transform="${esc(transform)}"`);
    if (tag === "g") {
      const opacity = parseFloat(cs.opacity);
      if (opacity < 1) attrs.push(`opacity="${f(opacity)}"`);
      const mask = this.mask(el);
      if (mask) attrs.push(`mask="url(#${mask})"`);
      this.out.push(`<g ${attrs.join(" ")}>`);
      for (const child of Array.from(el.children)) this.svgNode(child);
      this.out.push("</g>");
      return;
    }
    const geometry: Record<string, string[]> = {
      path: ["d"],
      line: ["x1", "y1", "x2", "y2"],
      circle: ["cx", "cy", "r"],
      ellipse: ["cx", "cy", "rx", "ry"],
      rect: ["x", "y", "width", "height", "rx", "ry"],
      polygon: ["points"],
      polyline: ["points"],
    };
    const keys = geometry[tag];
    if (!keys) return;
    for (const k of keys) {
      const v = el.getAttribute(k);
      if (v !== null) attrs.push(`${k}="${esc(v)}"`);
    }
    attrs.push(paint("fill", cs.fill.startsWith("url(") ? "none" : cs.fill));
    const sw = parseFloat(cs.strokeWidth) || 0;
    if (cs.stroke !== "none" && sw > 0) {
      attrs.push(paint("stroke", cs.stroke), `stroke-width="${f(sw)}"`);
      if (cs.strokeDasharray && cs.strokeDasharray !== "none") attrs.push(`stroke-dasharray="${esc(cs.strokeDasharray.replace(/px/g, ""))}"`);
      if (cs.strokeLinejoin && cs.strokeLinejoin !== "miter") attrs.push(`stroke-linejoin="${cs.strokeLinejoin}"`);
      if (cs.strokeLinecap && cs.strokeLinecap !== "butt") attrs.push(`stroke-linecap="${cs.strokeLinecap}"`);
    }
    const opacity = parseFloat(cs.opacity);
    if (opacity < 1) attrs.push(`opacity="${f(opacity)}"`);
    this.out.push(`<${tag} ${attrs.join(" ")}/>`);
  }

  text(node: Text, cs: CSSStyleDeclaration) {
    const value = node.data;
    if (!value.trim()) return;
    const range = document.createRange();
    type Line = { top: number; left: number; right: number; text: string };
    const lines: Line[] = [];
    let line: Line | null = null;
    for (let i = 0; i < value.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rects = range.getClientRects();
      const ch = value[i];
      if (rects.length === 0) {
        if (line && /\s/.test(ch) && !line.text.endsWith(" ")) line.text += " ";
        continue;
      }
      const rr = rects[rects.length - 1];
      const r = this.rel(rr);
      if (r.w === 0 && /\s/.test(ch)) {
        if (line && !line.text.endsWith(" ")) line.text += " ";
        continue;
      }
      if (!line || Math.abs(r.y - line.top) > r.h * 0.5) {
        if (line) lines.push(line);
        line = { top: r.y, left: r.x, right: r.x + r.w, text: "" };
      }
      line.text += /\s/.test(ch) ? " " : ch;
      line.right = Math.max(line.right, r.x + r.w);
    }
    if (line) lines.push(line);

    const transform = cs.textTransform;
    const family = cs.fontFamily;
    const size = parseFloat(cs.fontSize);
    this.measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${family}`;
    const m = this.measure.measureText("Hg");
    const ascent = m.fontBoundingBoxAscent ?? size * 0.8;
    const color = cs.color;
    const key = `${family}|${cs.fontWeight}|${cs.fontStyle}`;
    let use = this.fonts.get(key);
    if (!use) {
      use = { family, weight: cs.fontWeight, style: cs.fontStyle, chars: new Set() };
      this.fonts.set(key, use);
    }
    for (const l of lines) {
      // Keep trailing spaces: they separate this run from following inline elements.
      let text = l.text;
      if (!text.trim()) continue;
      if (transform === "uppercase") text = text.toUpperCase();
      else if (transform === "lowercase") text = text.toLowerCase();
      for (const ch of text) use.chars.add(ch.codePointAt(0)!);
      const ls = cs.letterSpacing && cs.letterSpacing !== "normal" ? ` letter-spacing="${f(parseFloat(cs.letterSpacing))}"` : "";
      const weight = cs.fontWeight !== "400" ? ` font-weight="${cs.fontWeight}"` : "";
      const style = cs.fontStyle !== "normal" ? ` font-style="${cs.fontStyle}"` : "";
      this.out.push(
        `<text x="${f(l.left)}" y="${f(l.top + ascent)}" font-family="${esc(family)}" font-size="${f(size)}"${weight}${style}${ls} ${paint("fill", color)} textLength="${f(l.right - l.left)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${esc(text)}</text>`,
      );
    }
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function parseUnicodeRange(range: string): [number, number][] {
  return range.split(",").map((part) => {
    const p = part.trim().replace(/^U\+/i, "");
    if (p.includes("?")) return [parseInt(p.replace(/\?/g, "0"), 16), parseInt(p.replace(/\?/g, "F"), 16)];
    const [a, b] = p.split("-");
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}

const firstFamily = (family: string) => family.split(",")[0].trim().replace(/^["']|["']$/g, "");

async function embedFonts(fonts: Iterable<FontUse>): Promise<string> {
  const wanted = Array.from(fonts);
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }
    const visit = async (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "");
          const weight = rule.style.getPropertyValue("font-weight") || "400";
          const style = rule.style.getPropertyValue("font-style") || "normal";
          const urange = rule.style.getPropertyValue("unicode-range");
          const matches = wanted.filter((w) => w.family.split(",").some((fam) => firstFamily(fam) === family));
          const relevant = matches.some((w) => {
            const [lo, hi] = weight.split(" ").map((x) => Number(x) || (x === "bold" ? 700 : 400));
            const wv = Number(w.weight) || 400;
            if (wv < lo || wv > (hi ?? lo)) return false;
            if ((style === "italic") !== (w.style === "italic")) return false;
            if (!urange) return true;
            const ranges = parseUnicodeRange(urange);
            for (const ch of w.chars) if (ranges.some(([a, b]) => ch >= a && ch <= b)) return true;
            return false;
          });
          if (!relevant) continue;
          const src = rule.style.getPropertyValue("src");
          const urls = Array.from(src.matchAll(/url\(["']?([^"')]+)["']?\)\s*(?:format\(["']?([^"')]+)["']?\))?/g));
          const pick = urls.find((u) => u[2] === "woff2") ?? urls.find((u) => u[2] === "woff") ?? urls[0];
          if (!pick) continue;
          const url = new URL(pick[1], sheet.href ?? location.href).toString();
          const key = `${family}|${weight}|${style}|${url}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            const blob = await (await fetch(url)).blob();
            const data = await blobToDataUrl(blob);
            rules.push(
              `@font-face{font-family:"${family}";src:url(${data})${pick[2] ? ` format("${pick[2]}")` : ""};font-weight:${weight};font-style:${style};${urange ? `unicode-range:${urange};` : ""}}`,
            );
          } catch {
            /* font not fetchable: viewers fall back to installed fonts */
          }
        } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
          await visit((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    await visit(cssRules);
  }
  return rules.join("\n");
}

export async function elementToSvg(root: HTMLElement, opts: { transparent?: boolean; embedFonts?: boolean } = {}): Promise<string> {
  // Measure in the unrotated frame; rotations are re-applied as SVG groups.
  const rotated = Array.from(root.querySelectorAll<HTMLElement>(".nnd-node")).filter((el) => el.style.transform.includes("rotate"));
  for (const el of rotated) {
    const m = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform);
    if (m) el.dataset.nndRotate = m[1];
    el.style.transform = "none";
  }
  const writer = new SvgWriter(root);
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  const pageColor = getComputedStyle(root.querySelector(".nnd-page") ?? root).backgroundColor;
  for (const child of Array.from(root.children)) {
    if (opts.transparent && child.classList.contains("nnd-page")) continue;
    writer.walk(child);
  }
  let body = writer.out.join("\n");
  for (const { el, id } of writer.images) {
    let href = el.currentSrc || el.src;
    try {
      href = await blobToDataUrl(await (await fetch(href)).blob());
    } catch {
      /* keep the URL */
    }
    body = body.replace(`{{${id}}}`, esc(href));
  }
  const fonts = opts.embedFonts === false ? "" : await embedFonts(writer.fonts.values());
  const bg = opts.transparent ? "" : `<rect width="${w}" height="${h}" ${paint("fill", pageColor)}/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    fonts ? `<defs><style>${fonts}</style></defs>` : "",
    bg,
    body,
    "</svg>",
  ].join("\n");
}

async function printSvg(svg: string, w: number, h: number) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(
    `<!doctype html><html><head><title>diagram</title><style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`,
  );
  doc.close();
  await new Promise((r) => setTimeout(r, 300));
  iframe.contentWindow!.focus();
  iframe.contentWindow!.print();
  setTimeout(() => iframe.remove(), 60_000);
}

/**
 * Renders a diagram to an image file in memory: SVG (with selectable text and
 * embedded fonts), PNG, JPEG or WebP. PDF is SVG printed by the browser, so it
 * is not available here (`exportDiagram` prints it; the CLI renders it
 * headless).
 */
export async function renderDiagram(root: ElementNode, options: Omit<ExportOptions, "fileName">): Promise<{ blob: Blob; width: number; height: number }> {
  const { format, theme = "light", baseUrl, resolveAsset, scale = 2, quality = 0.92 } = options;
  if (format === "pdf") throw new Error("renderDiagram cannot make PDFs; render an SVG and print it");
  const meta = EXPORT_FORMATS.find((f) => f.value === format)!;
  const transparent = meta.alpha && options.transparent === true;
  const { element, dispose } = await renderOffscreen(root, theme, baseUrl, resolveAsset);
  try {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const page = element.querySelector<HTMLElement>(".nnd-page");
    const pageColor = getComputedStyle(page ?? element).backgroundColor;
    if (transparent && page) page.style.display = "none";
    if (meta.raster) {
      const shot = await import("modern-screenshot");
      const opts = { scale, quality, backgroundColor: transparent ? null : format === "jpeg" && normalizeColor(pageColor).alpha === 0 ? "#ffffff" : pageColor };
      const url =
        format === "png" ? await shot.domToPng(element, opts) : format === "jpeg" ? await shot.domToJpeg(element, opts) : await shot.domToWebp(element, opts);
      return { blob: await (await fetch(url)).blob(), width, height };
    }
    const svg = await elementToSvg(element, { transparent });
    return { blob: new Blob([svg], { type: "image/svg+xml" }), width, height };
  } finally {
    dispose();
  }
}

/** Exports a diagram as a download (PDF: the browser's print dialog). */
export async function exportDiagram(root: ElementNode, options: ExportOptions): Promise<void> {
  const { format, fileName = "diagram" } = options;
  if (format === "pdf") {
    const { blob, width, height } = await renderDiagram(root, { ...options, format: "svg" });
    await printSvg(await blob.text(), width, height);
    return;
  }
  const { blob } = await renderDiagram(root, options);
  download(blob, `${fileName}.${format === "jpeg" ? "jpg" : format}`);
}
