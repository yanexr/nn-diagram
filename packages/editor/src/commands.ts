/**
 * Editing operations. Pure functions: (doc, layout, selection, …) → new doc.
 */
import {
  cloneNode,
  collectIds,
  element,
  findNode,
  insertChildren,
  isEdge,
  isShape,
  parseEndpoint,
  formatEndpoint,
  removeNodes,
  serializeNodes,
  uniqueId,
  updateNode,
  updateNodes,
  walk,
  withProps,
  type ChildNode,
  type ElementNode,
  type Value,
} from "@nn-diagram/format";
import { labelText, type Layout, type Pt, type Rect } from "@nn-diagram/viewer";

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const round = (n: number) => Math.round(n * 100) / 100;

export function absBounds(layout: Layout, uid: string): Rect | null {
  const s = layout.shapes.get(uid);
  if (s) return s.bounds;
  return null;
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
  for (const rect of rects) {
    x = Math.min(x, rect.x); y = Math.min(y, rect.y);
    r = Math.max(r, rect.x + rect.w); b = Math.max(b, rect.y + rect.h);
  }
  return { x, y, w: r - x, h: b - y };
}

/** Resolve a batch once, without a fresh tree search/ancestor allocation per uid. */
function selectionLocations(doc: ElementNode, selected: ReadonlySet<string>) {
  const locations = new Map<string, { node: ElementNode; parent: ElementNode; index: number }>();
  const visit = (parent: ElementNode) => {
    for (let index = 0; index < parent.children.length; index++) {
      const node = parent.children[index];
      if (node.kind !== "element") continue;
      if (selected.has(node.uid)) locations.set(node.uid, { node, parent, index });
      visit(node);
    }
  };
  visit(doc);
  return locations;
}

/** Selected uids without those whose ancestor is also selected. */
export function topLevel(layout: Layout, selection: string[] | Set<string>): string[] {
  const uids = Array.isArray(selection) ? selection : [...selection];
  const set = selection instanceof Set ? selection : new Set(uids);
  return uids.filter((uid) => {
    let p = layout.parents.get(uid);
    while (p) {
      if (set.has(p)) return false;
      p = layout.parents.get(p);
    }
    return true;
  });
}

export function isDescendant(layout: Layout, uid: string, ancestor: string): boolean {
  let p = layout.parents.get(uid);
  while (p) {
    if (p === ancestor) return true;
    p = layout.parents.get(p);
  }
  return false;
}

export function origin(layout: Layout, parentUid: string | null, rootUid: string): Pt {
  return layout.origins.get(parentUid ?? rootUid) ?? { x: 0, y: 0 };
}

/** Ids defined in a subtree. */
function subtreeIds(node: ElementNode): Set<string> {
  return collectIds(node);
}

/** Deletes the selection and arrows that pointed at deleted shapes. */
export function deleteSelection(doc: ElementNode, selection: string[]): ElementNode {
  const remove = new Set(selection);
  const removedIds = new Set<string>();
  walk(doc, (n) => {
    if (remove.has(n.uid)) {
      for (const id of subtreeIds(n)) removedIds.add(id);
    }
  });
  walk(doc, (n) => {
    if (!isEdge(n)) return;
    for (const key of ["from", "to"] as const) {
      const ep = parseEndpoint(n.props[key]);
      if (ep?.kind === "node" && removedIds.has(ep.id)) remove.add(n.uid);
    }
  });
  return removeNodes(doc, remove);
}

