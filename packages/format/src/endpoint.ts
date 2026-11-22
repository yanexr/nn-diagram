/**
 * Arrow endpoints.
 *
 *   "rms1"              floating: attaches to the outline facing the other end
 *   "rms1@top"          fixed point: top center (also bottom, left, right,
 *                       center, top-left, top-right, bottom-left, bottom-right)
 *   "rms1@top:0.25"     25% along the top side (left to right; top to bottom
 *                       for left/right sides)
 *   "rms1@bottom:72px"  72px from the start of the bottom side
 *   "rms1@0.5,1"        unit coordinates of the shape bounds
 *   "res1@0.4"          40% along the path of the arrow "res1"
 *   [480, 200]          free point, relative to the arrow's parent
 */
import type { Value } from "./ast";
import type { Side } from "./schema";

export type Endpoint =
  | {
      kind: "node";
      id: string;
      /** Unit coordinates, null when floating or when `offset` is used. */
      at: [number, number] | null;
      /** Pixel offset along a side. */
      offset?: { side: Side; px: number };
      /** Position along another arrow's path (0–1), for arrow-to-arrow connections. */
      along?: number;
    }
  | { kind: "point"; x: number; y: number };

const NAMED: Record<string, [number, number]> = {
  top: [0.5, 0],
  bottom: [0.5, 1],
  left: [0, 0.5],
  right: [1, 0.5],
  center: [0.5, 0.5],
  "top-left": [0, 0],
  "top-right": [1, 0],
  "bottom-left": [0, 1],
  "bottom-right": [1, 1],
};

const SIDE_POINT: Record<Side, (t: number) => [number, number]> = {
  top: (t) => [t, 0],
  bottom: (t) => [t, 1],
  left: (t) => [0, t],
  right: (t) => [1, t],
};

export function parseEndpoint(value: Value | undefined): Endpoint | null {
  if (Array.isArray(value)) {
    const [x, y] = value;
    if (typeof x === "number" && typeof y === "number") return { kind: "point", x, y };
    return null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const at = value.indexOf("@");
  if (at === -1) return { kind: "node", id: value.trim(), at: null };
  const id = value.slice(0, at).trim();
  const spec = value.slice(at + 1).trim();
  const px = /^(top|bottom|left|right):(-?\d*\.?\d+)px$/.exec(spec);
  if (px) return { kind: "node", id, at: null, offset: { side: px[1] as Side, px: Number(px[2]) } };
  if (/^\d*\.?\d+$/.test(spec)) return { kind: "node", id, at: null, along: Math.min(1, Math.max(0, Number(spec))) };
  return { kind: "node", id, at: parseAnchorSpec(spec) };
}

/** True if the anchor part after "@" could not be read. */
export function isInvalidAnchor(value: Value | undefined): boolean {
  if (typeof value !== "string" || !value.includes("@")) return false;
  const ep = parseEndpoint(value);
  return !ep || (ep.kind === "node" && !ep.at && !ep.offset && ep.along === undefined);
}

function parseAnchorSpec(spec: string): [number, number] | null {
  if (spec in NAMED) return [...NAMED[spec]];
  const side = /^(top|bottom|left|right):(-?\d*\.?\d+)$/.exec(spec);
  if (side) return SIDE_POINT[side[1] as Side](Number(side[2]));
  const xy = /^(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)$/.exec(spec);
  if (xy) return [Number(xy[1]), Number(xy[2])];
  return null;
}

/** Unit anchor of an endpoint for a shape of the given size. */
export function endpointAnchor(ep: Endpoint, size: { w: number; h: number }): [number, number] | null {
  if (ep.kind !== "node") return null;
  if (ep.offset) {
    const { side, px } = ep.offset;
    const len = side === "top" || side === "bottom" ? size.w : size.h;
    return SIDE_POINT[side](len > 0 ? px / len : 0);
  }
  return ep.at;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function formatAnchor(at: [number, number]): string {
  const [fx, fy] = [round(at[0]), round(at[1])];
  for (const [name, [nx, ny]] of Object.entries(NAMED)) {
    if (nx === fx && ny === fy) return name;
  }
  if (fy === 0 && fx > 0 && fx < 1) return `top:${fx}`;
  if (fy === 1 && fx > 0 && fx < 1) return `bottom:${fx}`;
  if (fx === 0 && fy > 0 && fy < 1) return `left:${fy}`;
  if (fx === 1 && fy > 0 && fy < 1) return `right:${fy}`;
  return `${fx},${fy}`;
}

/**
 * Anchor spec for a point on a shape, preferring whole pixel offsets along a
 * side (readable) over fractions.
 */
export function formatAnchorFor(at: [number, number], size: { w: number; h: number }): string {
  const named = formatAnchor(at);
  if (!named.includes(":")) return named;
  const [side, frac] = named.split(":");
  const len = side === "top" || side === "bottom" ? size.w : size.h;
  const px = Number(frac) * len;
  return Math.abs(px - Math.round(px)) < 0.05 ? `${side}:${Math.round(px)}px` : named;
}

export function formatEndpoint(endpoint: Endpoint): Value {
  if (endpoint.kind === "point") return [round(endpoint.x), round(endpoint.y)];
  if (endpoint.offset) return `${endpoint.id}@${endpoint.offset.side}:${round(endpoint.offset.px)}px`;
  if (endpoint.along !== undefined) return `${endpoint.id}@${round(endpoint.along)}`;
  return endpoint.at ? `${endpoint.id}@${formatAnchor(endpoint.at)}` : endpoint.id;
}
