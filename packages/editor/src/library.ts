/**
 * Shape library shown in the sidebar. Every item is plain diagram JSX with
 * coordinates relative to (0, 0); inserting it expands it into ordinary
 * editable elements (nothing is locked into a composite component).
 *
 * The built-in sections are general purpose. Apps add their own sections
 * (domain shapes, ready-made blocks) with the editor's `libraries` prop.
 */

export interface LibraryItem {
  id: string;
  label: string;
  /** Extra search terms. */
  keywords?: string;
  snippet: string;
  /**
   * Media files the snippet references by relative path, mapped to where
   * the editor can fetch them: `{ "dog.webp": "/media/dog.webp" }`. Inserting
   * the item copies them into the diagram, so they are saved next to it.
   */
  assets?: Record<string, string>;
}

export interface LibrarySection {
  id: string;
  title: string;
  /** "large" shows two tiles per row (for blocks made of several shapes). Default: four per row. */
  size?: "small" | "large";
  items: LibraryItem[];
}

/** Shorthand for library items: `libraryItem("box", "Box", "<Box … />", "rectangle")`. */
export const libraryItem = (id: string, label: string, snippet: string, keywords = "", assets?: Record<string, string>): LibraryItem => ({
  id,
  label,
  snippet: snippet.trim(),
  keywords,
  ...(assets ? { assets } : {}),
});
const item = libraryItem;

const box = (shape: string, w: number, h: number, label = "", extra = "") =>
  `<Box x={0} y={0} w={${w}} h={${h}}${shape === "rect" ? "" : ` shape="${shape}"`}${extra}${label ? `>${label}</Box>` : " />"}`;

export const SHAPES_SECTION: LibrarySection = {
  id: "shapes",
  title: "Shapes",
  items: [
    item("box", "Rectangle", box("rect", 120, 48, "Rectangle"), "box"),
    item("rounded", "Rounded rectangle", box("rect", 120, 48, "Rounded", ' className="rounded-xl"'), "box"),
    item("pill", "Pill", box("rect", 120, 40, "Pill", ' className="rounded-full"'), "stadium terminal start end"),
    item("text", "Text", `<Text x={0} y={0}>Text</Text>`, "label"),
    item("heading", "Heading", `<Text x={0} y={0} variant="heading">Heading</Text>`, "title"),
    item("title", "Title", `<Text x={0} y={0} variant="title">Title</Text>`),
    item("caption", "Caption", `<Text x={0} y={0} variant="caption">Fig. 1 — Overview</Text>`, "label mono"),
    item("label", "Small label", `<Text x={0} y={0} variant="label">label</Text>`, "annotation"),
    item("ellipse", "Ellipse", box("ellipse", 120, 64, "Ellipse"), "oval"),
    item("circle", "Circle", box("ellipse", 64, 64), "round"),
    item("diamond", "Diamond", box("diamond", 96, 64, "?"), "decision rhombus"),
    item("triangle", "Triangle", box("triangle", 64, 56)),
    item("hexagon", "Hexagon", box("hexagon", 112, 56, "Hexagon"), "preparation"),
    item("octagon", "Octagon", box("octagon", 64, 64), "stop"),
    item("parallelogram", "Parallelogram", box("parallelogram", 120, 48, "Data"), "input output io"),
    item("trapezoid", "Trapezoid", box("trapezoid", 120, 48, "Trapezoid"), "manual"),
    item("trap-right", "Narrowing trapezoid", box("trapezoid", 64, 120, "", ' narrow="right" inset={0.25}'), "encoder funnel compress"),
    item("trap-left", "Widening trapezoid", box("trapezoid", 64, 120, "", ' narrow="left" inset={0.25}'), "decoder expand"),
    item("cylinder", "Cylinder", box("cylinder", 72, 88, "Store"), "database storage"),
    item("document", "Document", box("document", 104, 64, "Document"), "file page"),
    item("note", "Note", box("note", 104, 72, "Note"), "sticky memo comment"),
    item("callout", "Speech bubble", box("callout", 120, 72, "Hello!"), "callout comment"),
    item("block-arrow", "Block arrow", box("arrow", 112, 48), "direction next"),
    item("chevron", "Chevron", box("chevron", 104, 48, "Step"), "process step"),
    item("star", "Star", box("star", 64, 64), "favorite rating"),
    item("cross", "Cross", box("cross", 56, 56), "plus add"),
    item("cloud", "Cloud", box("cloud", 128, 80, "Cloud"), "internet network"),
    item("person", "Person", box("person", 40, 48, "User"), "actor user human"),
    item("cuboid", "3D box", `<Cuboid x={0} y={0} w={88} h={72} depth={24} />`, "cube block tensor 2.5d"),
    item("panel", "Container", `<Box x={0} y={0} w={240} h={160} variant="panel">Container</Box>`, "panel group frame"),
    item("panel-blue", "Colored container", `<Box x={0} y={0} w={240} h={160} variant="panel-blue">Container</Box>`, "panel group frame"),
    item("image", "Image", `<Image x={0} y={0} w={120} h={88} src="" />`, "picture photo"),
    item(
      "table",
      "Table",
      `<Table x={0} y={0} w={192} h={72} header>
  <Row><Cell>Name</Cell><Cell>Value</Cell></Row>
  <Row><Cell>a</Cell><Cell>1</Cell></Row>
  <Row><Cell>b</Cell><Cell>2</Cell></Row>
</Table>`,
      "grid matrix rows columns cells",
    ),
  ],
};

