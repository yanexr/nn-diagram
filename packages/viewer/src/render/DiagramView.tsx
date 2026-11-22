/**
 * Static rendering of a diagram document. Used by the viewer and the editor.
 *
 * Shapes are nested DOM elements, positioned relative to their parent (like
 * CSS absolute positioning). Arrows are rendered in document order next to
 * shapes, so later elements are drawn on top.
 */
import { createContext, memo, useContext, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { isEdge, isShape, type ElementNode } from "@nn-diagram/format";
import { CALLOUT_BODY, type Layout, type Pt } from "../geometry";
import { markerPath, pathData, pointAlong, routeOf, shorten, type EdgeRoute } from "../routing";
import { getCssVersion, subscribeCss } from "../tailwind/engine";
import { RenderContext, useRenderContext, type RenderContextValue } from "./context";
import { labelChildren, renderInline } from "./inline";
import { scheduleStyleRead } from "./styleReads";
import {
  AudioVisual,
  BraceVisual,
  CuboidVisual,
  Glyph,
  IconVisual,
  ImageVisual,
  MediaPlaceholder,
  InkVisual,
  VideoVisual,
  NeuronsVisual,
  OpSymbol,
  SvgOutline,
  TokensVisual,
  cuboidOffsets,
  useProbedStyle,
} from "./shapes";

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : "");

const SVG_OUTLINES = new Set(["trapezoid", "parallelogram", "diamond", "hexagon", "triangle", "cylinder", "document", "note", "callout", "arrow", "chevron", "octagon", "cross", "star", "cloud", "person"]);

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** CSS classes a shape element gets (excluding state classes). */
export function shapeClasses(node: ElementNode): string {
  const variant = str(node.props.variant);
  const className = str(node.props.className);
  switch (node.name) {
    case "Box": {
      const shape = str(node.props.shape) || "rect";
      return cx("nnd-box", `nnd-shape-${shape}`, variant && `nnd-v-${variant}`, className);
    }
    case "Text":
      return cx("nnd-text", variant && variant !== "default" && `nnd-tv-${variant}`, className);
    case "Op":
      return cx("nnd-op", variant && `nnd-v-${variant}`, className);
    case "Cuboid":
      return cx("nnd-box nnd-cuboid", variant && `nnd-v-${variant}`, className);
    case "Neurons":
      return cx("nnd-neurons", variant && `nnd-v-${variant}`, className);
    case "Tokens":
      return cx("nnd-tokens-box", className);
    case "Image":
      return cx("nnd-image", className);
    case "Video":
      return cx("nnd-image nnd-video", className);
    case "Audio":
      return cx("nnd-audio-box", variant && `nnd-v-${variant}`, className);
    case "Ink":
      return cx("nnd-ink", className);
    case "Brace":
      return cx("nnd-brace", className);
    case "Icon":
      return cx("nnd-icon", variant && `nnd-v-${variant}`, className);
    case "Table":
      return cx("nnd-table", variant && `nnd-v-${variant}`, className);
    case "Group":
      return cx("nnd-group", className);
    default:
      return className;
  }
}

function Label({ node, style }: { node: ElementNode; style?: CSSProperties }) {
  const ctx = useRenderContext();
  // Moving/resizing a shape preserves its label children. Reuse the rendered
  // label (especially KaTeX's deep tree), while still giving renderLabel the
  // current full node on every render.
  const content = useMemo(() => {
    const children = labelChildren(node);
    return children.length ? <span className="nnd-label" style={style}>{renderInline(children)}</span> : null;
  }, [node.children, style]);
  return <>{ctx.renderLabel ? ctx.renderLabel(node, content) : content}</>;
}

const elementChildren = (node: ElementNode, name: string) => node.children.filter((c): c is ElementNode => c.kind === "element" && c.name === name);

