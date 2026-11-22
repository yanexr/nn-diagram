/**
 * Edge routing. The orthogonal router is a port of draw.io's (mxGraph)
 * `mxEdgeStyle.OrthConnector` and `mxEdgeStyle.SegmentConnector`
 * (Apache-2.0, Copyright JGraph Ltd). See NOTICE.
 */
import { endpointAnchor, parseEndpoint, type ElementNode, type Endpoint, type Route } from "@nn-diagram/format";
import {
  anchorPoint,
  center,
  perimeterPoint,
  rotatedBounds,
  type Layout,
  type Pt,
  type Rect,
  type ShapeLayout,
} from "./geometry";

const WEST = 1;
const NORTH = 2;
const SOUTH = 4;
const EAST = 8;
const ALL = 15;

const SOURCE_MASK = 1024;
const TARGET_MASK = 2048;
const SIDE_MASK = 480;
const CENTER_MASK = 512;

const ORTH_BUFFER = 10;
/** Jetty size: how far the route leaves a shape before turning. */
export const JETTY = 2 * ORTH_BUFFER;

const DIR_VECTORS = [[-1, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]];

const ROUTE_PATTERNS = [
  [[513, 2308, 2081, 2562], [513, 1090, 514, 2184, 2114, 2561], [513, 1090, 514, 2564, 2184, 2562], [513, 2308, 2561, 1090, 514, 2568, 2308]],
  [[514, 1057, 513, 2308, 2081, 2562], [514, 2184, 2114, 2561], [514, 2184, 2562, 1057, 513, 2564, 2184], [514, 1057, 513, 2568, 2308, 2561]],
  [[1090, 514, 1057, 513, 2308, 2081, 2562], [2114, 2561], [1090, 2562, 1057, 513, 2564, 2184], [1090, 514, 1057, 513, 2308, 2561, 2568]],
  [[2081, 2562], [1057, 513, 1090, 514, 2184, 2114, 2561], [1057, 513, 1090, 514, 2184, 2562, 2564], [1057, 2561, 1090, 514, 2568, 2308]],
];

