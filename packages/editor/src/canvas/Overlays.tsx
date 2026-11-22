/** Screen-space overlays of the canvas: selection, handles, guides and previews. */
import { memo, useMemo, type ReactNode } from "react";
import { parseEndpoint } from "@nn-diagram/format";
import {
  anchorPoint,
  center,
  connectionAnchors,
  diagramToScreen,
  inkPath,
  rotatePoint,
  routeOf,
  viaPoints,
  type Layout,
  type Pt,
  type Rect,
  type ShapeLayout,
  type Viewport,
} from "@nn-diagram/viewer";
import { unionRect } from "../commands";
import { useEd, useEditorContext } from "../context";
import { segmentHandles } from "./edges";
import { paramHandles } from "./params";
import type { Guide } from "./snap";

/**
 * Selection color: the host's `--nnd-accent` (default blue). The
 * overlay SVG sets it as its `color`, so shapes use currentColor.
 */
export const ACCENT = "currentColor";
const ACCENT_CSS = "var(--nnd-accent, #0d99ff)";
const GUIDE = "#ff3d9a";
const HANDLE = 7;

export interface Overlay {
  guides?: Guide[];
  rubber?: Rect;
  dropTarget?: string | null;
  preview?: { points: Pt[]; target: string | null; targetArrow: string | null; snap: Pt | null };
  label?: { at: Pt; text: string };
  /** New shape being drawn with a shape tool. */
  create?: { rect: Rect; ellipse: boolean };
  /** Pencil stroke being drawn (diagram coordinates). */
  stroke?: { points: number[][]; color: string; size: number };
}

export type Side = "top" | "right" | "bottom" | "left";

export const RESIZE_DIRS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

const r2 = (n: number) => Math.round(n * 100) / 100;

export function resizeCursor(handle: number, rotate: number): string {
  const [dx, dy] = RESIZE_DIRS[handle];
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + rotate + 360) % 180;
  const cursors = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
  return cursors[Math.round(angle / 45) % 4];
}

export function rotatedCorners(r: Rect, rotate: number): Pt[] {
  const c = center(r);
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ].map((p) => rotatePoint(p, rotate, c));
}

function screenPoints(points: Pt[], viewport: Viewport): string {
  return points.map((p) => {
    const q = diagramToScreen(viewport, p);
    return `${r2(q.x)},${r2(q.y)}`;
  }).join(" ");
}

const ShapeOutline = memo(function ShapeOutline({ shape, viewport, multiple }: { shape: ShapeLayout; viewport: Viewport; multiple: boolean }) {
  return <polygon points={screenPoints(rotatedCorners(shape.bounds, shape.rotate), viewport)} fill="none" stroke={ACCENT} strokeWidth={multiple ? 1 : 1.25} />;
});

const EdgeHighlight = memo(function EdgeHighlight({ points, viewport }: { points: Pt[]; viewport: Viewport }) {
  return <polyline points={screenPoints(points, viewport)} fill="none" stroke={ACCENT} strokeOpacity={0.35} strokeWidth={5} strokeLinejoin="round" />;
});

