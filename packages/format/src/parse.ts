/**
 * Parser for diagram files: a strict JSX subset.
 *
 * - The file holds one JSX element (optionally `export default`, wrapped in
 *   parentheses, followed by `;`). Comments before it are kept.
 * - Attribute values are string literals or `{…}` containing literals only:
 *   numbers, strings, template literals, booleans, null, arrays and objects.
 * - Template literals are raw (like String.raw), so LaTeX needs no escaping:
 *   tip={`$\frac{QK^\top}{\sqrt{d}}$`}. `${…}` substitutions are not allowed.
 * - Text children follow JSX whitespace rules. `{/* … *\/}` children are kept
 *   as comments.
 */
import { createUid, type ChildNode, type DiagramFile, type ElementNode, type Value } from "./ast";
import { decodeEntities } from "./entities";

export class DiagramParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly offset: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "DiagramParseError";
  }
}

const NAME_START = /[A-Za-z_$]/;
const NAME_CHAR = /[A-Za-z0-9_$\-.:]/;
const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_$]/;

class Parser {
  pos = 0;

  constructor(readonly src: string) {}

  // ---------------------------------------------------------------- helpers

  error(message: string, at = this.pos): never {
    let line = 1;
    let col = 1;
    for (let i = 0; i < at && i < this.src.length; i++) {
      if (this.src[i] === "\n") {
        line++;
        col = 1;
      } else col++;
    }
    throw new DiagramParseError(message, line, col, at);
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }

  startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  expect(s: string, what = `"${s}"`): void {
    if (!this.startsWith(s)) {
      const found = this.eof() ? "end of file" : `"${this.src.slice(this.pos, this.pos + 12)}"`;
      this.error(`Expected ${what} but found ${found}`);
    }
    this.pos += s.length;
  }

