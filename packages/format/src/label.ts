/**
 * Label source: an editing-friendly text form of label children, used by the
 * editor's property panel. It reads like the rendered label's markup:
 *
 *   Attention $\mathrm{softmax}(QK^\top/\sqrt{d})V$<br />   → a line break is a newline
 *   v<sub>θ</sub> and <Math tex="\frac{t}{T}" />
 *
 * Unlike JSX text, braces need no escaping, so LaTeX can be typed as is.
 * Inline tags (<b>, <sub>, <Math />, …) are written like in the file.
 */
import type { ChildNode, ElementNode } from "./ast";
import { decodeEntities } from "./entities";
import { parseFragment } from "./parse";
import { printValue } from "./serialize";

function tagSource(node: ElementNode): string {
  const props = Object.entries(node.props)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v === true ? k : typeof v === "string" && !v.includes('"') ? `${k}="${v}"` : `${k}={${printValue(v)}}`));
  const open = props.length ? `<${node.name} ${props.join(" ")}` : `<${node.name}`;
  if (node.children.length === 0) return `${open} />`;
  return `${open}>${labelSource(node.children)}</${node.name}>`;
}

/** Label children → label source. */
export function labelSource(children: ChildNode[]): string {
  let out = "";
  for (const c of children) {
    if (c.kind === "text") out += c.value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    else if (c.kind === "element") out += c.name === "br" ? "\n" : tagSource(c);
  }
  return out;
}

const TAG = /<\/?[A-Za-z][\w.-]*(?:\s+(?:[^<>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)?\s*\/?>/g;

/** JSX text for raw text: braces and other special characters as a template literal. */
function jsxText(raw: string): string {
  if (!raw) return "";
  if (/[{}<>&`$\\]/.test(raw) || /^\s|\s$/.test(raw)) {
    if (!raw.includes("`") && !raw.includes("${")) return "{`" + raw + "`}";
    return `{${JSON.stringify(raw)}}`;
  }
  return raw;
}

/** Label source → label children. Throws a DiagramParseError for malformed tags. */
export function parseLabelSource(source: string): ChildNode[] {
  let jsx = "";
  let last = 0;
  const text = (raw: string) =>
    raw
      .split("\n")
      .map((line) => jsxText(decodeEntities(line)))
      .join("<br />");
  for (const m of source.matchAll(TAG)) {
    jsx += text(source.slice(last, m.index));
    jsx += m[0];
    last = m.index + m[0].length;
  }
  jsx += text(source.slice(last));
  const [wrapper] = parseFragment(`<Label>${jsx}</Label>`);
  return wrapper && wrapper.kind === "element" ? wrapper.children : [];
}