function reversePortConstraints(c: number): number {
  return ((c & WEST) << 3) | ((c & NORTH) << 1) | ((c & SOUTH) >> 1) | ((c & EAST) >> 3);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Port of SegmentConnector. `p0`/`pe` are fixed terminal points (null when
 * floating), `hints` are the waypoints. Returns the route's inner points.
 */
function segmentConnector(source: Rect | null, target: Rect | null, p0: Pt | null, pe: Pt | null, controlHints: Pt[]): Pt[] {
  const result: Pt[] = [];
  const tol = 1;
  const tempPoints: Pt[] = [];
  let lastPushed: Pt | null = null;
  let horizontal = true;
  let hint: Pt | null = null;

  let pt: Pt | null = p0 ? { ...p0 } : source ? center(source) : null;

  if (controlHints.length > 0) {
    let hints = controlHints.map((h) => ({ ...h }));
    if (pt && hints[0]) {
      if (Math.abs(hints[0].x - pt.x) < tol) hints[0].x = pt.x;
      if (Math.abs(hints[0].y - pt.y) < tol) hints[0].y = pt.y;
    }
    const last = hints[hints.length - 1];
    if (pe && last) {
      if (Math.abs(last.x - pe.x) < tol) last.x = pe.x;
      if (Math.abs(last.y - pe.y) < tol) last.y = pe.y;
    }
    hint = hints[0];

    let currentTerm: Rect | null = source;
    let currentPt: Pt | null = p0;
    let currentHint = hint;
    if (currentPt) currentTerm = null;

    for (let i = 0; i < 2; i++) {
      const fixedVertAlign = currentPt != null && currentPt.x === currentHint.x;
      const fixedHozAlign = currentPt != null && currentPt.y === currentHint.y;
      const inHozChan = currentTerm != null && currentHint.y >= currentTerm.y && currentHint.y <= currentTerm.y + currentTerm.h;
      const inVertChan = currentTerm != null && currentHint.x >= currentTerm.x && currentHint.x <= currentTerm.x + currentTerm.w;
      const hozChan = fixedHozAlign || (currentPt == null && inHozChan);
      const vertChan = fixedVertAlign || (currentPt == null && inVertChan);

      if (!(i === 0 && ((hozChan && vertChan) || (fixedVertAlign && fixedHozAlign)))) {
        if (currentPt != null && !fixedHozAlign && !fixedVertAlign && (inHozChan || inVertChan)) {
          horizontal = !inHozChan;
          break;
        }
        if (vertChan || hozChan) {
          horizontal = hozChan;
          if (i === 1) horizontal = hints.length % 2 === 0 ? hozChan : vertChan;
          break;
        }
      }
      currentTerm = target;
      currentPt = pe;
      if (currentPt) currentTerm = null;
      currentHint = hints[hints.length - 1];
      if (fixedVertAlign && fixedHozAlign) hints = hints.slice(1);
    }

    if (pt) {
      if (horizontal && ((p0 && p0.y !== hint.y) || (!p0 && source && (hint.y < source.y || hint.y > source.y + source.h)))) {
        tempPoints.push({ x: pt.x, y: hint.y });
      } else if (!horizontal && ((p0 && p0.x !== hint.x) || (!p0 && source && (hint.x < source.x || hint.x > source.x + source.w)))) {
        tempPoints.push({ x: hint.x, y: pt.y });
      }
      if (horizontal) pt.y = hint.y;
      else pt.x = hint.x;
    } else {
      pt = { ...hint };
    }

    for (let i = 0; i < hints.length; i++) {
      horizontal = !horizontal;
      hint = hints[i];
      if (horizontal) pt.y = hint.y;
      else pt.x = hint.x;
      tempPoints.push({ ...pt });
    }
  } else {
    hint = pt;
    horizontal = true;
  }

  const end: Pt | null = pe ? pe : target ? center(target) : null;
  if (end && hint) {
    if (horizontal && ((pe && pe.y !== hint.y) || (!pe && target && (hint.y < target.y || hint.y > target.y + target.h)))) {
      tempPoints.push({ x: end.x, y: hint.y });
    } else if (!horizontal && ((pe && pe.x !== hint.x) || (!pe && target && (hint.x < target.x || hint.x > target.x + target.w)))) {
      tempPoints.push({ x: hint.x, y: end.y });
    }
  }

  // Removes bends inside the source / target terminals
  if (!p0 && source) {
    while (tempPoints.length > 0 && contains(source, tempPoints[0].x, tempPoints[0].y)) tempPoints.shift();
  }
  if (!pe && target) {
    while (tempPoints.length > 0 && contains(target, tempPoints[tempPoints.length - 1].x, tempPoints[tempPoints.length - 1].y)) {
      tempPoints.pop();
    }
  }

  for (const p of tempPoints) {
    const q = { x: round1(p.x), y: round1(p.y) };
    if (!lastPushed || Math.abs(lastPushed.x - q.x) >= tol || Math.abs(lastPushed.y - q.y) >= tol) {
      result.push(q);
      lastPushed = q;
    }
  }

  if (pe && result.length > 0) {
    const r = result[result.length - 1];
    if (Math.abs(pe.x - r.x) <= tol && Math.abs(pe.y - r.y) <= tol) {
      result.pop();
      const prev = result[result.length - 1];
      if (prev) {
        if (Math.abs(prev.x - pe.x) < tol) prev.x = pe.x;
        if (Math.abs(prev.y - pe.y) < tol) prev.y = pe.y;
      }
    }
  }
  return result;
}

/** Port of OrthConnector. Falls back to the segment connector with waypoints. */
function orthConnector(
  sourceState: { rect: Rect; rotate: number } | null,
  targetState: { rect: Rect; rotate: number } | null,
  p0: Pt | null,
  pe: Pt | null,
  hints: Pt[],
  jetty: [number, number],
  ports: [number, number] = [ALL, ALL],
): Pt[] {
  let [sourceBuffer, targetBuffer] = jetty;
  const source = sourceState?.rect ?? null;
  const target = targetState?.rect ?? null;
  if (source && sourceState === targetState) {
    targetBuffer = Math.max(sourceBuffer, targetBuffer);
    sourceBuffer = targetBuffer;
  }
  const totalBuffer = sourceBuffer + targetBuffer;
  let tooShort = false;
  if (p0 && pe) {
    const dx = pe.x - p0.x;
    const dy = pe.y - p0.y;
    tooShort = dx * dx + dy * dy < totalBuffer * totalBuffer;
  }
  if (tooShort || hints.length > 0) return segmentConnector(source, target, p0, pe, hints);

  if ((!source && !p0) || (!target && !pe)) return [];
  const srcRect = source ? rotatedBounds(source, sourceState!.rotate) : { x: p0!.x, y: p0!.y, w: 1, h: 1 };
  const trgRect = target ? rotatedBounds(target, targetState!.rotate) : { x: pe!.x, y: pe!.y, w: 1, h: 1 };
  if (srcRect.w === 0 || srcRect.h === 0 || trgRect.w === 0 || trgRect.h === 0) return [];

  const geo = [
    [srcRect.x, srcRect.y, srcRect.w, srcRect.h],
    [trgRect.x, trgRect.y, trgRect.w, trgRect.h],
  ];
  const buffer = [sourceBuffer, targetBuffer];
  const limits = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
  for (let i = 0; i < 2; i++) {
    limits[i][1] = geo[i][0] - buffer[i];
    limits[i][2] = geo[i][1] - buffer[i];
    limits[i][4] = geo[i][0] + geo[i][2] + buffer[i];
    limits[i][8] = geo[i][1] + geo[i][3] + buffer[i];
  }

  const sourceCenX = geo[0][0] + geo[0][2] / 2;
  const sourceCenY = geo[0][1] + geo[0][3] / 2;
  const targetCenX = geo[1][0] + geo[1][2] / 2;
  const targetCenY = geo[1][1] + geo[1][3] / 2;
  const dx = sourceCenX - targetCenX;
  const dy = sourceCenY - targetCenY;

  let quad = 0;
  if (dx < 0) quad = dy < 0 ? 2 : 1;
  else if (dy <= 0) {
    quad = 3;
    if (dx === 0) quad = 2;
  }

  const portConstraint = [...ports];
  const dir = [0, 0];
  const constraint = [
    [0.5, 0.5],
    [0.5, 0.5],
  ];
  if (!source) constraint[0] = [0, 0];
  if (!target) constraint[1] = [0, 0];

  let currentTerm: Pt | null = source ? p0 : null;
  for (let i = 0; i < 2; i++) {
    if (currentTerm) {
      constraint[i][0] = (currentTerm.x - geo[i][0]) / geo[i][2];
      if (Math.abs(currentTerm.x - geo[i][0]) <= 1) dir[i] = WEST;
      else if (Math.abs(currentTerm.x - geo[i][0] - geo[i][2]) <= 1) dir[i] = EAST;
      constraint[i][1] = (currentTerm.y - geo[i][1]) / geo[i][3];
      if (Math.abs(currentTerm.y - geo[i][1]) <= 1) dir[i] = NORTH;
      else if (Math.abs(currentTerm.y - geo[i][1] - geo[i][3]) <= 1) dir[i] = SOUTH;
    }
    currentTerm = target ? pe : null;
  }

  const sourceTopDist = geo[0][1] - (geo[1][1] + geo[1][3]);
  const sourceLeftDist = geo[0][0] - (geo[1][0] + geo[1][2]);
  const sourceBottomDist = geo[1][1] - (geo[0][1] + geo[0][3]);
  const sourceRightDist = geo[1][0] - (geo[0][0] + geo[0][2]);

  const vertexSeparations: number[] = [];
  vertexSeparations[1] = Math.max(sourceLeftDist - totalBuffer, 0);
  vertexSeparations[2] = Math.max(sourceTopDist - totalBuffer, 0);
  vertexSeparations[4] = Math.max(sourceBottomDist - totalBuffer, 0);
  vertexSeparations[3] = Math.max(sourceRightDist - totalBuffer, 0);

  const dirPref: number[] = [];
  const horPref: number[] = [];
  const vertPref: number[] = [];
  horPref[0] = sourceLeftDist >= sourceRightDist ? WEST : EAST;
  vertPref[0] = sourceTopDist >= sourceBottomDist ? NORTH : SOUTH;
  horPref[1] = reversePortConstraints(horPref[0]);
  vertPref[1] = reversePortConstraints(vertPref[0]);

  const preferredHorizDist = sourceLeftDist >= sourceRightDist ? sourceLeftDist : sourceRightDist;
  const preferredVertDist = sourceTopDist >= sourceBottomDist ? sourceTopDist : sourceBottomDist;
  const prefOrdering = [
    [0, 0],
    [0, 0],
  ];
  let preferredOrderSet = false;

  for (let i = 0; i < 2; i++) {
    if (dir[i] !== 0) continue;
    if ((horPref[i] & portConstraint[i]) === 0) horPref[i] = reversePortConstraints(horPref[i]);
    if ((vertPref[i] & portConstraint[i]) === 0) vertPref[i] = reversePortConstraints(vertPref[i]);
    prefOrdering[i][0] = vertPref[i];
    prefOrdering[i][1] = horPref[i];
  }

  if (preferredVertDist > 0 && preferredHorizDist > 0) {
    if ((horPref[0] & portConstraint[0]) > 0 && (vertPref[1] & portConstraint[1]) > 0) {
      prefOrdering[0][0] = horPref[0];
      prefOrdering[0][1] = vertPref[0];
      prefOrdering[1][0] = vertPref[1];
      prefOrdering[1][1] = horPref[1];
      preferredOrderSet = true;
    } else if ((vertPref[0] & portConstraint[0]) > 0 && (horPref[1] & portConstraint[1]) > 0) {
      prefOrdering[0][0] = vertPref[0];
      prefOrdering[0][1] = horPref[0];
      prefOrdering[1][0] = horPref[1];
      prefOrdering[1][1] = vertPref[1];
      preferredOrderSet = true;
    }
  }
  if (preferredVertDist > 0 && !preferredOrderSet) {
    prefOrdering[0][0] = vertPref[0];
    prefOrdering[0][1] = horPref[0];
    prefOrdering[1][0] = vertPref[1];
    prefOrdering[1][1] = horPref[1];
    preferredOrderSet = true;
  }
  if (preferredHorizDist > 0 && !preferredOrderSet) {
    prefOrdering[0][0] = horPref[0];
    prefOrdering[0][1] = vertPref[0];
    prefOrdering[1][0] = horPref[1];
    prefOrdering[1][1] = vertPref[1];
    preferredOrderSet = true;
  }

  for (let i = 0; i < 2; i++) {
    if (dir[i] !== 0) continue;
    if ((prefOrdering[i][0] & portConstraint[i]) === 0) prefOrdering[i][0] = prefOrdering[i][1];
    dirPref[i] = prefOrdering[i][0] & portConstraint[i];
    dirPref[i] |= (prefOrdering[i][1] & portConstraint[i]) << 8;
    dirPref[i] |= (prefOrdering[1 - i][i] & portConstraint[i]) << 16;
    dirPref[i] |= (prefOrdering[1 - i][1 - i] & portConstraint[i]) << 24;
    if ((dirPref[i] & 0xf) === 0) dirPref[i] = dirPref[i] << 8;
    if ((dirPref[i] & 0xf00) === 0) dirPref[i] = (dirPref[i] & 0xf) | (dirPref[i] >> 8);
    if ((dirPref[i] & 0xf0000) === 0) dirPref[i] = (dirPref[i] & 0xffff) | ((dirPref[i] & 0xf000000) >> 8);
    dir[i] = dirPref[i] & 0xf;
  }

  let sourceIndex = dir[0] === EAST ? 3 : dir[0];
  let targetIndex = dir[1] === EAST ? 3 : dir[1];
  sourceIndex -= quad;
  targetIndex -= quad;
  if (sourceIndex < 1) sourceIndex += 4;
  if (targetIndex < 1) targetIndex += 4;
  const routePattern = ROUTE_PATTERNS[sourceIndex - 1][targetIndex - 1];

  const wayPoints: number[][] = Array.from({ length: 12 }, () => [0, 0]);
  wayPoints[0][0] = geo[0][0];
  wayPoints[0][1] = geo[0][1];
  switch (dir[0]) {
    case WEST:
      wayPoints[0][0] -= sourceBuffer;
      wayPoints[0][1] += constraint[0][1] * geo[0][3];
      break;
    case SOUTH:
      wayPoints[0][0] += constraint[0][0] * geo[0][2];
      wayPoints[0][1] += geo[0][3] + sourceBuffer;
      break;
    case EAST:
      wayPoints[0][0] += geo[0][2] + sourceBuffer;
      wayPoints[0][1] += constraint[0][1] * geo[0][3];
      break;
    case NORTH:
      wayPoints[0][0] += constraint[0][0] * geo[0][2];
      wayPoints[0][1] -= sourceBuffer;
      break;
  }

  let currentIndex = 0;
  let lastOrientation = (dir[0] & (EAST | WEST)) > 0 ? 0 : 1;
  const initialOrientation = lastOrientation;
  let currentOrientation = 0;

  for (let i = 0; i < routePattern.length; i++) {
    const nextDirection = routePattern[i] & 0xf;
    let directionIndex = nextDirection === EAST ? 3 : nextDirection;
    directionIndex += quad;
    if (directionIndex > 4) directionIndex -= 4;
    const direction = DIR_VECTORS[directionIndex - 1];
    currentOrientation = directionIndex % 2 > 0 ? 0 : 1;
    if (currentOrientation !== lastOrientation) {
      currentIndex++;
      wayPoints[currentIndex][0] = wayPoints[currentIndex - 1][0];
      wayPoints[currentIndex][1] = wayPoints[currentIndex - 1][1];
    }
    const tar = (routePattern[i] & TARGET_MASK) > 0;
    const sou = (routePattern[i] & SOURCE_MASK) > 0;
    let side = (routePattern[i] & SIDE_MASK) >> 5;
    side = side << quad;
    if (side > 0xf) side = side >> 4;
    const isCenter = (routePattern[i] & CENTER_MASK) > 0;

    if ((sou || tar) && side < 9) {
      let limit = 0;
      const souTar = sou ? 0 : 1;
      if (isCenter && currentOrientation === 0) limit = geo[souTar][0] + constraint[souTar][0] * geo[souTar][2];
      else if (isCenter) limit = geo[souTar][1] + constraint[souTar][1] * geo[souTar][3];
      else limit = limits[souTar][side];

      if (currentOrientation === 0) {
        const delta = (limit - wayPoints[currentIndex][0]) * direction[0];
        if (delta > 0) wayPoints[currentIndex][0] += direction[0] * delta;
      } else {
        const delta = (limit - wayPoints[currentIndex][1]) * direction[1];
        if (delta > 0) wayPoints[currentIndex][1] += direction[1] * delta;
      }
    } else if (isCenter) {
      wayPoints[currentIndex][0] += direction[0] * Math.abs(vertexSeparations[directionIndex] / 2);
      wayPoints[currentIndex][1] += direction[1] * Math.abs(vertexSeparations[directionIndex] / 2);
    }

    if (currentIndex > 0 && wayPoints[currentIndex][currentOrientation] === wayPoints[currentIndex - 1][currentOrientation]) {
      currentIndex--;
    } else {
      lastOrientation = currentOrientation;
    }
  }

  const result: Pt[] = [];
  for (let i = 0; i <= currentIndex; i++) {
    if (i === currentIndex) {
      const targetOrientation = (dir[1] & (EAST | WEST)) > 0 ? 0 : 1;
      const sameOrient = targetOrientation === initialOrientation ? 0 : 1;
      if (sameOrient !== (currentIndex + 1) % 2) break;
    }
    result.push({ x: round1(wayPoints[i][0]), y: round1(wayPoints[i][1]) });
  }

  const deduped: Pt[] = [];
  for (const p of result) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) deduped.push(p);
  }
  return deduped;
}

