/**
 * Built-in components of the diagram format. This is metadata only (no
 * rendering): the viewer renders them, the editor builds its property panel
 * from them, and the validator checks files against them.
 */
import type { ElementNode } from "./ast";

export type PropType =
  | "number"
  | "string"
  | "boolean"
  | "enum"
  | "markdown"
  | "endpoint"
  | "points"
  | "numbers"
  | "strings"
  | "classes"
  | "variant"
  | "color";

export interface PropSpec {
  name: string;
  type: PropType;
  label?: string;
  options?: readonly string[];
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  description: string;
}

export type ComponentKind =
  /** The root `<Diagram>`. */
  | "root"
  /** Positioned element with x/y/w/h, selectable in the editor. */
  | "shape"
  /** Connector between shapes. */
  | "edge"
  /** Inline content inside a shape label (text formatting, math). */
  | "inline"
  /** Non-visual data such as explainer steps. */
  | "meta"
  /** Structural child of one element, e.g. <Row> and <Cell> in a <Table>. */
  | "part";

export interface ComponentSpec {
  name: string;
  kind: ComponentKind;
  description: string;
  props: PropSpec[];
  /** Shapes that can hold child shapes (positioned relative to it). */
  container?: boolean;
  /** Clicking a child selects the whole element first (like a group). */
  selectAsGroup?: boolean;
  /** Whether the element has a text label (its inline children). */
  label?: boolean;
  defaultSize?: [number, number];
  /** "part" components: the element they must be inside. */
  parent?: string;
}

const geometry: PropSpec[] = [
  { name: "id", type: "string", description: "Unique id, used by arrows (`from`/`to`), steps and links." },
  { name: "x", type: "number", description: "Left edge in px, relative to the parent shape." },
  { name: "y", type: "number", description: "Top edge in px, relative to the parent shape." },
  { name: "w", type: "number", min: 0, description: "Width in px." },
  { name: "h", type: "number", min: 0, description: "Height in px." },
  { name: "rotate", type: "number", step: 1, description: "Rotation in whole degrees around the center." },
];

const common: PropSpec[] = [
  { name: "variant", type: "variant", description: "Theme style: default, muted, outline, ghost, panel, a color (blue, orange, …) or panel-<color>." },
  { name: "className", type: "classes", description: "Tailwind classes. Override the variant, e.g. bg-red-100 font-semibold." },
  { name: "tip", type: "markdown", description: "Explanation shown on hover. Markdown with $LaTeX$." },
  { name: "link", type: "string", description: "URL, /lab/model page, or #diagram-file to open on click." },
];

export const SHAPES = [
  "rect",
  "ellipse",
  "trapezoid",
  "parallelogram",
  "diamond",
  "hexagon",
  "triangle",
  "cylinder",
  "document",
  "note",
  "callout",
  "arrow",
  "chevron",
  "octagon",
  "cross",
  "star",
  "cloud",
  "person",
] as const;
export type ShapeName = (typeof SHAPES)[number];

/** Shapes with an `inset` parameter: what it controls, its default and its maximum (fraction of the size). */
export const SHAPE_INSETS: Partial<Record<ShapeName, { label: string; default: number; max: number }>> = {
  trapezoid: { label: "Slant", default: 0.15, max: 0.5 },
  parallelogram: { label: "Slant", default: 0.15, max: 0.95 },
  hexagon: { label: "Slant", default: 0.15, max: 0.5 },
  arrow: { label: "Head", default: 0.35, max: 1 },
  chevron: { label: "Point", default: 0.25, max: 0.5 },
  octagon: { label: "Corner", default: 0.3, max: 0.5 },
  cross: { label: "Arm", default: 0.3, max: 0.5 },
};

/** Default `inset` of a shape. */
export function shapeInset(shape: string, inset: unknown): number {
  if (typeof inset === "number" && Number.isFinite(inset)) return inset;
  return SHAPE_INSETS[shape as ShapeName]?.default ?? 0.15;
}

