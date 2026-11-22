/**
 * The editing canvas: renders the diagram with the viewer's renderer and adds
 * selection, handles, guides, tools and all pointer interactions.
 *
 * Conventions: Shift constrains (axis / aspect
 * ratio), Alt disables snapping (and starts a rubber band over shapes),
 * Ctrl/Cmd+drag clones, Shift+click toggles selection, Space+drag or the
 * middle button pans, Ctrl/Cmd+wheel zooms.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import {
  cloneNode,
  collectIds,
  element,
  findNode,
  formatAnchorFor,
  formatEndpoint,
  getSpec,
  insertChildren,
  isEdge,
  isShape,
  parseEndpoint,
  setProps,
  updateNodes,
  walk,
  withProps,
  type ChildNode,
  type ElementNode,
  type Value,
} from "@nn-diagram/format";
import {
  DiagramView,
  anchorPoint,
  center,
  computeRoute,
  connectionAnchors,
  containsPoint,
  fitRect,
  formatInkPoints,
  labelChildren,
  nearestOnPath,
  nearestOutlinePoint,
  resolveEndpoint,
  rotatePoint,
  routeOf,
  screenToDiagram,
  unitAnchor,
  useElementSize,
  useWheelPanZoom,
  viaPoints,
  zoomAround,
  PAGE_COLORS,
  type EdgeGeometry,
  type Layout,
  type Pt,
  type Rect,
  type ResolvedEnd,
  type ShapeLayout,
} from "@nn-diagram/viewer";
import { setPageRect } from "../commands";
import { commonAncestor, duplicate, ensureId, isDescendant, makeIdsUnique, reparent, topLevel, translateNode, unionRect } from "../commands";
import { useEd, useEditorContext } from "../context";
import { CanvasMenu } from "./CanvasMenu";
import { dragSegment, finalizeHints } from "./edges";
import { LabelEditor } from "./LabelEditor";
import { tableSnippet } from "../table";
import { paramHandles } from "./params";
import { Overlays, RESIZE_DIRS, type Overlay, type Side } from "./Overlays";
import { snapMove, snapPoint, snapValue, type Guide } from "./snap";

type Gesture =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "rubber"; start: Pt; additive: boolean; base: string[]; targets?: MarqueeTargets; inspectorTimer?: number }
  | {
      kind: "move";
      start: Pt;
      screen: Pt;
      uids: string[];
      baseDoc: ElementNode;
      bounds: Rect | null;
      others?: Rect[];
      clone: boolean;
      clickUid: string | null;
      toggleOnClick: boolean;
      active: boolean;
      dropTarget?: string | null;
      /** Common parent of the moved shapes; undefined when they differ (no reparenting). */
      parent: string | null | undefined;
      origin: Pt;
      overScratch: boolean;
      /** Selection membership/ids are constant for the duration of a drag. */
      moved?: Set<string>;
      ids?: Set<string>;
    }
  | { kind: "resize"; uid: string; handle: number; rect: Rect; rotate: number; parentOrigin: Pt; aspect: number; others: Rect[]; baseDoc: ElementNode }
  | { kind: "rotate"; uid: string; center: Pt; startAngle: number; rot0: number; baseDoc: ElementNode }
  | { kind: "param"; uid: string; key: string; center: Pt; rotate: number; baseDoc: ElementNode }
  | { kind: "page"; handle: number; w: number; h: number; vp: { x: number; y: number; zoom: number }; baseDoc: ElementNode }
  | {
      kind: "connect";
      /** Source shape, or null when the arrow starts at a free point (arrow tool). */
      sourceUid: string | null;
      sourceAt: [number, number] | null;
      sourcePoint: Pt | null;
      start: Pt;
      screen: Pt;
      active: boolean;
      clickDirection: Side | null;
    }
  | { kind: "edgeEnd"; uid: string; end: "from" | "to" }
  | { kind: "segment"; uid: string; index: number; points: Pt[]; baseDoc: ElementNode }
  | { kind: "waypoint"; uid: string; index: number; baseDoc: ElementNode }
  | { kind: "create"; start: Pt; ellipse: boolean; parentUid: string | null; origin: Pt }
  | { kind: "draw"; points: number[][] };

interface MarqueeTarget {
  uid: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface MarqueeTargets {
  layout: Layout;
  routes: ReadonlyMap<string, EdgeGeometry>;
  enteredGroup: string | null;
  items: MarqueeTarget[];
}

/** Where a connection would attach. */
type Target =
  | { kind: "shape"; uid: string; at: [number, number] | null; snap: Pt | null }
  | { kind: "arrow"; uid: string; t: number; point: Pt };

const SIDE_ANCHOR: Record<Side, [number, number]> = { top: [0.5, 0], right: [1, 0.5], bottom: [0.5, 1], left: [0, 0.5] };
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Containers that accept dropped shapes. */
function acceptsChildren(node: ElementNode): boolean {
  if (node.name === "Group") return true;
  if (node.name !== "Box") return false;
  const variant = typeof node.props.variant === "string" ? node.props.variant : "";
  return variant.startsWith("panel") || node.children.some((c) => c.kind === "element" && isShape(c));
}

/** "id", "id@top" or "id@bottom:72px" for a connection point on a shape. */
function endpointValue(id: string, at: [number, number] | null, shape: ShapeLayout): string {
  return at ? `${id}@${formatAnchorFor(at, shape.bounds)}` : id;
}

function stripUid(c: ChildNode): unknown {
  if (c.kind !== "element") return c;
  return { name: c.name, props: c.props, children: c.children.map(stripUid) };
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** Height kept clear at the bottom of the canvas for the tool dock when fitting. */
const TOOL_DOCK_SPACE = 56;
const MARQUEE_INSPECTOR_PAUSE_MS = 100;

const CanvasDiagram = memo(DiagramView);

function pathExtents(points: Pt[]) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom };
}

const TOOL_CURSOR: Record<string, string | undefined> = {
  rect: "crosshair",
  ellipse: "crosshair",
  arrow: "crosshair",
  text: "text",
  table: "crosshair",
  pencil: "crosshair",
  hand: "grab",
};