// ----------------------------------------------------------------- public

export interface ResolvedEnd {
  shape: ShapeLayout | null;
  /** Fixed point (anchor or free point), null when floating on a shape. */
  point: Pt | null;
  /** Set when the end is attached to another arrow. */
  arrowId?: string;
  /** Direction of that arrow's segment at the attachment point (when axis-aligned). */
  axis?: "h" | "v";
}

/** Paths of already routed arrows by id, for arrow-to-arrow connections. */
export type ArrowPaths = ReadonlyMap<string, Pt[]>;

export interface EdgeRoute {
  /** Full polyline including both terminal points. */
  points: Pt[];
  source: ResolvedEnd;
  target: ResolvedEnd;
  /** Inner route points (excluding terminals), useful for segment editing. */
  inner: Pt[];
}

/**
 * Resolves an endpoint to a shape (fixed or floating) or a point. Ends on
 * another arrow need that arrow's path in `arrows`; `toward` picks the
 * nearest point on it when no position along it is given.
 */
export function resolveEndpoint(ep: Endpoint | null, layout: Layout, origin: Pt, arrows?: ArrowPaths, toward?: Pt): ResolvedEnd | null {
  if (!ep) return null;
  if (ep.kind === "point") return { shape: null, point: { x: origin.x + ep.x, y: origin.y + ep.y } };
  const shape = layout.byId.get(ep.id);
  if (shape) {
    const at = endpointAnchor(ep, shape.bounds);
    return { shape, point: at ? anchorPoint(shape, at) : null };
  }
  const path = arrows?.get(ep.id);
  if (!path) return null;
  const point = ep.along !== undefined ? pointAlong(path, ep.along) : nearestOnPath(path, toward ?? pointAlong(path, 0.5)).point;
  return { shape: null, point, arrowId: ep.id, axis: segmentAxis(path, point) };
}

