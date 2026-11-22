/** Editing operations on <Table> nodes (rows of <Row>, cells of <Cell>). */
import { element, text, withProps, type ElementNode } from "@nn-diagram/format";
import { tableGrid } from "@nn-diagram/viewer";

const rowsOf = (table: ElementNode) => table.children.filter((c): c is ElementNode => c.kind === "element" && c.name === "Row");
const cellsOf = (row: ElementNode) => row.children.filter((c): c is ElementNode => c.kind === "element" && c.name === "Cell");
const snap = (n: number, grid: number) => Math.max(grid, Math.round(n / grid) * grid);

/** A new table: a header row and body rows of empty cells. */
export function tableSnippet(cols = 3, rows = 3, cellW = 80, cellH = 32): string {
  const head = `    <Row>${Array.from({ length: cols }, (_, i) => `<Cell>Column ${i + 1}</Cell>`).join("")}</Row>`;
  const body = Array.from({ length: rows - 1 }, () => `    <Row>${"<Cell />".repeat(cols)}</Row>`);
  return [`<Table x={0} y={0} w={${cols * cellW}} h={${rows * cellH}} header>`, head, ...body, "</Table>"].join("\n");
}

export function tableSize(table: ElementNode): { rows: number; cols: number } {
  const { cols } = tableGrid(table);
  return { rows: rowsOf(table).length, cols: cols.length };
}

/** Replaces the table's rows, keeping other children (comments) in place. */
function withRows(table: ElementNode, rows: ElementNode[]): ElementNode {
  const others = table.children.filter((c) => !(c.kind === "element" && c.name === "Row"));
  return { ...table, children: [...rows, ...others] };
}

export function addRow(table: ElementNode, grid: number): ElementNode {
  const { cols, rows } = tableGrid(table);
  const h = snap(rows.length ? rows[rows.length - 1] : 32, grid);
  const row = element("Row", {}, Array.from({ length: cols.length }, () => element("Cell")));
  const next = withRows(table, [...rowsOf(table), row]);
  return withProps(next, {
    h: (typeof table.props.h === "number" ? table.props.h : 0) + h,
    rows: Array.isArray(table.props.rows) ? [...table.props.rows, h] : undefined,
  });
}

export function removeRow(table: ElementNode): ElementNode {
  const list = rowsOf(table);
  if (list.length <= 1) return table;
  const { rows } = tableGrid(table);
  const h = rows[rows.length - 1] ?? 0;
  return withProps(withRows(table, list.slice(0, -1)), {
    h: Math.max(0, (typeof table.props.h === "number" ? table.props.h : 0) - h),
    rows: Array.isArray(table.props.rows) ? table.props.rows.slice(0, -1) : undefined,
  });
}

export function addColumn(table: ElementNode, grid: number): ElementNode {
  const { cols } = tableGrid(table);
  const w = snap(cols.length ? cols[cols.length - 1] : 80, grid);
  const rows = rowsOf(table).map((r) => ({ ...r, children: [...r.children, element("Cell")] }));
  return withProps(withRows(table, rows), {
    w: (typeof table.props.w === "number" ? table.props.w : 0) + w,
    cols: Array.isArray(table.props.cols) ? [...table.props.cols, w] : undefined,
  });
}

export function removeColumn(table: ElementNode): ElementNode {
  const { cols } = tableGrid(table);
  if (cols.length <= 1) return table;
  const w = cols[cols.length - 1];
  const rows = rowsOf(table).map((r) => {
    const cells = cellsOf(r);
    const last = cells[cells.length - 1];
    if (!last) return r;
    const span = typeof last.props.span === "number" ? last.props.span : 1;
    const children = span > 1 ? r.children.map((c) => (c === last ? withProps(last, { span: span - 1 > 1 ? span - 1 : undefined }) : c)) : r.children.filter((c) => c !== last);
    return { ...r, children };
  });
  return withProps(withRows(table, rows), {
    w: Math.max(0, (typeof table.props.w === "number" ? table.props.w : 0) - w),
    cols: Array.isArray(table.props.cols) ? table.props.cols.slice(0, -1) : undefined,
  });
}

/** Cells by grid position (row, first column it covers). */
export function cellGrid(table: ElementNode): { cell: ElementNode; row: number; col: number; span: number }[] {
  const out: { cell: ElementNode; row: number; col: number; span: number }[] = [];
  rowsOf(table).forEach((r, row) => {
    let col = 0;
    for (const cell of cellsOf(r)) {
      const span = Math.max(1, typeof cell.props.span === "number" ? Math.round(cell.props.span) : 1);
      out.push({ cell, row, col, span });
      col += span;
    }
  });
  return out;
}

export function updateCell(table: ElementNode, uid: string, fn: (cell: ElementNode) => ElementNode): ElementNode {
  return withRows(
    table,
    rowsOf(table).map((r) => (cellsOf(r).some((c) => c.uid === uid) ? { ...r, children: r.children.map((c) => (c.kind === "element" && c.uid === uid ? fn(c) : c)) } : r)),
  );
}

export const plainCell = (value: string) => element("Cell", {}, value ? [text(value)] : []);
