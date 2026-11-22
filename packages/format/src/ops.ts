/**
 * Immutable tree operations. Every change returns a new root and copies only
 * the path to the changed node, so unchanged subtrees keep their identity
 * (cheap undo snapshots and memoized rendering).
 */
import type { ChildNode, ElementNode, Props, Value } from "./ast";

export interface Found {
  node: ElementNode;
  parent: ElementNode | null;
  index: number;
  /** Ancestors from the root down to the parent. */
  ancestors: ElementNode[];
}

export function findNode(root: ElementNode, uid: string): Found | null {
  if (root.uid === uid) return { node: root, parent: null, index: -1, ancestors: [] };
  const stack: ElementNode[] = [];
  const visit = (node: ElementNode): Found | null => {
    stack.push(node);
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.kind !== "element") continue;
      if (child.uid === uid) return { node: child, parent: node, index: i, ancestors: [...stack] };
      const found = visit(child);
      if (found) return found;
    }
    stack.pop();
    return null;
  };
  return visit(root);
}

export function findById(root: ElementNode, id: string): ElementNode | null {
  if (root.props.id === id) return root;
  for (const child of root.children) {
    if (child.kind !== "element") continue;
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

/** Replaces the node with `uid` by `updater(node)`. */
export function updateNode(root: ElementNode, uid: string, updater: (node: ElementNode) => ElementNode): ElementNode {
  if (root.uid === uid) return updater(root);
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.kind !== "element") continue;
    const next = updateNode(child, uid, updater);
    if (next !== child) {
      const children = root.children.slice();
      children[i] = next;
      return { ...root, children };
    }
  }
  return root;
}

/** Applies updates to many nodes in one pass. */
export function updateNodes(root: ElementNode, updates: ReadonlyMap<string, (node: ElementNode) => ElementNode>): ElementNode {
  if (updates.size === 0) return root;
  const visit = (node: ElementNode): ElementNode => {
    let next = node;
    const fn = updates.get(node.uid);
    if (fn) next = fn(node);
    let children: ChildNode[] | undefined;
    for (let i = 0; i < next.children.length; i++) {
      const child = next.children[i];
      if (child.kind !== "element") continue;
      const c = visit(child);
      if (c !== child) {
        children ??= next.children.slice();
        children[i] = c;
      }
    }
    return children ? { ...next, children } : next;
  };
  return visit(root);
}

/** Sets props; `undefined` removes a prop. */
export function withProps(node: ElementNode, patch: Record<string, Value | undefined>): ElementNode {
  const props: Props = { ...node.props };
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      if (key in props) {
        delete props[key];
        changed = true;
      }
    } else if (props[key] !== value) {
      props[key] = value;
      changed = true;
    }
  }
  return changed ? { ...node, props } : node;
}

export function setProps(root: ElementNode, uid: string, patch: Record<string, Value | undefined>): ElementNode {
  return updateNode(root, uid, (n) => withProps(n, patch));
}

export function removeNodes(root: ElementNode, uids: ReadonlySet<string>): ElementNode {
  if (uids.size === 0) return root;
  let changed = false;
  const children: ChildNode[] = [];
  for (const child of root.children) {
    if (child.kind === "element") {
      if (uids.has(child.uid)) {
        changed = true;
        continue;
      }
      const next = removeNodes(child, uids);
      if (next !== child) changed = true;
      children.push(next);
    } else children.push(child);
  }
  return changed ? { ...root, children } : root;
}

export function insertChildren(root: ElementNode, parentUid: string, index: number, nodes: ChildNode[]): ElementNode {
  return updateNode(root, parentUid, (parent) => {
    const children = [...parent.children];
    const at = index < 0 || index > children.length ? children.length : index;
    children.splice(at, 0, ...nodes);
    return { ...parent, children };
  });
}

export function replaceChildren(root: ElementNode, uid: string, children: ChildNode[]): ElementNode {
  return updateNode(root, uid, (n) => ({ ...n, children }));
}

export function collectIds(root: ElementNode): Set<string> {
  const ids = new Set<string>();
  const visit = (n: ElementNode) => {
    if (typeof n.props.id === "string") ids.add(n.props.id);
    for (const c of n.children) if (c.kind === "element") visit(c);
  };
  visit(root);
  return ids;
}

/** A readable unique id derived from a label, e.g. "rms-norm-2". */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const slug =
    base
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "node";
  const start = /^[a-z]/.test(slug) ? slug : `n-${slug}`;
  if (!taken.has(start)) return start;
  for (let i = 2; ; i++) {
    const candidate = `${start}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const GRID_FREE = new Set(["Op", "Ink"]);

/**
 * Rounds the geometry of every shape to the grid (relative to its parent).
 * Operator badges and pencil drawings keep their positions.
 */
export function snapToGrid(root: ElementNode, grid: number): ElementNode {
  const g = Math.max(1, grid);
  const snap = (v: unknown) => (typeof v === "number" ? Math.round(v / g) * g : v);
  const visit = (node: ElementNode): ElementNode => {
    let next = node;
    if (node !== root && typeof node.props.x === "number" && !GRID_FREE.has(node.name)) {
      const patch: Record<string, Value | undefined> = { x: snap(node.props.x) as number, y: snap(node.props.y) as number };
      if (typeof node.props.w === "number") patch.w = Math.max(g, snap(node.props.w) as number);
      if (typeof node.props.h === "number") patch.h = Math.max(g, snap(node.props.h) as number);
      next = withProps(node, patch);
    }
    let changed = next !== node;
    const children = next.children.map((c) => {
      if (c.kind !== "element") return c;
      const v = visit(c);
      if (v !== c) changed = true;
      return v;
    });
    return changed ? { ...next, children } : node;
  };
  return visit(root);
}
