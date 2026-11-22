/** Label content: text, inline HTML tags, <Math> and $…$ formulas. */
import katex from "katex";
import { createElement, Fragment, type ReactNode } from "react";
import { INLINE_TAGS, type ChildNode, type ElementNode } from "@nn-diagram/format";

const cache = new Map<string, string>();

export function renderTex(tex: string, display = false): string {
  const key = (display ? "D:" : "I:") + tex;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
    if (cache.size > 2000) cache.clear();
    cache.set(key, html);
  }
  return html;
}

export function MathSpan({ tex, display }: { tex: string; display?: boolean }) {
  return <span className="nnd-math" data-tex={tex} dangerouslySetInnerHTML={{ __html: renderTex(tex, display) }} />;
}

/** Splits text on $…$ (\$ escapes a dollar sign). */
function renderText(value: string, key: string): ReactNode {
  if (!value.includes("$")) return value.replace(/\\\$/g, "$");
  const out: ReactNode[] = [];
  const re = /(?<!\\)\$([^$]+?)(?<!\\)\$/g;
  let last = 0;
  let i = 0;
  for (let m = re.exec(value); m; m = re.exec(value)) {
    if (m.index > last) out.push(value.slice(last, m.index).replace(/\\\$/g, "$"));
    out.push(<MathSpan key={`${key}-m${i++}`} tex={m[1]} />);
    last = m.index + m[0].length;
  }
  if (last < value.length) out.push(value.slice(last).replace(/\\\$/g, "$"));
  return <Fragment key={key}>{out}</Fragment>;
}

const ALLOWED_ATTRS = new Set(["className", "title"]);

function renderInlineElement(node: ElementNode, key: string): ReactNode {
  if (node.name === "Math") {
    const tex = typeof node.props.tex === "string" ? node.props.tex : "";
    return <MathSpan key={key} tex={tex} display={node.props.display === true} />;
  }
  if (!INLINE_TAGS.has(node.name)) return null;
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(node.props)) {
    if (ALLOWED_ATTRS.has(k) && typeof v === "string") props[k] = v;
  }
  if (node.name === "br") return createElement("br", props);
  return createElement(node.name, props, renderInline(node.children, key));
}

export function renderInline(children: ChildNode[], keyPrefix = "c"): ReactNode[] {
  const out: ReactNode[] = [];
  children.forEach((child, i) => {
    const key = `${keyPrefix}-${i}`;
    if (child.kind === "text") out.push(renderText(child.value, key));
    else if (child.kind === "element") out.push(renderInlineElement(child, key));
  });
  return out;
}

export function hasLabel(node: ElementNode): boolean {
  return node.children.some(
    (c) => (c.kind === "text" && c.value.trim() !== "") || (c.kind === "element" && (INLINE_TAGS.has(c.name) || c.name === "Math")),
  );
}

/** Label children only (text and inline elements, not child shapes). */
export function labelChildren(node: ElementNode): ChildNode[] {
  return node.children.filter((c) => c.kind === "text" || (c.kind === "element" && (INLINE_TAGS.has(c.name) || c.name === "Math")));
}

/** Plain-text version of a label, e.g. for the layers panel. */
export function labelText(node: ElementNode): string {
  const parts: string[] = [];
  const visit = (children: ChildNode[]) => {
    for (const c of children) {
      if (c.kind === "text") parts.push(c.value);
      else if (c.kind === "element") {
        if (c.name === "Math" && typeof c.props.tex === "string") parts.push(c.props.tex);
        else if (INLINE_TAGS.has(c.name)) visit(c.children);
      }
    }
  };
  visit(node.children);
  return parts.join("").replace(/\s+/g, " ").trim();
}
