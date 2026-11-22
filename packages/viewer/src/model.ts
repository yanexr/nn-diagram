/** Hooks that turn a document into layout + routes, and doc helpers. */
import { useCallback, useMemo, useState } from "react";
import { isShape, parseDiagram, parseEndpoint, walk, DiagramParseError, type DiagramFile, type ElementNode } from "@nn-diagram/format";
import { computeLayout, type Layout, type ShapeLayout } from "./geometry";
import { arrowDependencies, routeEdge } from "./routing";
import type { Pt } from "./geometry";
import type { EdgeGeometry } from "./render/DiagramView";

interface RoutedLayout {
  layout: Layout;
  routes: ReadonlyMap<string, EdgeGeometry>;
}

/** Same immutable shape and absolute geometry, including measured text and parent movement. */
function sameTerminal(a: ShapeLayout | undefined, b: ShapeLayout | undefined): boolean {
  return a === b || !!a && !!b && a.node === b.node && a.parentUid === b.parentUid && a.depth === b.depth && a.rotate === b.rotate && a.outline === b.outline && a.radius === b.radius &&
    a.bounds.x === b.bounds.x && a.bounds.y === b.bounds.y && a.bounds.w === b.bounds.w && a.bounds.h === b.bounds.h;
}

/** Routes arrows in dependency order. Unchanged routes keep their identity across edits. */
export function computeRoutes(layout: Layout, previous?: RoutedLayout): Map<string, EdgeGeometry> {
  const routes = new Map<string, EdgeGeometry>();
  const paths = new Map<string, Pt[]>();
  const oldEdges = new Map(previous?.layout.edges.map((e) => [e.uid, e]));
  const oldPaths = new Map<string, Pt[]>();
  const ambiguous = new Set<string>();
  if (previous) for (const edge of previous.layout.edges) {
    const id = edge.node.props.id;
    const geometry = previous.routes.get(edge.uid);
    if (typeof id === "string" && geometry) {
      if (oldPaths.has(id)) ambiguous.add(id);
      oldPaths.set(id, geometry.route.points);
    }
  }
  const reusable = (edge: Layout["edges"][number]) => {
    const old = oldEdges.get(edge.uid);
    if (!old || !previous || old.node !== edge.node || old.origin.x !== edge.origin.x || old.origin.y !== edge.origin.y) return false;
    for (const key of ["from", "to"] as const) {
      const ep = parseEndpoint(edge.node.props[key]);
      if (ep?.kind !== "node") continue;
      const a = layout.byId.get(ep.id), b = previous.layout.byId.get(ep.id);
      if (!sameTerminal(a, b)) return false;
      // Arrow-to-arrow attachments follow the newly routed dependency, transitively.
      if (!a && (ambiguous.has(ep.id) || paths.get(ep.id) !== oldPaths.get(ep.id))) return false;
    }
    return true;
  };
  let pending = layout.edges;
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next: typeof pending = [];
    for (const edge of pending) {
      const deps = arrowDependencies(edge.node, layout);
      if (deps.some((d) => !paths.has(d)) && pass < 7) {
        next.push(edge);
        continue;
      }
      const cached = reusable(edge) ? previous?.routes.get(edge.uid) : undefined;
      const route = cached?.route ?? routeEdge(edge.node, layout, edge.origin, paths);
      if (!route) continue;
      routes.set(edge.uid, cached ?? { route, origin: edge.origin });
      const id = edge.node.props.id;
      if (typeof id === "string") paths.set(id, route.points);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  return routes;
}

export function useDiagramLayout(root: ElementNode | null) {
  const [measured, setMeasured] = useState<ReadonlyMap<string, { w: number; h: number }>>(() => new Map());
  const onMeasure = useCallback((uid: string, size: { w: number; h: number }) => {
    setMeasured((prev) => {
      const old = prev.get(uid);
      if (old && Math.abs(old.w - size.w) < 0.5 && Math.abs(old.h - size.h) < 0.5) return prev;
      const next = new Map(prev);
      next.set(uid, size);
      return next;
    });
  }, []);
  const layout = useMemo(() => (root ? computeLayout(root, measured) : null), [root, measured]);
  // Keep one previous layout, rather than retaining drag history in a global cache.
  // Updating render-local state is safe if React abandons/replays a concurrent render.
  const [routed, setRouted] = useState<RoutedLayout | null>(null);
  let current = routed;
  if (layout && current?.layout !== layout) {
    current = { layout, routes: computeRoutes(layout, current ?? undefined) };
    setRouted(current);
  } else if (!layout && current) {
    current = null;
    setRouted(null);
  }
  return { layout, routes: current?.routes ?? EMPTY_ROUTES, onMeasure, measured };
}

const EMPTY_ROUTES = new Map<string, EdgeGeometry>();

export type ParseResult = { file: DiagramFile; error: null } | { file: null; error: DiagramParseError | Error };

export function safeParse(source: string): ParseResult {
  try {
    return { file: parseDiagram(source), error: null };
  } catch (err) {
    return { file: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export interface StepInfo {
  title: string;
  focus: string[];
  text: string;
}

export function readSteps(root: ElementNode): StepInfo[] {
  const steps: StepInfo[] = [];
  for (const child of root.children) {
    if (child.kind !== "element" || child.name !== "Steps") continue;
    for (const step of child.children) {
      if (step.kind !== "element" || step.name !== "Step") continue;
      const text = step.children.map((c) => (c.kind === "text" ? c.value : "")).join("");
      steps.push({
        title: typeof step.props.title === "string" ? step.props.title : "",
        focus: typeof step.props.focus === "string" ? step.props.focus.split(/\s+/).filter(Boolean) : [],
        text,
      });
    }
  }
  return steps;
}

/**
 * uids to dim for a set of focused ids: everything except the focused
 * elements, their descendants, their ancestors (so they stay visible) and
 * arrows between focused elements.
 */
export function dimmedFor(root: ElementNode, layout: Layout, focusIds: string[]): Set<string> {
  const focused = new Set<string>();
  const byId = new Map<string, ElementNode>();
  walk(root, (n) => {
    if (typeof n.props.id === "string") byId.set(n.props.id, n);
  });
  for (const id of focusIds) {
    const node = byId.get(id);
    if (!node) continue;
    walk(node, (n) => {
      focused.add(n.uid);
    });
    let parent = layout.parents.get(node.uid);
    while (parent) {
      focused.add(parent);
      parent = layout.parents.get(parent);
    }
  }
  const focusedIds = new Set(focusIds);
  const dimmed = new Set<string>();
  walk(root, (n) => {
    if (n === root) return;
    if (isShape(n) && !focused.has(n.uid)) dimmed.add(n.uid);
    if (n.name === "Arrow" && !focused.has(n.uid)) {
      const from = typeof n.props.from === "string" ? n.props.from.split("@")[0] : "";
      const to = typeof n.props.to === "string" ? n.props.to.split("@")[0] : "";
      const fromNode = layout.byId.get(from);
      const toNode = layout.byId.get(to);
      const inFocus = (uid: string | undefined) => !!uid && focused.has(uid) && !isAncestorOnly(uid);
      const isAncestorOnly = (uid: string) => {
        // An ancestor of a focused element is kept visible but does not make
        // its arrows "focused".
        const node = layout.shapes.get(uid)?.node;
        return !!node && !focusedIds.has(String(node.props.id ?? "")) && !hasFocusedAncestor(uid);
      };
      const hasFocusedAncestor = (uid: string): boolean => {
        let p: string | null | undefined = uid;
        while (p) {
          const node = layout.shapes.get(p)?.node;
          if (node && focusedIds.has(String(node.props.id ?? ""))) return true;
          p = layout.parents.get(p);
        }
        return false;
      };
      if (!(inFocus(fromNode?.uid) && inFocus(toNode?.uid)) && !focusedIds.has(String(n.props.id ?? ""))) dimmed.add(n.uid);
    }
  });
  return dimmed;
}
