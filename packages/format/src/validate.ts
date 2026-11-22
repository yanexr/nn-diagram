/**
 * Static checks for diagram files. Used by the CLI (`pnpm diagram check`) so an
 * LLM can verify a file it wrote, and by the editor to show problems.
 */
import { walk, type DiagramFile, type ElementNode } from "./ast";
import { isInvalidAnchor, parseEndpoint } from "./endpoint";
import { DiagramParseError, parseDiagram } from "./parse";
import { ARROW_VARIANTS, BOX_VARIANTS, COMPONENTS, INLINE_TAGS, RENAMED_VARIANTS, SHAPES, isShape } from "./schema";

const renamedHint = (v: string) => (RENAMED_VARIANTS[v] ? `; it was renamed to "${RENAMED_VARIANTS[v]}"` : "");

export interface Issue {
  severity: "error" | "warning";
  message: string;
  /** Element id or name/path for orientation. */
  where?: string;
  line?: number;
  column?: number;
}

function describe(node: ElementNode): string {
  const id = node.props.id;
  if (typeof id === "string") return `<${node.name} id="${id}">`;
  const label = node.children.find((c) => c.kind === "text");
  return label && label.kind === "text" ? `<${node.name}> "${label.value.slice(0, 30)}"` : `<${node.name}>`;
}

export function validateDiagram(file: DiagramFile): Issue[] {
  const issues: Issue[] = [];
  const root = file.root;
  if (root.name !== "Diagram") {
    issues.push({ severity: "error", message: `Root element must be <Diagram>, found <${root.name}>` });
  }
  const grid = typeof root.props.grid === "number" ? root.props.grid : 4;
  const ids = new Map<string, ElementNode>();
  const arrows: ElementNode[] = [];
  const stepIds: { ids: string[]; node: ElementNode }[] = [];

  walk(root, (node, parent) => {
    const spec = COMPONENTS[node.name];
    const where = describe(node);
    if (!spec && !INLINE_TAGS.has(node.name) && node !== root) {
      issues.push({ severity: "warning", message: `Unknown element <${node.name}>`, where });
    }
    const id = node.props.id;
    if (id !== undefined) {
      if (typeof id !== "string" || !id) {
        issues.push({ severity: "error", message: "id must be a non-empty string", where });
      } else if (ids.has(id)) {
        issues.push({ severity: "error", message: `Duplicate id "${id}"`, where });
      } else {
        ids.set(id, node);
      }
    }
    if (node.name === "Arrow") arrows.push(node);
    if (spec?.kind === "part" && spec.parent && parent?.name !== spec.parent) {
      issues.push({ severity: "error", message: `<${node.name}> must be inside <${spec.parent}>`, where });
    }
    if (node.name === "Table") checkTable(node, where, issues);
    if (node.name === "Step" && typeof node.props.focus === "string") {
      stepIds.push({ ids: node.props.focus.split(/\s+/).filter(Boolean), node });
    }

    if (isShape(node)) {
      if (parent && !isShape(parent) && parent !== root && parent.name !== "") {
        issues.push({ severity: "error", message: `Shapes must be inside <Diagram> or another shape, not <${parent.name}>`, where });
      }
      for (const key of ["x", "y"] as const) {
        const v = node.props[key];
        if (typeof v !== "number") {
          issues.push({ severity: "error", message: `Missing numeric ${key}={…}`, where });
        } else if (v % grid !== 0 && node.name !== "Op" && node.name !== "Ink") {
          // Operator badges are often centered on a line, so half-grid positions are fine.
          issues.push({ severity: "warning", message: `${key}={${v}} is not on the ${grid}px grid`, where });
        }
      }
      for (const key of ["w", "h"] as const) {
        const v = node.props[key];
        if (v === undefined) {
          if (node.name !== "Text") issues.push({ severity: "error", message: `Missing ${key}={…}`, where });
        } else if (typeof v !== "number" || v < 0) {
          issues.push({ severity: "error", message: `${key} must be a non-negative number`, where });
        } else if (v % grid !== 0 && node.name !== "Op" && node.name !== "Ink") {
          issues.push({ severity: "warning", message: `${key}={${v}} is not on the ${grid}px grid`, where });
        }
      }
      const rotate = node.props.rotate;
      if (rotate !== undefined && (typeof rotate !== "number" || !Number.isInteger(rotate))) {
        issues.push({ severity: "warning", message: "rotate should be a whole number of degrees", where });
      }
      const variant = node.props.variant;
      if (typeof variant === "string" && node.name !== "Text" && !BOX_VARIANTS.includes(variant)) {
        issues.push({ severity: "warning", message: `Unknown variant "${variant}"${renamedHint(variant)}`, where });
      }
      const shape = node.props.shape;
      if (shape !== undefined && !(SHAPES as readonly unknown[]).includes(shape)) {
        issues.push({ severity: "error", message: `Unknown shape "${String(shape)}". Use one of: ${SHAPES.join(", ")}`, where });
      }
      // Children should stay inside their parent.
      if (parent && isShape(parent)) {
        const pw = parent.props.w;
        const ph = parent.props.h;
        const { x, y, w, h } = node.props;
        if (
          typeof pw === "number" && typeof ph === "number" &&
          typeof x === "number" && typeof y === "number" && typeof w === "number" && typeof h === "number" &&
          (x < 0 || y < 0 || x + w > pw || y + h > ph)
        ) {
          issues.push({
            severity: "warning",
            message: `Extends outside its parent ${describe(parent)} (child coordinates are relative to the parent)`,
            where,
          });
        }
      }
    }
  });

  for (const arrow of arrows) {
    const where = describe(arrow);
    const variant = arrow.props.variant;
    if (typeof variant === "string" && !ARROW_VARIANTS.includes(variant)) {
      issues.push({ severity: "warning", message: `Unknown arrow variant "${variant}"${renamedHint(variant)}${variant === "cond" || variant === "grad" ? " (add `dashed`)" : ""}`, where });
    }
    for (const key of ["from", "to"] as const) {
      const raw = arrow.props[key];
      if (raw === undefined) {
        issues.push({ severity: "error", message: `Arrow is missing "${key}"`, where });
        continue;
      }
      const ep = parseEndpoint(raw);
      if (!ep) {
        issues.push({ severity: "error", message: `Invalid ${key}=${JSON.stringify(raw)}`, where });
      } else if (ep.kind === "node") {
        if (!ids.has(ep.id)) issues.push({ severity: "error", message: `${key} references unknown id "${ep.id}"`, where });
        if (isInvalidAnchor(raw)) {
          issues.push({ severity: "error", message: `Invalid anchor in ${key}="${raw}"`, where });
        }
      }
    }
  }

  for (const { ids: focus, node } of stepIds) {
    for (const id of focus) {
      if (!ids.has(id)) issues.push({ severity: "warning", message: `Step focuses unknown id "${id}"`, where: describe(node) });
    }
  }
  return issues;
}