/** Orientation of the polyline segment through `p`, if it is horizontal or vertical. */
function segmentAxis(points: Pt[], p: Pt): "h" | "v" | undefined {
  let best: { d: number; axis: "h" | "v" | undefined } = { d: Infinity, axis: undefined };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = nearestOnPath([a, b], p).distance;
    if (d >= best.d) continue;
    const axis = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5 ? "h" : Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5 ? "v" : undefined;
    best = { d, axis };
  }
  return best.axis;
}

/** Arrows meet the arrow they attach to at a right angle. */
const portsFor = (end: ResolvedEnd) => (end.axis === "v" ? WEST | EAST : end.axis === "h" ? NORTH | SOUTH : ALL);

/** Closest point on a polyline and its position along it (0–1). */
export function nearestOnPath(points: Pt[], p: Pt): { point: Pt; t: number; distance: number } {
  const total = pathLength(points) || 1;
  let best = { point: points[0], t: 0, distance: Infinity };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = len ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len))) : 0;
    const q = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.distance) best = { point: q, t: (walked + len * u) / total, distance: d };
    walked += len;
  }
  return best;
}

/** Ids of arrows an arrow attaches to. */
export function arrowDependencies(node: ElementNode, layout: Layout): string[] {
  const deps: string[] = [];
  for (const key of ["from", "to"] as const) {
    const ep = parseEndpoint(node.props[key]);
    if (ep?.kind === "node" && !layout.byId.has(ep.id)) deps.push(ep.id);
  }
  return deps;
}