export const SIDES = ["top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];

export const ARROW_HEADS = ["arrow", "open", "classic", "diamond", "circle", "bar", "none"] as const;
export type ArrowHead = (typeof ARROW_HEADS)[number];

export const ROUTES = ["orthogonal", "straight", "curved"] as const;
export type Route = (typeof ROUTES)[number];

export const PALETTE = [
  "gray",
  "slate",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;

/**
 * Neutral box styles. Everything colored uses a PALETTE name: `blue` (a
 * filled box) or `panel-blue` (a large light area). All of them adapt to the
 * light and dark diagram themes.
 */
export const BASE_VARIANTS = {
  default: { label: "Default", description: "White box, gray outline" },
  muted: { label: "Muted", description: "Light gray, for secondary elements" },
  outline: { label: "Outline", description: "No fill, default outline" },
  ghost: { label: "Ghost", description: "No fill, no outline (a plain label)" },
  panel: { label: "Panel", description: "Large light gray background area" },
} as const;

export const EDGE_VARIANTS = {
  default: "Default connection",
  muted: "Light gray connection",
} as const;

/**
 * Variant names of older files and what replaced them (the validator
 * suggests the replacement).
 */
export const RENAMED_VARIANTS: Record<string, string> = {
  attn: "orange", ffn: "sky", norm: "muted", embed: "pink", linear: "violet", act: "green", cond: "indigo",
  conv: "teal", pool: "cyan", latent: "amber", encoder: "blue", decoder: "emerald", router: "fuchsia",
  frozen: "slate", loss: "red", io: "stone", skip: "muted", grad: "red",
};

export const BOX_VARIANTS: string[] = [
  ...Object.keys(BASE_VARIANTS),
  ...PALETTE,
  ...PALETTE.map((c) => `panel-${c}`),
];

export const ARROW_VARIANTS: string[] = [...Object.keys(EDGE_VARIANTS), ...PALETTE];

/** Token color aliases understood by <Tokens>. */
export const TOKEN_KINDS: Record<string, string> = {
  text: "amber",
  image: "blue",
  pixel: "rose",
  audio: "green",
  video: "purple",
  latent: "emerald",
  noise: "gray",
  cond: "indigo",
};

const shapeVisual: PropSpec[] = [
  {
    name: "shape",
    type: "enum",
    options: SHAPES,
    default: "rect",
    description: "Outline shape. `arrow` and `chevron` point right (use `rotate` for other directions); `callout` has its tail at the bottom left; `person` shows its label below.",
  },
  {
    name: "narrow",
    type: "enum",
    options: SIDES,
    default: "top",
    description: "trapezoid only: the short side. Encoders narrow to the right, decoders to the left.",
  },
  {
    name: "inset",
    type: "number",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.15,
    description: "Fraction of the size: slant of trapezoid/parallelogram/hexagon (default 0.15), head length of arrow (0.35), point of chevron (0.25), corner cut of octagon (0.3), arm inset of cross (0.3).",
  },
];

export const COMPONENTS: Record<string, ComponentSpec> = {
  Diagram: {
    name: "Diagram",
    kind: "root",
    description: "Root element. Defines the page size and grid.",
    container: true,
    props: [
      { name: "width", type: "number", default: 1200, description: "Page width in px." },
      { name: "height", type: "number", default: 800, description: "Page height in px." },
      { name: "autoSize", type: "boolean", default: false, description: "The editor keeps the page fitted around the content (with `padding`), moving everything so it starts at the padding." },
      { name: "padding", type: "number", default: 24, min: 0, description: "Space around the content when autoSize is on." },
      { name: "grid", type: "number", default: 4, min: 1, description: "Grid size in px. Geometry should be a multiple of it." },
      { name: "title", type: "string", description: "Optional title, used as the title of exported SVG/PDF files." },
      { name: "background", type: "color", description: 'Page color, e.g. "#fafaf9" or "transparent". Default: the theme page color (white / near-black).' },
      { name: "className", type: "classes", description: "Classes for the page, e.g. font-serif text-[13px]." },
    ],
  },
  Box: {
    name: "Box",
    kind: "shape",
    description: "A shape with an optional label. Can contain other shapes.",
    container: true,
    label: true,
    defaultSize: [120, 40],
    props: [...geometry, ...shapeVisual, ...common],
  },
  Group: {
    name: "Group",
    kind: "shape",
    description: "Invisible container. Clicking a child selects the group first.",
    container: true,
    selectAsGroup: true,
    defaultSize: [200, 120],
    props: [...geometry, ...common],
  },
  Text: {
    name: "Text",
    kind: "shape",
    description: "Text without a box. Width and height are optional (auto-sized).",
    label: true,
    defaultSize: [80, 20],
    props: [
      ...geometry,
      ...common.filter((p) => p.name !== "variant"),
      { name: "variant", type: "enum", options: ["default", "title", "heading", "caption", "label", "math"], description: "Text style." },
    ],
  },
  Image: {
    name: "Image",
    kind: "shape",
    description: "Raster or vector image.",
    defaultSize: [160, 120],
    props: [
      ...geometry,
      { name: "src", type: "string", description: "Image URL or path relative to the diagram file." },
      { name: "alt", type: "string", description: "Alternative text." },
      { name: "fit", type: "enum", options: ["cover", "contain", "fill"], default: "cover", description: "How the image fills its box." },
      { name: "grid", type: "numbers", description: "[cols, rows]: draws patch grid lines over the image." },
      ...common.filter((p) => p.name !== "variant"),
    ],
  },
  Video: {
    name: "Video",
    kind: "shape",
    description: "Video clip. start/end trim the playback without changing the file.",
    defaultSize: [240, 136],
    props: [
      ...geometry,
      { name: "src", type: "string", description: "Video URL or path relative to the diagram file." },
      { name: "poster", type: "string", description: "Image shown before playback." },
      { name: "autoplay", type: "boolean", default: true, description: "Play automatically (muted videos only, by browser rules)." },
      { name: "muted", type: "boolean", default: true, description: "Mute the audio track." },
      { name: "loop", type: "boolean", default: true, description: "Loop between start and end." },
      { name: "controls", type: "boolean", default: false, description: "Show playback controls." },
      { name: "start", type: "number", min: 0, step: 0.1, description: "Start time in seconds." },
      { name: "end", type: "number", min: 0, step: 0.1, description: "End time in seconds." },
      { name: "fit", type: "enum", options: ["cover", "contain", "fill"], default: "cover", description: "How the video fills its box." },
      ...common.filter((p) => p.name !== "variant"),
    ],
  },
  Audio: {
    name: "Audio",
    kind: "shape",
    description: "Audio clip shown as a player with a waveform. Children are its title.",
    label: true,
    defaultSize: [240, 48],
    props: [
      ...geometry,
      { name: "src", type: "string", description: "Audio URL or path relative to the diagram file." },
      { name: "loop", type: "boolean", default: false, description: "Loop playback." },
      ...common,
    ],
  },
  Ink: {
    name: "Ink",
    kind: "shape",
    description: "Freehand pencil stroke drawn by a user (points relative to the element).",
    defaultSize: [40, 40],
    props: [
      ...geometry,
      { name: "points", type: "string", description: 'Stroke points "x y x y …" in px, relative to x/y. Scaled when w/h change.' },
      { name: "color", type: "color", default: "#e11d48", description: "Stroke color." },
      { name: "size", type: "number", default: 4, min: 1, max: 64, description: "Brush size in px." },
      ...common.filter((p) => p.name !== "variant"),
    ],
  },
  Arrow: {
    name: "Arrow",
    kind: "edge",
    description: "Connector between shapes. Children become its label.",
    label: true,
    props: [
      { name: "id", type: "string", description: "Optional id." },
      { name: "from", type: "endpoint", description: 'Source: "id" (floating), "id@top", "id@top:0.25", "id@bottom:72px", "id@0.5,1", "arrowId@0.5" (point along another arrow) or [x, y].' },
      { name: "to", type: "endpoint", description: "Target, same syntax as from." },
      { name: "via", type: "points", description: "Waypoints [[x, y], …] relative to the arrow's parent." },
      { name: "route", type: "enum", options: ROUTES, default: "orthogonal", description: "Routing style." },
      { name: "head", type: "enum", options: ARROW_HEADS, default: "arrow", description: "Marker at the target end." },
      { name: "tail", type: "enum", options: ARROW_HEADS, default: "none", description: "Marker at the source end." },
      { name: "dashed", type: "boolean", default: false, description: "Dashed line." },
      { name: "rounded", type: "number", default: 0, min: 0, description: "Corner radius of bends in px." },
      { name: "labelAt", type: "number", default: 0.5, min: 0, max: 1, step: 0.05, description: "Label position along the path (0–1)." },
      ...common,
    ],
  },
  Op: {
    name: "Op",
    kind: "shape",
    description: "Circular operator such as ⊕ (add), ⊗ (multiply), ⊙ (concat) or a letter badge.",
    defaultSize: [16, 16],
    props: [
      ...geometry,
      { name: "symbol", type: "string", default: "+", description: '"+", "x", "concat", "dot", "sigma" or any short text like "c".' },
      ...common,
    ],
  },
  Tokens: {
    name: "Tokens",
    kind: "shape",
    description: "A row of token squares, e.g. text and image tokens.",
    defaultSize: [160, 16],
    props: [
      ...geometry,
      {
        name: "segments",
        type: "strings",
        default: ["text:4", "...", "image:4"],
        description: 'Segments: "kind:count" (kind = text|image|pixel|audio|video|latent|noise|cond or a color), "..." (ellipsis), "concat", "+".',
      },
      { name: "vertical", type: "boolean", default: false, description: "Stack tokens vertically." },
      ...common,
    ],
  },
  Cuboid: {
    name: "Cuboid",
    kind: "shape",
    description: "Pseudo-3D block for tensors and conv feature maps. w/h is the full bounding box, the front face is (w - depth) × (h - 0.75·depth).",
    label: true,
    defaultSize: [40, 80],
    props: [
      ...geometry,
      { name: "depth", type: "number", default: 24, min: 0, description: "Depth of the oblique faces in px." },
      { name: "side", type: "enum", options: ["right", "left"], default: "right", description: "Side the depth recedes to: right (top and right faces visible) or left (top and left faces visible, as in the DCGAN figure)." },
      ...common,
    ],
  },
  Neurons: {
    name: "Neurons",
    kind: "shape",
    description: "Fully connected network drawn as layers of circles.",
    defaultSize: [160, 120],
    props: [
      ...geometry,
      { name: "layers", type: "numbers", default: [3, 4, 2], description: "Neurons per layer, left to right." },
      { name: "connect", type: "enum", options: ["dense", "none"], default: "dense", description: "Connections between layers." },
      ...common,
    ],
  },
  Icon: {
    name: "Icon",
    kind: "shape",
    description: "Line icon from the Lucide set (https://lucide.dev/icons), e.g. cpu, gpu, database, brain, flame, snowflake, file-text, image, audio-waveform. Drawn in the text color; a color variant tints it.",
    defaultSize: [24, 24],
    props: [
      ...geometry,
      { name: "name", type: "string", default: "box", description: 'Lucide icon name in kebab-case, e.g. "cpu", "brain-circuit", "scan-face".' },
      { name: "strokeWidth", type: "number", default: 2, min: 0.25, max: 4, step: 0.25, description: "Line width in icon units (the icon is 24 units wide)." },
      ...common,
    ],
  },
  Table: {
    name: "Table",
    kind: "shape",
    description: "Grid of cells: tables, matrices (e.g. a similarity matrix), embedding rows and heatmaps. Children are <Row> elements holding <Cell> elements.",
    defaultSize: [240, 96],
    props: [
      ...geometry,
      { name: "cols", type: "numbers", description: "Column widths in px (default: equal widths that fill w)." },
      { name: "rows", type: "numbers", description: "Row heights in px (default: equal heights that fill h)." },
      { name: "header", type: "boolean", default: false, description: "The first row is a header row (bold, tinted)." },
      { name: "lines", type: "enum", options: ["all", "rows", "none"], default: "all", description: "Inner grid lines: all, between rows only (a booktabs-style table), or none." },
      ...common,
    ],
  },
  Row: {
    name: "Row",
    kind: "part",
    parent: "Table",
    description: "A table row. Children are <Cell> elements.",
    props: [
      { name: "variant", type: "variant", description: "Fill of every cell in the row (a color name)." },
      { name: "className", type: "classes", description: "Tailwind classes for every cell in the row." },
    ],
  },
  Cell: {
    name: "Cell",
    kind: "part",
    parent: "Row",
    label: true,
    description: "A table cell. Children are its label.",
    props: [
      { name: "variant", type: "variant", description: "Cell fill: a color name (blue, orange, …) or muted." },
      { name: "className", type: "classes", description: "Tailwind classes, e.g. bg-blue-300 font-semibold text-left." },
      { name: "span", type: "number", default: 1, min: 1, description: "Number of columns the cell spans." },
    ],
  },
  Brace: {
    name: "Brace",
    kind: "shape",
    description: "Curly brace spanning its box, for ×N annotations.",
    defaultSize: [12, 80],
    props: [
      ...geometry,
      { name: "side", type: "enum", options: SIDES, default: "right", description: "Side the brace tip points to." },
      ...common.filter((p) => p.name !== "variant"),
    ],
  },
  Math: {
    name: "Math",
    kind: "inline",
    description: "LaTeX formula rendered with KaTeX, inside any label.",
    props: [
      { name: "tex", type: "string", description: "LaTeX source." },
      { name: "display", type: "boolean", default: false, description: "Display (block) style." },
    ],
  },
  Steps: {
    name: "Steps",
    kind: "meta",
    description: "Explainer walk-through. Contains <Step> elements.",
    props: [],
  },
  Step: {
    name: "Step",
    kind: "meta",
    description: "One explainer step: highlights elements and shows markdown text.",
    props: [
      { name: "title", type: "string", description: "Step title." },
      { name: "focus", type: "string", description: "Space-separated ids to highlight. Everything else is dimmed." },
    ],
  },
};

/** HTML tags allowed inside labels. */
export const INLINE_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "sub",
  "sup",
  "br",
  "span",
  "code",
  "small",
  "mark",
  "p",
  "div",
  "ul",
  "ol",
  "li",
]);

export function getSpec(name: string): ComponentSpec | undefined {
  return COMPONENTS[name];
}

export function isShape(node: ElementNode): boolean {
  return COMPONENTS[node.name]?.kind === "shape";
}

export function isEdge(node: ElementNode): boolean {
  return COMPONENTS[node.name]?.kind === "edge";
}

/** Inline label content: text formatting tags and <Math>. */
export function isInline(node: ElementNode): boolean {
  return INLINE_TAGS.has(node.name) || COMPONENTS[node.name]?.kind === "inline";
}

export function isMeta(node: ElementNode): boolean {
  return COMPONENTS[node.name]?.kind === "meta";
}

/** Structural children such as table rows and cells. */
export function isPart(node: ElementNode): boolean {
  return COMPONENTS[node.name]?.kind === "part";
}