export const CONNECT_SECTION: LibrarySection = {
  id: "connect",
  title: "Connect & annotate",
  items: [
    item("arrow", "Arrow", `<Arrow from={[0, 16]} to={[96, 16]} />`, "line connector"),
    item("arrow-dashed", "Dashed arrow", `<Arrow from={[0, 16]} to={[96, 16]} dashed />`, "line connector"),
    item("arrow-both", "Double arrow", `<Arrow from={[0, 16]} to={[96, 16]} tail="arrow" />`, "line connector bidirectional"),
    item("line", "Line", `<Arrow from={[0, 16]} to={[96, 16]} head="none" />`, "connector"),
    item("elbow", "Elbow arrow", `<Arrow from={[0, 0]} to={[96, 40]} />`, "orthogonal connector"),
    item("curved", "Curved arrow", `<Arrow from={[0, 40]} to={[96, 0]} route="curved" />`, "bezier connector"),
    item("open-arrow", "Open arrow", `<Arrow from={[0, 16]} to={[96, 16]} head="open" />`, "line connector"),
    item("diamond-arrow", "Diamond end", `<Arrow from={[0, 16]} to={[96, 16]} head="diamond" />`, "aggregation uml"),
    item("op-add", "Add ⊕", `<Op x={0} y={0} w={16} h={16} symbol="+" />`, "plus sum operator"),
    item("op-mul", "Multiply ⊗", `<Op x={0} y={0} w={16} h={16} symbol="x" />`, "times product operator"),
    item("op-concat", "Concat", `<Op x={0} y={0} w={16} h={16} symbol="concat" />`, "concatenate join operator"),
    item("op-letter", "Letter badge", `<Op x={0} y={0} w={16} h={16} symbol="c" variant="indigo" />`, "badge symbol"),
    item("badge", "Number badge", `<Op x={0} y={0} w={20} h={20} symbol="1" variant="blue" />`, "step marker count"),
    item("brace", "Brace", `<Brace x={0} y={0} w={12} h={88} side="right" />`, "curly bracket group"),
    item("repeat", "×N label", `<Text x={0} y={0} variant="label">×N</Text>`, "repeat times"),
    item("math", "Math symbol", `<Text x={0} y={0} variant="math">x</Text>`, "variable latex"),
    item("formula", "Formula", `<Text x={0} y={0}><Math tex="E = mc^2" /></Text>`, "latex math equation"),
  ],
};

/** The editor's default sidebar sections. */
export const DEFAULT_LIBRARY: LibrarySection[] = [SHAPES_SECTION, CONNECT_SECTION];
