/**
 * Grid snapping and alignment guides.
 *
 * Positions are stored relative to the parent, so the grid is measured from
 * the parent's origin. With grid snapping on, an alignment guide is only used
 * when it also lands on the grid: values written to the file always stay on
 * the grid (no "not on the 4px grid" warnings), and guides still show every
 * alignment that holds.
 */
import type { Pt, Rect } from "@nn-diagram/viewer";

export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export interface SnapOptions {
  grid: number;
  tolerance: number;
  snapGrid: boolean;
  guides: boolean;
  /** Absolute origin of the parent; the grid is relative to it. */
  origin?: Pt;
}

const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

const onGrid = (v: number, grid: number, o: number) => Math.abs(((v - o) / grid) - Math.round((v - o) / grid)) < 1e-6;

/** Snaps a moved rect. `others` are candidate alignment targets. */
export function snapMove(rect: Rect, dx: number, dy: number, others: Rect[], opts: SnapOptions): SnapResult {
  const ox = opts.origin?.x ?? 0;
  const oy = opts.origin?.y ?? 0;
  const moved = { ...rect, x: rect.x + dx, y: rect.y + dy };
  let bestX: number | null = null;
  let bestY: number | null = null;
  if (opts.guides) {
    for (const o of others) {
      for (const a of xs(moved)) {
        for (const b of xs(o)) {
          const diff = b - a;
          if (Math.abs(diff) > opts.tolerance || (bestX !== null && Math.abs(diff) >= Math.abs(bestX))) continue;
          if (opts.snapGrid && !onGrid(moved.x + diff, opts.grid, ox)) continue;
          bestX = diff;
        }
      }
      for (const a of ys(moved)) {
        for (const b of ys(o)) {
          const diff = b - a;
          if (Math.abs(diff) > opts.tolerance || (bestY !== null && Math.abs(diff) >= Math.abs(bestY))) continue;
          if (opts.snapGrid && !onGrid(moved.y + diff, opts.grid, oy)) continue;
          bestY = diff;
        }
      }
    }
  }
  let ndx = dx;
  let ndy = dy;
  if (bestX !== null) ndx += bestX;
  else if (opts.snapGrid) ndx = Math.round((rect.x + dx - ox) / opts.grid) * opts.grid + ox - rect.x;
  if (bestY !== null) ndy += bestY;
  else if (opts.snapGrid) ndy = Math.round((rect.y + dy - oy) / opts.grid) * opts.grid + oy - rect.y;

  const final = { ...rect, x: rect.x + ndx, y: rect.y + ndy };
  const guides: Guide[] = [];
  if (opts.guides) {
    // Show every alignment that holds after snapping.
    for (const o of others) {
      for (const a of xs(final)) {
        if (xs(o).some((b) => Math.abs(b - a) < 0.5)) {
          guides.push({ x1: a, y1: Math.min(final.y, o.y), x2: a, y2: Math.max(final.y + final.h, o.y + o.h) });
        }
      }
      for (const a of ys(final)) {
        if (ys(o).some((b) => Math.abs(b - a) < 0.5)) {
          guides.push({ x1: Math.min(final.x, o.x), y1: a, x2: Math.max(final.x + final.w, o.x + o.w), y2: a });
        }
      }
    }
  }
  return { dx: ndx, dy: ndy, guides };
}

/** Snaps a single coordinate (resize edges) to guides or the grid. */
export function snapValue(value: number, axis: "x" | "y", others: Rect[], opts: SnapOptions): { value: number; guide: number | null } {
  const o = axis === "x" ? (opts.origin?.x ?? 0) : (opts.origin?.y ?? 0);
  if (opts.guides) {
    let best: number | null = null;
    for (const r of others) {
      for (const b of axis === "x" ? xs(r) : ys(r)) {
        if (Math.abs(b - value) > opts.tolerance) continue;
        if (opts.snapGrid && !onGrid(b, opts.grid, o)) continue;
        if (best === null || Math.abs(b - value) < Math.abs(best - value)) best = b;
      }
    }
    if (best !== null) return { value: best, guide: best };
  }
  return { value: opts.snapGrid ? Math.round((value - o) / opts.grid) * opts.grid + o : value, guide: null };
}

/** Snaps a point to the grid relative to an origin. */
export function snapPoint(p: Pt, grid: number, origin: Pt = { x: 0, y: 0 }): Pt {
  return { x: Math.round((p.x - origin.x) / grid) * grid + origin.x, y: Math.round((p.y - origin.y) / grid) * grid + origin.y };
}
