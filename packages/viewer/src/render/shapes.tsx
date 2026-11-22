/** Visuals of the built-in components (everything inside a node's box). */
import { getStroke } from "perfect-freehand";
import { Pause, Play } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { PALETTE, TOKEN_KINDS, type ElementNode } from "@nn-diagram/format";
import { CALLOUT_BODY, cuboidOffsets, noteFold, unitPolygon } from "../geometry";
import { useRenderContext } from "./context";
import { iconComponent, useIconSet } from "./icons";
import { getCssVersion, subscribeCss } from "../tailwind/engine";
import { scheduleStyleRead } from "./styleReads";

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ probe

export interface ProbedStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: string | undefined;
}

const PROBE_STYLE: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  padding: 0,
  visibility: "hidden",
  pointerEvents: "none",
};
const noSubscription = () => () => {};
const noVersion = () => 0;

/**
 * Reads the fill/stroke an element *would* have from its classes, so shapes
 * drawn as SVG (trapezoids, cylinders, …) honour bg-* and border-* classes
 * exactly like rectangles do.
 */
export function useProbedStyle(classes: string): [ReactNode, ProbedStyle | null] {
  const ref = useRef<HTMLSpanElement>(null);
  const { theme } = useRenderContext();
  const css = useSyncExternalStore(classes ? subscribeCss : noSubscription, classes ? getCssVersion : noVersion, noVersion);
  const [style, setStyle] = useState<ProbedStyle | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      const width = parseFloat(cs.borderTopWidth) || 0;
      const borderStyle = cs.borderTopStyle;
      const next: ProbedStyle = {
        fill: cs.backgroundColor,
        stroke: width > 0 && borderStyle !== "none" ? cs.borderTopColor : "transparent",
        strokeWidth: width,
        dash: borderStyle === "dashed" ? `${width * 4} ${width * 3}` : borderStyle === "dotted" ? `${width} ${width * 2}` : undefined,
      };
      return () => setStyle((prev) =>
        prev && prev.fill === next.fill && prev.stroke === next.stroke && prev.strokeWidth === next.strokeWidth && prev.dash === next.dash
          ? prev
          : next,
      );
    };
    let cancelRead = scheduleStyleRead(el, read);
    // Stylesheets may arrive after the first paint (fonts, Tailwind build).
    const id = requestAnimationFrame(() => { cancelRead = scheduleStyleRead(el, read); });
    return () => { cancelRead(); cancelAnimationFrame(id); };
  }, [classes, theme, css]);
  return [<span key="probe" ref={ref} aria-hidden className={classes} style={PROBE_STYLE} />, style];
}

// ---------------------------------------------------------- outline shapes

