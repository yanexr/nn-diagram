/**
 * Layout: absolute geometry of every shape, outlines (perimeters) and
 * connection points. Pure functions, no DOM.
 */
import { isEdge, isShape, shapeInset, type ElementNode, type ShapeName } from "@nn-diagram/format";

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeLayout {
  uid: string;
  id: string | null;
  node: ElementNode;
  parentUid: string | null;
  /** Absolute bounds (before rotation). */
  bounds: Rect;
  rotate: number;
  outline: OutlineKind;
  /** Corner radius of rectangular outlines (px), so arrows end on rounded corners. */
  radius: number;
  depth: number;
}

export interface EdgeEntry {
  uid: string;
  node: ElementNode;
  parentUid: string | null;
  /** Absolute origin of the arrow's parent, for `via` and free points. */
  origin: Pt;
}

export interface Layout {
  page: { w: number; h: number };
  grid: number;
  shapes: Map<string, ShapeLayout>;
  byId: Map<string, ShapeLayout>;
  edges: EdgeEntry[];
  /** Absolute origin for the children of each shape (and "" for the root). */
  origins: Map<string, Pt>;
  /** Parent uid of every element (shapes and edges). */
  parents: Map<string, string | null>;
}

export type Measured = ReadonlyMap<string, { w: number; h: number }>;

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Outline used for routing and anchors: a Box shape, a circle (Op) or the cuboid silhouette. */
export type OutlineKind = ShapeName | "op" | "cuboid";

/** Pixel offsets of a cuboid's depth (oblique faces), clamped to its size. */
export function cuboidOffsets(w: number, h: number, depth: number) {
  const dx = Math.max(0, Math.min(depth, w - 2));
  const dy = Math.max(0, Math.min(depth * 0.75, h - 2));
  return { dx, dy };
}

export function outlineOf(node: ElementNode): OutlineKind {
  if (node.name === "Op") return "op";
  if (node.name === "Cuboid") return "cuboid";
  if (node.name === "Box") {
    const shape = node.props.shape;
    if (shape === "cloud") return "ellipse";
    if (shape === "person") return "rect";
    return typeof shape === "string" ? (shape as ShapeName) : "rect";
  }
  return "rect";
}

const RADII: Record<string, number> = { none: 0, xs: 2, sm: 4, "": 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, "4xl": 32 };

/**
 * Corner radius of a rectangular shape from its variant and `rounded-*`
 * classes (Tailwind's default scale), clamped to half the smaller side.
 */
export function cornerRadius(node: ElementNode, w: number, h: number): number {
  let r = 0;
  const variant = typeof node.props.variant === "string" ? node.props.variant : "";
  if (node.name === "Box") {
    const shape = node.props.shape;
    if (typeof shape === "string" && shape !== "rect") return 0;
    r = variant === "panel" || variant.startsWith("panel-") ? 10 : 3;
  } else if (node.name === "Image" || node.name === "Video") r = 2;
  else if (node.name === "Audio") r = 10;
  else if (node.name === "Cuboid") return 0;
  else return 0;
  const cls = typeof node.props.className === "string" ? node.props.className.split(/\s+/) : [];
  for (const c of cls) {
    const m = /^rounded(?:-(.+))?$/.exec(c);
    if (!m) continue;
    const v = m[1] ?? "";
    if (v === "full") r = Infinity;
    else if (v.startsWith("[")) {
      const px = /^\[(\d*\.?\d+)(px|rem)?\]$/.exec(v);
      if (px) r = Number(px[1]) * (px[2] === "rem" ? 16 : 1);
    } else if (v in RADII) r = RADII[v];
  }
  return Math.max(0, Math.min(r, w / 2, h / 2));
}

/** Size of an element; Text without w/h uses its measured size. */
export function sizeOf(node: ElementNode, measured?: Measured): { w: number; h: number } {
  const m = measured?.get(node.uid);
  const w = typeof node.props.w === "number" ? node.props.w : (m?.w ?? 0);
  const h = typeof node.props.h === "number" ? node.props.h : (m?.h ?? 0);
  return { w, h };
}