function referencePoint(ep: Endpoint | null, layout: Layout, origin: Pt): Pt | undefined {
  if (!ep) return undefined;
  if (ep.kind === "point") return { x: origin.x + ep.x, y: origin.y + ep.y };
  const shape = layout.byId.get(ep.id);
  return shape ? center(shape.bounds) : undefined;
}

export function viaPoints(node: ElementNode, origin: Pt): Pt[] {
  const via = node.props.via;
  if (!Array.isArray(via)) return [];
  const out: Pt[] = [];
  for (const p of via) {
    if (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") {
      out.push({ x: origin.x + p[0], y: origin.y + p[1] });
    }
  }
  return out;
}

export function routeOf(node: ElementNode): Route {
  const r = node.props.route;
  return r === "straight" || r === "curved" ? r : "orthogonal";
}

/**
 * Computes the full route between two resolved ends:
 * fixed terminal points, then the edge style, then floating terminal points.
 */
/** Centers closer than this (px) across the gap get a straight line instead of a small jog. */
const ALIGN_TOLERANCE = 16;

/**
 * Nearly aligned ends: when two ends face each other across a gap and their
 * centers are only a few px apart, the orthogonal router would draw a tiny
 * step in the middle. Instead, return the shared
 * coordinate for one straight segment, if both outlines reach it.
 */
