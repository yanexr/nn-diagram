/**
 * In-place label editing (double-click, Enter or F2). The label becomes
 * contentEditable; on commit its DOM is converted back into label children.
 * Bold/italic/underline (Ctrl+B/I/U) and sub/superscript (Ctrl+, / Ctrl+.)
 * work as in other editors. Formulas render as atoms; type $…$ for new ones.
 */
import { useEffect, useRef } from "react";
import { INLINE_TAGS, element, text, type ChildNode, type ElementNode } from "@nn-diagram/format";
import { labelChildren, renderTex } from "@nn-diagram/viewer";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Static HTML for label children (formulas become non-editable atoms). */
export function childrenToHtml(children: ChildNode[]): string {
  return children
    .map((c) => {
      if (c.kind === "text") return escapeHtml(c.value);
      if (c.kind !== "element") return "";
      if (c.name === "Math") {
        const tex = typeof c.props.tex === "string" ? c.props.tex : "";
        return `<span class="nnd-math" contenteditable="false" data-tex="${escapeHtml(tex).replace(/"/g, "&quot;")}">${renderTex(tex, c.props.display === true)}</span>`;
      }
      if (!INLINE_TAGS.has(c.name)) return "";
      if (c.name === "br") return "<br>";
      const cls = typeof c.props.className === "string" ? ` class="${escapeHtml(c.props.className)}"` : "";
      return `<${c.name}${cls}>${childrenToHtml(c.children)}</${c.name}>`;
    })
    .join("");
}

const TAG_MAP: Record<string, string> = { strong: "b", em: "i", strike: "s" };

/** Converts edited DOM back into label children. */
export function htmlToChildren(root: Node): ChildNode[] {
  const out: ChildNode[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.value += value;
    else out.push(text(value));
  };
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText((node.textContent ?? "").replace(/ /g, " "));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tex = el.getAttribute("data-tex");
    if (tex !== null) {
      out.push(element("Math", { tex }));
      return;
    }
    let tag = el.tagName.toLowerCase();
    tag = TAG_MAP[tag] ?? tag;
    if (tag === "br") {
      out.push(element("br"));
      return;
    }
    if (tag === "div" || tag === "p") {
      // contentEditable line breaks
      if (out.length && !(out[out.length - 1].kind === "element" && (out[out.length - 1] as ElementNode).name === "br")) {
        out.push(element("br"));
      }
      for (const child of htmlToChildren(el)) {
        if (child.kind === "text") pushText(child.value);
        else out.push(child);
      }
      return;
    }
    const children = htmlToChildren(el);
    if (INLINE_TAGS.has(tag) && tag !== "span") {
      out.push(element(tag, {}, children));
    } else if (tag === "span" && el.className && !el.className.startsWith("nnd-")) {
      out.push(element("span", { className: el.className }, children));
    } else {
      for (const child of children) {
        if (child.kind === "text") pushText(child.value);
        else out.push(child);
      }
    }
  });
  // Trim trailing line breaks and whitespace.
  while (out.length) {
    const last = out[out.length - 1];
    if (last.kind === "element" && last.name === "br") out.pop();
    else if (last.kind === "text" && !last.value.trim()) out.pop();
    else break;
  }
  const first = out[0];
  if (first && first.kind === "text") first.value = first.value.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last && last.kind === "text") last.value = last.value.replace(/\s+$/, "");
  return out.filter((c) => c.kind !== "text" || c.value !== "");
}

export function LabelEditor({ node, onCommit, onCancel }: { node: ElementNode; onCommit: (children: ChildNode[]) => void; onCancel: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = childrenToHtml(labelChildren(node));
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Only on mount: the node changes identity on commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    if (done.current || !ref.current) return;
    done.current = true;
    onCommit(htmlToChildren(ref.current));
  };

  return (
    <span
      ref={ref}
      className="nnd-label"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{ outline: "none", minWidth: 8, minHeight: "1em", cursor: "text", userSelect: "text", whiteSpace: "pre-wrap", caretColor: "var(--nnd-select)" }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === "Escape" || e.key === "Tab" || (e.key === "Enter" && mod)) {
          e.preventDefault();
          commit();
        } else if (e.key === "Enter") {
          e.preventDefault();
          document.execCommand("insertLineBreak");
        } else if (mod && e.key === ",") {
          e.preventDefault();
          document.execCommand("subscript");
        } else if (mod && e.key === ".") {
          e.preventDefault();
          document.execCommand("superscript");
        } else if (mod && e.key.toLowerCase() === "z") {
          // Let the browser undo inside the label.
        } else if (e.key === "Escape") {
          onCancel();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
    />
  );
}