export function computeLayout(root: ElementNode, measured?: Measured): Layout {
  const layout: Layout = {
    page: { w: num(root.props.width, 1200), h: num(root.props.height, 800) },
    grid: Math.max(1, num(root.props.grid, 4)),
    shapes: new Map(),
    byId: new Map(),
    edges: [],
    origins: new Map([[root.uid, { x: 0, y: 0 }]]),
    parents: new Map(),
  };

  const visit = (node: ElementNode, parent: ElementNode, origin: Pt, depth: number) => {
    for (const child of node.children) {
      if (child.kind !== "element") continue;
      if (isShape(child)) {
        const { w, h } = sizeOf(child, measured);
        const bounds = { x: origin.x + num(child.props.x), y: origin.y + num(child.props.y), w, h };
        const id = typeof child.props.id === "string" ? child.props.id : null;
        const entry: ShapeLayout = {
          uid: child.uid,
          id,
          node: child,
          parentUid: node === root ? null : node.uid,
          bounds,
          rotate: num(child.props.rotate),
          outline: outlineOf(child),
          radius: cornerRadius(child, w, h),
          depth,
        };
        layout.shapes.set(child.uid, entry);
        layout.parents.set(child.uid, entry.parentUid);
        if (id && !layout.byId.has(id)) layout.byId.set(id, entry);
        const childOrigin = { x: bounds.x, y: bounds.y };
        layout.origins.set(child.uid, childOrigin);
        visit(child, node, childOrigin, depth + 1);
      } else if (isEdge(child)) {
        layout.edges.push({ uid: child.uid, node: child, parentUid: node === root ? null : node.uid, origin });
        layout.parents.set(child.uid, node === root ? null : node.uid);
      }
    }
  };
  visit(root, root, { x: 0, y: 0 }, 0);
  return layout;
}

// ------------------------------------------------------------------ outlines

export function center(r: Rect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rotatePoint(p: Pt, deg: number, c: Pt): Pt {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function rotatedBounds(r: Rect, deg: number): Rect {
  if (!deg) return r;
  const c = center(r);
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ].map((p) => rotatePoint(p, deg, c));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Size of the folded corner of a note, in px. */
export function noteFold(w: number, h: number): number {
  return Math.max(0, Math.min(16, w * 0.3, h * 0.3));
}

/** Vertical fraction of a callout taken by its body (the rest is the tail). */
export const CALLOUT_BODY = 0.78;

const STAR: [number, number][] = (() => {
  const pts: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = ((-90 + k * 36) * Math.PI) / 180;
    const r = k % 2 ? 0.2 : 0.5;
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  // Stretch to the full box height (the star's bottom points sit above the circle's bottom).
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  return pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(((y - lo) / (hi - lo)) * 1e4) / 1e4]);
})();

/** Outline polygon in unit coordinates for polygonal shapes. */
export function unitPolygon(node: ElementNode, outline: OutlineKind): [number, number][] | null {
  const inset = shapeInset(outline, node.props.inset);
  const w = num(node.props.w, 1) || 1;
  const h = num(node.props.h, 1) || 1;
  switch (outline) {
    case "trapezoid": {
      const side = node.props.narrow ?? "top";
      const i = inset;
      if (side === "bottom") return [[0, 0], [1, 0], [1 - i, 1], [i, 1]];
      if (side === "left") return [[0, i], [1, 0], [1, 1], [0, 1 - i]];
      if (side === "right") return [[0, 0], [1, i], [1, 1 - i], [0, 1]];
      return [[i, 0], [1 - i, 0], [1, 1], [0, 1]];
    }
    case "parallelogram":
      return [[inset, 0], [1, 0], [1 - inset, 1], [0, 1]];
    case "diamond":
      return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    case "hexagon":
      return [[inset, 0], [1 - inset, 0], [1, 0.5], [1 - inset, 1], [inset, 1], [0, 0.5]];
    case "triangle":
      return [[0.5, 0], [1, 1], [0, 1]];
    case "note": {
      const f = noteFold(w, h);
      return [[0, 0], [1 - f / w, 0], [1, f / h], [1, 1], [0, 1]];
    }
    case "callout": {
      const b = CALLOUT_BODY;
      return [[0, 0], [1, 0], [1, b], [0.42, b], [0.2, 1], [0.24, b], [0, b]];
    }
    case "arrow": {
      const i = Math.min(1, inset);
      return [[0, 0.25], [1 - i, 0.25], [1 - i, 0], [1, 0.5], [1 - i, 1], [1 - i, 0.75], [0, 0.75]];
    }
    case "chevron":
      return [[0, 0], [1 - inset, 0], [1, 0.5], [1 - inset, 1], [0, 1], [inset, 0.5]];
    case "octagon": {
      // The corner cut is a fraction of the smaller side, so corners stay at 45°.
      const c = Math.min(inset, 0.5) * Math.min(w, h);
      const u = c / w;
      const v = c / h;
      return [[u, 0], [1 - u, 0], [1, v], [1, 1 - v], [1 - u, 1], [u, 1], [0, 1 - v], [0, v]];
    }
    case "cross": {
      const i = Math.min(inset, 0.49);
      return [[i, 0], [1 - i, 0], [1 - i, i], [1, i], [1, 1 - i], [1 - i, 1 - i], [1 - i, 1], [i, 1], [i, 1 - i], [0, 1 - i], [0, i], [i, i]];
    }
    case "star":
      return STAR;
    case "cuboid": {
      // Silhouette of front, top and side faces: the back-top edge is inset by the depth.
      const { dx, dy } = cuboidOffsets(w, h, num(node.props.depth, 24));
      const u = dx / w;
      const v = dy / h;
      if (node.props.side === "left") return [[0, 0], [1 - u, 0], [1, v], [1, 1], [u, 1], [0, 1 - v]];
      return [[0, v], [u, 0], [1, 0], [1, 1 - v], [1 - u, 1], [0, 1]];
    }
    default:
      return null;
  }
}