function straightAcross(source: ResolvedEnd, target: ResolvedEnd): { axis: "h" | "v"; at: number } | null {
  if (source.point && target.point) return null;
  // Fixed anchors and ends on other arrows keep their own direction.
  if ((source.shape && source.point) || (target.shape && target.point) || source.arrowId || target.arrowId) return null;
  const extent = (e: ResolvedEnd): Rect | null => {
    if (e.point) return { x: e.point.x, y: e.point.y, w: 0, h: 0 };
    if (!e.shape || e.shape.rotate) return null;
    return e.shape.bounds;
  };
  const a = extent(source);
  const b = extent(target);
  if (!a || !b) return null;
  const pick = (aLo: number, aSize: number, bLo: number, bSize: number, aFixed: number | null, bFixed: number | null) => {
    const inset = (size: number) => Math.min(4, size / 2);
    const lo = Math.max(aLo + inset(aSize), bLo + inset(bSize));
    const hi = Math.min(aLo + aSize - inset(aSize), bLo + bSize - inset(bSize));
    if (lo > hi) return null;
    const ca = aFixed ?? aLo + aSize / 2;
    const cb = bFixed ?? bLo + bSize / 2;
    if (Math.abs(ca - cb) < 0.01 || Math.abs(ca - cb) > ALIGN_TOLERANCE) return null;
    const want = aFixed ?? bFixed ?? (ca + cb) / 2;
    return Math.min(hi, Math.max(lo, want));
  };
  if (a.x + a.w <= b.x || b.x + b.w <= a.x) {
    const at = pick(a.y, a.h, b.y, b.h, source.point?.y ?? null, target.point?.y ?? null);
    return at === null ? null : { axis: "h", at };
  }
  if (a.y + a.h <= b.y || b.y + b.h <= a.y) {
    const at = pick(a.x, a.w, b.x, b.w, source.point?.x ?? null, target.point?.x ?? null);
    return at === null ? null : { axis: "v", at };
  }
  return null;
}