export function outlinePath(node: ElementNode, w: number, h: number, inset: number): string {
  const shape = typeof node.props.shape === "string" ? node.props.shape : "rect";
  const x0 = inset;
  const y0 = inset;
  const ww = Math.max(0, w - inset * 2);
  const hh = Math.max(0, h - inset * 2);
  if (shape === "cylinder") {
    const ry = Math.min(hh * 0.15, 12);
    return (
      `M${r2(x0)},${r2(y0 + ry)} A${r2(ww / 2)},${r2(ry)} 0 0,1 ${r2(x0 + ww)},${r2(y0 + ry)} ` +
      `L${r2(x0 + ww)},${r2(y0 + hh - ry)} A${r2(ww / 2)},${r2(ry)} 0 0,1 ${r2(x0)},${r2(y0 + hh - ry)} Z ` +
      // The front rim, drawn right to left: the same winding as the body, so its fill adds instead of cutting a hole.
      `M${r2(x0 + ww)},${r2(y0 + ry)} A${r2(ww / 2)},${r2(ry)} 0 0,1 ${r2(x0)},${r2(y0 + ry)}`
    );
  }
  if (shape === "document") {
    const wave = Math.min(hh * 0.12, 10);
    return (
      `M${r2(x0)},${r2(y0)} L${r2(x0 + ww)},${r2(y0)} L${r2(x0 + ww)},${r2(y0 + hh - wave)} ` +
      `C${r2(x0 + ww * 0.75)},${r2(y0 + hh - wave * 2.6)} ${r2(x0 + ww * 0.5)},${r2(y0 + hh + wave * 0.8)} ${r2(x0)},${r2(y0 + hh - wave)} Z`
    );
  }
  if (shape === "note") {
    const f = noteFold(w, h);
    const x1 = x0 + ww;
    // Outline, then the fold (a second subpath, wound like the outline so it stays filled).
    return (
      `M${r2(x0)},${r2(y0)} L${r2(x1 - f)},${r2(y0)} L${r2(x1)},${r2(y0 + f)} L${r2(x1)},${r2(y0 + hh)} L${r2(x0)},${r2(y0 + hh)} Z ` +
      `M${r2(x1)},${r2(y0 + f)} L${r2(x1 - f)},${r2(y0 + f)} L${r2(x1 - f)},${r2(y0)}`
    );
  }
  if (shape === "cloud") {
    const P = (u: number, v: number) => `${r2(x0 + u * ww)},${r2(y0 + v * hh)}`;
    return (
      `M${P(0.25, 0.25)} C${P(0.05, 0.25)} ${P(0, 0.5)} ${P(0.16, 0.55)} C${P(0, 0.66)} ${P(0.18, 0.9)} ${P(0.31, 0.8)} ` +
      `C${P(0.4, 1)} ${P(0.7, 1)} ${P(0.8, 0.8)} C${P(1, 0.8)} ${P(1, 0.6)} ${P(0.875, 0.5)} ` +
      `C${P(1, 0.3)} ${P(0.8, 0.1)} ${P(0.625, 0.2)} C${P(0.5, 0.05)} ${P(0.3, 0.05)} ${P(0.25, 0.25)} Z`
    );
  }
  if (shape === "person") {
    // Head and shoulders.
    const r = Math.min(ww, hh) * 0.21;
    const cx = x0 + ww / 2;
    const top = y0 + r * 2 + hh * 0.05;
    const R = Math.max(0, Math.min(ww / 2, (y0 + hh - top) * 0.9));
    return (
      `M${r2(cx - r)},${r2(y0 + r)} A${r2(r)},${r2(r)} 0 1,1 ${r2(cx + r)},${r2(y0 + r)} A${r2(r)},${r2(r)} 0 1,1 ${r2(cx - r)},${r2(y0 + r)} Z ` +
      `M${r2(x0)},${r2(y0 + hh)} L${r2(x0)},${r2(top + R)} A${r2(R)},${r2(R)} 0 0,1 ${r2(x0 + R)},${r2(top)} ` +
      `L${r2(x0 + ww - R)},${r2(top)} A${r2(R)},${r2(R)} 0 0,1 ${r2(x0 + ww)},${r2(top + R)} L${r2(x0 + ww)},${r2(y0 + hh)} Z`
    );
  }
  const poly = unitPolygon(node, shape as never);
  if (!poly) return "";
  return poly.map(([u, v], i) => `${i ? "L" : "M"}${r2(x0 + u * ww)},${r2(y0 + v * hh)}`).join(" ") + " Z";
}

export function SvgOutline({ node, w, h, style }: { node: ElementNode; w: number; h: number; style: ProbedStyle | null }) {
  if (!style) return null;
  const d = outlinePath(node, w, h, style.strokeWidth / 2);
  return (
    <svg className="nnd-svg-shape" width={w} height={h} aria-hidden>
      <path
        d={d}
        style={{ fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDasharray: style.dash, strokeLinejoin: "round" }}
      />
    </svg>
  );
}

// --------------------------------------------------------------------- Op

export function OpSymbol({ symbol }: { symbol: string; size?: number }) {
  const s = symbol.trim();
  const lower = s.toLowerCase();
  const plus = s === "+" || lower === "add" || lower === "plus" || s === "⊕";
  const times = lower === "x" || s === "×" || lower === "mul" || lower === "times" || s === "⊗";
  // Symbols are drawn in a 100×100 box that fills the circle's content box,
  // so they stay exactly centered whatever the border width.
  const box: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" };
  if (plus || times) {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={box} aria-hidden>
        <g stroke="currentColor" strokeWidth={1} transform={times ? "rotate(45 50 50)" : undefined}>
          <line x1={22} y1={50} x2={78} y2={50} vectorEffect="non-scaling-stroke" />
          <line x1={50} y1={22} x2={50} y2={78} vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
    );
  }
  if (lower === "concat" || lower === "dot" || s === "⊙" || s === "·") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={box} aria-hidden>
        <circle cx={50} cy={50} r={11} fill="currentColor" />
      </svg>
    );
  }
  return <Glyph text={s === "sigma" ? "σ" : s} />;
}