function polygonPoints(layout: ShapeLayout): Pt[] | null {
  const unit = unitPolygon(layout.node, layout.outline);
  if (!unit) return null;
  const { x, y, w, h } = layout.bounds;
  return unit.map(([u, v]) => ({ x: x + u * w, y: y + v * h }));
}

/** Intersection of segment a-b with segment c-d, as parameter t on a-b. */
function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  return u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

function polygonRayHit(poly: Pt[], from: Pt, to: Pt): Pt | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const t = segmentIntersection(from, to, poly[i], poly[(i + 1) % poly.length]);
    if (t !== null && t >= 0 && (best === null || t < best)) best = t;
  }
  return best === null ? null : { x: from.x + (to.x - from.x) * best, y: from.y + (to.y - from.y) * best };
}

function rectPerimeter(b: Rect, next: Pt, orthogonal: boolean): Pt {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const alpha = Math.atan2(next.y - cy, next.x - cx);
  const t = Math.atan2(b.h, b.w);
  const p = { x: 0, y: 0 };
  if (alpha < -Math.PI + t || alpha > Math.PI - t) {
    p.x = b.x;
    p.y = cy - (b.w * Math.tan(alpha)) / 2;
  } else if (alpha < -t) {
    p.y = b.y;
    p.x = cx - (b.h * Math.tan(Math.PI / 2 - alpha)) / 2;
  } else if (alpha < t) {
    p.x = b.x + b.w;
    p.y = cy + (b.w * Math.tan(alpha)) / 2;
  } else {
    p.y = b.y + b.h;
    p.x = cx + (b.h * Math.tan(Math.PI / 2 - alpha)) / 2;
  }
  if (orthogonal) {
    if (next.x >= b.x && next.x <= b.x + b.w) p.x = next.x;
    else if (next.y >= b.y && next.y <= b.y + b.h) p.y = next.y;
    if (next.x < b.x) p.x = b.x;
    else if (next.x > b.x + b.w) p.x = b.x + b.w;
    if (next.y < b.y) p.y = b.y;
    else if (next.y > b.y + b.h) p.y = b.y + b.h;
  }
  return p;
}

function ellipsePerimeter(b: Rect, next: Pt, orthogonal: boolean): Pt {
  const a = b.w / 2;
  const bb = b.h / 2;
  const cx = b.x + a;
  const cy = b.y + bb;
  const dx = next.x - cx;
  const dy = next.y - cy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return next;
  if (Math.abs(dx) < 1e-9) return { x: cx, y: cy + (bb * dy) / Math.abs(dy) };
  if (orthogonal) {
    if (next.y >= b.y && next.y <= b.y + b.h) {
      const ty = next.y - cy;
      let tx = Math.sqrt(a * a * (1 - (ty * ty) / (bb * bb))) || 0;
      if (next.x <= b.x) tx = -tx;
      return { x: cx + tx, y: next.y };
    }
    if (next.x >= b.x && next.x <= b.x + b.w) {
      const tx = next.x - cx;
      let ty = Math.sqrt(bb * bb * (1 - (tx * tx) / (a * a))) || 0;
      if (next.y <= b.y) ty = -ty;
      return { x: next.x, y: cy + ty };
    }
  }
  const t = (a * bb) / Math.sqrt(bb * bb * dx * dx + a * a * dy * dy);
  return { x: cx + t * dx, y: cy + t * dy };
}