/** Renames ids in pasted/duplicated nodes so they are unique, and remaps references. */
export function makeIdsUnique(nodes: ChildNode[], taken: Set<string>): ChildNode[] {
  const map = new Map<string, string>();
  const visitIds = (n: ChildNode) => {
    if (n.kind !== "element") return;
    const id = n.props.id;
    if (typeof id === "string") {
      const next = taken.has(id) ? uniqueId(id.replace(/-\d+$/, ""), taken) : id;
      taken.add(next);
      map.set(id, next);
    }
    n.children.forEach(visitIds);
  };
  nodes.forEach(visitIds);
  const remap = (n: ChildNode): ChildNode => {
    if (n.kind !== "element") return n;
    const patch: Record<string, Value | undefined> = {};
    if (typeof n.props.id === "string") patch.id = map.get(n.props.id);
    for (const key of ["from", "to"] as const) {
      const ep = parseEndpoint(n.props[key]);
      if (ep?.kind === "node" && map.has(ep.id)) patch[key] = formatEndpoint({ ...ep, id: map.get(ep.id)! });
    }
    if (n.name === "Step" && typeof n.props.focus === "string") {
      patch.focus = n.props.focus
        .split(/\s+/)
        .map((id) => map.get(id) ?? id)
        .join(" ");
    }
    return { ...withProps(n, patch), children: n.children.map(remap) };
  };
  return nodes.map(remap);
}