let glyphCtx: CanvasRenderingContext2D | null = null;

/**
 * Text centered by its ink, not its line box: a "c", "a", "Σ" or "+" sits in
 * the optical middle of the circle. The glyph's ink bounds are measured with
 * the canvas text metrics of the element's own font.
 */
export function Glyph({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState<{ x: number; y: number } | null>(null);
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontsReady((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    glyphCtx ??= document.createElement("canvas").getContext("2d");
    if (!glyphCtx) return;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize) || 10;
    glyphCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    glyphCtx.textAlign = "left";
    glyphCtx.textBaseline = "alphabetic";
    const m = glyphCtx.measureText(text);
    // The span is one line with line-height 1, centered by the circle's flexbox.
    const fontAscent = m.fontBoundingBoxAscent ?? size * 0.8;
    const fontDescent = m.fontBoundingBoxDescent ?? size * 0.2;
    const baseline = (size - (fontAscent + fontDescent)) / 2 + fontAscent;
    const inkMiddle = baseline - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    const inkCenter = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const next = { x: Math.round((m.width / 2 - inkCenter) * 100) / 100, y: Math.round((size / 2 - inkMiddle) * 100) / 100 };
    setShift((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
  });
  void fontsReady;
  return (
    <span ref={ref} className="nnd-label nnd-glyph" style={shift ? { transform: `translate(${shift.x}px, ${shift.y}px)` } : undefined}>
      {text}
    </span>
  );
}

// ----------------------------------------------------------------- Tokens

function tokenColor(kind: string): string {
  const color = TOKEN_KINDS[kind] ?? ((PALETTE as readonly string[]).includes(kind) ? kind : null);
  if (color) return color;
  return kind.startsWith("#") || kind.startsWith("rgb") || kind.startsWith("oklch") ? kind : "gray";
}

export function TokensVisual({ node, w, h }: { node: ElementNode; w: number; h: number }) {
  const segments = Array.isArray(node.props.segments) ? node.props.segments.filter((s): s is string => typeof s === "string") : [];
  const vertical = node.props.vertical === true;
  const main = vertical ? h : w;
  const cross = vertical ? w : h;
  type Item = { kind: "cell"; color: string } | { kind: "sep"; sym: string };
  const items: Item[] = [];
  for (const seg of segments) {
    if (seg === "..." || seg === "…" || seg === "concat" || seg === "+") items.push({ kind: "sep", sym: seg });
    else {
      const [kind, count] = seg.split(":");
      const n = Math.max(0, Math.min(64, Math.round(Number(count ?? 1)) || 1));
      for (let i = 0; i < n; i++) items.push({ kind: "cell", color: tokenColor(kind) });
    }
  }
  const cells = items.filter((i) => i.kind === "cell").length;
  const seps = items.length - cells;
  let s = Math.min(cross * 0.72, 14);
  let gap = s * 0.2;
  let sepW = s * 1.3;
  const total = cells * s + seps * sepW + Math.max(0, items.length - 1) * gap;
  if (total > main && total > 0) {
    const k = main / total;
    s *= k;
    gap *= k;
    sepW *= k;
  }
  return (
    <div
      className="nnd-tokens"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap,
      }}
    >
      {items.map((item, i) =>
        item.kind === "cell" ? (
          <span
            key={i}
            className="nnd-token"
            style={
              {
                width: vertical ? s * 1.1 : s,
                height: vertical ? s : s * 0.9,
                borderRadius: Math.max(1, s * 0.12),
                "--tok": item.color.includes("(") || item.color.startsWith("#") ? item.color : `var(--color-${item.color}-300)`,
                "--tok-dark": item.color.includes("(") || item.color.startsWith("#") ? item.color : `var(--color-${item.color}-500)`,
              } as CSSProperties
            }
          />
        ) : (
          <span key={i} style={{ position: "relative", width: sepW, height: sepW, flex: "none" }}>
            {item.sym === "..." || item.sym === "…" ? (
              <span className="nnd-token-dot" />
            ) : (
              <span className="nnd-op" style={{ position: "absolute", inset: 0 }}>
                <OpSymbol symbol={item.sym} />
              </span>
            )}
          </span>
        ),
      )}
    </div>
  );
}

// ----------------------------------------------------------------- Cuboid

export { cuboidOffsets };