function polygonPerimeter(poly: Pt[], b: Rect, next: Pt, orthogonal: boolean): Pt {
  const c = center(b);
  if (orthogonal) {
    // Project along the axis the next point is aligned with.
    if (next.x >= b.x && next.x <= b.x + b.w) {
      const from = { x: next.x, y: next.y < c.y ? b.y - 1 : b.y + b.h + 1 };
      const hit = polygonRayHit(poly, from, { x: next.x, y: c.y });
      if (hit) return hit;
    } else if (next.y >= b.y && next.y <= b.y + b.h) {
      const from = { x: next.x < c.x ? b.x - 1 : b.x + b.w + 1, y: next.y };
      const hit = polygonRayHit(poly, from, { x: c.x, y: next.y });
      if (hit) return hit;
    }
  }
  const far = { x: c.x + (next.x - c.x) * 1e3, y: c.y + (next.y - c.y) * 1e3 };
  return polygonRayHit(poly, c, far) ?? rectPerimeter(b, next, orthogonal);
}

/** Corner circle center if `p` (on the bounds) lies in a rounded corner zone. */
function cornerCenter(b: Rect, r: number, p: Pt): Pt | null {
  if (r <= 0) return null;
  const left = p.x < b.x + r - 1e-6;
  const right = p.x > b.x + b.w - r + 1e-6;
  const top = p.y < b.y + r - 1e-6;
  const bottom = p.y > b.y + b.h - r + 1e-6;
  if ((left || right) && (top || bottom)) {
    return { x: left ? b.x + r : b.x + b.w - r, y: top ? b.y + r : b.y + b.h - r };
  }
  return null;
}

/**
 * Moves a point on the rectangle bounds onto the rounded corner arc. With
 * `axis`, the point slides along that axis (orthogonal edges); otherwise it is
 * projected along the line from `from` (the shape center).
 */
function roundCorner(b: Rect, r: number, p: Pt, axis: "x" | "y" | null, from: Pt): Pt {
  const cc = cornerCenter(b, r, p);
  if (!cc) return p;
  if (axis === "y") {
    // vertical approach: keep x, find y on the arc
    const dx = Math.min(Math.abs(p.x - cc.x), r);
    const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
    return { x: p.x, y: p.y < cc.y ? cc.y - dy : cc.y + dy };
  }
  if (axis === "x") {
    const dy = Math.min(Math.abs(p.y - cc.y), r);
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    return { x: p.x < cc.x ? cc.x - dx : cc.x + dx, y: p.y };
  }
  // Ray from `from` through p intersected with the corner circle (far hit).
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const fx = from.x - cc.x;
  const fy = from.y - cc.y;
  const bq = fx * ux + fy * uy;
  const disc = bq * bq - (fx * fx + fy * fy - r * r);
  if (disc < 0) return p;
  const t = -bq + Math.sqrt(disc);
  return { x: from.x + ux * t, y: from.y + uy * t };
}

/**
 * Point where an edge coming from `next` meets the outline of the shape.
 * `orthogonal` projects horizontally/vertically, for orthogonal edges.
 */
export function perimeterPoint(shape: ShapeLayout, next: Pt, orthogonal: boolean): Pt {
  const b = shape.bounds;
  const c = center(b);
  const local = rotatePoint(next, -shape.rotate, c);
  const orth = orthogonal && !shape.rotate;
  let p: Pt;
  if (shape.outline === "ellipse" || shape.outline === "op") p = ellipsePerimeter(b, local, orth);
  else {
    const poly = polygonPoints(shape);
    if (poly) p = polygonPerimeter(poly, b, local, orth);
    else {
      p = rectPerimeter(b, local, orth);
      if (shape.radius > 0) {
        const axis = orth ? (Math.abs(p.y - b.y) < 1e-6 || Math.abs(p.y - b.y - b.h) < 1e-6 ? "y" : "x") : null;
        p = roundCorner(b, shape.radius, p, axis, c);
      }
    }
  }
  return rotatePoint(p, shape.rotate, c);
}