export function computeRoute(source: ResolvedEnd, target: ResolvedEnd, waypoints: Pt[], route: Route): EdgeRoute {
  if (route !== "straight" && waypoints.length === 0) {
    const straight = straightAcross(source, target);
    if (straight) {
      const across = (e: ResolvedEnd, other: ResolvedEnd): Pt => {
        if (e.point) return e.point;
        const o = other.point ?? center(other.shape!.bounds);
        return perimeterPoint(e.shape!, straight.axis === "h" ? { x: o.x, y: straight.at } : { x: straight.at, y: o.y }, true);
      };
      const start = across(source, target);
      const end = across(target, source);
      return { points: [start, end], source, target, inner: [] };
    }
  }
  const sourceRect = source.shape ? { rect: source.shape.bounds, rotate: source.shape.rotate } : null;
  const targetRect = target.shape ? { rect: target.shape.bounds, rotate: target.shape.rotate } : null;
  const orthogonal = route !== "straight";
  let inner: Pt[];
  // Curved arrows with waypoints use them as the curve's control points.
  if (route === "straight" || (route === "curved" && waypoints.length > 0)) inner = waypoints.map((p) => ({ ...p }));
  else inner = orthConnector(sourceRect, targetRect, source.point, target.point, waypoints, [JETTY, JETTY], [portsFor(source), portsFor(target)]);

  let start = source.point;
  let end = target.point;
  if (!end && target.shape) {
    const next = inner.length ? inner[inner.length - 1] : (start ?? center(source.shape ? source.shape.bounds : target.shape.bounds));
    end = perimeterPoint(target.shape, next, orthogonal);
  }
  if (!start && source.shape) {
    const next = inner.length ? inner[0] : (end ?? center(target.shape ? target.shape.bounds : source.shape.bounds));
    start = perimeterPoint(source.shape, next, orthogonal);
  }
  const points = [start ?? { x: 0, y: 0 }, ...inner, end ?? { x: 0, y: 0 }];
  return { points: simplify(points), source, target, inner };
}

/** Removes duplicate points and points in the middle of straight runs. */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.01 && Math.abs(prev.y - p.y) < 0.01) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01);
      if (!collinear) break;
      out.pop();
    }
    out.push(p);
  }
  return out.length >= 2 ? out : points;
}

export function routeEdge(node: ElementNode, layout: Layout, origin: Pt, arrows?: ArrowPaths): EdgeRoute | null {
  const fromEp = parseEndpoint(node.props.from);
  const toEp = parseEndpoint(node.props.to);
  const via = viaPoints(node, origin);
  const source = resolveEndpoint(fromEp, layout, origin, arrows, via[0] ?? referencePoint(toEp, layout, origin));
  const target = resolveEndpoint(toEp, layout, origin, arrows, via[via.length - 1] ?? referencePoint(fromEp, layout, origin) ?? source?.point ?? undefined);
  if (!source || !target) return null;
  return computeRoute(source, target, via, routeOf(node));
}

// ---------------------------------------------------------------- drawing

export function pathLength(points: Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

export function pointAlong(points: Pt[], t: number): Pt {
  const total = pathLength(points);
  let remaining = total * Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= seg || i === points.length - 1) {
      const f = seg ? remaining / seg : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= seg;
  }
  return points[0];
}