export function CuboidVisual({ node, w, h, style }: { node: ElementNode; w: number; h: number; style: ProbedStyle | null }) {
  const { theme } = useRenderContext();
  if (!style) return null;
  const { dx, dy } = cuboidOffsets(w, h, num(node.props.depth, 24));
  const sw = style.strokeWidth || 1;
  const o = sw / 2;
  let front = `M${o},${r2(dy)} L${r2(w - dx)},${r2(dy)} L${r2(w - dx)},${r2(h - o)} L${o},${r2(h - o)} Z`;
  let top = `M${o},${r2(dy)} L${r2(dx)},${o} L${r2(w - o)},${o} L${r2(w - dx)},${r2(dy)} Z`;
  let side = `M${r2(w - dx)},${r2(dy)} L${r2(w - o)},${o} L${r2(w - o)},${r2(h - dy)} L${r2(w - dx)},${r2(h - o)} Z`;
  if (node.props.side === "left") {
    // Mirrored: the depth recedes to the upper left, the left face is visible.
    front = `M${r2(dx)},${r2(dy)} L${r2(w - o)},${r2(dy)} L${r2(w - o)},${r2(h - o)} L${r2(dx)},${r2(h - o)} Z`;
    top = `M${o},${o} L${r2(w - dx)},${o} L${r2(w - o)},${r2(dy)} L${r2(dx)},${r2(dy)} Z`;
    side = `M${o},${o} L${r2(dx)},${r2(dy)} L${r2(dx)},${r2(h - o)} L${o},${r2(h - dy)} Z`;
  }
  const base = { stroke: style.stroke, strokeWidth: sw, strokeDasharray: style.dash, strokeLinejoin: "round" as const };
  // Light from the top: the top face is the brightest, the side face the darkest.
  // Light theme: the outline is darker than the fill, so the side is shaded toward it and the top toward white.
  // Dark theme: the outline is brighter than the (dark) fill, so the top is lit toward it (a tinted highlight
  // instead of washed-out gray) and the side is shaded toward black.
  const line = style.stroke === "transparent" ? null : style.stroke;
  const dark = theme === "dark";
  const sideFill = dark ? `color-mix(in oklab, ${style.fill} 72%, black)` : `color-mix(in oklab, ${style.fill} 62%, ${line ?? "black"})`;
  const topFill = dark ? `color-mix(in oklab, ${style.fill} 70%, ${line ?? "white"})` : `color-mix(in oklab, ${style.fill} 70%, white)`;
  return (
    <svg className="nnd-svg-shape" width={w} height={h} aria-hidden>
      <path d={side} style={{ ...base, fill: sideFill }} />
      <path d={top} style={{ ...base, fill: topFill }} />
      <path d={front} style={{ ...base, fill: style.fill }} />
    </svg>
  );
}

// ---------------------------------------------------------------- Neurons