  /** Skips whitespace and JS comments, collecting block/line comment bodies. */
  skipTrivia(comments?: string[]): void {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿") {
        this.pos++;
      } else if (this.startsWith("//")) {
        const end = this.src.indexOf("\n", this.pos);
        const stop = end === -1 ? this.src.length : end;
        comments?.push(this.src.slice(this.pos, stop));
        this.pos = stop;
      } else if (this.startsWith("/*")) {
        const end = this.src.indexOf("*/", this.pos + 2);
        if (end === -1) this.error("Unterminated comment");
        comments?.push(this.src.slice(this.pos, end + 2));
        this.pos = end + 2;
      } else {
        return;
      }
    }
  }

  // --------------------------------------------------------------- program

  parseFile(): DiagramFile {
    const header: string[] = [];
    this.skipTrivia(header);
    if (this.startsWith("export")) {
      this.pos += "export".length;
      this.skipTrivia();
      this.expect("default", '"default" after "export"');
      this.skipTrivia();
    }
    let parens = 0;
    while (this.peek() === "(") {
      parens++;
      this.pos++;
      this.skipTrivia();
    }
    if (this.peek() !== "<") this.error("Expected the diagram to start with a JSX element like <Diagram>");
    const root = this.parseElement();
    this.skipTrivia();
    while (parens > 0) {
      this.expect(")");
      parens--;
      this.skipTrivia();
    }
    if (this.peek() === ";") this.pos++;
    this.skipTrivia();
    if (!this.eof()) this.error("Unexpected content after the root element. A diagram file holds exactly one root element");
    return { root, header };
  }

  /** Parses a sequence of elements, e.g. clipboard content. */
  parseFragment(): ChildNode[] {
    const nodes: ChildNode[] = [];
    for (;;) {
      const comments: string[] = [];
      this.skipTrivia(comments);
      for (const c of comments) {
        if (c.startsWith("/*")) nodes.push({ kind: "comment", value: c.slice(2, -2) });
      }
      if (this.eof()) break;
      if (this.peek() !== "<") this.error("Expected a JSX element");
      const el = this.parseElement();
      if (el.name === "") nodes.push(...el.children);
      else nodes.push(el);
    }
    return nodes;
  }

  // -------------------------------------------------------------- elements

  parseName(): string {
    const start = this.pos;
    if (!NAME_START.test(this.peek())) this.error("Expected an element name");
    while (NAME_CHAR.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  parseElement(): ElementNode {
    const start = this.pos;
    this.expect("<");
    this.skipTrivia();
    // Fragment
    if (this.peek() === ">") {
      this.pos++;
      const children = this.parseChildren("");
      return { kind: "element", name: "", props: {}, children, uid: createUid() };
    }
    const name = this.parseName();
    const props: Record<string, Value> = {};
    for (;;) {
      this.skipTrivia();
      const c = this.peek();
      if (c === "/") {
        this.pos++;
        this.expect(">", '">" to close the self-closing tag');
        return { kind: "element", name, props, children: [], uid: createUid() };
      }
      if (c === ">") {
        this.pos++;
        break;
      }
      if (c === "{") this.error("Spread attributes like {...props} are not supported in diagram files");
      if (!NAME_START.test(c)) {
        if (this.eof()) this.error(`Unterminated <${name}> tag`, start);
        this.error(`Unexpected character "${c}" in <${name}> tag`);
      }
      const attrStart = this.pos;
      const attr = this.parseName();
      if (attr in props) this.error(`Duplicate attribute "${attr}" on <${name}>`, attrStart);
      this.skipTrivia();
      if (this.peek() === "=") {
        this.pos++;
        this.skipTrivia();
        props[attr] = this.parseAttrValue(attr);
      } else {
        props[attr] = true;
      }
    }
    const children = this.parseChildren(name);
    return { kind: "element", name, props, children, uid: createUid() };
  }

  parseAttrValue(attr: string): Value {
    const c = this.peek();
    if (c === '"' || c === "'") {
      // JSX attribute strings have no escape sequences, only entities.
      const end = this.src.indexOf(c, this.pos + 1);
      if (end === -1) this.error(`Unterminated string for attribute "${attr}"`);
      const raw = this.src.slice(this.pos + 1, end);
      this.pos = end + 1;
      return decodeEntities(raw);
    }
    if (c === "{") {
      this.pos++;
      this.skipTrivia();
      const value = this.parseValue();
      this.skipTrivia();
      this.expect("}", `"}" to close the value of "${attr}"`);
      return value;
    }
    return this.error(`Expected a string or {value} for attribute "${attr}"`);
  }

  parseChildren(parentName: string): ChildNode[] {
    const children: ChildNode[] = [];
    let textStart = this.pos;
    const flushText = () => {
      if (this.pos > textStart) {
        const cleaned = cleanJsxText(this.src.slice(textStart, this.pos));
        if (cleaned) children.push({ kind: "text", value: decodeEntities(cleaned) });
      }
    };
    for (;;) {
      if (this.eof()) this.error(parentName ? `Missing closing tag </${parentName}>` : "Missing closing tag </>");
      const c = this.peek();
      if (c === "<") {
        flushText();
        if (this.peek(1) === "/") {
          this.pos += 2;
          this.skipTrivia();
          const closeStart = this.pos;
          const closing = this.peek() === ">" ? "" : this.parseName();
          if (closing !== parentName) {
            this.error(`Closing tag </${closing}> does not match <${parentName}>`, closeStart);
          }
          this.skipTrivia();
          this.expect(">");
          return children;
        }
        children.push(this.parseElement());
        textStart = this.pos;
      } else if (c === "{") {
        flushText();
        this.pos++;
        const comments: string[] = [];
        this.skipTrivia(comments);
        if (this.peek() === "}") {
          this.pos++;
          for (const body of comments) {
            if (body.startsWith("/*")) children.push({ kind: "comment", value: body.slice(2, -2) });
          }
        } else {
          const valueStart = this.pos;
          if (IDENT_START.test(this.peek()) && !/^(true|false|null|undefined)\b/.test(this.src.slice(this.pos))) {
            this.error(
              '"{" is not allowed in JSX text: it starts an expression. Put LaTeX in <Math tex="…" />, or wrap the whole text in a {`template literal`}',
              valueStart - 1,
            );
          }
          const value = this.parseValue();
          this.skipTrivia();
          this.expect("}", '"}" to close the expression');
          if (typeof value === "string") children.push({ kind: "text", value });
          else if (typeof value === "number") children.push({ kind: "text", value: String(value) });
          else if (value !== null && typeof value !== "boolean") {
            this.error("Only strings and numbers can be used as children", valueStart);
          }
        }
        textStart = this.pos;
      } else if (c === "}" || c === ">") {
        this.error(`"${c}" is not allowed in JSX text. Write {"${c}"} instead, or put LaTeX in <Math tex="…" /> or a {\`template literal\`}`);
      } else {
        this.pos++;
      }
    }
  }

  // ---------------------------------------------------------------- values

  parseValue(): Value {
    this.skipTrivia();
    const c = this.peek();
    if (c === '"' || c === "'") return this.parseJsString(c);
    if (c === "`") return this.parseTemplate();
    if (c === "[") return this.parseArray();
    if (c === "{") return this.parseObject();
    if (c === "-" || c === "+" || c === "." || /[0-9]/.test(c)) return this.parseNumber();
    if (IDENT_START.test(c)) {
      const start = this.pos;
      while (IDENT_CHAR.test(this.peek())) this.pos++;
      const word = this.src.slice(start, this.pos);
      if (word === "true") return true;
      if (word === "false") return false;
      if (word === "null" || word === "undefined") return null;
      this.error(`"${word}" is not a literal. Diagram files are data only: use numbers, strings, arrays or objects`, start);
    }
    return this.error("Expected a value");
  }

  parseNumber(): number {
    const start = this.pos;
    const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (!m) this.error("Invalid number");
    this.pos += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) this.error("Invalid number", start);
    return n;
  }

  parseJsString(quote: string): string {
    this.pos++;
    let out = "";
    for (;;) {
      if (this.eof()) this.error("Unterminated string");
      const c = this.peek();
      if (c === quote) {
        this.pos++;
        return out;
      }
      if (c === "\n") this.error("Unterminated string (use a `template literal` for multi-line text)");
      if (c === "\\") {
        const n = this.peek(1);
        this.pos += 2;
        switch (n) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "v": out += "\v"; break;
          case "0": out += "\0"; break;
          case "u": {
            const m = /^(\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4})/.exec(this.src.slice(this.pos));
            if (!m) this.error("Invalid unicode escape");
            const hex = m[0].startsWith("{") ? m[0].slice(1, -1) : m[0];
            out += String.fromCodePoint(parseInt(hex, 16));
            this.pos += m[0].length;
            break;
          }
          case "x": {
            const hex = this.src.slice(this.pos, this.pos + 2);
            if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.error("Invalid hex escape");
            out += String.fromCharCode(parseInt(hex, 16));
            this.pos += 2;
            break;
          }
          case "\n": break;
          default: out += n;
        }
        continue;
      }
      out += c;
      this.pos++;
    }
  }

  /** Raw template literal: backslashes are kept as written. */
  parseTemplate(): string {
    const start = this.pos;
    this.pos++;
    let out = "";
    for (;;) {
      if (this.eof()) this.error("Unterminated template literal", start);
      const c = this.peek();
      if (c === "`") {
        this.pos++;
        return out.replace(/\r\n/g, "\n");
      }
      if (c === "$" && this.peek(1) === "{") {
        this.error("${…} substitutions are not allowed: diagram files are never executed");
      }
      if (c === "\\" && (this.peek(1) === "`" || this.peek(1) === "$")) {
        out += this.peek(1);
        this.pos += 2;
        continue;
      }
      out += c;
      this.pos++;
    }
  }

  parseArray(): Value[] {
    this.expect("[");
    const items: Value[] = [];
    for (;;) {
      this.skipTrivia();
      if (this.peek() === "]") {
        this.pos++;
        return items;
      }
      items.push(this.parseValue());
      this.skipTrivia();
      if (this.peek() === ",") this.pos++;
      else if (this.peek() !== "]") this.error('Expected "," or "]" in array');
    }
  }

  parseObject(): { [key: string]: Value } {
    this.expect("{");
    const obj: { [key: string]: Value } = {};
    for (;;) {
      this.skipTrivia();
      if (this.peek() === "}") {
        this.pos++;
        return obj;
      }
      let key: string;
      const c = this.peek();
      if (c === '"' || c === "'") key = this.parseJsString(c);
      else if (IDENT_START.test(c)) {
        const s = this.pos;
        while (IDENT_CHAR.test(this.peek())) this.pos++;
        key = this.src.slice(s, this.pos);
      } else if (/[0-9]/.test(c)) key = String(this.parseNumber());
      else this.error("Expected an object key");
      this.skipTrivia();
      this.expect(":", '":" after object key');
      obj[key] = this.parseValue();
      this.skipTrivia();
      if (this.peek() === ",") this.pos++;
      else if (this.peek() !== "}") this.error('Expected "," or "}" in object');
    }
  }
}

/** JSX text whitespace rules (same as Babel's cleanJSXElementLiteralChild). */
export function cleanJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i])) lastNonEmpty = i;
  }
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, " ");
    if (i !== 0) line = line.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) line = line.replace(/[ ]+$/, "");
    if (line) {
      if (i !== lastNonEmpty) line += " ";
      out += line;
    }
  }
  return out;
}

export function parseDiagram(source: string): DiagramFile {
  return new Parser(source).parseFile();
}

export function parseFragment(source: string): ChildNode[] {
  return new Parser(source).parseFragment();
}