/** Moves elements by (dx, dy): shapes by x/y, arrows by their waypoints and free ends. */
export function translateNode(node: ElementNode, dx: number, dy: number): ElementNode {
  if (isShape(node)) return withProps(node, { x: round(num(node.props.x) + dx), y: round(num(node.props.y) + dy) });
  if (isEdge(node)) {
    const patch: Record<string, Value | undefined> = {};
    const via = node.props.via;
    if (Array.isArray(via)) {
      patch.via = via.map((p) => (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" ? [round(p[0] + dx), round(p[1] + dy)] : p));
    }
    for (const key of ["from", "to"] as const) {
      const ep = parseEndpoint(node.props[key]);
      if (ep?.kind === "point") patch[key] = [round(ep.x + dx), round(ep.y + dy)];
    }
    return withProps(node, patch);
  }
  return node;
}

export function nudge(doc: ElementNode, layout: Layout, selection: string[], dx: number, dy: number): ElementNode {
  const updates = new Map<string, (n: ElementNode) => ElementNode>();
  for (const uid of topLevel(layout, selection)) updates.set(uid, (n) => translateNode(n, dx, dy));
  return updateNodes(doc, updates);
}

/** Serializes the selection for the clipboard, with absolute coordinates. */
export function copySelection(doc: ElementNode, layout: Layout, selection: string[]): string | null {
  const top = topLevel(layout, selection);
  if (top.length === 0) return null;
  const nodes: ElementNode[] = [];
  const copiedIds = new Set<string>();
  const selected = new Set(top);
  const locations = selectionLocations(doc, selected);
  const add = (uid: string) => {
    const found = locations.get(uid);
    if (!found) return;
    const o = origin(layout, layout.parents.get(uid) ?? null, doc.uid);
    nodes.push(translateNode(found.node, o.x, o.y));
    for (const id of collectIds(found.node)) copiedIds.add(id);
  };
  top.forEach(add);
  // Arrows between copied shapes come along.
  for (const edge of layout.edges) {
    if (selected.has(edge.uid)) continue;
    const from = parseEndpoint(edge.node.props.from);
    const to = parseEndpoint(edge.node.props.to);
    if (from?.kind === "node" && to?.kind === "node" && copiedIds.has(from.id) && copiedIds.has(to.id)) {
      let parent = layout.parents.get(edge.uid);
      while (parent && !selected.has(parent)) parent = layout.parents.get(parent);
      if (!parent) nodes.push(translateNode(edge.node, edge.origin.x, edge.origin.y));
    }
  }
  return serializeNodes(nodes);
}

/** Inserts nodes (absolute coordinates) into `parentUid`, keeping ids unique. */
export function insertNodes(
  doc: ElementNode,
  layout: Layout,
  nodes: ChildNode[],
  opts: { parentUid?: string | null; offset?: Pt; index?: number } = {},
): { doc: ElementNode; uids: string[] } {
  const parentUid = opts.parentUid ?? doc.uid;
  const o = layout.origins.get(parentUid) ?? { x: 0, y: 0 };
  const off = opts.offset ?? { x: 0, y: 0 };
  const fresh = makeIdsUnique(nodes.map(cloneNode), collectIds(doc)).map((n) =>
    n.kind === "element" ? translateNode(n, off.x - o.x, off.y - o.y) : n,
  );
  const elements = fresh.filter((n): n is ElementNode => n.kind === "element");
  return { doc: insertChildren(doc, parentUid, opts.index ?? -1, fresh), uids: elements.map((n) => n.uid) };
}

export function duplicate(doc: ElementNode, layout: Layout, selection: string[], offset: number): { doc: ElementNode; uids: string[] } {
  const top = topLevel(layout, selection);
  const uids: string[] = [];
  const taken = collectIds(doc);
  const locations = selectionLocations(doc, new Set(top));
  const parents = new Map<string, Map<string, ElementNode>>();
  // Insert each copy right after its original, in its parent.
  for (const uid of top) {
    const found = locations.get(uid);
    if (!found) continue;
    const [copy] = makeIdsUnique([cloneNode(found.node)], taken) as ElementNode[];
    const moved = translateNode(copy, offset, offset);
    let copies = parents.get(found.parent.uid);
    if (!copies) parents.set(found.parent.uid, copies = new Map());
    copies.set(uid, moved);
    uids.push(moved.uid);
  }
  const updates = new Map<string, (node: ElementNode) => ElementNode>();
  for (const [parent, copies] of parents) updates.set(parent, (node) => {
    const children: ChildNode[] = [];
    for (const child of node.children) {
      children.push(child);
      const copy = child.kind === "element" ? copies.get(child.uid) : undefined;
      if (copy) children.push(copy);
    }
    return { ...node, children };
  });
  return { doc: updateNodes(doc, updates), uids };
}

/** Gives a shape an id if it has none (needed to connect arrows). */
export function ensureId(doc: ElementNode, uid: string): { doc: ElementNode; id: string } {
  const found = findNode(doc, uid);
  if (!found) return { doc, id: "" };
  const id = found.node.props.id;
  if (typeof id === "string" && id) return { doc, id };
  const label = labelText(found.node) || found.node.name.toLowerCase();
  const next = uniqueId(label, collectIds(doc));
  return { doc: updateNodes(doc, new Map([[uid, (n: ElementNode) => withProps(n, { id: next })]])), id: next };
}

/** Moves nodes into another parent, keeping their absolute position. */
export function reparent(doc: ElementNode, layout: Layout, uids: string[], targetUid: string | null): ElementNode {
  const target = targetUid ?? doc.uid;
  const to = layout.origins.get(target) ?? { x: 0, y: 0 };
  const moving: ElementNode[] = [];
  const locations = selectionLocations(doc, new Set(uids));
  for (const uid of uids) {
    const found = locations.get(uid);
    if (!found) continue;
    const from = origin(layout, layout.parents.get(uid) ?? null, doc.uid);
    moving.push(translateNode(found.node, from.x - to.x, from.y - to.y));
  }
  let next = removeNodes(doc, new Set(uids));
  next = insertChildren(next, target, -1, moving);
  return next;
}

export function groupSelection(doc: ElementNode, layout: Layout, selection: string[]): { doc: ElementNode; uids: string[] } {
  const top = topLevel(layout, selection).filter((u) => layout.parents.has(u));
  const shapes = top.filter((u) => layout.shapes.has(u));
  if (shapes.length === 0) return { doc, uids: selection };
  const parentUid = layout.parents.get(shapes[0]) ?? null;
  const sameParent = top.every((u) => (layout.parents.get(u) ?? null) === parentUid);
  if (!sameParent) return { doc, uids: selection };
  const bounds = unionRect(shapes.map((u) => layout.shapes.get(u)!.bounds))!;
  const po = origin(layout, parentUid, doc.uid);
  const parentNode = parentUid ? layout.shapes.get(parentUid)!.node : doc;
  const selected = new Set(top);
  const indices: number[] = [];
  const children: ElementNode[] = [];
  for (let index = 0; index < parentNode.children.length; index++) {
    const child = parentNode.children[index];
    if (child.kind !== "element" || !selected.has(child.uid)) continue;
    indices.push(index);
    children.push(translateNode(child, -(bounds.x - po.x), -(bounds.y - po.y)));
  }
  const group = element(
    "Group",
    { x: round(bounds.x - po.x), y: round(bounds.y - po.y), w: round(bounds.w), h: round(bounds.h) },
    children,
  );
  const insertAt = Math.max(...indices) - (top.length - 1);
  const remaining = parentNode.children.filter((c) => c.kind !== "element" || !selected.has(c.uid));
  remaining.splice(insertAt, 0, group);
  const next = updateNode(doc, parentUid ?? doc.uid, (node) => ({ ...node, children: remaining }));
  return { doc: next, uids: [group.uid] };
}

export function ungroup(doc: ElementNode, layout: Layout, selection: string[]): { doc: ElementNode; uids: string[] } {
  let next = doc;
  const uids: string[] = [];
  for (const uid of selection) {
    const found = findNode(next, uid);
    if (!found || !found.parent || found.node.name !== "Group") continue;
    const gx = num(found.node.props.x);
    const gy = num(found.node.props.y);
    const children = found.node.children.map((c) => (c.kind === "element" ? translateNode(c, gx, gy) : c));
    next = removeNodes(next, new Set([uid]));
    next = insertChildren(next, found.parent.uid, found.index, children);
    for (const c of children) if (c.kind === "element") uids.push(c.uid);
  }
  void layout;
  return { doc: next, uids };
}

export type ZOrder = "front" | "back" | "forward" | "backward";

export function reorder(doc: ElementNode, selection: string[], op: ZOrder): ElementNode {
  const sel = new Set(selection);
  const visit = (node: ElementNode): ElementNode => {
    let children = node.children.map((c) => (c.kind === "element" ? visit(c) : c));
    const picked = children.filter((c) => c.kind === "element" && sel.has(c.uid));
    if (picked.length) {
      if (op === "front") children = [...children.filter((c) => !picked.includes(c)), ...picked];
      else if (op === "back") {
        const rest = children.filter((c) => !picked.includes(c));
        // Keep label text first so serialization stays tidy.
        const firstEl = rest.findIndex((c) => c.kind === "element");
        const at = firstEl === -1 ? rest.length : firstEl;
        children = [...rest.slice(0, at), ...picked, ...rest.slice(at)];
      } else {
        const arr = [...children];
        const indices = arr.map((c, i) => (c.kind === "element" && sel.has(c.uid) ? i : -1)).filter((i) => i >= 0);
        if (op === "forward") {
          for (const i of indices.reverse()) {
            let j = i + 1;
            while (j < arr.length && arr[j].kind !== "element") j++;
            if (j < arr.length && !(arr[j].kind === "element" && sel.has((arr[j] as ElementNode).uid))) [arr[i], arr[j]] = [arr[j], arr[i]];
          }
        } else {
          for (const i of indices) {
            let j = i - 1;
            while (j >= 0 && arr[j].kind !== "element") j--;
            if (j >= 0 && !(arr[j].kind === "element" && sel.has((arr[j] as ElementNode).uid))) [arr[i], arr[j]] = [arr[j], arr[i]];
          }
        }
        children = arr;
      }
    }
    const changed = children.some((c, i) => c !== node.children[i]);
    return changed ? { ...node, children } : node;
  };
  return visit(doc);
}

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";

export function align(doc: ElementNode, layout: Layout, selection: string[], how: Align): ElementNode {
  const shapes = topLevel(layout, selection).filter((u) => layout.shapes.has(u));
  if (shapes.length < 2) return doc;
  const box = unionRect(shapes.map((u) => layout.shapes.get(u)!.bounds))!;
  const updates = new Map<string, (n: ElementNode) => ElementNode>();
  for (const uid of shapes) {
    const b = layout.shapes.get(uid)!.bounds;
    let dx = 0;
    let dy = 0;
    if (how === "left") dx = box.x - b.x;
    if (how === "center") dx = box.x + box.w / 2 - (b.x + b.w / 2);
    if (how === "right") dx = box.x + box.w - (b.x + b.w);
    if (how === "top") dy = box.y - b.y;
    if (how === "middle") dy = box.y + box.h / 2 - (b.y + b.h / 2);
    if (how === "bottom") dy = box.y + box.h - (b.y + b.h);
    if (dx || dy) updates.set(uid, (n) => translateNode(n, Math.round(dx), Math.round(dy)));
  }
  return updateNodes(doc, updates);
}

export function distribute(doc: ElementNode, layout: Layout, selection: string[], axis: "h" | "v"): ElementNode {
  const shapes = topLevel(layout, selection).filter((u) => layout.shapes.has(u));
  if (shapes.length < 3) return doc;
  const items = shapes.map((u) => ({ uid: u, b: layout.shapes.get(u)!.bounds }));
  const key = axis === "h" ? "x" : "y";
  const size = axis === "h" ? "w" : "h";
  items.sort((a, b) => a.b[key] - b.b[key]);
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const total = items.reduce((s, i) => s + i.b[size], 0);
  const gap = (last[key] + last[size] - first[key] - total) / (items.length - 1);
  let pos = first[key];
  const updates = new Map<string, (n: ElementNode) => ElementNode>();
  for (const item of items) {
    const delta = Math.round(pos - item.b[key]);
    if (delta) updates.set(item.uid, (n) => translateNode(n, axis === "h" ? delta : 0, axis === "v" ? delta : 0));
    pos += item.b[size] + gap;
  }
  return updateNodes(doc, updates);
}

/** Nearest common ancestor shape of two shapes (null = root). */
export function commonAncestor(layout: Layout, a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  const chain = (u: string) => {
    const out: string[] = [];
    let p = layout.parents.get(u) ?? null;
    while (p) {
      out.push(p);
      p = layout.parents.get(p) ?? null;
    }
    return out;
  };
  const ca = chain(a);
  const cb = new Set(chain(b));
  return ca.find((u) => cb.has(u)) ?? null;
}

// ------------------------------------------------------------------ page

/**
 * Moves the page's top-left corner to (rect.x, rect.y) and sets its size.
 * Coordinates are relative to the page, so the top-level content is moved by
 * the opposite amount: it stays where it is while the page grows or shrinks
 * on any side.
 */
export function setPageRect(doc: ElementNode, rect: Rect): ElementNode {
  const dx = -rect.x;
  const dy = -rect.y;
  let root = doc;
  if (dx || dy) root = { ...root, children: root.children.map((c) => (c.kind === "element" ? translateNode(c, dx, dy) : c)) };
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  return root.props.width === w && root.props.height === h && root === doc ? doc : withProps(root, { width: w, height: h });
}

/** Bounds of everything on the page (shapes and arrow routes). */
export function contentBounds(layout: Layout, routes: Iterable<{ route: { points: { x: number; y: number }[] } }>): Rect | null {
  const rects: Rect[] = [...layout.shapes.values()].filter((s) => s.depth === 0).map((s) => s.bounds);
  for (const r of routes) {
    const pts = r.route.points;
    if (!pts.length) continue;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  return unionRect(rects);
}

/** Page rect that fits the content with `padding`, on the grid (relative to the current page). */
export function fittedPageRect(content: Rect, grid: number, padding: number): Rect {
  const g = Math.max(1, grid);
  const x = Math.floor((content.x - padding) / g) * g;
  const y = Math.floor((content.y - padding) / g) * g;
  const right = Math.ceil((content.x + content.w + padding) / g) * g;
  const bottom = Math.ceil((content.y + content.h + padding) / g) * g;
  return { x, y, w: right - x, h: bottom - y };
}