export function NeuronsVisual({ node, w, h, style }: { node: ElementNode; w: number; h: number; style: ProbedStyle | null }) {
  const layers = Array.isArray(node.props.layers)
    ? node.props.layers.map((n) => Math.max(1, Math.min(32, Math.round(num(n, 1)))))
    : [3, 4, 2];
  const dense = node.props.connect !== "none";
  const cols = layers.length;
  const maxN = Math.max(...layers);
  const colGap = cols > 1 ? w / cols : w;
  const rowGap = h / maxN;
  const r = Math.max(2, Math.min(colGap * 0.22, rowGap * 0.36, 14));
  const pos = layers.map((n, li) => {
    const x = colGap * (li + 0.5);
    const top = (h - n * rowGap) / 2;
    return Array.from({ length: n }, (_, i) => ({ x, y: top + rowGap * (i + 0.5) }));
  });
  const fill = style?.fill ?? "var(--nnd-fill)";
  const stroke = style && style.stroke !== "transparent" ? style.stroke : "var(--nnd-line)";
  return (
    <svg className="nnd-svg-shape" width={w} height={h} aria-hidden>
      {dense && (
        <g style={{ stroke: "var(--nnd-muted)", strokeWidth: 0.6, opacity: 0.8 }}>
          {pos.slice(0, -1).flatMap((col, li) =>
            col.flatMap((a, ai) => pos[li + 1].map((b, bi) => <line key={`${li}-${ai}-${bi}`} x1={r2(a.x + r)} y1={r2(a.y)} x2={r2(b.x - r)} y2={r2(b.y)} />)),
          )}
        </g>
      )}
      {pos.flat().map((p, i) => (
        <circle key={i} cx={r2(p.x)} cy={r2(p.y)} r={r2(r)} style={{ fill, stroke, strokeWidth: style?.strokeWidth || 1 }} />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------- Icon

export function IconVisual({ node, w, h }: { node: ElementNode; w: number; h: number }) {
  useIconSet();
  const name = typeof node.props.name === "string" && node.props.name ? node.props.name : "box";
  const Icon = iconComponent(name);
  const strokeWidth = num(node.props.strokeWidth, 2);
  if (Icon === undefined) return null;
  if (Icon === null) {
    // Unknown name: a dashed placeholder, so the mistake is visible.
    return (
      <svg className="nnd-svg-shape" width={w} height={h} viewBox="0 0 24 24" aria-hidden>
        <rect x={2} y={2} width={20} height={20} rx={3} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 2" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 17h.01" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    );
  }
  return <Icon className="nnd-svg-shape" width={w} height={h} strokeWidth={strokeWidth} aria-hidden />;
}

// ------------------------------------------------------------------ Brace

export function BraceVisual({ node, w, h }: { node: ElementNode; w: number; h: number }) {
  const side = node.props.side ?? "right";
  const vertical = side === "left" || side === "right";
  const L = vertical ? h : w;
  const D = vertical ? w : h;
  const q = Math.min(L * 0.08, D * 0.9, 10);
  // Brace along the y axis pointing right, in a D × L box.
  const d =
    `M0,0 Q${r2(D * 0.5)},0 ${r2(D * 0.5)},${r2(q)} L${r2(D * 0.5)},${r2(L / 2 - q)} Q${r2(D * 0.5)},${r2(L / 2)} ${r2(D)},${r2(L / 2)} ` +
    `Q${r2(D * 0.5)},${r2(L / 2)} ${r2(D * 0.5)},${r2(L / 2 + q)} L${r2(D * 0.5)},${r2(L - q)} Q${r2(D * 0.5)},${r2(L)} 0,${r2(L)}`;
  let transform = "";
  if (side === "left") transform = `translate(${w},0) scale(-1,1)`;
  else if (side === "bottom") transform = `matrix(0,1,1,0,0,0)`;
  else if (side === "top") transform = `translate(0,${h}) matrix(0,-1,1,0,0,0)`;
  return (
    <svg className="nnd-svg-shape" width={w} height={h} aria-hidden>
      <path d={d} transform={transform || undefined} style={{ fill: "none", stroke: "currentColor", strokeWidth: 1 }} />
    </svg>
  );
}

// ------------------------------------------------------------------ Image

/** URL for an image/video/audio `src`, via the context's resolver or the base URL. */
export function useAssetUrl(src: string): string {
  const { baseUrl, resolveAsset } = useRenderContext();
  if (!src) return "";
  return resolveAsset?.(src) ?? resolveSrc(src, baseUrl);
}

export function resolveSrc(src: string, baseUrl?: string): string {
  if (!baseUrl || /^(https?:|data:|blob:|\/)/.test(src)) return src;
  try {
    // Resolve without depending on the page origin (same result on server and client).
    const dummy = "http://nn-diagram.invalid";
    const url = new URL(src, new URL(baseUrl, dummy));
    return url.origin === dummy ? url.pathname + url.search + url.hash : url.toString();
  } catch {
    return src;
  }
}

/** Static, theme-aware media silhouette. It inherits the shape's exact size and radius. */
export function MediaPlaceholder({ kind = "image", label, caption }: { kind?: "image" | "video" | "audio"; label?: string; caption?: ReactNode }) {
  return (
    <div data-nnd-media-placeholder={kind} role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label || caption ? undefined : true}
      style={{ position: "absolute", inset: 0, borderRadius: "inherit", background: "color-mix(in srgb, var(--nnd-muted, #888) 12%, transparent)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden", pointerEvents: "none" }}>
      {caption && <div className="nnd-audio-title" style={{ maxWidth: "100%", padding: "0 10px", boxSizing: "border-box" }}>{caption}</div>}
      <svg viewBox="0 0 48 36" aria-hidden style={{ width: "38%", height: "48%", maxWidth: 96, maxHeight: 72, color: "var(--nnd-muted, #888)", opacity: .45 }} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {kind === "audio" ? <path d="M4 15v6m6-12v18m7-23v28m7-19v10m7-16v22m7-18v14m6-10v6" /> : kind === "video" ?
          <><rect x={3} y={3} width={42} height={30} rx={4} /><path d="m20 11 12 7-12 7z" /></> :
          <><rect x={3} y={3} width={42} height={30} rx={4} /><circle cx={15} cy={12} r={3} /><path d="m4 28 12-10 8 6 9-11 11 14" /></>}
      </svg>
    </div>
  );
}

export function ImageVisual({ node, w, h }: { node: ElementNode; w: number; h: number }) {
  const { media } = useRenderContext();
  const src = useAssetUrl(media !== "placeholder" && typeof node.props.src === "string" ? node.props.src : "");
  const [loadedSrc, setLoadedSrc] = useState("");
  const fit = node.props.fit === "contain" || node.props.fit === "fill" ? node.props.fit : "cover";
  const grid = Array.isArray(node.props.grid) ? node.props.grid.map((n) => Math.max(1, Math.round(num(n, 1)))) : null;
  const cols = grid?.[0] ?? 0;
  const rows = grid?.[1] ?? cols;
  return (
    <>
      {(!src || loadedSrc !== src) && <MediaPlaceholder label={typeof node.props.alt === "string" ? node.props.alt : undefined} />}
      {src ? (
        <img
          src={src}
          alt={typeof node.props.alt === "string" ? node.props.alt : ""}
          draggable={false}
          decoding="async"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setLoadedSrc("")}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit, borderRadius: "inherit", visibility: loadedSrc === src ? "visible" : "hidden" }}
        />
      ) : null}
      {grid && cols > 0 && (
        <svg className="nnd-svg-shape" width={w} height={h} aria-hidden>
          <g style={{ stroke: "rgba(255,255,255,0.9)", strokeWidth: 1.5 }}>
            {Array.from({ length: cols + 1 }, (_, i) => (
              <line key={`c${i}`} x1={r2((w * i) / cols)} y1={0} x2={r2((w * i) / cols)} y2={h} />
            ))}
            {Array.from({ length: rows + 1 }, (_, i) => (
              <line key={`r${i}`} x1={0} y1={r2((h * i) / rows)} x2={w} y2={r2((h * i) / rows)} />
            ))}
          </g>
        </svg>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Video

export function VideoVisual({ node }: { node: ElementNode }) {
  const { interactive } = useRenderContext();
  const src = useAssetUrl(typeof node.props.src === "string" ? node.props.src : "");
  const poster = useAssetUrl(typeof node.props.poster === "string" ? node.props.poster : "");
  const ref = useRef<HTMLVideoElement>(null);
  const start = num(node.props.start, 0);
  const end = typeof node.props.end === "number" ? node.props.end : null;
  const loop = node.props.loop !== false;
  const autoplay = node.props.autoplay !== false;
  const muted = node.props.muted !== false;
  const controls = node.props.controls === true && interactive !== false;
  const fit = node.props.fit === "contain" || node.props.fit === "fill" ? node.props.fit : "cover";
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onLoaded = () => {
      if (start > 0 && v.currentTime < start) v.currentTime = start;
    };
    const onTime = () => {
      if (end !== null && v.currentTime >= end) {
        if (loop) v.currentTime = start;
        else v.pause();
      }
    };
    const onEnded = () => {
      if (loop) {
        v.currentTime = start;
        v.play().catch(() => undefined);
      }
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnded);
    };
  }, [start, end, loop, src]);
  if (!src) return <div style={{ position: "absolute", inset: 0, background: "var(--nnd-fill, #eee)", borderRadius: "inherit" }} />;
  return (
    <video
      ref={ref}
      src={src}
      poster={poster || undefined}
      autoPlay={autoplay}
      muted={muted}
      loop={loop && end === null}
      controls={controls}
      playsInline
      preload="metadata"
      onPointerDown={controls ? (e) => e.stopPropagation() : undefined}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit, borderRadius: "inherit", pointerEvents: controls ? "auto" : "none" }}
    />
  );
}