/** Column widths and row heights of a <Table>: the listed sizes, or equal parts of w/h. */
export function tableGrid(node: ElementNode): { cols: number[]; rows: number[] } {
  const rowNodes = elementChildren(node, "Row");
  const span = (c: ElementNode) => Math.max(1, Math.round(num(c.props.span, 1)));
  const count = Math.max(1, ...rowNodes.map((r) => elementChildren(r, "Cell").reduce((n, c) => n + span(c), 0)));
  const sizes = (list: unknown, n: number, total: number) =>
    Array.isArray(list) && list.length ? list.map((v) => num(v)) : Array.from({ length: n }, () => total / Math.max(1, n));
  return {
    cols: sizes(node.props.cols, count, num(node.props.w)),
    rows: sizes(node.props.rows, rowNodes.length, num(node.props.h)),
  };
}

/** Cells of a table, absolutely positioned. Inner lines are cell borders; the outer border is the table's. */
function TableVisual({ node }: { node: ElementNode }) {
  const { cols, rows } = tableGrid(node);
  const header = node.props.header === true;
  const lines = str(node.props.lines) || "all";
  const xs = cols.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [0]);
  const ys = rows.reduce<number[]>((acc, h) => [...acc, acc[acc.length - 1] + h], [0]);
  const rowNodes = elementChildren(node, "Row");
  return (
    <>
      {rowNodes.map((row, r) => {
        let c = 0;
        const rowVariant = str(row.props.variant);
        return elementChildren(row, "Cell").map((cell) => {
          const span = Math.max(1, Math.round(num(cell.props.span, 1)));
          const c0 = Math.min(c, cols.length);
          const c1 = Math.min(c + span, cols.length);
          c += span;
          const variant = str(cell.props.variant) || rowVariant;
          const style: CSSProperties = {
            left: xs[c0],
            top: ys[r] ?? 0,
            width: xs[c1] - xs[c0],
            height: rows[r] ?? 0,
            borderRightWidth: lines === "all" && c1 < cols.length ? "inherit" : 0,
            borderBottomWidth: lines !== "none" && r < rowNodes.length - 1 ? "inherit" : 0,
          };
          return (
            <div
              key={cell.uid}
              data-cell-uid={cell.uid}
              className={cx("nnd-cell", header && r === 0 && "nnd-cell-head", variant && `nnd-v-${variant}`, str(row.props.className), str(cell.props.className))}
              style={style}
            >
              <Label node={cell} />
            </div>
          );
        });
      })}
    </>
  );
}

/** Positions child shapes relative to the parent's border box. */
function ChildLayer({ node }: { node: ElementNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useRenderContext();
  const className = str(node.props.className);
  const variant = str(node.props.variant);
  // The owner's border comes from the diagram stylesheet, which may arrive after the first render.
  const css = useSyncExternalStore(subscribeCss, getCssVersion, getCssVersion);
  useLayoutEffect(() => {
    const el = ref.current;
    // Child layout effects run before the parent's ref is attached. The DOM
    // parent already exists, including when styles are cached (library insertion).
    const owner = el?.parentElement;
    if (!owner || !el) return;
    return scheduleStyleRead(el, () => {
      const cs = getComputedStyle(owner);
      const left = `${-(parseFloat(cs.borderLeftWidth) || 0)}px`;
      const top = `${-(parseFloat(cs.borderTopWidth) || 0)}px`;
      return () => {
        if (el.style.left !== left) el.style.left = left;
        if (el.style.top !== top) el.style.top = top;
      };
    });
  }, [className, variant, theme, css]);
  return (
    <div ref={ref} className="nnd-children">
      <NodeList parent={node} />
    </div>
  );
}

function useAutoSize(node: ElementNode, ref: React.RefObject<HTMLDivElement | null>) {
  const { onMeasure } = useRenderContext();
  const auto = node.name === "Text" && (typeof node.props.w !== "number" || typeof node.props.h !== "number");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!auto || !el || !onMeasure) return;
    const report = () => onMeasure(node.uid, { w: el.offsetWidth, h: el.offsetHeight });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  // ResizeObserver reports content/font/width changes. Position-only edits
  // must not reconnect it and force synchronous layout for every text node.
  }, [auto, node.uid, node.children, node.props.w, node.props.h, node.props.className, node.props.variant, onMeasure, ref]);
  return auto;
}