/** SVG path data: polyline with optional rounded corners, or a smooth curve. */
export function pathData(points: Pt[], route: Route, radius: number): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  if (points.length < 2) return "";
  if (route === "curved" && points.length > 2) {
    let d = `M${f(points[0].x)},${f(points[0].y)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const n = points[i + 1];
      const mid = i === points.length - 2 ? n : { x: (p.x + n.x) / 2, y: (p.y + n.y) / 2 };
      d += ` Q${f(p.x)},${f(p.y)} ${f(mid.x)},${f(mid.y)}`;
    }
    return d;
  }
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (radius > 0 && i < points.length - 1) {
      const prev = points[i - 1];
      const next = points[i + 1];
      const l1 = Math.hypot(p.x - prev.x, p.y - prev.y);
      const l2 = Math.hypot(next.x - p.x, next.y - p.y);
      const r = Math.min(radius, l1 / 2, l2 / 2);
      if (r > 0.5) {
        const a = { x: p.x + ((prev.x - p.x) / l1) * r, y: p.y + ((prev.y - p.y) / l1) * r };
        const b = { x: p.x + ((next.x - p.x) / l2) * r, y: p.y + ((next.y - p.y) / l2) * r };
        d += ` L${f(a.x)},${f(a.y)} Q${f(p.x)},${f(p.y)} ${f(b.x)},${f(b.y)}`;
        continue;
      }
    }
    d += ` L${f(p.x)},${f(p.y)}`;
  }
  return d;
}

export interface Marker {
  d: string;
  style: "fill" | "open" | "hollow";
  /** How much the line must be shortened so it ends at the marker's base. */
  inset: number;
}

/** Marker geometry at `tip`, pointing in the direction from `from` to `tip`. */
export function markerPath(kind: string, from: Pt, tip: Pt, strokeWidth: number): Marker | null {
  if (kind === "none") return null;
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const px = -uy;
  const py = ux;
  const s = 6 + (strokeWidth - 1) * 2;
  const at = (along: number, across: number) => ({ x: tip.x - ux * along + px * across, y: tip.y - uy * along + py * across });
  const f = (p: Pt) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`;
  switch (kind) {
    case "open": {
      const a = at(s * 1.2, s * 0.6);
      const b = at(s * 1.2, -s * 0.6);
      return { d: `M${f(a)} L${f(tip)} L${f(b)}`, style: "open", inset: strokeWidth / 2 };
    }
    case "classic": {
      const a = at(s * 1.25, s * 0.6);
      const b = at(s * 1.25, -s * 0.6);
      const notch = at(s * 0.85, 0);
      return { d: `M${f(tip)} L${f(a)} L${f(notch)} L${f(b)} Z`, style: "fill", inset: s * 0.85 };
    }
    case "diamond": {
      const a = at(s * 0.8, s * 0.55);
      const b = at(s * 1.6, 0);
      const c = at(s * 0.8, -s * 0.55);
      return { d: `M${f(tip)} L${f(a)} L${f(b)} L${f(c)} Z`, style: "fill", inset: s * 1.6 };
    }
    case "circle": {
      const r = s * 0.5;
      const c = at(r, 0);
      return {
        d: `M${f({ x: c.x - r, y: c.y })} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`,
        style: "hollow",
        inset: r * 2,
      };
    }
    case "bar": {
      const a = at(0, s * 0.7);
      const b = at(0, -s * 0.7);
      return { d: `M${f(a)} L${f(b)}`, style: "open", inset: 0 };
    }
    default: {
      // "arrow": filled triangle
      const a = at(s * 1.15, s * 0.55);
      const b = at(s * 1.15, -s * 0.55);
      return { d: `M${f(tip)} L${f(a)} L${f(b)} Z`, style: "fill", inset: s * 1.1 };
    }
  }
}

/** Shortens the polyline at one end by `inset` px (so lines end at marker bases). */
export function shorten(points: Pt[], atEnd: boolean, inset: number): Pt[] {
  if (inset <= 0 || points.length < 2) return points;
  const pts = points.map((p) => ({ ...p }));
  const i = atEnd ? pts.length - 1 : 0;
  const j = atEnd ? pts.length - 2 : 1;
  const len = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
  if (len <= inset) return pts;
  pts[i] = { x: pts[i].x + ((pts[j].x - pts[i].x) / len) * inset, y: pts[i].y + ((pts[j].y - pts[i].y) / len) * inset };
  return pts;
}