// ------------------------------------------------------------------ Audio

const peaksCache = new Map<string, Promise<number[]>>();

function seededPeaks(seed: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 2654435761);
    return 0.25 + (((h >>> 0) % 1000) / 1000) * 0.75;
  });
}

/** Normalized peaks of an audio file (cached), falling back to a stable pseudo-waveform. */
function loadPeaks(url: string, n: number): Promise<number[]> {
  const key = `${url}#${n}`;
  let p = peaksCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const step = Math.floor(data.length / n) || 1;
        const peaks: number[] = [];
        for (let i = 0; i < n; i++) {
          let max = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) max = Math.max(max, Math.abs(data[j]));
          peaks.push(max);
        }
        const top = Math.max(...peaks, 1e-6);
        return peaks.map((v) => Math.max(0.08, v / top));
      } catch {
        return seededPeaks(url, n);
      }
    })();
    peaksCache.set(key, p);
  }
  return p;
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function AudioVisual({ node, w, h, label }: { node: ElementNode; w: number; h: number; label: ReactNode }) {
  const src = useAssetUrl(typeof node.props.src === "string" ? node.props.src : "");
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = Math.max(12, Math.min(96, Math.floor((w - h - 56) / 4)));
  const [peaks, setPeaks] = useState<number[]>(() => seededPeaks(src || "audio", bars));
  useEffect(() => {
    let alive = true;
    if (src) loadPeaks(src, bars).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [src, bars]);
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => undefined);
    else a.pause();
  };
  const btn = Math.max(20, Math.min(h - 12, 36));
  return (
    <div className="nnd-audio" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 8, padding: "0 10px" }}>
      {src && (
        <audio
          ref={ref}
          src={src}
          loop={node.props.loop === true}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
        />
      )}
      <button
        type="button"
        className="nnd-audio-button"
        style={{ width: btn, height: btn }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={btn * 0.42} fill="currentColor" /> : <Play size={btn * 0.42} fill="currentColor" style={{ marginLeft: btn * 0.06 }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, height: "100%" }}>
        {label && <div className="nnd-audio-title">{label}</div>}
        <svg width="100%" height={Math.max(10, Math.min(h - (label ? 28 : 16), 28))} preserveAspectRatio="none" viewBox={`0 0 ${peaks.length * 4} 20`} aria-hidden>
          {peaks.map((v, i) => (
            <rect key={i} x={i * 4} y={10 - v * 9} width={2.4} height={Math.max(1, v * 18)} rx={1.2} className={i / peaks.length < progress ? "nnd-audio-played" : "nnd-audio-bar"} />
          ))}
        </svg>
      </div>
      <span className="nnd-audio-time">{fmtTime(playing || progress > 0 ? progress * duration : duration)}</span>
    </div>
  );
}

