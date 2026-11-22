/**
 * Shape parameter handles (yellow diamonds): extra handles for the
 * dimensions a shape has besides its box, such as a cuboid's depth or a
 * trapezoid's slant. Each handle sits on the outline where the parameter
 * shows, and dragging it maps the pointer back to the parameter's value.
 */
import { SHAPE_INSETS, shapeInset, type ShapeName, type Value } from "@nn-diagram/format";
import { cuboidOffsets, type Pt, type ShapeLayout } from "@nn-diagram/viewer";

export interface ParamHandle {
  key: string;
  /** Tooltip / status text. */
  label: string;
  /** Position in diagram coordinates, before the shape's rotation. */
  at: Pt;
  /** Drag axis, for the cursor. */
  axis: "x" | "y";
  /** New props for a pointer at `p` (diagram coordinates, unrotated). `free` disables grid snapping. */
  apply: (p: Pt, grid: number, free: boolean) => Record<string, Value | undefined>;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export function paramHandles(shape: ShapeLayout): ParamHandle[] {
  const { node } = shape;
  const b = shape.bounds;
  if (node.name === "Cuboid") {
    const depth = num(node.props.depth, 24);
    const { dx } = cuboidOffsets(b.w, b.h, depth);
    const left = node.props.side === "left";
    return [
      {
        key: "depth",
        label: "Depth",
        // The back-top corner on the front face's side: dragging it inward makes the block deeper.
        at: { x: left ? b.x + b.w - dx : b.x + dx, y: b.y },
        axis: "x",
        apply: (p, grid, free) => {
          const raw = clamp(left ? b.x + b.w - p.x : p.x - b.x, 0, b.w - 2);
          return { depth: free ? Math.round(raw) : Math.round(raw / grid) * grid };
        },
      },
    ];
  }
  if (node.name !== "Box") return [];
  const kind = typeof node.props.shape === "string" ? node.props.shape : "rect";
  const spec = SHAPE_INSETS[kind as ShapeName];
  if (!spec) return [];
  const inset = shapeInset(kind, node.props.inset);
  const fraction = (px: number, size: number, free: boolean, grid: number) => {
    const snapped = free ? px : Math.round(px / grid) * grid;
    return round2(clamp(snapped / Math.max(size, 1), 0, spec.max));
  };
  const handle = (at: Pt, axis: "x" | "y", value: (p: Pt, grid: number, free: boolean) => number): ParamHandle[] => [
    { key: "inset", label: spec.label, at, axis, apply: (p, grid, free) => ({ inset: value(p, grid, free) }) },
  ];
  const right = b.x + b.w;
  switch (kind) {
    case "trapezoid": {
      const narrow = typeof node.props.narrow === "string" ? node.props.narrow : "top";
      if (narrow === "left" || narrow === "right")
        return handle({ x: narrow === "left" ? b.x : right, y: b.y + inset * b.h }, "y", (p, g, f) => fraction(p.y - b.y, b.h, f, g));
      return handle({ x: b.x + inset * b.w, y: narrow === "bottom" ? b.y + b.h : b.y }, "x", (p, g, f) => fraction(p.x - b.x, b.w, f, g));
    }
    case "arrow":
    case "chevron":
      // The head's back edge, measured from the tip.
      return handle({ x: right - inset * b.w, y: b.y }, "x", (p, g, f) => fraction(right - p.x, b.w, f, g));
    case "octagon": {
      const side = Math.min(b.w, b.h);
      return handle({ x: b.x + Math.min(inset, 0.5) * side, y: b.y }, "x", (p, g, f) => fraction(p.x - b.x, side, f, g));
    }
    default:
      return handle({ x: b.x + inset * b.w, y: b.y }, "x", (p, g, f) => fraction(p.x - b.x, b.w, f, g));
  }
}