export function Overlays({
  layout,
  selection,
  hover,
  overlay,
  editing,
  enteredGroup,
  showAffordances,
}: {
  layout: Layout;
  selection: string[];
  hover: string | null;
  overlay: Overlay;
  editing: string | null;
  enteredGroup: string | null;
  showAffordances: boolean;
}) {
  const { api } = useEditorContext();
  const viewport = useEd((s) => s.viewport);
  const autoSize = useEd((s) => s.doc.props.autoSize === true);
  const routes = api.routes();
  const edgesByUid = useMemo(() => new Map(layout.edges.map((edge) => [edge.uid, edge])), [layout.edges]);
  const S = (p: Pt) => diagramToScreen(viewport, p);
  const poly = (pts: Pt[]) => screenPoints(pts, viewport);
  const selShapes = selection.map((u) => layout.shapes.get(u)).filter((s): s is ShapeLayout => !!s);
  const selEdges = selection.filter((u) => routes.has(u));
  const single = selShapes.length === 1 && selection.length === 1 ? selShapes[0] : null;
  const hoverShape = hover && !editing ? layout.shapes.get(hover) : null;
  const connecting = !!overlay.preview;

  const handles: ReactNode[] = [];
  // Page handles (nothing selected): grow or shrink the page on any side.
  if (selection.length === 0 && !editing && !enteredGroup && showAffordances && !autoSize && !overlay.rubber) {
    const { w, h } = layout.page;
    const pts = [
      { x: 0, y: 0 },
      { x: w / 2, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h / 2 },
      { x: w, y: h },
      { x: w / 2, y: h },
      { x: 0, y: h },
      { x: 0, y: h / 2 },
    ];
    pts.forEach((p, i) => {
      const sp = S(p);
      handles.push(
        <rect
          key={`pg${i}`}
          data-handle="page"
          data-index={i}
          x={sp.x - 3.5}
          y={sp.y - 3.5}
          width={7}
          height={7}
          rx={1}
          fill="#fff"
          stroke="#94a3b8"
          strokeWidth={1}
          style={{ pointerEvents: "all", cursor: resizeCursor(i, 0) }}
        >
          <title>Resize the page</title>
        </rect>,
      );
    });
  }
  if (single && !editing) {
    const c = center(single.bounds);
    const b = single.bounds;
    const points = [
      { x: b.x, y: b.y },
      { x: b.x + b.w / 2, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h / 2 },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x + b.w / 2, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
      { x: b.x, y: b.y + b.h / 2 },
    ].map((p) => rotatePoint(p, single.rotate, c));
    const small = b.w * viewport.zoom < 24 || b.h * viewport.zoom < 24;
    points.forEach((p, i) => {
      if (small && i % 2 === 1) return;
      const sp = S(p);
      handles.push(
        <rect
          key={`r${i}`}
          data-handle="resize"
          data-uid={single.uid}
          data-index={i}
          x={sp.x - HANDLE / 2}
          y={sp.y - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
          rx={1}
          fill="#fff"
          stroke={ACCENT}
          strokeWidth={1}
          style={{ pointerEvents: "all", cursor: resizeCursor(i, single.rotate) }}
        />,
      );
    });
    // Shape parameters (cuboid depth, trapezoid slant): amber diamonds on the outline.
    for (const ph of paramHandles(single)) {
      const sp = S(rotatePoint(ph.at, single.rotate, c));
      const r = 5;
      handles.push(
        <path
          key={`p${ph.key}`}
          data-handle="param"
          data-uid={single.uid}
          data-key={ph.key}
          d={`M${sp.x},${sp.y - r} L${sp.x + r},${sp.y} L${sp.x},${sp.y + r} L${sp.x - r},${sp.y} Z`}
          fill="#f59e0b"
          stroke="#fff"
          strokeWidth={1.2}
          style={{ pointerEvents: "all", cursor: ph.axis === "x" ? "ew-resize" : "ns-resize" }}
        >
          <title>{ph.label}</title>
        </path>,
      );
    }
    // Rotation handle above the top-right corner.
    const rp = S(rotatePoint({ x: b.x + b.w + 14 / viewport.zoom, y: b.y - 14 / viewport.zoom }, single.rotate, c));
    handles.push(
      <g key="rot" data-handle="rotate" data-uid={single.uid} style={{ pointerEvents: "all", cursor: "grab" }}>
        <circle cx={rp.x} cy={rp.y} r={5} fill="#fff" stroke={ACCENT} strokeWidth={1.2} />
        <path d={`M${rp.x - 2.2},${rp.y + 0.6} a2.4,2.4 0 1,1 1.2,2`} fill="none" stroke={ACCENT} strokeWidth={1} />
      </g>,
    );
  }

  // Edge handles
  for (const uid of selEdges) {
    const geo = routes.get(uid)!;
    const entry = edgesByUid.get(uid);
    if (!entry) continue;
    const node = entry.node;
    const pts = geo.route.points;
    handles.push(<EdgeHighlight key={`hl${uid}`} points={pts} viewport={viewport} />);
    if (selection.length !== 1) continue;
    if (routeOf(node) === "orthogonal") {
      for (const h of segmentHandles(pts)) {
        const sp = S(h.at);
        handles.push(
          <rect
            key={`s${uid}${h.index}`}
            data-handle="segment"
            data-uid={uid}
            data-index={h.index}
            x={sp.x - 4}
            y={sp.y - 4}
            width={8}
            height={8}
            rx={4}
            fill={ACCENT}
            fillOpacity={0.85}
            stroke="#fff"
            strokeWidth={1.2}
            style={{ pointerEvents: "all", cursor: h.vertical ? "col-resize" : "row-resize" }}
          />,
        );
      }
    } else {
      const via = viaPoints(node, entry.origin);
      const all = [pts[0], ...via, pts[pts.length - 1]];
      via.forEach((v, i) => {
        const sp = S(v);
        handles.push(
          <rect key={`w${uid}${i}`} data-handle="waypoint" data-uid={uid} data-index={i} x={sp.x - 4} y={sp.y - 4} width={8} height={8} fill={ACCENT} stroke="#fff" strokeWidth={1.2} style={{ pointerEvents: "all", cursor: "move" }} />,
        );
      });
      for (let i = 0; i < all.length - 1; i++) {
        const sp = S({ x: (all[i].x + all[i + 1].x) / 2, y: (all[i].y + all[i + 1].y) / 2 });
        handles.push(
          <circle key={`v${uid}${i}`} data-handle="virtual" data-uid={uid} data-index={i} cx={sp.x} cy={sp.y} r={3.5} fill="#fff" stroke={ACCENT} strokeOpacity={0.7} style={{ pointerEvents: "all", cursor: "copy" }} />,
        );
      }
    }
    for (const end of ["from", "to"] as const) {
      const p = S(end === "from" ? pts[0] : pts[pts.length - 1]);
      const connected = parseEndpoint(node.props[end])?.kind === "node";
      handles.push(
        <circle
          key={`e${uid}${end}`}
          data-handle="edge-end"
          data-uid={uid}
          data-end={end}
          cx={p.x}
          cy={p.y}
          r={5}
          fill={connected ? ACCENT : "#fff"}
          stroke={connected ? "#fff" : ACCENT}
          strokeWidth={1.5}
          style={{ pointerEvents: "all", cursor: "move" }}
        />,
      );
    }
  }

  // Connection affordances on the hovered shape
  const affordances: ReactNode[] = [];
  if (showAffordances && hoverShape && !connecting && selection.length <= 1 && hoverShape.node.name !== "Ink") {
    const zoomOk = hoverShape.bounds.w * viewport.zoom > 10 && hoverShape.bounds.h * viewport.zoom > 10;
    if (zoomOk) {
      for (const at of connectionAnchors(hoverShape)) {
        const sp = S(anchorPoint(hoverShape, at));
        affordances.push(
          <g key={`a${at.join()}`} data-handle="anchor" data-uid={hoverShape.uid} data-at={JSON.stringify(at)} style={{ pointerEvents: "all", cursor: "crosshair" }}>
            <circle cx={sp.x} cy={sp.y} r={7} fill="transparent" />
            <path d={`M${sp.x - 2.5},${sp.y - 2.5} L${sp.x + 2.5},${sp.y + 2.5} M${sp.x + 2.5},${sp.y - 2.5} L${sp.x - 2.5},${sp.y + 2.5}`} stroke={ACCENT} strokeWidth={1.4} />
          </g>,
        );
      }
      // Blue hover arrows (click: clone + connect, drag: connect)
      const b = hoverShape.bounds;
      const c = center(b);
      const off = 18 / viewport.zoom;
      const sides: [Side, Pt, number][] = [
        ["top", { x: c.x, y: b.y - off }, -90],
        ["right", { x: b.x + b.w + off, y: c.y }, 0],
        ["bottom", { x: c.x, y: b.y + b.h + off }, 90],
        ["left", { x: b.x - off, y: c.y }, 180],
      ];
      if (!hoverShape.rotate) {
        for (const [side, pt, angle] of sides) {
          const sp = S(pt);
          affordances.push(
            <g
              key={`h${side}`}
              data-handle="hover-arrow"
              data-uid={hoverShape.uid}
              data-side={side}
              transform={`translate(${r2(sp.x)},${r2(sp.y)}) rotate(${angle})`}
              className="nnd-hover-arrow"
              style={{ pointerEvents: "all", cursor: "pointer" }}
            >
              <title>Click: add a connected copy · Drag: connect</title>
              <circle r={9} fill="transparent" />
              <path d="M-5,-4.5 L3,0 L-5,4.5 Z" fill={ACCENT} fillOpacity={0.55} />
            </g>,
          );
        }
      }
    }
  }

  const guides = overlay.guides ?? [];
  const drop = overlay.dropTarget ? layout.shapes.get(overlay.dropTarget) : null;
  const previewTarget = overlay.preview?.target ? layout.shapes.get(overlay.preview.target) : null;
  const previewArrow = overlay.preview?.targetArrow ? routes.get(overlay.preview.targetArrow) : null;
  const entered = enteredGroup ? layout.shapes.get(enteredGroup) : null;
  const stroke = overlay.stroke;
  // Rasterize the changing marquee and outlines separately from the stationary scene.
  const willChange = overlay.rubber ? "transform" : undefined;

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        style={{ color: ACCENT_CSS, willChange }}
      >
        {entered && <polygon points={poly(rotatedCorners(entered.bounds, entered.rotate))} fill="none" stroke={ACCENT} strokeOpacity={0.5} strokeDasharray="4 3" />}
        {hoverShape && !selection.includes(hoverShape.uid) && (
          <polygon points={poly(rotatedCorners(hoverShape.bounds, hoverShape.rotate))} fill="none" stroke={ACCENT} strokeOpacity={0.55} strokeWidth={1} />
        )}
        {selShapes.map((s) => (
          <ShapeOutline key={s.uid} shape={s} viewport={viewport} multiple={selShapes.length > 1} />
        ))}
        {selShapes.length > 1 &&
          (() => {
            const u = unionRect(selShapes.map((s) => s.bounds))!;
            const a = S({ x: u.x, y: u.y });
            return <rect x={a.x - 3} y={a.y - 3} width={u.w * viewport.zoom + 6} height={u.h * viewport.zoom + 6} fill="none" stroke={ACCENT} strokeDasharray="3 3" strokeOpacity={0.7} />;
          })()}
        {drop && <polygon points={poly(rotatedCorners(drop.bounds, drop.rotate))} fill={ACCENT} fillOpacity={0.05} stroke={ACCENT} strokeWidth={2} strokeDasharray="6 3" />}
        {guides.map((g, i) => {
          const a = S({ x: g.x1, y: g.y1 });
          const b = S({ x: g.x2, y: g.y2 });
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={GUIDE} strokeWidth={1} />;
        })}
        {overlay.rubber &&
          (() => {
            const a = S({ x: overlay.rubber.x, y: overlay.rubber.y });
            return <rect x={a.x} y={a.y} width={overlay.rubber.w * viewport.zoom} height={overlay.rubber.h * viewport.zoom} fill={ACCENT} fillOpacity={0.07} stroke={ACCENT} strokeWidth={1} />;
          })()}
        {overlay.create &&
          (() => {
            const r = overlay.create.rect;
            const a = S({ x: r.x, y: r.y });
            const w = r.w * viewport.zoom;
            const h = r.h * viewport.zoom;
            return overlay.create.ellipse ? (
              <ellipse cx={a.x + w / 2} cy={a.y + h / 2} rx={w / 2} ry={h / 2} fill={ACCENT} fillOpacity={0.06} stroke={ACCENT} strokeWidth={1.25} />
            ) : (
              <rect x={a.x} y={a.y} width={w} height={h} rx={3 * viewport.zoom} fill={ACCENT} fillOpacity={0.06} stroke={ACCENT} strokeWidth={1.25} />
            );
          })()}
        {previewTarget && (
          <polygon points={poly(rotatedCorners(previewTarget.bounds, previewTarget.rotate))} fill="none" stroke={ACCENT} strokeWidth={2} strokeOpacity={overlay.preview?.snap ? 0.4 : 0.9} />
        )}
        {previewArrow && <polyline points={poly(previewArrow.route.points)} fill="none" stroke={ACCENT} strokeOpacity={0.45} strokeWidth={6} strokeLinejoin="round" />}
        {overlay.preview && (
          <>
            <polyline points={poly(overlay.preview.points)} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeDasharray="4 3" />
            {overlay.preview.snap &&
              (() => {
                const sp = S(overlay.preview!.snap!);
                return <circle cx={sp.x} cy={sp.y} r={5} fill={ACCENT} fillOpacity={0.3} stroke={ACCENT} strokeWidth={1.5} />;
              })()}
          </>
        )}
        {stroke && stroke.points.length > 0 && (
          <path
            d={inkPath(
              stroke.points.map(([x, y]) => {
                const p = S({ x, y });
                return [p.x, p.y];
              }),
              stroke.size * viewport.zoom,
            )}
            fill={stroke.color}
          />
        )}
        {affordances}
        {handles}
      </svg>
      {overlay.label &&
        (() => {
          const sp = S(overlay.label.at);
          return (
            <div className="pointer-events-none absolute rounded bg-[var(--nnd-accent,#0d99ff)] px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums shadow-sm" style={{ left: sp.x, top: sp.y + 8 }}>
              {overlay.label.text}
            </div>
          );
        })()}
    </>
  );
}