// -------------------------------------------------------------------- Ink

export function parseInkPoints(value: unknown): number[][] {
  if (typeof value !== "string") return [];
  const nums = value.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out: number[][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

export function formatInkPoints(points: number[][]): string {
  return points.map(([x, y]) => `${Math.round(x * 2) / 2} ${Math.round(y * 2) / 2}`).join(" ");
}

/** Smooth, pressure-like outline of a stroke as SVG path data (perfect-freehand). */
export function inkPath(points: number[][], size: number): string {
  if (points.length === 0) return "";
  const outline = getStroke(points, { size, thinning: 0.45, smoothing: 0.6, streamline: 0.45, simulatePressure: true, last: true });
  if (outline.length < 2) return "";
  let d = `M${r2(outline[0][0])},${r2(outline[0][1])}`;
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += ` Q${r2(x0)},${r2(y0)} ${r2((x0 + x1) / 2)},${r2((y0 + y1) / 2)}`;
  }
  return d + " Z";
}

/** Natural size of an ink drawing (point extents plus half the brush). */
export function inkExtent(points: number[][], size: number): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const [x, y] of points) {
    w = Math.max(w, x);
    h = Math.max(h, y);
  }
  return { w: w + size / 2 + 1, h: h + size / 2 + 1 };
}

export function InkVisual({ node, w, h }: { node: ElementNode; w: number; h: number }) {
  const points = parseInkPoints(node.props.points);
  const size = num(node.props.size, 4);
  const color = typeof node.props.color === "string" ? node.props.color : "#e11d48";
  const ext = inkExtent(points, size);
  return (
    <svg className="nnd-svg-shape" width={w} height={h} viewBox={`0 0 ${r2(ext.w)} ${r2(ext.h)}`} preserveAspectRatio="none" aria-hidden>
      <path d={inkPath(points, size)} style={{ fill: color, stroke: "none" }} />
    </svg>
  );
}