/** Absolute position of a fixed anchor (unit coordinates of the bounds). */
export function anchorPoint(shape: ShapeLayout, at: [number, number]): Pt {
  const b = shape.bounds;
  let p = { x: b.x + at[0] * b.w, y: b.y + at[1] * b.h };
  const onBounds = at[0] === 0 || at[0] === 1 || at[1] === 0 || at[1] === 1;
  if (onBounds && shape.outline === "rect" && shape.radius > 0) {
    const corner = (at[0] === 0 || at[0] === 1) && (at[1] === 0 || at[1] === 1);
    const axis = corner ? null : at[1] === 0 || at[1] === 1 ? "y" : "x";
    p = roundCorner(b, shape.radius, p, axis, center(b));
  }
  if (onBounds && shape.outline !== "rect") {
    // Project onto the real outline, from the center towards the anchor.
    const c = center(b);
    if (Math.abs(p.x - c.x) > 1e-6 || Math.abs(p.y - c.y) > 1e-6) {
      const far = { x: c.x + (p.x - c.x) * 4, y: c.y + (p.y - c.y) * 4 };
      p = perimeterPoint({ ...shape, rotate: 0 }, far, false);
    }
  }
  return rotatePoint(p, shape.rotate, center(b));
}

const RECT_ANCHORS: [number, number][] = [
  [0, 0], [0.25, 0], [0.5, 0], [0.75, 0], [1, 0],
  [0, 0.25], [1, 0.25], [0, 0.5], [1, 0.5], [0, 0.75], [1, 0.75],
  [0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1],
];

const ROUND_ANCHORS: [number, number][] = [
  [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5],
  [0.146, 0.146], [0.854, 0.146], [0.854, 0.854], [0.146, 0.854],
];

/** Fixed connection points shown when connecting. */
export function connectionAnchors(shape: ShapeLayout): [number, number][] {
  if (shape.outline === "ellipse" || shape.outline === "op") return ROUND_ANCHORS;
  if (shape.outline === "rect") return RECT_ANCHORS;
  return [[0.5, 0], [0.25, 0], [0.75, 0], [1, 0.5], [0.5, 1], [0.25, 1], [0.75, 1], [0, 0.5]];
}

/** Unit anchor of an absolute point on (or near) the shape bounds. */
export function unitAnchor(shape: ShapeLayout, p: Pt): [number, number] {
  const b = shape.bounds;
  const local = rotatePoint(p, -shape.rotate, center(b));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return [round((local.x - b.x) / (b.w || 1)), round((local.y - b.y) / (b.h || 1))];
}

export function containsPoint(shape: ShapeLayout, p: Pt, tolerance = 0): boolean {
  const b = shape.bounds;
  const local = rotatePoint(p, -shape.rotate, center(b));
  return (
    local.x >= b.x - tolerance &&
    local.x <= b.x + b.w + tolerance &&
    local.y >= b.y - tolerance &&
    local.y <= b.y + b.h + tolerance
  );
}

/** Closest point on the outline to `p` (used for "connect anywhere"). */
export function nearestOutlinePoint(shape: ShapeLayout, p: Pt): Pt {
  const b = shape.bounds;
  const c = center(b);
  const local = rotatePoint(p, -shape.rotate, c);
  let best: Pt = { x: b.x, y: b.y };
  if (shape.outline === "rect") {
    const candidates = [
      { x: Math.min(Math.max(local.x, b.x), b.x + b.w), y: b.y },
      { x: Math.min(Math.max(local.x, b.x), b.x + b.w), y: b.y + b.h },
      { x: b.x, y: Math.min(Math.max(local.y, b.y), b.y + b.h) },
      { x: b.x + b.w, y: Math.min(Math.max(local.y, b.y), b.y + b.h) },
    ];
    let d = Infinity;
    for (const q of candidates) {
      const dd = (q.x - local.x) ** 2 + (q.y - local.y) ** 2;
      if (dd < d) {
        d = dd;
        best = q;
      }
    }
    const cc = cornerCenter(b, shape.radius, best);
    if (cc) {
      const len = Math.hypot(local.x - cc.x, local.y - cc.y) || 1;
      best = { x: cc.x + ((local.x - cc.x) / len) * shape.radius, y: cc.y + ((local.y - cc.y) / len) * shape.radius };
    }
  } else {
    best = perimeterPoint({ ...shape, rotate: 0 }, local, false);
  }
  return rotatePoint(best, shape.rotate, c);
}