/** Pointer capture that tolerates pointers the browser no longer tracks. */
function capture(el: HTMLElement | null, pointerId: number, on: boolean) {
  try {
    if (on) el?.setPointerCapture(pointerId);
    else if (el?.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // e.g. the pointer was already released
  }
}

export function Canvas() {
  const { api, actions, layout, routes, onMeasure } = useEditorContext();
  const store = api.store;
  const doc = useEd((s) => s.doc);
  const selection = useEd((s) => s.selection);
  const viewport = useEd((s) => s.viewport);
  const theme = useEd((s) => s.theme);
  const showGrid = useEd((s) => s.showGrid);
  const editingText = useEd((s) => s.editingText);
  const enteredGroup = useEd((s) => s.enteredGroup);
  const layersHover = useEd((s) => s.hoverUid);
  const tool = useEd((s) => s.tool);
  const assets = useEd((s) => s.assets);
  const baseUrl = useEd((s) => s.file.url ?? undefined);

  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const setViewport = store.getState().setViewport;
  useWheelPanZoom(containerRef, setViewport);

  const [overlay, setOverlay] = useState<Overlay>({});
  const [hover, setHover] = useState<string | null>(null);
  const [space, setSpace] = useState(false);
  // State (not just the gesture ref) so the cursor switches between grab and grabbing right away.
  const [panning, setPanning] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const lastContextPoint = useRef<Pt | undefined>(undefined);

  const resolveAsset = useCallback((src: string) => assets[src]?.url, [assets]);

  useEffect(() => () => {
    const g = gesture.current;
    if (g?.kind === "rubber") window.clearTimeout(g.inspectorTimer);
  }, []);

  // ------------------------------------------------------------ view api
  const fitTo = useCallback(
    (rect: Rect, maxZoom = 1.5) => {
      const el = containerRef.current;
      if (!el) return;
      // Leave the bottom strip free for the floating tool dock.
      setViewport(fitRect({ w: el.clientWidth, h: el.clientHeight - TOOL_DOCK_SPACE }, rect, 40, maxZoom));
    },
    [setViewport],
  );

  useEffect(() => {
    api.fit = () => {
      const l = api.layout();
      if (l) fitTo({ x: 0, y: 0, w: l.page.w, h: l.page.h });
    };
    api.zoomToSelection = () => {
      const l = api.layout();
      const sel = store.getState().selection;
      const rect = l && unionRect(sel.map((u) => l.shapes.get(u)?.bounds).filter((r): r is Rect => !!r));
      if (rect) fitTo({ x: rect.x - 20, y: rect.y - 20, w: rect.w + 40, h: rect.h + 40 }, 4);
    };
    api.zoomBy = (f) => {
      const el = containerRef.current;
      if (el) setViewport((vp) => zoomAround(vp, f, { x: el.clientWidth / 2, y: el.clientHeight / 2 }));
    };
    api.zoomTo = (z) => {
      const el = containerRef.current;
      if (el) setViewport((vp) => zoomAround(vp, z / vp.zoom, { x: el.clientWidth / 2, y: el.clientHeight / 2 }));
    };
    api.viewCenter = () => {
      const el = containerRef.current;
      const vp = store.getState().viewport;
      return el ? screenToDiagram(vp, { x: el.clientWidth / 2, y: el.clientHeight / 2 }) : { x: 0, y: 0 };
    };
    api.canvasElement = () => containerRef.current;
  }, [api, fitTo, setViewport, store]);

  // Fit once when the canvas first gets a size.
  const fittedOnce = useRef(false);
  useEffect(() => {
    if (!fittedOnce.current && size && size.w > 0 && layout) {
      fittedOnce.current = true;
      api.fit();
    }
  }, [size, layout, api]);

  // Space bar panning
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping()) {
        if (!e.repeat) setSpace(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ------------------------------------------------------------- helpers
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toDiagram = (e: { clientX: number; clientY: number }) => screenToDiagram(store.getState().viewport, local(e));

  const nodeOf = (l: Layout, uid: string): ElementNode | null => l.shapes.get(uid)?.node ?? l.edges.find((e) => e.uid === uid)?.node ?? null;

  /** What a click on `uid` selects: the outermost group that is not entered. */
  const selectableFor = useCallback(
    (l: Layout, uid: string): string => {
      let p = l.parents.get(uid);
      if (!p) return uid;
      const entered = new Set<string>();
      let g = store.getState().enteredGroup;
      while (g) {
        entered.add(g);
        g = l.parents.get(g) ?? null;
      }
      let result = uid;
      while (p) {
        const node = l.shapes.get(p)?.node;
        if (node && getSpec(node.name)?.selectAsGroup && !entered.has(p)) result = p;
        p = l.parents.get(p) ?? null;
      }
      return result;
    },
    [store],
  );

  /**
   * Element under the pointer. Arrows have a wide invisible hit stroke, so
   * where many lines meet (dense networks) several overlap: take the line
   * nearest to the pointer, not the one drawn last.
   */
  const hitUid = (target: EventTarget | Element | null, at?: Pt): string | null => {
    const el = (target as Element | null)?.closest?.("[data-uid]");
    const uid = el?.getAttribute("data-uid") ?? null;
    if (!uid || !at || !el?.hasAttribute("data-edge")) return uid;
    let best = uid;
    let bestDistance = Infinity;
    for (const [u, g] of api.routes()) {
      const d = nearestOnPath(g.route.points, at).distance;
      if (d < bestDistance) {
        bestDistance = d;
        best = u;
      }
    }
    return best;
  };

  /** Shape under a screen point, ignoring some uids (e.g. those being dragged). */
  const shapeAt = (clientX: number, clientY: number, ignore: (uid: string) => boolean = () => false): string | null => {
    const l = api.layout();
    if (!l) return null;
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const uid = el.closest?.("[data-uid]")?.getAttribute("data-uid");
      if (uid && l.shapes.has(uid) && !ignore(uid)) return uid;
    }
    return null;
  };

  /** Deepest container (panel / group) under a point, for new shapes. */
  const containerAt = (clientX: number, clientY: number): string | null => {
    const l = api.layout();
    let cur = shapeAt(clientX, clientY);
    while (cur && l) {
      const node = l.shapes.get(cur)?.node;
      if (node && acceptsChildren(node)) return cur;
      cur = l.parents.get(cur) ?? null;
    }
    return store.getState().enteredGroup;
  };

  const otherRects = (l: Layout, moving: string[]): Rect[] => {
    const set = new Set(moving);
    const out: Rect[] = [];
    for (const s of l.shapes.values()) {
      let uid: string | null | undefined = s.uid;
      while (uid && !set.has(uid)) uid = l.parents.get(uid);
      if (uid) continue;
      out.push(s.bounds);
    }
    out.push({ x: 0, y: 0, w: l.page.w, h: l.page.h });
    return out;
  };

  /** Finds where a connection would attach: a shape anchor, another arrow, or a shape outline. */
  const connectTarget = (clientX: number, clientY: number, p: Pt, exclude?: string, excludeArrow?: string): Target | null => {
    const l = api.layout();
    if (!l) return null;
    const zoom = store.getState().viewport.zoom;
    // 1. Fixed anchors of shapes near the pointer (also slightly outside).
    let best: { uid: string; at: [number, number]; d: number; p: Pt } | null = null;
    for (const s of l.shapes.values()) {
      if (s.uid === exclude || s.node.name === "Ink" || !containsPoint(s, p, 12 / zoom)) continue;
      for (const at of connectionAnchors(s)) {
        const ap = anchorPoint(s, at);
        const d = Math.hypot(ap.x - p.x, ap.y - p.y);
        if (d < 9 / zoom && (!best || d < best.d)) best = { uid: s.uid, at, d, p: ap };
      }
    }
    if (best) return { kind: "shape", uid: best.uid, at: best.at, snap: best.p };
    // 2. Other arrows (arrow-to-arrow connections).
    let arrowHit: { uid: string; t: number; point: Pt; d: number } | null = null;
    for (const [uid, geo] of api.routes()) {
      if (uid === excludeArrow) continue;
      const hit = nearestOnPath(geo.route.points, p);
      if (hit.distance < 6 / zoom && (!arrowHit || hit.distance < arrowHit.d)) arrowHit = { uid, t: hit.t, point: hit.point, d: hit.distance };
    }
    // 3. The shape outline or its inside (floating).
    const uid = shapeAt(clientX, clientY, (u) => u === exclude || l.shapes.get(u)?.node.name === "Ink");
    if (uid) {
      const shape = l.shapes.get(uid)!;
      const outline = nearestOutlinePoint(shape, p);
      if (Math.hypot(outline.x - p.x, outline.y - p.y) < 6 / zoom) return { kind: "shape", uid, at: unitAnchor(shape, outline), snap: outline };
      if (arrowHit && arrowHit.d < 4 / zoom) return { kind: "arrow", uid: arrowHit.uid, t: arrowHit.t, point: arrowHit.point };
      return { kind: "shape", uid, at: null, snap: null };
    }
    if (arrowHit) return { kind: "arrow", uid: arrowHit.uid, t: arrowHit.t, point: arrowHit.point };
    return null;
  };

  const resolved = (l: Layout, t: Target): ResolvedEnd => {
    if (t.kind === "arrow") return { shape: null, point: t.point };
    const shape = l.shapes.get(t.uid)!;
    return { shape, point: t.at ? anchorPoint(shape, t.at) : null };
  };

  /** Endpoint value for a target, giving the shape or arrow an id if needed. */
  const targetValue = (doc: ElementNode, l: Layout, t: Target): { doc: ElementNode; value: Value } => {
    const res = ensureId(doc, t.uid);
    if (t.kind === "arrow") return { doc: res.doc, value: formatEndpoint({ kind: "node", id: res.id, at: null, along: Math.round(t.t * 1000) / 1000 }) };
    return { doc: res.doc, value: endpointValue(res.id, t.at, l.shapes.get(t.uid)!) };
  };

  const snapOn = (e: { altKey: boolean }) => store.getState().snapToGrid && !e.altKey;

  // -------------------------------------------------------- pointer down
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    // The panel resize handles' hit area reaches into the canvas; they claim the press with preventDefault.
    if (e.nativeEvent.defaultPrevented) return;
    const l = api.layout();
    if (!l) return;
    if (store.getState().editingText) {
      // The label editor handles its own pointer events; blur commits. Without a mounted editor, just leave the mode.
      if ((document.activeElement as HTMLElement | null)?.isContentEditable) return;
      store.getState().set({ editingText: null });
    }
    containerRef.current?.focus({ preventScroll: true });
    const s = store.getState();
    const p = toDiagram(e);

    if (e.button === 2) {
      // Right-click: select what is under the pointer, then the context menu opens.
      lastContextPoint.current = p;
      const hit = hitUid(e.target, p);
      if (hit) {
        const target = selectableFor(l, hit);
        if (!s.selection.includes(target)) s.select([target]);
      } else s.select([]);
      return;
    }
    if (e.button === 1 || (e.button === 0 && (space || s.tool === "hand"))) {
      e.preventDefault();
      capture(containerRef.current, e.pointerId, true);
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: s.viewport.x, vy: s.viewport.y };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    capture(containerRef.current, e.pointerId, true);

    // ---- tools
    if (s.tool === "pencil") {
      gesture.current = { kind: "draw", points: [[p.x, p.y]] };
      setOverlay({ stroke: { points: [[p.x, p.y]], color: s.pen.color, size: s.pen.size } });
      return;
    }
    if (s.tool === "rect" || s.tool === "ellipse") {
      const parentUid = containerAt(e.clientX, e.clientY);
      const origin = l.origins.get(parentUid ?? s.doc.uid) ?? { x: 0, y: 0 };
      const start = snapOn(e) ? snapPoint(p, l.grid, origin) : p;
      gesture.current = { kind: "create", start, ellipse: s.tool === "ellipse", parentUid, origin };
      return;
    }
    if (s.tool === "text") {
      const parentUid = containerAt(e.clientX, e.clientY);
      const origin = l.origins.get(parentUid ?? s.doc.uid) ?? { x: 0, y: 0 };
      const at = snapOn(e) ? snapPoint(p, l.grid, origin) : p;
      const node = element("Text", { x: r2(at.x - origin.x), y: r2(at.y - origin.y) }, [{ kind: "text", value: "Text" }]);
      s.commit(insertChildren(s.doc, parentUid ?? s.doc.uid, -1, [node]), { selection: [node.uid] });
      s.set({ tool: "select", editingText: node.uid });
      return;
    }
    if (s.tool === "table") {
      const parentUid = containerAt(e.clientX, e.clientY);
      const origin = l.origins.get(parentUid ?? s.doc.uid) ?? { x: 0, y: 0 };
      actions.insertSnippet(tableSnippet(), snapOn(e) ? snapPoint(p, l.grid, origin) : p);
      return;
    }
    if (s.tool === "arrow") {
      const t = connectTarget(e.clientX, e.clientY, p);
      if (t?.kind === "shape") {
        gesture.current = { kind: "connect", sourceUid: t.uid, sourceAt: t.at, sourcePoint: null, start: p, screen: local(e), active: false, clickDirection: null };
      } else {
        const start = t?.kind === "arrow" ? t.point : snapOn(e) ? snapPoint(p, l.grid) : p;
        gesture.current = { kind: "connect", sourceUid: null, sourceAt: null, sourcePoint: start, start, screen: local(e), active: false, clickDirection: null };
      }
      return;
    }

    const handle = (e.target as Element).closest?.("[data-handle]") as HTMLElement | null;
    if (handle) {
      const kind = handle.dataset.handle;
      const uid = handle.dataset.uid!;
      const index = Number(handle.dataset.index ?? 0);
      if (kind === "resize") {
        const shape = l.shapes.get(uid)!;
        s.beginGesture();
        gesture.current = {
          kind: "resize",
          uid,
          handle: index,
          rect: shape.bounds,
          rotate: shape.rotate,
          parentOrigin: l.origins.get(shape.parentUid ?? s.doc.uid) ?? { x: 0, y: 0 },
          aspect: shape.bounds.w / Math.max(shape.bounds.h, 1),
          others: otherRects(l, [uid]),
          baseDoc: s.doc,
        };
      } else if (kind === "page") {
        s.beginGesture();
        gesture.current = { kind: "page", handle: index, w: l.page.w, h: l.page.h, vp: s.viewport, baseDoc: s.doc };
      } else if (kind === "param") {
        const shape = l.shapes.get(uid)!;
        s.beginGesture();
        gesture.current = { kind: "param", uid, key: handle.dataset.key!, center: center(shape.bounds), rotate: shape.rotate, baseDoc: s.doc };
      } else if (kind === "rotate") {
        const shape = l.shapes.get(uid)!;
        const c = center(shape.bounds);
        s.beginGesture();
        gesture.current = { kind: "rotate", uid, center: c, startAngle: Math.atan2(p.y - c.y, p.x - c.x), rot0: shape.rotate, baseDoc: s.doc };
      } else if (kind === "anchor" || kind === "hover-arrow") {
        const at = kind === "anchor" ? (JSON.parse(handle.dataset.at!) as [number, number]) : null;
        gesture.current = {
          kind: "connect",
          sourceUid: uid,
          sourceAt: at,
          sourcePoint: null,
          start: p,
          screen: local(e),
          active: false,
          clickDirection: kind === "hover-arrow" ? (handle.dataset.side as Side) : null,
        };
      } else if (kind === "edge-end") {
        s.beginGesture();
        gesture.current = { kind: "edgeEnd", uid, end: handle.dataset.end as "from" | "to" };
      } else if (kind === "segment") {
        const geo = api.routes().get(uid);
        if (!geo) return;
        s.beginGesture();
        gesture.current = { kind: "segment", uid, index, points: geo.route.points, baseDoc: s.doc };
      } else if (kind === "waypoint" || kind === "virtual") {
        s.beginGesture();
        let base = s.doc;
        if (kind === "virtual") {
          // Insert a new waypoint at this segment's middle.
          const edge = nodeOf(l, uid)!;
          const origin = l.edges.find((x) => x.uid === uid)!.origin;
          const via = viaPoints(edge, origin).map((v) => [r2(v.x - origin.x), r2(v.y - origin.y)] as Value);
          via.splice(index, 0, [r2(p.x - origin.x), r2(p.y - origin.y)]);
          base = setProps(s.doc, uid, { via });
          s.updateGesture(base);
        }
        gesture.current = { kind: "waypoint", uid, index, baseDoc: base };
      }
      return;
    }

    const hit = hitUid(e.target, p);
    if (!hit || e.altKey) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      gesture.current = { kind: "rubber", start: p, additive, base: s.selection };
      if (!additive) {
        s.select([]);
        if (!hit) s.set({ enteredGroup: null });
      }
      s.set({ marqueeInspectorSelection: store.getState().selection });
      return;
    }

    const target = selectableFor(l, hit);
    let sel = s.selection;
    let toggleOnClick = false;
    if (e.shiftKey) {
      sel = sel.includes(target) ? sel.filter((u) => u !== target) : [...sel, target];
      s.select(sel);
    } else if (e.ctrlKey || e.metaKey) {
      toggleOnClick = true;
    } else if (!sel.includes(target)) {
      sel = [target];
      s.select(sel);
    }
    const moving = topLevel(l, sel.includes(target) ? sel : [...sel, target]);
    const shapes = moving.filter((u) => l.shapes.has(u));
    const parents = new Set(moving.map((u) => l.parents.get(u) ?? null));
    const parent = parents.size === 1 ? [...parents][0] : undefined;
    gesture.current = {
      kind: "move",
      start: p,
      screen: local(e),
      uids: moving,
      baseDoc: s.doc,
      bounds: unionRect(shapes.map((u) => l.shapes.get(u)!.bounds)),
      clone: e.ctrlKey || e.metaKey,
      clickUid: target,
      toggleOnClick,
      active: false,
      parent,
      origin: l.origins.get(parent ?? s.doc.uid) ?? { x: 0, y: 0 },
      overScratch: false,
    };
  };

  // -------------------------------------------------------- pointer move
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    // This canvas owns captured gestures. In particular, prevent outer panel
    // resizers from measuring all their hit regions on every diagram drag.
    if (g) e.preventDefault();
    const l = api.layout();
    const s = store.getState();
    if (!l) return;
    const p = toDiagram(e);
    const zoom = s.viewport.zoom;
    const snapGrid = snapOn(e);
    const snapOpts = { grid: l.grid, tolerance: 6 / zoom, snapGrid, guides: !e.altKey };

    if (!g) {
      if (s.tool !== "select") {
        if (hover) setHover(null);
        return;
      }
      // Hover
      const handle = (e.target as Element).closest?.("[data-handle]");
      if (handle) return;
      const uid = hitUid(e.target, p);
      const shapeUid = uid && l.shapes.has(uid) ? uid : null;
      if (shapeUid !== hover) {
        // Keep the hover while the pointer is near the shape (for the hover arrows).
        if (!shapeUid && hover) {
          const h = l.shapes.get(hover);
          if (h && containsPoint(h, p, 30 / zoom)) return;
        }
        setHover(shapeUid);
      }
      return;
    }

    switch (g.kind) {
      case "pan":
        setViewport((vp) => ({ ...vp, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
        return;

      case "draw": {
        g.points.push([p.x, p.y]);
        setOverlay({ stroke: { points: [...g.points], color: s.pen.color, size: s.pen.size } });
        return;
      }

      case "create": {
        let q = snapGrid ? snapPoint(p, l.grid, g.origin) : p;
        if (e.shiftKey) {
          const d = Math.max(Math.abs(q.x - g.start.x), Math.abs(q.y - g.start.y));
          q = { x: g.start.x + Math.sign(q.x - g.start.x || 1) * d, y: g.start.y + Math.sign(q.y - g.start.y || 1) * d };
        }
        const rect = { x: Math.min(g.start.x, q.x), y: Math.min(g.start.y, q.y), w: Math.abs(q.x - g.start.x), h: Math.abs(q.y - g.start.y) };
        setOverlay({ create: { rect, ellipse: g.ellipse }, label: { at: { x: rect.x, y: rect.y + rect.h }, text: `${Math.round(rect.w)} × ${Math.round(rect.h)}` } });
        return;
      }

      case "rubber": {
        const r = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) };
        setOverlay({ rubber: r });
        const routes = api.routes();
        let targets = g.targets;
        // Rebuild if the layout, a route, or the group selection scope changed.
        if (targets?.layout !== l || targets.routes !== routes || targets.enteredGroup !== s.enteredGroup) {
          const items: MarqueeTarget[] = [];
          for (const sh of l.shapes.values()) {
            const { x, y, w, h } = sh.bounds;
            items.push({ uid: selectableFor(l, sh.uid), left: x, top: y, right: x + w, bottom: y + h });
          }
          for (const edge of l.edges) {
            const points = routes.get(edge.uid)?.route.points;
            if (points?.length) items.push({ uid: selectableFor(l, edge.uid), ...pathExtents(points) });
          }
          targets = { layout: l, routes, enteredGroup: s.enteredGroup, items };
          g.targets = targets;
        }
        const right = r.x + r.w;
        const bottom = r.y + r.h;
        const inside = new Set<string>();
        for (const b of targets.items) {
          if (b.left >= r.x && b.top >= r.y && b.right <= right && b.bottom <= bottom) inside.add(b.uid);
        }
        const unique = topLevel(l, inside);
        s.select(g.additive ? [...new Set([...g.base, ...unique])] : unique);
        const current = store.getState();
        // Mounting single-element fields can take several frames. Do it once
        // the pointer pauses, while the canvas tracks selection immediately.
        if (g.inspectorTimer !== undefined) {
          window.clearTimeout(g.inspectorTimer);
          g.inspectorTimer = undefined;
        }
        if (current.selection.length === 1 && current.selection !== current.marqueeInspectorSelection) {
          g.inspectorTimer = window.setTimeout(() => {
            g.inspectorTimer = undefined;
            const latest = store.getState();
            if (gesture.current === g && latest.selection === current.selection) {
              latest.set({ marqueeInspectorSelection: latest.selection });
            }
          }, MARQUEE_INSPECTOR_PAUSE_MS);
        }
        return;
      }

      case "move": {
        const sp = local(e);
        if (!g.active) {
          if (Math.hypot(sp.x - g.screen.x, sp.y - g.screen.y) < 3) return;
          g.active = true;
          // A click only selects. Build snapping candidates once a drag actually starts.
          g.others = otherRects(l, g.uids);
          setHover(null);
          s.beginGesture();
          if (g.clone) {
            const res = duplicate(g.baseDoc, l, g.uids, 0);
            g.baseDoc = res.doc;
            g.uids = res.uids;
            s.updateGesture(res.doc, res.uids);
          }
        }
        // Dragging onto the scratchpad keeps a copy there instead of moving.
        const canvasRect = containerRef.current!.getBoundingClientRect();
        const inCanvas = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right && e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;
        const overScratch = !inCanvas && !!document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-scratchpad-drop]");
        if (overScratch !== g.overScratch) {
          g.overScratch = overScratch;
          s.set({ scratchHover: overScratch });
        }
        let dx = p.x - g.start.x;
        let dy = p.y - g.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        let guides: Guide[] = [];
        if (g.bounds) {
          const snapped = snapMove(g.bounds, dx, dy, g.others!, { ...snapOpts, origin: g.origin });
          if (!e.shiftKey || dx !== 0) dx = snapped.dx;
          if (!e.shiftKey || dy !== 0) dy = snapped.dy;
          guides = snapped.guides;
        } else if (snapGrid) {
          dx = Math.round(dx / l.grid) * l.grid;
          dy = Math.round(dy / l.grid) * l.grid;
        }
        if (!g.moved || !g.ids) {
          const selected = new Set(g.uids);
          const moved = new Set<string>();
          const ids = new Set<string>();
          walk(g.baseDoc, (node) => {
            if (selected.has(node.uid)) walk(node, (child) => {
              moved.add(child.uid);
              if (typeof child.props.id === "string") ids.add(child.props.id);
            });
          });
          g.moved = moved;
          g.ids = ids;
        }
        const ids = g.ids;
        const updates = new Map<string, (n: ElementNode) => ElementNode>();
        for (const uid of g.uids) {
          updates.set(uid, (n) => translateNode(n, dx, dy));
        }
        // Arrows between moved shapes keep their shape: move their waypoints too.
        for (const edge of l.edges) {
          if (g.moved.has(edge.uid)) continue;
          const from = parseEndpoint(edge.node.props.from);
          const to = parseEndpoint(edge.node.props.to);
          if (from?.kind === "node" && to?.kind === "node" && ids.has(from.id) && ids.has(to.id) && Array.isArray(edge.node.props.via)) {
            updates.set(edge.uid, (n) => translateNode(n, dx, dy));
          }
        }
        s.updateGesture(updateNodes(g.baseDoc, updates));
        // Drop target (reparenting into containers)
        let dropTarget: string | null | undefined;
        if (g.bounds && g.parent !== undefined && !overScratch) {
          const under = inCanvas ? shapeAt(e.clientX, e.clientY, (u) => g.moved!.has(u)) : null;
          let container: string | null = null;
          let cur = under;
          while (cur) {
            const node = l.shapes.get(cur)?.node;
            if (node && acceptsChildren(node)) {
              container = cur;
              break;
            }
            cur = l.parents.get(cur) ?? null;
          }
          dropTarget = container !== g.parent ? container : undefined;
        }
        g.dropTarget = dropTarget;
        const b = g.bounds;
        setOverlay({
          guides,
          dropTarget: dropTarget === undefined ? undefined : dropTarget,
          label: b ? { at: { x: b.x + dx, y: b.y + dy + b.h }, text: `${r2(b.x + dx - g.origin.x)}, ${r2(b.y + dy - g.origin.y)}` } : undefined,
        });
        return;
      }

      case "resize": {
        const { rect, rotate, handle } = g;
        const c = center(rect);
        const lp = rotatePoint(p, -rotate, c);
        const [hx, hy] = RESIZE_DIRS[handle];
        let left = rect.x;
        let top = rect.y;
        let right = rect.x + rect.w;
        let bottom = rect.y + rect.h;
        const guideXs: number[] = [];
        const guideYs: number[] = [];
        const opts = { ...snapOpts, origin: g.parentOrigin };
        const snapX = (v: number) => {
          if (rotate) return snapGrid ? Math.round((v - g.parentOrigin.x) / l.grid) * l.grid + g.parentOrigin.x : v;
          const r = snapValue(v, "x", g.others, opts);
          if (r.guide !== null) guideXs.push(r.guide);
          return r.value;
        };
        const snapY = (v: number) => {
          if (rotate) return snapGrid ? Math.round((v - g.parentOrigin.y) / l.grid) * l.grid + g.parentOrigin.y : v;
          const r = snapValue(v, "y", g.others, opts);
          if (r.guide !== null) guideYs.push(r.guide);
          return r.value;
        };
        if (hx < 0) left = Math.min(snapX(lp.x), right - 1);
        if (hx > 0) right = Math.max(snapX(lp.x), left + 1);
        if (hy < 0) top = Math.min(snapY(lp.y), bottom - 1);
        if (hy > 0) bottom = Math.max(snapY(lp.y), top + 1);
        let w = right - left;
        let h = bottom - top;
        const gs = snapGrid ? l.grid : 1;
        if (e.shiftKey) {
          // Keep the aspect ratio, rounded to the grid.
          if (hx !== 0 && hy !== 0) {
            if (w / h > g.aspect) h = w / g.aspect;
            else w = h * g.aspect;
          } else if (hx !== 0) h = w / g.aspect;
          else w = h * g.aspect;
          w = Math.max(gs, Math.round(w / gs) * gs);
          h = Math.max(gs, Math.round(h / gs) * gs);
          if (hx < 0) left = right - w;
          if (hy < 0) top = bottom - h;
          if (hx === 0) left = snapGrid ? Math.round((c.x - w / 2 - g.parentOrigin.x) / gs) * gs + g.parentOrigin.x : c.x - w / 2;
          if (hy === 0) top = snapGrid ? Math.round((c.y - h / 2 - g.parentOrigin.y) / gs) * gs + g.parentOrigin.y : c.y - h / 2;
        }
        w = Math.max(gs, Math.round(w));
        h = Math.max(gs, Math.round(h));
        let x = left;
        let y = top;
        if (rotate) {
          // Keep the opposite handle fixed in world space.
          const nc = rotatePoint({ x: left + w / 2, y: top + h / 2 }, rotate, c);
          x = nc.x - w / 2;
          y = nc.y - h / 2;
        }
        s.updateGesture(setProps(g.baseDoc, g.uid, { x: r2(x - g.parentOrigin.x), y: r2(y - g.parentOrigin.y), w, h }));
        const final = { x, y, w, h };
        setOverlay({
          guides: [
            ...guideXs.map((gx) => ({ x1: gx, y1: Math.min(final.y, 0), x2: gx, y2: Math.max(final.y + final.h, l.page.h) })),
            ...guideYs.map((gy) => ({ x1: Math.min(final.x, 0), y1: gy, x2: Math.max(final.x + final.w, l.page.w), y2: gy })),
          ],
          label: { at: { x: final.x, y: final.y + final.h }, text: `${w} × ${h}` },
        });
        return;
      }

      case "page": {
        // Moving the left/top edge shifts the content the other way, and the
        // view with it, so nothing moves on screen.
        const [hx, hy] = RESIZE_DIRS[g.handle];
        const snap = (v: number) => (snapOn(e) ? Math.round(v / l.grid) * l.grid : Math.round(v));
        const min = l.grid * 4;
        const pw = p.x + (s.viewport.x - g.vp.x) / g.vp.zoom;
        const py = p.y + (s.viewport.y - g.vp.y) / g.vp.zoom;
        let x = 0, y = 0, w = g.w, h = g.h;
        if (hx < 0) {
          x = Math.min(snap(pw), g.w - min);
          w = g.w - x;
        } else if (hx > 0) w = Math.max(min, snap(pw));
        if (hy < 0) {
          y = Math.min(snap(py), g.h - min);
          h = g.h - y;
        } else if (hy > 0) h = Math.max(min, snap(py));
        s.updateGesture(setPageRect(g.baseDoc, { x, y, w, h }));
        setViewport(() => ({ ...g.vp, x: g.vp.x + x * g.vp.zoom, y: g.vp.y + y * g.vp.zoom }));
        setOverlay({ label: { at: { x: 0, y: h }, text: `${w} × ${h}` } });
        return;
      }

      case "param": {
        // The parameters never change the shape's box, so its bounds stay valid while dragging.
        const shape = l.shapes.get(g.uid);
        const ph = shape && paramHandles(shape).find((h) => h.key === g.key);
        if (!ph) return;
        const lp = rotatePoint(p, -g.rotate, g.center);
        const props = ph.apply(lp, l.grid, !snapOn(e));
        s.updateGesture(setProps(g.baseDoc, g.uid, props));
        const b = shape.bounds;
        setOverlay({ label: { at: { x: b.x, y: b.y + b.h }, text: `${ph.label} ${Object.values(props)[0]}` } });
        return;
      }

      case "rotate": {
        const angle = Math.atan2(p.y - g.center.y, p.x - g.center.x);
        let deg = g.rot0 + ((angle - g.startAngle) * 180) / Math.PI;
        deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
        for (const m of [0, 90, 180, 270, -90, -180]) if (Math.abs(deg - m) < 3 && !e.shiftKey) deg = m;
        deg = ((((deg + 180) % 360) + 360) % 360) - 180;
        if (deg === -180) deg = 180;
        s.updateGesture(setProps(g.baseDoc, g.uid, { rotate: deg === 0 ? undefined : deg }));
        const b = l.shapes.get(g.uid)?.bounds;
        setOverlay({ label: b ? { at: { x: b.x, y: b.y + b.h }, text: `${deg}°` } : undefined });
        return;
      }

      case "connect":
      case "edgeEnd": {
        if (g.kind === "connect" && !g.active) {
          const sp = local(e);
          if (Math.hypot(sp.x - g.screen.x, sp.y - g.screen.y) < 4) return;
          g.active = true;
          setHover(null);
        }
        const exclude =
          g.kind === "connect" && g.sourceUid && !g.sourceAt && containsPoint(l.shapes.get(g.sourceUid)!, p) ? g.sourceUid : undefined;
        const t = connectTarget(e.clientX, e.clientY, p, exclude, g.kind === "edgeEnd" ? g.uid : undefined);
        const freeEnd: ResolvedEnd = { shape: null, point: snapGrid ? snapPoint(p, l.grid) : p };
        const targetEnd = t ? resolved(l, t) : freeEnd;
        let points: Pt[];
        if (g.kind === "connect") {
          const source: ResolvedEnd = g.sourceUid
            ? { shape: l.shapes.get(g.sourceUid)!, point: g.sourceAt ? anchorPoint(l.shapes.get(g.sourceUid)!, g.sourceAt) : null }
            : { shape: null, point: g.sourcePoint };
          points = computeRoute(source, targetEnd, [], "orthogonal").points;
        } else {
          const edge = l.edges.find((x) => x.uid === g.uid)!;
          const other = resolveEndpoint(parseEndpoint(edge.node.props[g.end === "from" ? "to" : "from"]), l, edge.origin, pathsById(), undefined) ?? freeEnd;
          const source = g.end === "from" ? targetEnd : other;
          const target = g.end === "from" ? other : targetEnd;
          points = computeRoute(source, target, viaPoints(edge.node, edge.origin), routeOf(edge.node)).points;
        }
        setOverlay({
          preview: {
            points,
            target: t?.kind === "shape" ? t.uid : null,
            targetArrow: t?.kind === "arrow" ? t.uid : null,
            snap: t?.kind === "shape" ? t.snap : t?.kind === "arrow" ? t.point : null,
          },
        });
        return;
      }

      case "segment": {
        const edge = l.edges.find((x) => x.uid === g.uid);
        if (!edge) return;
        const pt = snapGrid ? snapPoint(p, l.grid, edge.origin) : p;
        const hints = dragSegment(g.points, g.index, pt);
        const baseEdge = findNode(g.baseDoc, g.uid)!.node;
        const src = resolveEndpoint(parseEndpoint(baseEdge.props.from), l, edge.origin, pathsById());
        const trg = resolveEndpoint(parseEndpoint(baseEdge.props.to), l, edge.origin, pathsById());
        if (!src || !trg) return;
        const result = finalizeHints(src, trg, hints, pt);
        const via = result.map((q) => [r2(q.x - edge.origin.x), r2(q.y - edge.origin.y)] as Value);
        s.updateGesture(setProps(g.baseDoc, g.uid, { via: via.length ? via : undefined }));
        return;
      }

      case "waypoint": {
        const edge = l.edges.find((x) => x.uid === g.uid);
        if (!edge) return;
        const pt = snapGrid ? snapPoint(p, l.grid, edge.origin) : p;
        const node = findNode(g.baseDoc, g.uid)!.node;
        const via = Array.isArray(node.props.via) ? [...node.props.via] : [];
        via[g.index] = [r2(pt.x - edge.origin.x), r2(pt.y - edge.origin.y)];
        s.updateGesture(setProps(g.baseDoc, g.uid, { via }));
        return;
      }
    }
  };

  /** Paths of routed arrows by id (for ends attached to arrows). */
  const pathsById = () => {
    const l = api.layout();
    const map = new Map<string, Pt[]>();
    if (!l) return map;
    for (const edge of l.edges) {
      const id = edge.node.props.id;
      const geo = api.routes().get(edge.uid);
      if (typeof id === "string" && geo) map.set(id, geo.route.points);
    }
    return map;
  };

  // ---------------------------------------------------------- pointer up
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setPanning(false);
    capture(containerRef.current, e.pointerId, false);
    setOverlay({});
    if (g?.kind === "rubber") {
      window.clearTimeout(g.inspectorTimer);
      store.getState().set({ marqueeInspectorSelection: null });
      return;
    }
    const l = api.layout();
    const s = store.getState();
    if (!g || !l) return;
    const p = toDiagram(e);

    switch (g.kind) {
      case "draw": {
        finishStroke(g.points);
        return;
      }
      case "create": {
        let q = snapOn(e) ? snapPoint(p, l.grid, g.origin) : p;
        if (e.shiftKey) {
          const d = Math.max(Math.abs(q.x - g.start.x), Math.abs(q.y - g.start.y));
          q = { x: g.start.x + Math.sign(q.x - g.start.x || 1) * d, y: g.start.y + Math.sign(q.y - g.start.y || 1) * d };
        }
        let rect = { x: Math.min(g.start.x, q.x), y: Math.min(g.start.y, q.y), w: Math.abs(q.x - g.start.x), h: Math.abs(q.y - g.start.y) };
        if (rect.w < 4 || rect.h < 4) rect = { x: g.start.x, y: g.start.y, w: g.ellipse ? 64 : 120, h: g.ellipse ? 64 : 40 };
        const props: Record<string, Value> = { x: r2(rect.x - g.origin.x), y: r2(rect.y - g.origin.y), w: Math.round(rect.w), h: Math.round(rect.h) };
        if (g.ellipse) props.shape = "ellipse";
        const node = element("Box", props);
        s.commit(insertChildren(s.doc, g.parentUid ?? s.doc.uid, -1, [node]), { selection: [node.uid] });
        s.set({ tool: "select" });
        return;
      }
      case "move": {
        if (g.overScratch) {
          s.set({ scratchHover: false });
          s.cancelGesture();
          actions.addToScratchpad(g.uids);
          return;
        }
        if (!g.active) {
          if (g.toggleOnClick && g.clickUid) {
            s.select(s.selection.includes(g.clickUid) ? s.selection.filter((u) => u !== g.clickUid) : [...s.selection, g.clickUid]);
          } else if (g.clickUid && !e.shiftKey) {
            s.select([g.clickUid]);
          }
          return;
        }
        if (g.dropTarget !== undefined) {
          const shapes = g.uids.filter((u) => l.shapes.has(u));
          s.updateGesture(reparent(s.doc, l, shapes, g.dropTarget), g.uids);
        }
        s.endGesture();
        return;
      }
      case "resize":
      case "rotate":
      case "param":
      case "page":
      case "segment":
      case "waypoint":
        s.endGesture();
        return;
      case "connect": {
        if (!g.active) {
          if (g.clickDirection && g.sourceUid) cloneAndConnect(g.sourceUid, g.clickDirection);
          return;
        }
        const exclude = g.sourceUid && !g.sourceAt && containsPoint(l.shapes.get(g.sourceUid)!, p) ? g.sourceUid : undefined;
        const t = connectTarget(e.clientX, e.clientY, p, exclude);
        // The arrow lives in the nearest common container of its ends.
        let parentUid: string | null;
        if (g.sourceUid && t?.kind === "shape") parentUid = t.uid === g.sourceUid ? (l.parents.get(t.uid) ?? null) : commonAncestor(l, g.sourceUid, t.uid);
        else if (g.sourceUid) parentUid = l.parents.get(g.sourceUid) ?? null;
        else if (t?.kind === "shape") parentUid = l.parents.get(t.uid) ?? null;
        else parentUid = s.enteredGroup;
        const o = l.origins.get(parentUid ?? s.doc.uid) ?? { x: 0, y: 0 };
        let doc = s.doc;
        let from: Value;
        if (g.sourceUid) {
          const src = ensureId(doc, g.sourceUid);
          doc = src.doc;
          from = endpointValue(src.id, g.sourceAt, l.shapes.get(g.sourceUid)!);
        } else {
          // A free start on another arrow attaches to it.
          const startOnArrow = connectTarget(e.clientX, e.clientY, g.start, undefined);
          if (startOnArrow?.kind === "arrow" && Math.hypot(startOnArrow.point.x - g.start.x, startOnArrow.point.y - g.start.y) < 1) {
            const res = targetValue(doc, l, startOnArrow);
            doc = res.doc;
            from = res.value;
          } else from = [r2(g.sourcePoint!.x - o.x), r2(g.sourcePoint!.y - o.y)];
        }
        let to: Value;
        if (t) {
          const res = targetValue(doc, l, t);
          doc = res.doc;
          to = res.value;
        } else {
          const q = snapOn(e) ? snapPoint(p, l.grid, o) : p;
          to = [r2(q.x - o.x), r2(q.y - o.y)];
        }
        const arrow = element("Arrow", { from, to });
        doc = insertChildren(doc, parentUid ?? doc.uid, -1, [arrow]);
        s.commit(doc, { selection: [arrow.uid] });
        if (s.tool === "arrow") s.set({ tool: "select" });
        return;
      }
      case "edgeEnd": {
        const edge = l.edges.find((x) => x.uid === g.uid);
        if (!edge) return s.endGesture();
        const t = connectTarget(e.clientX, e.clientY, p, undefined, g.uid);
        let doc = s.doc;
        let value: Value;
        if (t) {
          const res = targetValue(doc, l, t);
          doc = res.doc;
          value = res.value;
        } else {
          const q = snapOn(e) ? snapPoint(p, l.grid, edge.origin) : p;
          value = [r2(q.x - edge.origin.x), r2(q.y - edge.origin.y)];
        }
        s.updateGesture(setProps(doc, g.uid, { [g.end]: value }));
        s.endGesture();
        return;
      }
      default:
        return;
    }
  };

  /** Turns a pencil stroke into an <Ink> element. */
  const finishStroke = (points: number[][]) => {
    const s = store.getState();
    const l = api.layout();
    if (!l || points.length === 0) return;
    const size = s.pen.size;
    const pad = size / 2 + 1;
    const xs = points.map((q) => q[0]);
    const ys = points.map((q) => q[1]);
    const x0 = Math.floor(Math.min(...xs) - pad);
    const y0 = Math.floor(Math.min(...ys) - pad);
    const rel = points.map(([x, y]) => [x - x0, y - y0]);
    const w = Math.ceil(Math.max(...xs) - x0 + pad);
    const h = Math.ceil(Math.max(...ys) - y0 + pad);
    const parentUid = s.enteredGroup;
    const o = l.origins.get(parentUid ?? s.doc.uid) ?? { x: 0, y: 0 };
    const node = element("Ink", { x: x0 - o.x, y: y0 - o.y, w, h, points: formatInkPoints(rel), color: s.pen.color, size });
    s.commit(insertChildren(s.doc, parentUid ?? s.doc.uid, -1, [node]));
  };

  /** Clicking a direction arrow clones the shape in that direction and connects the two. */
  const cloneAndConnect = (uid: string, side: Side) => {
    const l = api.layout();
    const s = store.getState();
    if (!l) return;
    const found = findNode(s.doc, uid);
    if (!found || !found.parent) return;
    const node = found.node;
    const w = num(node.props.w);
    const h = num(node.props.h);
    const gap = l.grid * 8;
    const dx = side === "left" ? -(w + gap) : side === "right" ? w + gap : 0;
    const dy = side === "top" ? -(h + gap) : side === "bottom" ? h + gap : 0;
    let doc = s.doc;
    const src = ensureId(doc, uid);
    doc = src.doc;
    const shapeOnly = { ...node, children: node.children.filter((c) => c.kind !== "element" || (!isShape(c) && !isEdge(c))) };
    const [copy] = makeIdsUnique([cloneNode(withProps(shapeOnly, { id: src.id }))], collectIds(doc)) as ElementNode[];
    const moved = translateNode(copy, dx, dy);
    doc = insertChildren(doc, found.parent.uid, found.index + 1, [moved]);
    const arrow = element("Arrow", {
      from: formatEndpoint({ kind: "node", id: src.id, at: SIDE_ANCHOR[side] }),
      to: formatEndpoint({ kind: "node", id: String(moved.props.id), at: SIDE_ANCHOR[OPPOSITE[side]] }),
    });
    doc = insertChildren(doc, found.parent.uid, -1, [arrow]);
    s.commit(doc, { selection: [moved.uid] });
  };

  // -------------------------------------------------------- double click
  const onDoubleClick = (e: React.MouseEvent) => {
    const l = api.layout();
    const s = store.getState();
    if (!l || s.tool !== "select") return;
    // Pointer capture retargets click events to the canvas, so hit-test by position.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const handle = under?.closest?.("[data-handle]") as HTMLElement | null;
    if (handle?.dataset.handle === "waypoint") {
      const uid = handle.dataset.uid!;
      const node = nodeOf(l, uid);
      const via = Array.isArray(node?.props.via) ? [...(node!.props.via as Value[])] : [];
      via.splice(Number(handle.dataset.index), 1);
      s.commit(setProps(s.doc, uid, { via: via.length ? via : undefined }));
      return;
    }
    const hit = hitUid(under, toDiagram(e)) ?? (handle?.dataset.uid || null);
    if (!hit) {
      s.set({ enteredGroup: null });
      return;
    }
    const target = selectableFor(l, hit);
    const targetNode = nodeOf(l, target);
    if (targetNode && getSpec(targetNode.name)?.selectAsGroup && target !== hit) {
      // Enter the group and select the child under the pointer.
      s.set({ enteredGroup: target });
      let inner = hit;
      let p = l.parents.get(hit) ?? null;
      while (p && p !== target) {
        const n = l.shapes.get(p)?.node;
        if (n && getSpec(n.name)?.selectAsGroup) inner = p;
        p = l.parents.get(p) ?? null;
      }
      s.select([inner]);
      return;
    }
    // Tables: edit the cell under the pointer.
    const cellUid = targetNode?.name === "Table" ? (under?.closest?.("[data-cell-uid]") as HTMLElement | null)?.dataset.cellUid : undefined;
    if (cellUid) {
      s.set({ editingText: cellUid, selection: [target], tool: "select" });
      return;
    }
    api.startTextEdit(target);
  };

  // ------------------------------------------------------- drag and drop
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const p = toDiagram(e);
    const files = Array.from(e.dataTransfer.files);
    for (const f of files.filter((f) => f.name.endsWith(".jsx"))) actions.paste(await f.text());
    await actions.insertMedia(files.filter((f) => !f.name.endsWith(".jsx")), p);
  };

  // ---------------------------------------------------------- rendering
  const renderLabel = useCallback(
    (node: ElementNode, def: ReactNode) => {
      if (node.uid !== editingText) return def;
      return (
        <LabelEditor
          key={node.uid}
          node={node}
          onCommit={(children: ChildNode[]) => {
            const st = store.getState();
            const found = findNode(st.doc, node.uid);
            if (found) {
              const label = new Set(labelChildren(found.node));
              const rest = found.node.children.filter((c) => !label.has(c));
              const before = JSON.stringify(labelChildren(found.node).map(stripUid));
              const after = JSON.stringify(children.map(stripUid));
              if (before !== after) {
                st.commit(updateNodes(st.doc, new Map([[node.uid, (n: ElementNode) => ({ ...n, children: [...children, ...rest] })]])));
              }
            }
            st.set({ editingText: null });
            containerRef.current?.focus({ preventScroll: true });
          }}
          onCancel={() => store.getState().set({ editingText: null })}
        />
      );
    },
    [editingText, store],
  );

  // Hosts can tint the area around the page (`--nnd-canvas-light` / `--nnd-canvas-dark`).
  const canvasBg = theme === "dark" ? "var(--nnd-canvas-dark, #1e1e1e)" : "var(--nnd-canvas-light, #f5f5f5)";
  const customBg = typeof doc.props.background === "string" ? doc.props.background : null;
  const pageBg = customBg ? (customBg === "transparent" ? "transparent" : customBg) : PAGE_COLORS[theme];
  const pageScreen = layout ? { x: viewport.x, y: viewport.y, w: layout.page.w * viewport.zoom, h: layout.page.h * viewport.zoom } : null;
  const gridPx = layout ? layout.grid * viewport.zoom : 0;
  // Dots on grid points, at least 12 screen px apart.
  const gridStep = gridPx >= 12 ? gridPx : gridPx * Math.ceil(12 / Math.max(gridPx, 0.01));
  const gridColor = theme === "dark" ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)";
  const grid = useMemo(
    () => showGrid ? <GridLayer step={gridStep / viewport.zoom} dot={1 / viewport.zoom} color={gridColor} /> : null,
    [showGrid, gridStep, viewport.zoom, gridColor],
  );
  const handMode = panning || space || tool === "hand";
  const cursor = panning ? "grabbing" : handMode ? "grab" : TOOL_CURSOR[tool];
  const activeGesture = gesture.current;
  // The marquee moves in the overlay. The diagram itself stays still.
  const movingDiagram = panning || (activeGesture && activeGesture.kind !== "rubber" && (activeGesture.kind !== "move" || activeGesture.active));

  return (
    <CanvasMenu pasteAt={() => lastContextPoint.current}>
      <div
        ref={containerRef}
        tabIndex={0}
        data-canvas=""
        className={`relative h-full w-full touch-none overflow-hidden outline-none select-none ${handMode ? "[&_*]:cursor-[inherit]!" : ""}`}
        style={{ background: canvasBg, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={(e) => {
          if (gesture.current?.kind === "rubber") onPointerUp(e);
        }}
        onPointerLeave={() => !gesture.current && setHover(null)}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {pageScreen && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: pageScreen.x,
              top: pageScreen.y,
              width: pageScreen.w,
              height: pageScreen.h,
              background:
                pageBg === "transparent" ? "repeating-conic-gradient(rgba(128,128,128,0.18) 0 25%, transparent 0 50%) 0 0 / 16px 16px" : pageBg,
              boxShadow: theme === "dark" ? "0 0 0 1px rgba(255,255,255,0.08)" : "0 0 0 1px rgba(0,0,0,0.06), 0 2px 12px rgba(0,0,0,0.06)",
            }}
          />
        )}
        {doc && layout && (
          <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", willChange: movingDiagram ? "transform" : undefined, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
            <CanvasDiagram
              root={doc}
              layout={layout}
              routes={routes}
              theme={theme}
              baseUrl={baseUrl}
              resolveAsset={resolveAsset}
              interactive={false}
              onMeasure={onMeasure}
              renderLabel={renderLabel}
              underlay={grid}
            />
          </div>
        )}
        {layout && (
          <Overlays
            layout={layout}
            selection={selection}
            hover={gesture.current ? null : (layersHover ?? hover)}
            overlay={overlay}
            editing={editingText}
            enteredGroup={enteredGroup}
            showAffordances={tool === "select"}
          />
        )}
      </div>
    </CanvasMenu>
  );
}

/**
 * The dot grid, drawn inside the diagram between the page background and the
 * shapes, so filled shapes hide it. Sizes are in diagram px (`dot` = 1 screen px).
 */
function GridLayer({ step, dot, color }: { step: number; dot: number; color: string }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage: `radial-gradient(circle, ${color} ${dot}px, transparent ${dot * 1.5}px)`,
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${-step / 2}px ${-step / 2}px`,
      }}
    />
  );
}
