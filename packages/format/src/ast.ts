/**
 * Document model of a diagram file.
 *
 * A diagram file is a single JSX expression. It is parsed into this tree and
 * never executed, so only literal values are allowed in attributes.
 */

export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value };

export type Props = Record<string, Value>;

export interface ElementNode {
  kind: "element";
  /** Component or HTML tag name. Empty string for a fragment `<>…</>`. */
  name: string;
  props: Props;
  children: ChildNode[];
  /** Runtime identity used by the viewer and editor. Never serialized. */
  uid: string;
}

export interface TextNode {
  kind: "text";
  value: string;
}

export interface CommentNode {
  kind: "comment";
  /** Comment body without the surrounding `/*` and `*\/`. */
  value: string;
}

export type ChildNode = ElementNode | TextNode | CommentNode;

export interface DiagramFile {
  root: ElementNode;
  /** Comments that appear before the root element, kept verbatim. */
  header: string[];
}

let uidCounter = 0;

export function createUid(): string {
  uidCounter += 1;
  return `n${uidCounter.toString(36)}`;
}

export function element(
  name: string,
  props: Props = {},
  children: ChildNode[] = [],
): ElementNode {
  return { kind: "element", name, props, children, uid: createUid() };
}

export function text(value: string): TextNode {
  return { kind: "text", value };
}

export function isElement(node: ChildNode | undefined | null): node is ElementNode {
  return node != null && node.kind === "element";
}

/** Deep clone with fresh uids, e.g. for duplicate and paste. */
export function cloneNode<T extends ChildNode>(node: T): T {
  if (node.kind !== "element") return { ...node };
  return {
    ...node,
    props: structuredClone(node.props),
    children: node.children.map(cloneNode),
    uid: createUid(),
  } as T;
}

export function walk(
  node: ElementNode,
  visit: (node: ElementNode, parent: ElementNode | null, depth: number) => void | false,
  parent: ElementNode | null = null,
  depth = 0,
): void {
  if (visit(node, parent, depth) === false) return;
  for (const child of node.children) {
    if (child.kind === "element") walk(child, visit, node, depth + 1);
  }
}
