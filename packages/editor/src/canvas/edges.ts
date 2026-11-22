/**
 * Interactive editing of orthogonal arrows: each segment has a handle in its
 * middle; dragging it moves the segment and the result is stored as
 * waypoints. Ported from draw.io's (mxGraph) `mxEdgeSegmentHandler`
 * (Apache-2.0, Copyright JGraph Ltd). See NOTICE.
 */
import { computeRoute, simplify, type Pt, type ResolvedEnd } from "@nn-diagram/viewer";

/** Route points used for segment handles (straight edges get a virtual middle). */
export function segmentPoints(points: Pt[]): Pt[] {
  const pts = points;
  const tol = 1;
  if (
    pts.length === 2 ||
    (pts.length === 3 &&
      ((Math.abs(pts[0].x - pts[1].x) < tol && Math.abs(pts[1].x - pts[2].x) < tol) ||
        (Math.abs(pts[0].y - pts[1].y) < tol && Math.abs(pts[1].y - pts[2].y) < tol)))
  ) {
    const last = pts[pts.length - 1];
    const c = { x: pts[0].x + (last.x - pts[0].x) / 2, y: pts[0].y + (last.y - pts[0].y) / 2 };
    return [pts[0], c, { ...c }, last];
  }
  return pts;
}

export interface SegmentHandle {
  /** Bend index: the segment between points[index - 1] and points[index]. */
  index: number;
  at: Pt;
  /** Segment is vertical (handle moves horizontally). */
  vertical: boolean;
}

export function segmentHandles(points: Pt[]): SegmentHandle[] {
  const pts = segmentPoints(points);
  const straight = pts.length === 4 && Math.abs(pts[1].x - pts[2].x) < 1 && Math.abs(pts[1].y - pts[2].y) < 1;
  const handles: SegmentHandle[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (straight && i !== 2) continue;
    const a = pts[i - 1];
    const b = pts[i];
    let vertical = Math.abs(a.x - b.x) < 1;
    if (Math.abs(a.y - b.y) < 1 && Math.abs(a.x - b.x) < 1 && i < pts.length - 1) {
      vertical = Math.abs(a.x - pts[i + 1].x) < 1;
    }
    if (straight) vertical = Math.abs(pts[0].x - pts[3].x) < 1;
    handles.push({ index: i, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, vertical });
  }
  return handles;
}

/** New waypoints when the segment `index` is dragged to `point` (getPreviewPoints). */
export function dragSegment(points: Pt[], index: number, point: Pt): Pt[] {
  const pts = segmentPoints(points).map((p) => ({ ...p }));
  let last = pts[0];
  const result: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const pt = pts[i];
    if (i === index) {
      if (Math.abs(last.x - pt.x) < 1) {
        last.x = point.x;
        pt.x = point.x;
      }
      if (Math.abs(last.y - pt.y) < 1) {
        last.y = point.y;
        pt.y = point.y;
      }
    }
    if (i < pts.length - 1) result.push(pt);
    last = pt;
  }
  return result;
}

function contains(end: ResolvedEnd, p: Pt): boolean {
  const b = end.shape?.bounds;
  return !!b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

/** Inner bends of a routed polyline, without points on straight runs. */
function bends(points: Pt[]): Pt[] {
  return simplify(points).slice(1, -1);
}

/**
 * Resolves dragged hints into the waypoints to store, like
 * mxEdgeSegmentHandler.updatePreviewState: routes with the hints, keeps only
 * real bends, and drops the waypoints if the default route looks the same.
 */
export function finalizeHints(source: ResolvedEnd, target: ResolvedEnd, hints: Pt[], point: Pt): Pt[] {
  let h = hints;
  if (h.length === 1 && (contains(source, h[0]) || contains(target, h[0]))) h = [point, point];
  const routed = computeRoute(source, target, h, "orthogonal").points;
  let result = bends(routed);
  if (result.length === 0) {
    const a = routed[0];
    const b = routed[routed.length - 1];
    if (Math.round(a.x - b.x) === 0 || Math.round(a.y - b.y) === 0) result = [];
  }
  const plain = computeRoute(source, target, [], "orthogonal").points;
  const same =
    simplify(plain).length === simplify(routed).length &&
    simplify(plain).every((p, i) => Math.abs(p.x - simplify(routed)[i].x) < 1 && Math.abs(p.y - simplify(routed)[i].y) < 1);
  return same ? [] : result;
}