export const ShapeView = memo(function ShapeView({ node }: { node: ElementNode }) {
  const ctx = useRenderContext();
  const ref = useRef<HTMLDivElement>(null);
  const auto = useAutoSize(node, ref);
  const w = num(node.props.w);
  const h = num(node.props.h);
  const rotate = num(node.props.rotate);
  const shape = str(node.props.shape) || "rect";
  const classes = shapeClasses(node);
  const svgOutline = node.name === "Box" && SVG_OUTLINES.has(shape);
  const probeNeeded = svgOutline || node.name === "Cuboid" || node.name === "Neurons";
  const [probe, probed] = useProbedStyle(probeNeeded ? classes : "");
  const hasChildShapes = node.children.some((c) => c.kind === "element" && (isShape(c) || isEdge(c)));
  const dimmed = ctx.dimmed?.has(node.uid);

  const style: CSSProperties = {
    left: num(node.props.x),
    top: num(node.props.y),
    width: auto && typeof node.props.w !== "number" ? "max-content" : w,
    height: auto && typeof node.props.h !== "number" ? "auto" : h,
    transform: rotate ? `rotate(${rotate}deg)` : undefined,
  };
  if (probeNeeded) {
    // The outline is drawn in SVG from the probed colors; without a CSS
    // border the SVG lines up exactly with the element's box.
    style.backgroundColor = "transparent";
    style.borderWidth = 0;
    style.boxShadow = "none";
  }

  let visual: ReactNode = null;
  let label: ReactNode = <Label node={node} />;
  switch (node.name) {
    case "Box":
      if (svgOutline) visual = <SvgOutline node={node} w={w} h={h} style={probed} />;
      // Small boxes (tokens, dots) keep their size: the label padding would make them wider.
      if (w < 24) style.paddingLeft = style.paddingRight = 0;
      if (h < 12) style.paddingTop = style.paddingBottom = 0;
      // Keep the label in the callout's body, above the tail.
      if (shape === "callout") style.paddingBottom = h * (1 - CALLOUT_BODY);
      break;
    case "Op":
      label = <OpSymbol symbol={str(node.props.symbol) || "+"} />;
      break;
    case "Text": {
      // A centered single glyph (a math variable like V) is centered by its ink:
      // italic letters overhang their advance box and would look off-center.
      const kids = node.children;
      const only = kids.length === 1 && kids[0].kind === "text" ? kids[0].value.trim() : "";
      if (only && [...only].length <= 2 && !only.includes("$") && /(^|\s)justify-center(\s|$)/.test(str(node.props.className))) {
        label = ctx.renderLabel ? <>{ctx.renderLabel(node, <Glyph text={only} />)}</> : <Glyph text={only} />;
      }
      break;
    }
    case "Tokens":
      visual = <TokensVisual node={node} w={w} h={h} />;
      label = null;
      break;
    case "Cuboid": {
      visual = <CuboidVisual node={node} w={w} h={h} style={probed} />;
      const { dx, dy } = cuboidOffsets(w, h, num(node.props.depth, 24));
      label = (
        <div style={{ position: "absolute", left: node.props.side === "left" ? dx : 0, top: dy, width: w - dx, height: h - dy, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <Label node={node} />
        </div>
      );
      break;
    }
    case "Neurons":
      visual = <NeuronsVisual node={node} w={w} h={h} style={probed} />;
      label = null;
      break;
    case "Brace":
      visual = <BraceVisual node={node} w={w} h={h} />;
      label = null;
      break;
    case "Icon":
      visual = <IconVisual node={node} w={w} h={h} />;
      label = null;
      break;
    case "Table":
      visual = <TableVisual node={node} />;
      label = null;
      break;
    case "Image":
      visual = <ImageVisual node={node} w={w} h={h} />;
      label = null;
      break;
    case "Video":
      visual = ctx.media === "placeholder" ? <MediaPlaceholder kind="video" /> : <VideoVisual node={node} />;
      label = null;
      break;
    case "Audio": {
      const children = labelChildren(node);
      const title = children.length ? renderInline(children) : null;
      // Through renderLabel, so the editor can edit the title in place.
      const audioLabel = ctx.renderLabel ? ctx.renderLabel(node, title) : title;
      visual = ctx.media === "placeholder" ? <MediaPlaceholder kind="audio" caption={audioLabel} /> : <AudioVisual node={node} w={w} h={h} label={audioLabel} />;
      label = null;
      break;
    }
    case "Ink":
      visual = <InkVisual node={node} w={w} h={h} />;
      label = null;
      break;
    case "Group":
      label = null;
      break;
  }

  return (
    <div
      ref={ref}
      data-uid={node.uid}
      data-id={str(node.props.id) || undefined}
      className={cx("nnd-node", classes, dimmed && "nnd-dim", auto && "nnd-auto")}
      style={style}
    >
      {probeNeeded && probe}
      {visual}
      {label}
      {hasChildShapes && <ChildLayer node={node} />}
    </div>
  );
});

// ------------------------------------------------------------------ edges

export interface EdgeGeometry {
  route: EdgeRoute;
  /** Absolute origin of the arrow's parent. */
  origin: Pt;
}

export function strokeWidthOf(node: ElementNode): number {
  const m = /(?:^|\s)stroke-(\d+(?:\.\d+)?)(?:\s|$)/.exec(str(node.props.className));
  const arbitrary = /(?:^|\s)stroke-\[(\d+(?:\.\d+)?)px\](?:\s|$)/.exec(str(node.props.className));
  return m ? Number(m[1]) : arbitrary ? Number(arbitrary[1]) : 1;
}

/** Unscaled size of an element (offsetWidth/Height), kept up to date. */
function useElementSize(el: HTMLElement | null): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!el) {
      setSize(null);
      return;
    }
    const report = () => setSize((s) => (s && s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return size;
}

export const EdgeView = memo(function EdgeView({ node, geometry }: { node: ElementNode; geometry: EdgeGeometry | undefined }) {
  const ctx = useRenderContext();
  const maskId = useId();
  const [labelEl, setLabelEl] = useState<HTMLDivElement | null>(null);
  const labelSize = useElementSize(labelEl);
  if (!geometry) return null;
  const { route, origin } = geometry;
  const pts = route.points.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
  if (pts.length < 2) return null;
  const sw = strokeWidthOf(node);
  const headKind = str(node.props.head) || "arrow";
  const tailKind = str(node.props.tail) || "none";
  const n = pts.length;
  const head = markerPath(headKind, pts[n - 2], pts[n - 1], sw);
  const tail = markerPath(tailKind, pts[1], pts[0], sw);
  let line = pts;
  if (head) line = shorten(line, true, head.inset);
  if (tail) line = shorten(line, false, tail.inset);
  const rt = routeOf(node);
  const d = pathData(line, rt, num(node.props.rounded));
  const variant = str(node.props.variant);
  const dashStyle = node.props.dashed === true ? ({ "--nnd-dash": `${4 * sw} ${3 * sw}` } as CSSProperties) : undefined;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 12 + sw * 3;
  const minX = Math.floor(Math.min(...xs) - pad);
  const minY = Math.floor(Math.min(...ys) - pad);
  const width = Math.ceil(Math.max(...xs) + pad) - minX;
  const height = Math.ceil(Math.max(...ys) + pad) - minY;

  const labelNodes = labelChildren(node);
  const labelAt = typeof node.props.labelAt === "number" ? node.props.labelAt : 0.5;
  const defaultLabel = labelNodes.length ? renderInline(labelNodes) : null;
  const labelContent = ctx.renderLabel ? ctx.renderLabel(node, defaultLabel) : defaultLabel;
  const lp = labelContent != null ? pointAlong(pts, labelAt) : null;
  const cut = lp && labelSize ? { x: lp.x - labelSize.w / 2, y: lp.y - labelSize.h / 2, w: labelSize.w, h: labelSize.h } : null;
  const classes = cx("nnd-edge", variant && `nnd-ev-${variant}`, str(node.props.className), ctx.dimmed?.has(node.uid) && "nnd-dim");
  const markerClass = (style: "fill" | "open" | "hollow") =>
    style === "fill" ? "nnd-head-fill" : style === "hollow" ? "nnd-head-hollow" : "nnd-head-open";

  return (
    <>
      <svg
        data-uid={node.uid}
        data-edge=""
        className={classes}
        style={{ position: "absolute", left: minX, top: minY, overflow: "visible", pointerEvents: "none", ...dashStyle }}
        width={width}
        height={height}
      >
        <g transform={`translate(${-minX},${-minY})`}>
          <path className="nnd-hit" d={pathData(pts, rt, num(node.props.rounded))} style={{ stroke: "transparent", strokeWidth: 10, fill: "none", pointerEvents: "stroke" }} />
          {/* A label cuts a gap into the line (a mask, not a background, so any page color shows through). */}
          {cut && (
            <mask id={maskId} maskUnits="userSpaceOnUse" x={minX} y={minY} width={width} height={height}>
              <rect x={minX} y={minY} width={width} height={height} fill="white" />
              <rect x={cut.x} y={cut.y} width={cut.w} height={cut.h} rx={2} fill="black" />
            </mask>
          )}
          <g mask={cut ? `url(#${maskId})` : undefined}>
            <path className="nnd-line" d={d} />
            {head && <path className={markerClass(head.style)} d={head.d} />}
            {tail && <path className={markerClass(tail.style)} d={tail.d} />}
            {route.source.arrowId && !tail && <circle className="nnd-head-fill" cx={pts[0].x} cy={pts[0].y} r={2 + sw * 0.6} />}
          </g>
        </g>
      </svg>
      {lp && (
        <div
          ref={setLabelEl}
          data-uid={node.uid}
          className={cx("nnd-edge-label", variant && `nnd-ev-${variant}`, ctx.dimmed?.has(node.uid) && "nnd-dim")}
          style={{ left: lp.x, top: lp.y }}
        >
          {labelContent}
        </div>
      )}
    </>
  );
});

// ------------------------------------------------------------------ lists

// Routes change on every layout pass. They go through their own context so
// memoized shapes do not re-render when only arrows move.
const RoutesContext = createContext<ReadonlyMap<string, EdgeGeometry>>(new Map());

const EdgeSlot = memo(function EdgeSlot({ node }: { node: ElementNode }) {
  const routes = useContext(RoutesContext);
  return <EdgeView node={node} geometry={routes.get(node.uid)} />;
});

export const NodeList = memo(function NodeList({ parent }: { parent: ElementNode }) {
  return (
    <>
      {parent.children.map((child) => {
        if (child.kind !== "element") return null;
        if (isShape(child)) return <ShapeView key={child.uid} node={child} />;
        if (isEdge(child)) return <EdgeSlot key={child.uid} node={child} />;
        return null;
      })}
    </>
  );
});

// ------------------------------------------------------------------- root

export interface DiagramViewProps extends RenderContextValue {
  root: ElementNode;
  layout: Layout;
  routes: ReadonlyMap<string, EdgeGeometry>;
  className?: string;
  style?: CSSProperties;
  /** Extra content rendered on top, in diagram coordinates (editor overlays). */
  children?: ReactNode;
  /** Content between the page background and the shapes (the editor's grid). */
  underlay?: ReactNode;
  rootRef?: React.Ref<HTMLDivElement>;
}

/** Page background from `<Diagram background="…">`, if set. */
export function pageStyle(root: ElementNode): CSSProperties | undefined {
  const bg = root.props.background;
  return typeof bg === "string" && bg ? { background: bg } : undefined;
}

export function DiagramView({
  root,
  layout,
  routes,
  className,
  style,
  children,
  underlay,
  rootRef,
  theme,
  baseUrl,
  onMeasure,
  dimmed,
  renderLabel,
  resolveAsset,
  interactive,
  media,
}: DiagramViewProps) {
  const ctx = useMemo<RenderContextValue>(
    () => ({ theme, baseUrl, onMeasure, dimmed, renderLabel, resolveAsset, interactive, media }),
    [theme, baseUrl, onMeasure, dimmed, renderLabel, resolveAsset, interactive, media],
  );
  return (
    <RenderContext.Provider value={ctx}>
      <RoutesContext.Provider value={routes}>
        <div
          ref={rootRef}
          className={cx("nnd-root", ctx.theme === "dark" && "nnd-dark", className)}
          style={{ width: layout.page.w, height: layout.page.h, ...style }}
          data-nnd-root=""
        >
          <div className={cx("nnd-page", str(root.props.className))} style={pageStyle(root)} />
          {underlay}
          <NodeList parent={root} />
          {children}
        </div>
      </RoutesContext.Provider>
    </RenderContext.Provider>
  );
}
