/**
 * Canonical printer. Produces stable, compact output: one element per line,
 * props in a fixed order, label content inline. The editor always writes files
 * through this, so diffs stay small and readable for humans and LLMs.
 */
import type { ChildNode, DiagramFile, ElementNode, Props, Value } from "./ast";
import { escapeAmpersands } from "./entities";
import { isInline } from "./schema";

const FIRST = ["id", "width", "height", "grid", "x", "y", "w", "h", "rotate", "from", "to", "via"];
const LAST = ["variant", "className", "tip", "link"];
const INDENT = "  ";

function orderedEntries(props: Props): [string, Value][] {
  const keys = Object.keys(props).filter((k) => props[k] !== undefined);
  const first = FIRST.filter((k) => keys.includes(k));
  const last = LAST.filter((k) => keys.includes(k));
  const middle = keys.filter((k) => !FIRST.includes(k) && !LAST.includes(k));
  return [...first, ...middle, ...last].map((k) => [k, props[k]]);
}

function canTemplate(s: string): boolean {
  return !s.includes("`") && !s.includes("${") && !s.endsWith("\\");
}

function printString(s: string): string {
  if ((s.includes("\n") || s.includes('"') || s.includes("\\")) && canTemplate(s)) return "`" + s + "`";
  return JSON.stringify(s);
}

function printNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000);
}

export function printValue(v: Value): string {
  if (v === null) return "null";
  if (typeof v === "string") return printString(v);
  if (typeof v === "number") return printNumber(v);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(printValue).join(", ")}]`;
  const entries = Object.entries(v).map(([k, val]) => {
    const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
    return `${key}: ${printValue(val)}`;
  });
  return entries.length ? `{ ${entries.join(", ")} }` : "{}";
}

function printProp(name: string, v: Value): string {
  if (v === true) return name;
  if (typeof v === "string") {
    if (!v.includes('"') && !v.includes("\n")) return `${name}="${escapeAmpersands(v)}"`;
    if (canTemplate(v)) return `${name}={\`${v}\`}`;
  }
  return `${name}={${printValue(v)}}`;
}

function printText(value: string): string {
  if (/[{}\n]/.test(value)) {
    return canTemplate(value) ? "{`" + value + "`}" : `{${JSON.stringify(value)}}`;
  }
  return escapeAmpersands(value).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function openTag(node: ElementNode): string {
  const props = orderedEntries(node.props).map(([k, v]) => printProp(k, v));
  return props.length ? `<${node.name} ${props.join(" ")}` : `<${node.name}`;
}

/** Label content (text, inline tags, <Math>) printed on a single line. */
function printInline(children: ChildNode[]): string {
  let out = "";
  for (const child of children) {
    if (child.kind === "text") out += printText(child.value);
    else if (child.kind === "comment") out += `{/*${child.value}*/}`;
    else out += printInlineElement(child);
  }
  return out;
}

function printInlineElement(node: ElementNode): string {
  if (node.children.length === 0) return `${openTag(node)} />`;
  return `${openTag(node)}>${printInline(node.children)}</${node.name}>`;
}

function isContent(child: ChildNode): boolean {
  return child.kind === "text" || (child.kind === "element" && isInline(child));
}

function printElement(node: ElementNode, depth: number): string {
  const pad = INDENT.repeat(depth);
  if (node.name === "") {
    return node.children.map((c) => printChild(c, depth)).join("\n");
  }
  if (node.children.length === 0) return `${pad}${openTag(node)} />`;
  // Table rows stay on one line: <Row><Cell>a</Cell><Cell>b</Cell></Row>.
  if (node.children.every(isContent) || node.name === "Row") {
    return `${pad}${openTag(node)}>${printInline(node.children)}</${node.name}>`;
  }
  const lines = [`${pad}${openTag(node)}>`];
  let run: ChildNode[] = [];
  const flush = () => {
    if (run.length) lines.push(`${pad}${INDENT}${printInline(run).trim()}`);
    run = [];
  };
  for (const child of node.children) {
    if (isContent(child)) {
      run.push(child);
      continue;
    }
    flush();
    lines.push(printChild(child, depth + 1));
  }
  flush();
  lines.push(`${pad}</${node.name}>`);
  return lines.join("\n");
}

function printChild(child: ChildNode, depth: number): string {
  const pad = INDENT.repeat(depth);
  if (child.kind === "comment") return `${pad}{/*${child.value}*/}`;
  if (child.kind === "text") return `${pad}${printText(child.value)}`;
  return printElement(child, depth);
}

export function serializeDiagram(file: DiagramFile): string {
  const header = file.header.length ? file.header.join("\n") + "\n" : "";
  return header + printElement(file.root, 0) + "\n";
}

/** Serializes shapes for the clipboard. Multiple nodes are wrapped in a fragment. */
export function serializeNodes(nodes: ChildNode[]): string {
  if (nodes.length === 1) return printChild(nodes[0], 0);
  return ["<>", ...nodes.map((n) => printChild(n, 1)), "</>"].join("\n");
}