function checkTable(table: ElementNode, where: string, issues: Issue[]) {
  const rows = table.children.filter((c): c is ElementNode => c.kind === "element" && c.name === "Row");
  const width = (row: ElementNode) =>
    row.children.reduce((n, c) => n + (c.kind === "element" && c.name === "Cell" ? (typeof c.props.span === "number" ? c.props.span : 1) : 0), 0);
  const counts = rows.map(width);
  const cols = table.props.cols;
  const n = Array.isArray(cols) ? cols.length : Math.max(0, ...counts);
  if (counts.some((c) => c !== n)) {
    issues.push({ severity: "warning", message: `Rows have different numbers of cells (${counts.join(", ")})${Array.isArray(cols) ? `; cols lists ${n} columns` : ""}`, where });
  }
  const heights = table.props.rows;
  if (Array.isArray(heights) && heights.length !== rows.length) {
    issues.push({ severity: "warning", message: `rows lists ${heights.length} heights for ${rows.length} <Row> elements`, where });
  }
  for (const [key, list, size] of [["cols", cols, table.props.w], ["rows", heights, table.props.h]] as const) {
    if (Array.isArray(list) && typeof size === "number") {
      const sum = list.reduce<number>((a, b) => a + (typeof b === "number" ? b : 0), 0);
      if (sum !== size) issues.push({ severity: "warning", message: `${key} add up to ${sum}, but ${key === "cols" ? "w" : "h"}={${size}}`, where });
    }
  }
}

/** Parses and validates source text. Parse errors are reported as issues. */
export function checkSource(source: string): { file: DiagramFile | null; issues: Issue[] } {
  try {
    const file = parseDiagram(source);
    return { file, issues: validateDiagram(file) };
  } catch (err) {
    if (err instanceof DiagramParseError) {
      return {
        file: null,
        issues: [{ severity: "error", message: err.message, line: err.line, column: err.column }],
      };
    }
    throw err;
  }
}
