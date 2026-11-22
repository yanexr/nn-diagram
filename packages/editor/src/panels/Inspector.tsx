/**
 * Right panel: Position, Layout, Appearance, Fill,
 * Stroke and Typography sections with scrubbable fields. Everything is
 * written as theme variants, props or Tailwind classes, so the file stays
 * readable for people and LLMs.
 */

import { Button } from "@nn-diagram/ui/button";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  ArrowDown,
  ArrowUp,
  Baseline,
  Check,
  CornerUpRight,
  Grid3x3,
  Group as GroupIcon,
  Link2,
  Link2Off,
  Maximize2,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Plus,
  RotateCw,
  Scan,
  SquareRoundCorner,
  Sun,
  Moon,
  Type,
  Ungroup,
} from "lucide-react";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { addColumn, addRow, cellGrid, removeColumn, removeRow, tableSize, updateCell } from "../table";
import {
  ARROW_HEADS,
  EDGE_VARIANTS,
  PALETTE,
  BASE_VARIANTS,
  SHAPES,
  SHAPE_INSETS,
  shapeInset,
  type ShapeName,
  SIDES,
  findNode,
  getSpec,
  isEdge,
  isShape,
  labelSource,
  parseLabelSource,
  updateNodes,
  walk,
  withProps,
  type ChildNode,
  type ElementNode,
  type Value,
} from "@nn-diagram/format";
import { IconButton, PAGE_COLORS, Tip, cn, cx, labelChildren, labelText, normalizeColor, shapeClasses,
  WEB_FONTS,
} from "@nn-diagram/viewer";
import { THEME_COLOR_VAR, colorClass, colorOf, getClass, pxOf, setClass, type ClassGroup } from "../classes";
import { contentBounds, fittedPageRect, groupSelection, reorder, setPageRect, ungroup } from "../commands";
import { useEd, useEditorContext } from "../context";
import {
  ColorRow,
  Grid2,
  IconGroup,
  Label,
  ScrubField,
  Section,
  Segmented,
  Select,
  SmallButton,
  TextArea,
  TextField,
  Toggle,
  cssColor,
  useThemeColors,
  toHex,
  useDocumentColors,
  type ColorValue,
  type ThemeColors,
  PanelScroll,
} from "./controls";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const round = (n: number, p = 100) => Math.round(n * p) / p;

/** Stroke weight: three lines of growing thickness. Lucide has no such icon. */
const StrokeWeight = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round">
    <path d="M4 5h16" strokeWidth={1.25} />
    <path d="M4 11h16" strokeWidth={2.25} />
    <path d="M4 18h16" strokeWidth={3.5} />
  </svg>
);

function useSelected(selection: string[]): ElementNode[] {
  const doc = useEd((s) => s.doc);
  return useMemo(() => {
    if (!selection.length) return [];
    if (selection.length === 1) {
      const node = findNode(doc, selection[0])?.node;
      return node ? [node] : [];
    }
    const wanted = new Set(selection);
    const found = new Map<string, ElementNode>();
    walk(doc, (node) => { if (wanted.has(node.uid)) found.set(node.uid, node); });
    return selection.map((uid) => found.get(uid)).filter((n): n is ElementNode => !!n);
  }, [doc, selection]);
}

/** Applies an update to the given (or all selected) nodes as one undo step. */
function useUpdate() {
  const { api } = useEditorContext();
  return (fn: (n: ElementNode) => ElementNode, merge?: string, nodes?: ElementNode[]) => {
    const s = api.store.getState();
    const targets = nodes ?? [];
    if (!nodes) {
      const selected = new Set(s.selection);
      walk(s.doc, (node) => { if (selected.has(node.uid)) targets.push(node); });
    }
    const map = new Map(targets.map((n) => [n.uid, fn] as const));
    s.commit(updateNodes(s.doc, map), merge ? { merge } : undefined);
  };
}

/** Step for scrubbing positions and sizes: the grid while snapping is on. */
function useGridStep(): number {
  const snap = useEd((s) => s.snapToGrid);
  const grid = useEd((s) => (typeof s.doc.props.grid === "number" ? s.doc.props.grid : 4));
  return snap ? grid : 1;
}

function common<T>(nodes: ElementNode[], get: (n: ElementNode) => T): T | null {
  if (nodes.length === 0) return null;
  const first = get(nodes[0]);
  return nodes.every((n) => get(n) === first) ? first : null;
}

function useClassSetter(nodes: ElementNode[]) {
  const update = useUpdate();
  return (group: ClassGroup, value: string | null, merge?: string) =>
    update(
      (n) => {
        const next = setClass(str(n.props.className), group, value);
        return withProps(n, { className: next || undefined });
      },
      merge,
      nodes,
    );
}

const classOf = (n: ElementNode, group: ClassGroup) => getClass(str(n.props.className), group);

const DocumentColorsContext = createContext<string[]>([]);
const NodeThemeColorsContext = createContext<ThemeColors | null>(null);
const useDocColors = () => useContext(DocumentColorsContext);

function useDocumentPalette(): string[] {
  const doc = useEd((s) => s.doc);
  const classes = useMemo(() => {
    const out: string[] = [];
    walk(doc, (n) => {
      if (typeof n.props.className === "string") out.push(n.props.className);
    });
    return out;
  }, [doc]);
  return useDocumentColors(classes);
}

// ------------------------------------------------------------------- root

export function Inspector() {
  const selection = useEd((s) => s.selection.length === 1 ? s.marqueeInspectorSelection ?? s.selection : s.selection);
  const selected = useSelected(selection);
  const tool = useEd((s) => s.tool);
  const theme = useEd((s) => s.theme);
  const documentColors = useDocumentPalette();
  const node = selected[0];
  // Fill, Stroke and Typography share the same theme sample. Keep this above
  // the conditional sections rather than probing in each section separately.
  const classes = node && isShape(node) ? shapeClasses(withProps(node, { className: undefined })) : "";
  const themeColors = useThemeColors(classes, theme);
  return (
    <DocumentColorsContext.Provider value={documentColors}>
      <NodeThemeColorsContext.Provider value={themeColors}>
        <PanelScroll className="h-full text-sm">
          <div className="flex flex-col">
            {tool === "pencil" && <PencilSection />}
            {selected.length === 0 ? <DiagramProps /> : <SelectionProps nodes={selected} />}
          </div>
        </PanelScroll>
      </NodeThemeColorsContext.Provider>
    </DocumentColorsContext.Provider>
  );
}

// ----------------------------------------------------------------- pencil

function PencilSection() {
  const { api } = useEditorContext();
  const pen = useEd((s) => s.pen);
  const docColors = useDocColors();
  const set = (patch: Partial<typeof pen>) => api.store.getState().set({ pen: { ...pen, ...patch } });
  return (
    <Section title="Pencil">
      <ColorRow value={hexAlpha(pen.color)} tip="Brush" onChange={(v) => set({ color: v ? toHexAlpha(v) : "#e11d48" })} documentColors={docColors} allowNone={false} placeholder="Default" />
      <ScrubField icon={<Maximize2 />} tip="Brush size" value={pen.size} min={1} max={64} suffix="px" onChange={(v) => set({ size: Math.round(v) })} />
    </Section>
  );
}

// ---------------------------------------------------------------- diagram

function DiagramProps() {
  const { api, actions } = useEditorContext();
  const doc = useEd((s) => s.doc);
  const file = useEd((s) => s.file);
  const theme = useEd((s) => s.theme);
  const showGrid = useEd((s) => s.showGrid);
  const snap = useEd((s) => s.snapToGrid);
  const docColors = useDocColors();
  const gridStep = useGridStep();
  const set = (patch: Record<string, Value | undefined>, merge?: string) => {
    const s = api.store.getState();
    s.commit(withProps(s.doc, patch), merge ? { merge } : undefined);
  };
  const { layout, routes } = useEditorContext();
  const fitPageOnce = () => {
    if (!layout) return;
    const content = contentBounds(layout, routes.values());
    if (!content) return;
    const s = api.store.getState();
    const rect = fittedPageRect(content, layout.grid, num(doc.props.padding) ?? 24);
    const vp = s.viewport;
    s.commit(setPageRect(s.doc, rect));
    s.set({ viewport: { ...vp, x: vp.x + rect.x * vp.zoom, y: vp.y + rect.y * vp.zoom } });
  };
  const bg = str(doc.props.background);
  const bgValue: ColorValue | null = bg ? (bg === "transparent" ? { token: "transparent", alpha: 100 } : hexAlpha(bg)) : null;
  return (
    <>
      <Section title="File">
        <TextField value={file.name.replace(/\.diagram\.jsx$/, "")} onChange={(v) => actions.rename(v)} placeholder="untitled" />
        <div className="truncate text-[11px] text-muted-foreground">
          {file.folder ? `In folder “${file.folder.name}”` : file.handle ? "Linked to a file on disk" : file.url ? "Opened from the website" : "Not saved yet"}
        </div>
      </Section>
      <Section title="Page">
        <Grid2>
          <ScrubField icon="W" scrubStep={gridStep} tip="Page width" value={num(doc.props.width) ?? 1200} min={40} onChange={(v) => set({ width: Math.round(v) }, "page-w")} />
          <ScrubField icon="H" scrubStep={gridStep} tip="Page height" value={num(doc.props.height) ?? 800} min={40} onChange={(v) => set({ height: Math.round(v) }, "page-h")} />
        </Grid2>
        <Toggle
          checked={doc.props.autoSize === true}
          onChange={(v) => set({ autoSize: v || undefined })}
          label="Auto size (fit to content)"
        />
        {doc.props.autoSize === true ? (
          <ScrubField icon={<Maximize2 />} tip="Padding around the content" value={num(doc.props.padding) ?? 24} min={0} max={400} suffix="px" onChange={(v) => set({ padding: Math.round(v) === 24 ? undefined : Math.round(v) }, "page-pad")} />
        ) : (
          <Button variant="outline" size="xs" className="w-full" onClick={() => fitPageOnce()}>
            <Scan data-icon="inline-start" /> Fit page to content
          </Button>
        )}
        <ScrubField icon={<Grid3x3 />} tip="Grid size" value={num(doc.props.grid) ?? 4} min={1} max={100} suffix="px" onChange={(v) => set({ grid: Math.round(v) }, "page-grid")} />
        <div>
          <Label>Background</Label>
          <ColorRow
            value={bgValue}
            placeholder="Theme"
            tip="Background"
            themeColor={PAGE_COLORS[theme]}
            documentColors={docColors}
            onChange={(v) =>
              set({ background: !v ? undefined : v.token === "transparent" ? "transparent" : v.token === "theme" ? toHexAlpha({ token: PAGE_COLORS[theme], alpha: v.alpha }) : toHexAlpha(v) })
            }
          />
        </div>
      </Section>
      <Section title="Diagram theme">
        <Segmented
          value={theme}
          options={[
            { value: "light", label: (<span className="flex items-center gap-1.5"><Sun /> Light</span>) },
            { value: "dark", label: (<span className="flex items-center gap-1.5"><Moon /> Dark</span>) },
          ]}
          onChange={(v) => api.store.getState().set({ theme: v })}
        />
        <Toggle checked={showGrid} onChange={(v) => api.store.getState().set({ showGrid: v })} label="Show grid" />
        <Toggle checked={snap} onChange={(v) => api.store.getState().set({ snapToGrid: v })} label="Snap to grid (Alt bypasses)" />
      </Section>
      <Section title="Page classes">
        <TextField mono value={str(doc.props.className)} onChange={(v) => set({ className: v.trim() || undefined })} placeholder="e.g. font-serif" />
      </Section>
    </>
  );
}

function hexAlpha(css: string): ColorValue {
  const c = normalizeColor(css);
  return { token: c.value === "none" ? "#000000" : c.value, alpha: Math.round(c.alpha * 100) };
}

function toHexAlpha(v: ColorValue): string {
  const hex = toHex(v.token);
  return v.alpha >= 100 ? hex : `${hex}${Math.round((v.alpha / 100) * 255).toString(16).padStart(2, "0")}`;
}

// -------------------------------------------------------------- selection

const TYPE_LABEL: Record<string, string> = {
  Box: "Box",
  Group: "Group",
  Text: "Text",
  Image: "Image",
  Video: "Video",
  Audio: "Audio",
  Ink: "Drawing",
  Arrow: "Arrow",
  Op: "Operator",
  Tokens: "Tokens",
  Cuboid: "Cuboid",
  Neurons: "Neurons",
  Brace: "Brace",
  Icon: "Icon",
  Table: "Table",
};

const LABELED = new Set(["Box", "Text", "Cuboid", "Audio"]);
const FILLABLE = new Set(["Box", "Op", "Cuboid", "Neurons", "Audio", "Text", "Table"]);
const STROKABLE = new Set(["Box", "Op", "Cuboid", "Neurons", "Audio", "Image", "Video", "Table"]);
const ROUNDABLE = new Set(["Box", "Image", "Video", "Audio", "Table"]);
const VARIANTS = new Set(["Box", "Op", "Cuboid", "Neurons", "Audio", "Icon", "Table"]);

function SelectionProps({ nodes }: { nodes: ElementNode[] }) {
  const { api, layout } = useEditorContext();
  const update = useUpdate();
  const single = nodes.length === 1 ? nodes[0] : null;
  const shapes = nodes.filter(isShape);
  const edges = nodes.filter(isEdge);
  const title = single ? (TYPE_LABEL[single.name] ?? single.name) : `${nodes.length} selected`;
  const run = (fn: (doc: ElementNode) => ElementNode | { doc: ElementNode; uids: string[] }) => {
    const s = api.store.getState();
    const res = fn(s.doc);
    if ("kind" in res) s.commit(res);
    else s.commit(res.doc, { selection: res.uids });
  };
  const all = (names: Set<string>) => shapes.length > 0 && shapes.every((n) => names.has(n.name));
  const isRectBox = (n: ElementNode) => n.name !== "Box" || !n.props.shape || n.props.shape === "rect";

  return (
    <>
      <div className="flex items-center gap-1 border-b border-border py-3 pr-3 pl-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          {single && <div className="truncate text-[11px] text-muted-foreground">{labelText(single) || str(single.props.id) || "—"}</div>}
          {!single && shapes.length > 0 && edges.length > 0 && (
            <div className="truncate text-[11px] text-muted-foreground">
              {shapes.length} {shapes.length === 1 ? "shape" : "shapes"}, {edges.length} {edges.length === 1 ? "arrow" : "arrows"}
            </div>
          )}
        </div>
        <SmallButton tip="Bring to front (Ctrl+Shift+F)" onClick={() => run((d) => reorder(d, api.store.getState().selection, "front"))}>
          <ArrowUpToLine />
        </SmallButton>
        <SmallButton tip="Send to back (Ctrl+Shift+B)" onClick={() => run((d) => reorder(d, api.store.getState().selection, "back"))}>
          <ArrowDownToLine />
        </SmallButton>
        {nodes.length > 1 && layout && (
          <SmallButton tip="Group (Ctrl+G)" onClick={() => run((d) => groupSelection(d, layout, api.store.getState().selection))}>
            <GroupIcon />
          </SmallButton>
        )}
        {single?.name === "Group" && layout && (
          <SmallButton tip="Ungroup (Ctrl+Shift+U)" onClick={() => run((d) => ungroup(d, layout, api.store.getState().selection))}>
            <Ungroup />
          </SmallButton>
        )}
      </div>

      {single && (
        <div className="border-b border-border px-4 py-3">
          <Tip label="Id, used by arrows and links" side="left" delay={500}>
            <div className="flex items-center gap-2">
              <span className="w-6 text-[11px] text-muted-foreground">Id</span>
              <TextField
                mono
                value={str(single.props.id)}
                placeholder="none"
                onChange={(v) => {
                  const id = v.trim().replace(/\s+/g, "-");
                  update((n) => withProps(n, { id: id || undefined }));
                }}
              />
            </div>
          </Tip>
        </div>
      )}

      {shapes.length > 0 && <PositionSection nodes={shapes} />}
      {single && getSpec(single.name)?.label && <TextContentSection node={single} />}
      {single && isShape(single) && <LayoutSection node={single} />}
      {shapes.length > 0 && edges.length === 0 && (
        <AppearanceSection nodes={shapes} rounded={shapes.every((n) => ROUNDABLE.has(n.name) && isRectBox(n))} />
      )}
      {all(VARIANTS) && edges.length === 0 && <ThemeSection nodes={shapes} />}
      {all(FILLABLE) && edges.length === 0 && <FillSection nodes={shapes} />}
      {all(STROKABLE) && edges.length === 0 && <StrokeSection nodes={shapes} />}
      {shapes.some((n) => LABELED.has(n.name) || getSpec(n.name)?.label) && edges.length === 0 && <TypographySection nodes={shapes} />}
      {single?.name === "Box" && <ShapeSection node={single} />}
      {single && <ComponentSection node={single} />}
      {edges.length > 0 && shapes.length === 0 && <EdgeSection nodes={edges} />}
      {single && <ExplainSection node={single} />}
      {single && <AdvancedSection node={single} />}
    </>
  );
}

// ------------------------------------------------------------------ text

/**
 * The label as editable source: plain text with $LaTeX$ (braces as is),
 * inline tags and newlines for line breaks. Updates live while it parses.
 */
function TextContentSection({ node }: { node: ElementNode }) {
  const { api } = useEditorContext();
  const source = useMemo(() => labelSource(labelChildren(node)), [node]);
  const [text, setText] = useState(source);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const [previousSource, setPreviousSource] = useState(source);
  if (previousSource !== source) {
    setPreviousSource(source);
    if (!focused.current) {
      setText(source);
      setError(null);
    }
  }
  const apply = (value: string) => {
    let children: ChildNode[];
    try {
      children = parseLabelSource(value);
    } catch (err) {
      setError((err as Error).message.split("\n")[0]);
      return;
    }
    setError(null);
    const s = api.store.getState();
    const found = findNode(s.doc, node.uid);
    if (!found) return;
    const label = new Set(labelChildren(found.node));
    const rest = found.node.children.filter((c) => !label.has(c));
    s.commit(updateNodes(s.doc, new Map([[node.uid, (n: ElementNode) => ({ ...n, children: [...children, ...rest] })]])), { merge: `label-${node.uid}` });
  };
  return (
    <Section title="Text">
      <textarea
        className="min-h-14 w-full resize-y rounded-md border border-transparent bg-muted/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed outline-none hover:border-border focus:border-[var(--nnd-accent,#0d99ff)] focus:bg-background"
        rows={Math.min(8, Math.max(2, text.split("\n").length + 1))}
        value={text}
        placeholder="Label text, $\LaTeX$ formulas, <b>, <sub>…"
        spellCheck={false}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(source);
          setError(null);
        }}
        onChange={(e) => {
          setText(e.target.value);
          apply(e.target.value);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </Section>
  );
}

// --------------------------------------------------------------- position

function PositionSection({ nodes }: { nodes: ElementNode[] }) {
  const { api, actions, layout } = useEditorContext();
  const gridStep = useGridStep();
  const update = useUpdate();
  const single = nodes.length === 1 ? nodes[0] : null;
  const alignTo = (how: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    if (!single) return actions.align(how);
    // A single element aligns to its parent (or the page).
    const s = api.store.getState();
    const parentUid = layout?.parents.get(single.uid) ?? null;
    const parent = parentUid ? layout?.shapes.get(parentUid)?.bounds : null;
    const pw = parent ? parent.w : (num(s.doc.props.width) ?? 1200);
    const ph = parent ? parent.h : (num(s.doc.props.height) ?? 800);
    const b = layout?.shapes.get(single.uid)?.bounds;
    if (!b) return;
    const g = layout?.grid ?? 4;
    const snap = (v: number) => Math.round(v / g) * g;
    const patch: Record<string, number> = {};
    if (how === "left") patch.x = 0;
    if (how === "center") patch.x = snap((pw - b.w) / 2);
    if (how === "right") patch.x = pw - b.w;
    if (how === "top") patch.y = 0;
    if (how === "middle") patch.y = snap((ph - b.h) / 2);
    if (how === "bottom") patch.y = ph - b.h;
    update((n) => withProps(n, patch), undefined, [single]);
  };
  const rotate = common(nodes, (n) => num(n.props.rotate) ?? 0);
  return (
    <Section title="Position">
      <div className="flex gap-1.5">
        <div className="flex-1">
          <IconGroup
            value={null}
            onChange={alignTo}
            options={[
              { value: "left", icon: <AlignStartVertical />, tip: single ? "Align left (in parent)" : "Align left" },
              { value: "center", icon: <AlignCenterVertical />, tip: "Align horizontal centers" },
              { value: "right", icon: <AlignEndVertical />, tip: "Align right" },
            ]}
          />
        </div>
        <div className="flex-1">
          <IconGroup
            value={null}
            onChange={alignTo}
            options={[
              { value: "top", icon: <AlignStartHorizontal />, tip: "Align top" },
              { value: "middle", icon: <AlignCenterHorizontal />, tip: "Align vertical centers" },
              { value: "bottom", icon: <AlignEndHorizontal />, tip: "Align bottom" },
            ]}
          />
        </div>
      </div>
      {nodes.length > 2 && (
        <IconGroup
          value={null}
          onChange={(v) => actions.distribute(v)}
          options={[
            { value: "h", icon: <AlignHorizontalDistributeCenter />, tip: "Distribute horizontal spacing" },
            { value: "v", icon: <AlignVerticalDistributeCenter />, tip: "Distribute vertical spacing" },
          ]}
        />
      )}
      {single && (
        <Grid2>
          <ScrubField icon="X" scrubStep={gridStep} tip="X position (relative to the parent)" value={num(single.props.x)} onChange={(v) => update((n) => withProps(n, { x: round(v) }), "pos-x")} />
          <ScrubField icon="Y" scrubStep={gridStep} tip="Y position (relative to the parent)" value={num(single.props.y)} onChange={(v) => update((n) => withProps(n, { y: round(v) }), "pos-y")} />
        </Grid2>
      )}
      <div className="flex items-center gap-1.5">
        <ScrubField
          className="flex-1"
          icon={<RotateCw />}
          tip="Rotation"
          suffix="°"
          precision={0}
          value={rotate}
          placeholder="Mixed"
          onChange={(v) => {
            const deg = ((Math.round(v) % 360) + 540) % 360 - 180;
            update((n) => withProps(n, { rotate: deg === 0 || deg === -180 ? (deg === 0 ? undefined : 180) : deg }), "rotate");
          }}
        />
        <SmallButton tip="Rotate 90° (Ctrl+R)" onClick={actions.rotate90}>
          <CornerUpRight />
        </SmallButton>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------- layout

function LayoutSection({ node }: { node: ElementNode }) {
  const update = useUpdate();
  const gridStep = useGridStep();
  const { layout } = useEditorContext();
  const [lock, setLock] = useState(false);
  const measured = layout?.shapes.get(node.uid)?.bounds;
  const auto = node.name === "Text" && (num(node.props.w) === null || num(node.props.h) === null);
  const w = num(node.props.w) ?? (measured ? Math.round(measured.w) : null);
  const h = num(node.props.h) ?? (measured ? Math.round(measured.h) : null);
  const ratio = w && h ? w / h : 1;
  const container = node.name === "Group" || (node.name === "Box" && node.children.some((c) => c.kind === "element" && isShape(c)));
  const clip = getClass(str(node.props.className), "overflow") === "overflow-hidden";
  return (
    <Section title="Layout">
      <div className="flex items-center gap-1.5">
        <div className="grid flex-1 grid-cols-2 gap-2">
          <ScrubField
            icon="W"
            scrubStep={gridStep}
            tip="Width"
            min={0}
            value={w}
            placeholder="auto"
            onChange={(v) => update((n) => withProps(n, lock ? { w: Math.round(v), h: Math.round(v / ratio) } : { w: Math.round(v) }), "size-w")}
          />
          <ScrubField
            icon="H"
            scrubStep={gridStep}
            tip="Height"
            min={0}
            value={h}
            placeholder="auto"
            onChange={(v) => update((n) => withProps(n, lock ? { h: Math.round(v), w: Math.round(v * ratio) } : { h: Math.round(v) }), "size-h")}
          />
        </div>
        <SmallButton tip={lock ? "Unlock aspect ratio" : "Lock aspect ratio"} onClick={() => setLock(!lock)}>
          {lock ? <Link2 /> : <Link2Off />}
        </SmallButton>
      </div>
      {node.name === "Text" && (
        <Toggle checked={auto} onChange={(v) => update((n) => withProps(n, v ? { w: undefined, h: undefined } : { w: w ?? 80, h: h ?? 20 }))} label="Auto size (fits the text)" />
      )}
      {container && (
        <Toggle
          checked={clip}
          onChange={(v) => update((n) => withProps(n, { className: setClass(str(n.props.className), "overflow", v ? "overflow-hidden" : null) || undefined }))}
          label="Clip content"
        />
      )}
    </Section>
  );
}

// ------------------------------------------------------------- appearance

function AppearanceSection({ nodes, rounded }: { nodes: ElementNode[]; rounded: boolean }) {
  const setCls = useClassSetter(nodes);
  const { layout } = useEditorContext();
  const opacityCls = common(nodes, (n) => classOf(n, "opacity"));
  const opacity = opacityCls ? Number(/opacity-(\d+)/.exec(opacityCls)?.[1] ?? 100) : nodes.every((n) => !classOf(n, "opacity")) ? 100 : null;
  const radius = common(nodes, (n) => layout?.shapes.get(n.uid)?.radius ?? 0);
  return (
    <Section title="Appearance">
      <Grid2>
        <ScrubField
          icon={<Baseline />}
          tip="Opacity"
          suffix="%"
          min={0}
          max={100}
          precision={0}
          value={opacity}
          placeholder="Mixed"
          onChange={(v) => setCls("opacity", Math.round(v) >= 100 ? null : `opacity-${Math.round(v)}`, "opacity")}
        />
        {rounded && (
          <ScrubField
            icon={<SquareRoundCorner />}
            tip="Corner radius"
            min={0}
            value={radius === null ? null : round(radius)}
            placeholder="Mixed"
            onChange={(v) => setCls("radius", `rounded-[${Math.round(v)}px]`, "radius")}
          />
        )}
      </Grid2>
      {rounded && nodes.some((n) => classOf(n, "radius")) && (
        <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setCls("radius", null)}>
          Reset corners to theme
        </button>
      )}
    </Section>
  );
}

// ------------------------------------------------------------ theme style

/** Theme colors of a node as the canvas shows them (its variant, without custom classes). */
function useNodeThemeColors() {
  return useContext(NodeThemeColorsContext)!;
}

const CUSTOM_COLOR_GROUPS = ["fill", "stroke", "textColor"] as const;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const variantLabel = (v: string) => (v.startsWith("panel-") ? `${capitalize(v.slice(6))} panel` : capitalize(v));

/**
 * Theme style swatches, drawn with the diagram's own CSS variables in the
 * current diagram theme, so they show exactly the colors the canvas uses.
 * The applied style has a checkmark.
 */
function VariantPicker({ value, onChange, names, edge }: { value: string | null; onChange: (v: string) => void; names: string[]; edge?: boolean }) {
  const theme = useEd((s) => s.theme);
  return (
    <div className={cn("nnd-root flex flex-wrap gap-1 bg-transparent", theme === "dark" && "nnd-dark")}>
      {names.map((v) => {
        const base = (BASE_VARIANTS as Record<string, { label: string; description: string }>)[v];
        const label = edge ? ((EDGE_VARIANTS as Record<string, string>)[v] ?? capitalize(v)) : base ? `${base.label}: ${base.description}` : variantLabel(v);
        const selected = value === v;
        return (
          <Tip key={v} label={label} side="top" delay={250}>
            <button
              type="button"
              aria-pressed={selected}
              aria-label={label}
              onClick={() => onChange(v)}
              className={cn(
                "grid size-5 place-items-center rounded-[5px] transition-transform hover:scale-110",
                edge ? `nnd-edge ${v !== "default" ? `nnd-ev-${v}` : ""}` : `nnd-box nnd-v-${v}`,
              )}
              style={
                edge
                  ? { background: "var(--nnd-page)", border: "2px solid var(--nnd-edge)", color: "var(--nnd-edge)", fill: "none", padding: 0 }
                  : v === "ghost"
                    ? { background: "transparent", border: "1px solid color-mix(in oklab, var(--nnd-fg) 22%, transparent)", color: "var(--nnd-fg)", padding: 0, borderRadius: 5 }
                    : { background: "var(--nnd-fill)", border: "1px solid var(--nnd-line)", color: "var(--nnd-text, var(--nnd-fg))", padding: 0, borderRadius: 5 }
              }
            >
              {selected && <Check className="size-3" strokeWidth={3} />}
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

function ThemeSection({ nodes }: { nodes: ElementNode[] }) {
  const update = useUpdate();
  const variant = common(nodes, (n) => str(n.props.variant) || "default");
  // A style counts as applied only while no custom fill, stroke or text color overrides it.
  const custom = nodes.some((n) => CUSTOM_COLOR_GROUPS.some((g) => classOf(n, g)));
  const value = custom ? null : variant;
  // Choosing a style applies it fully again: custom colors are removed.
  const set = (v: string) =>
    update((n) => {
      let cls = str(n.props.className);
      for (const g of CUSTOM_COLOR_GROUPS) cls = setClass(cls, g, null);
      return withProps(n, { variant: v === "default" ? undefined : v, className: cls || undefined });
    });
  const base = Object.keys(BASE_VARIANTS).filter((v) => v !== "panel");
  return (
    <Section title="Theme style">
      <VariantPicker value={value} names={base} onChange={set} />
      <VariantPicker value={value} names={[...PALETTE]} onChange={set} />
      {nodes.every((n) => n.name === "Box") && (
        <VariantPicker
          value={value}
          names={["panel", ...PALETTE.filter((p) => !["slate", "stone", "lime", "emerald", "yellow", "rose"].includes(p)).map((p) => `panel-${p}`)]}
          onChange={set}
        />
      )}
    </Section>
  );
}

// ------------------------------------------------------------ fill/stroke

function FillSection({ nodes }: { nodes: ElementNode[] }) {
  const setCls = useClassSetter(nodes);
  const docColors = useDocColors();
  const fill = common(nodes, (n) => JSON.stringify(colorOf(classOf(n, "fill"))));
  const value = fill ? (JSON.parse(fill) as ColorValue | null) : null;
  const themeColors = useNodeThemeColors();
  return (
    <Section title="Fill">
      <ColorRow
        value={value}
        tip="Fill"
        themeColor={themeColors.fill}
        documentColors={docColors}
        onChange={(v) => setCls("fill", v ? colorClass("bg", v) : null, "fill")}
      />
    </Section>
  );
}

function StrokeSection({ nodes }: { nodes: ElementNode[] }) {
  const setCls = useClassSetter(nodes);
  const docColors = useDocColors();
  const stroke = common(nodes, (n) => JSON.stringify(colorOf(classOf(n, "stroke"))));
  const value = stroke ? (JSON.parse(stroke) as ColorValue | null) : null;
  const themeColors = useNodeThemeColors();
  const widthCls = common(nodes, (n) => classOf(n, "strokeWidth"));
  const width = widthCls === null ? (nodes.every((n) => !classOf(n, "strokeWidth")) ? 1 : null) : widthCls === "border" ? 1 : (pxOf(widthCls) ?? Number(/border-(\d+)/.exec(widthCls)?.[1] ?? 1));
  const styleCls = common(nodes, (n) => classOf(n, "strokeStyle"));
  return (
    <Section title="Stroke">
      <ColorRow
        value={value}
        tip="Stroke"
        themeColor={themeColors.line}
        documentColors={docColors}
        onChange={(v) => setCls("stroke", v ? colorClass("border", v) : null, "stroke")}
      />
      <Grid2>
        <ScrubField
          icon={<StrokeWeight />}
          tip="Stroke weight"
          min={0}
          max={32}
          suffix="px"
          value={width}
          placeholder="Mixed"
          onChange={(v) => {
            const px = Math.round(v * 2) / 2;
            setCls("strokeWidth", px === 1 ? null : px === 0 ? "border-0" : `border-[${px}px]`, "stroke-w");
          }}
        />
        <Select
          tip="Stroke style"
          value={(styleCls?.replace("border-", "") ?? "solid") as string}
          options={[
            { value: "solid", label: "Solid" },
            { value: "dashed", label: "Dashed" },
            { value: "dotted", label: "Dotted" },
          ]}
          onChange={(v) => setCls("strokeStyle", v === "solid" ? null : `border-${v}`)}
        />
      </Grid2>
    </Section>
  );
}

// ------------------------------------------------------------- typography

const WEIGHTS = [
  { value: "default", label: "Default" },
  { value: "font-light", label: "Light" },
  { value: "font-normal", label: "Regular" },
  { value: "font-medium", label: "Medium" },
  { value: "font-semibold", label: "Semibold" },
  { value: "font-bold", label: "Bold" },
  { value: "font-extrabold", label: "Extra bold" },
];

function TypographySection({ nodes }: { nodes: ElementNode[] }) {
  const setCls = useClassSetter(nodes);
  const docColors = useDocColors();
  const textTheme = useNodeThemeColors();
  const size = common(nodes, (n) => classOf(n, "fontSize"));
  const sizePx = size ? pxOf(size, { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36 }) : nodes.every((n) => !classOf(n, "fontSize")) ? 13 : null;
  const weight = common(nodes, (n) => classOf(n, "fontWeight"));
  const family = common(nodes, (n) => classOf(n, "fontFamily"));
  const italic = common(nodes, (n) => classOf(n, "fontStyle")) === "italic";
  const color = common(nodes, (n) => JSON.stringify(colorOf(classOf(n, "textColor"))));
  const colorValue = color ? (JSON.parse(color) as ColorValue | null) : null;
  const justify = common(nodes, (n) => classOf(n, "justify"));
  const items = common(nodes, (n) => classOf(n, "alignItems"));
  const lh = common(nodes, (n) => classOf(n, "lineHeight"));
  const lhValue = lh ? Number(/leading-\[?(\d*\.?\d+)\]?/.exec(lh)?.[1] ?? NaN) : null;
  const tr = common(nodes, (n) => classOf(n, "tracking"));
  const trValue = tr ? Number(/tracking-\[(-?\d*\.?\d+)em\]/.exec(tr)?.[1] ?? NaN) * 100 : 0;
  return (
    <Section title="Typography">
      <Select
        tip="Font"
        value={(family ?? "default") as string}
        options={[
          { value: "default", label: "Sans (theme)" },
          { value: "font-serif", label: "Serif" },
          { value: "font-mono", label: "Mono" },
          ...WEB_FONTS.map((f) => ({ value: f.cls, label: f.label })),
        ]}
        onChange={(v) => setCls("fontFamily", v === "default" ? null : v)}
      />
      <Grid2>
        <Select tip="Weight" value={(weight ?? "default") as string} options={WEIGHTS} onChange={(v) => setCls("fontWeight", v === "default" ? null : v)} />
        <ScrubField icon={<Type />} tip="Font size" min={4} max={400} suffix="px" value={sizePx} placeholder="Mixed" onChange={(v) => setCls("fontSize", `text-[${Math.round(v)}px]`, "font-size")} />
      </Grid2>
      <Grid2>
        <ScrubField
          icon={<MoveVertical />}
          tip="Line height (× font size)"
          step={0.05}
          min={0.5}
          max={4}
          value={lh === null ? null : Number.isFinite(lhValue ?? NaN) ? lhValue : null}
          placeholder="Auto"
          onChange={(v) => setCls("lineHeight", `leading-[${round(v)}]`, "leading")}
        />
        <ScrubField
          icon={<MoveHorizontal />}
          tip="Letter spacing"
          suffix="%"
          step={1}
          min={-20}
          max={100}
          value={Number.isFinite(trValue) ? round(trValue, 1) : 0}
          onChange={(v) => setCls("tracking", Math.round(v) === 0 ? null : `tracking-[${round(v / 100, 1000)}em]`, "tracking")}
        />
      </Grid2>
      <div className="flex gap-1.5">
        <div className="flex-1">
          <IconGroup
            value={justify === "justify-start" ? "left" : justify === "justify-end" ? "right" : justify === "justify-center" ? "center" : null}
            options={[
              { value: "left", icon: <AlignLeft />, tip: "Align left" },
              { value: "center", icon: <AlignCenter />, tip: "Align center" },
              { value: "right", icon: <AlignRight />, tip: "Align right" },
            ]}
            onChange={(v) => {
              setCls("justify", v === "left" ? "justify-start" : v === "right" ? "justify-end" : "justify-center");
              setCls("textAlign", v === "left" ? "text-left" : v === "right" ? "text-right" : "text-center");
            }}
          />
        </div>
        <div className="flex-1">
          <IconGroup
            value={items === "items-start" ? "top" : items === "items-end" ? "bottom" : items === "items-center" ? "middle" : null}
            options={[
              { value: "top", icon: <ArrowUp />, tip: "Align top" },
              { value: "middle", icon: <AlignCenterHorizontal />, tip: "Align middle" },
              { value: "bottom", icon: <ArrowDown />, tip: "Align bottom" },
            ]}
            onChange={(v) => setCls("alignItems", v === "top" ? "items-start" : v === "bottom" ? "items-end" : "items-center")}
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex-1">
          <ColorRow value={colorValue} tip="Text color" placeholder="Theme" themeColor={textTheme.text} documentColors={docColors} allowNone={false} onChange={(v) => setCls("textColor", v ? colorClass("text", v) : null, "text-color")} />
        </div>
        <IconButton size="xs" variant="ghost" active={italic} onClick={() => setCls("fontStyle", italic ? null : "italic")} aria-label="Italic">
          <span className="font-serif text-sm italic">I</span>
        </IconButton>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ shape

function ShapeSection({ node }: { node: ElementNode }) {
  const update = useUpdate();
  const shape = str(node.props.shape) || "rect";
  const inset = SHAPE_INSETS[shape as ShapeName];
  return (
    <Section title="Shape">
      <Select tip="Outline" value={shape} options={SHAPES} onChange={(v) => update((n) => withProps(n, { shape: v === "rect" ? undefined : v }))} />
      {shape === "trapezoid" && (
        <Segmented
          value={(str(node.props.narrow) || "top") as (typeof SIDES)[number]}
          options={SIDES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), title: `Narrow side: ${s}` }))}
          onChange={(v) => update((n) => withProps(n, { narrow: v === "top" ? undefined : v }))}
        />
      )}
      {inset && (
        <ScrubField icon="∠" tip={`${inset.label} (fraction of the size)`} value={shapeInset(shape, node.props.inset)} step={0.01} min={0} max={inset.max} onChange={(v) => update((n) => withProps(n, { inset: round(v) }), "inset")} />
      )}
    </Section>
  );
}

function ComponentSection({ node }: { node: ElementNode }) {
  const update = useUpdate();
  const docColors = useDocColors();
  const set = (patch: Record<string, Value | undefined>, merge?: string) => update((n) => withProps(n, patch), merge);
  switch (node.name) {
    case "Op":
      return (
        <Section title="Operator">
          <Segmented
            value={str(node.props.symbol) || "+"}
            options={[
              { value: "+", label: "⊕", title: "Add" },
              { value: "x", label: "⊗", title: "Multiply" },
              { value: "concat", label: "⊙", title: "Concat" },
              { value: "c", label: "c", title: "Letter badge" },
            ]}
            onChange={(v) => set({ symbol: v })}
          />
          <TextField value={str(node.props.symbol)} onChange={(v) => set({ symbol: v })} placeholder="Symbol or short text" />
        </Section>
      );
    case "Tokens":
      return (
        <Section title="Tokens">
          <TextField mono value={Array.isArray(node.props.segments) ? node.props.segments.join(" ") : ""} onChange={(v) => set({ segments: v.split(/[\s,]+/).filter(Boolean) })} />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <code>kind:count</code> (text, image, pixel, audio, video, latent, noise, cond or a color), <code>...</code>, <code>concat</code>, <code>+</code>
          </p>
          <Toggle checked={node.props.vertical === true} onChange={(v) => set({ vertical: v || undefined })} label="Vertical" />
        </Section>
      );
    case "Cuboid":
      return (
        <Section title="Cuboid">
          <ScrubField icon="D" tip="Depth" value={num(node.props.depth) ?? 24} min={0} suffix="px" onChange={(v) => set({ depth: Math.round(v) }, "depth")} />
          <Segmented
            value={str(node.props.side) === "left" ? "left" : "right"}
            options={[
              { value: "left" as const, label: "Left" },
              { value: "right" as const, label: "Right" },
            ]}
            onChange={(v) => set({ side: v === "left" ? "left" : undefined })}
          />
        </Section>
      );
    case "Neurons":
      return (
        <Section title="Neurons">
          <TextField mono value={Array.isArray(node.props.layers) ? node.props.layers.join(", ") : "3, 4, 2"} onChange={(v) => set({ layers: v.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => n > 0) })} />
          <Toggle checked={node.props.connect !== "none"} onChange={(v) => set({ connect: v ? undefined : "none" })} label="Dense connections" />
        </Section>
      );
    case "Image":
      return (
        <Section title="Image">
          <TextField mono value={str(node.props.src).startsWith("data:") ? "(embedded, saved as a file on save)" : str(node.props.src)} onChange={(v) => set({ src: v })} placeholder="file name or URL" />
          <Segmented
            value={(str(node.props.fit) || "cover") as "cover" | "contain" | "fill"}
            options={["cover", "contain", "fill"].map((v) => ({ value: v as "cover", label: v[0].toUpperCase() + v.slice(1) }))}
            onChange={(v) => set({ fit: v === "cover" ? undefined : v })}
          />
          <TextField
            mono
            value={Array.isArray(node.props.grid) ? node.props.grid.join(", ") : ""}
            placeholder="Patch grid: cols, rows"
            onChange={(v) => {
              const g = v.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => n > 0);
              set({ grid: g.length ? g : undefined });
            }}
          />
        </Section>
      );
    case "Video":
      return (
        <Section title="Video">
          <TextField mono value={str(node.props.src)} onChange={(v) => set({ src: v })} placeholder="file name or URL" />
          <Grid2>
            <ScrubField icon="⇤" tip="Start (seconds)" step={0.1} min={0} suffix="s" value={num(node.props.start) ?? 0} onChange={(v) => set({ start: v > 0 ? round(v, 10) : undefined }, "v-start")} />
            <ScrubField icon="⇥" tip="End (seconds, empty = full length)" step={0.1} min={0} suffix="s" value={num(node.props.end)} placeholder="end" onChange={(v) => set({ end: v > 0 ? round(v, 10) : undefined }, "v-end")} />
          </Grid2>
          <div className="grid grid-cols-2 gap-1.5">
            <Toggle checked={node.props.autoplay !== false} onChange={(v) => set({ autoplay: v ? undefined : false })} label="Autoplay" />
            <Toggle checked={node.props.muted !== false} onChange={(v) => set({ muted: v ? undefined : false })} label="Mute audio" />
            <Toggle checked={node.props.loop !== false} onChange={(v) => set({ loop: v ? undefined : false })} label="Loop" />
            <Toggle checked={node.props.controls === true} onChange={(v) => set({ controls: v || undefined })} label="Controls" />
          </div>
          <Segmented
            value={(str(node.props.fit) || "cover") as "cover" | "contain" | "fill"}
            options={["cover", "contain", "fill"].map((v) => ({ value: v as "cover", label: v[0].toUpperCase() + v.slice(1) }))}
            onChange={(v) => set({ fit: v === "cover" ? undefined : v })}
          />
        </Section>
      );
    case "Audio":
      return (
        <Section title="Audio">
          <TextField mono value={str(node.props.src)} onChange={(v) => set({ src: v })} placeholder="file name or URL" />
          <Toggle checked={node.props.loop === true} onChange={(v) => set({ loop: v || undefined })} label="Loop" />
          <p className="text-[11px] text-muted-foreground">Double-click the player to edit its title.</p>
        </Section>
      );
    case "Ink":
      return (
        <Section title="Drawing">
          <ColorRow
            value={hexAlpha(str(node.props.color) || "#e11d48")}
            tip="Brush"
            onChange={(v) => set({ color: v ? toHexAlpha(v) : undefined })}
            documentColors={docColors}
            allowNone={false}
            placeholder="Default"
          />
          <ScrubField icon={<Maximize2 />} tip="Brush size" value={num(node.props.size) ?? 4} min={1} max={64} suffix="px" onChange={(v) => set({ size: Math.round(v) }, "ink-size")} />
        </Section>
      );
    case "Icon":
      return (
        <Section title="Icon">
          <TextField mono value={str(node.props.name)} onChange={(v) => set({ name: v.trim().toLowerCase().replace(/\s+/g, "-") || undefined })} placeholder="Lucide name, e.g. cpu" />
          <ScrubField icon={<StrokeWeight />} tip="Line width (24 units = icon width)" value={num(node.props.strokeWidth) ?? 2} min={0.25} max={4} step={0.25} onChange={(v) => set({ strokeWidth: v === 2 ? undefined : round(v, 4) }, "icon-stroke")} />
        </Section>
      );
    case "Table":
      return <TableSection node={node} />;
    case "Brace":
      return (
        <Section title="Brace">
          <Segmented value={(str(node.props.side) || "right") as (typeof SIDES)[number]} options={SIDES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} onChange={(v) => set({ side: v })} />
        </Section>
      );
    case "Text":
      return (
        <Section title="Text style">
          <Select
            value={(str(node.props.variant) || "default") as string}
            options={[
              { value: "default", label: "Body" },
              { value: "title", label: "Title" },
              { value: "heading", label: "Heading" },
              { value: "caption", label: "Caption (mono, caps)" },
              { value: "label", label: "Label (small, muted)" },
              { value: "math", label: "Math (italic serif)" },
            ]}
            onChange={(v) => set({ variant: v === "default" ? undefined : v })}
          />
        </Section>
      );
    default:
      return null;
  }
}

// ------------------------------------------------------------------ table

/**
 * Rows and columns, header and grid lines, and the cells: click a cell in the
 * small grid to edit its text and fill. Double-click a cell on the canvas to
 * edit it in place.
 */
function TableSection({ node }: { node: ElementNode }) {
  const update = useUpdate();
  const grid = useGridStep();
  const set = (patch: Record<string, Value | undefined>) => update((n) => withProps(n, patch));
  const { rows, cols } = tableSize(node);
  const cells = cellGrid(node);
  const [active, setActive] = useState<string | null>(null);
  const cell = cells.find((c) => c.cell.uid === active)?.cell ?? null;
  const theme = useEd((s) => s.theme);
  const stepper = (label: string, value: number, dec: () => void, inc: () => void) => (
    <div className="flex items-center gap-1">
      <span className="flex-1 text-[11px] text-muted-foreground">{label}</span>
      <SmallButton tip={`Remove last ${label.toLowerCase().replace(/s$/, "")}`} onClick={dec}>
        <Minus />
      </SmallButton>
      <span className="w-5 text-center text-xs tabular-nums">{value}</span>
      <SmallButton tip={`Add ${label.toLowerCase().replace(/s$/, "")}`} onClick={inc}>
        <Plus />
      </SmallButton>
    </div>
  );
  const cellVariant = cell ? str(cell.props.variant) || "default" : null;
  return (
    <Section title="Table">
      <Grid2>
        {stepper("Rows", rows, () => update((n) => removeRow(n)), () => update((n) => addRow(n, grid)))}
        {stepper("Columns", cols, () => update((n) => removeColumn(n)), () => update((n) => addColumn(n, grid)))}
      </Grid2>
      <Toggle checked={node.props.header === true} onChange={(v) => set({ header: v || undefined })} label="Header row" />
      <Segmented
        value={(str(node.props.lines) || "all") as "all" | "rows" | "none"}
        options={[
          { value: "all", label: "Grid", title: "Lines between all cells" },
          { value: "rows", label: "Rows", title: "Lines between rows only" },
          { value: "none", label: "None", title: "No inner lines" },
        ]}
        onChange={(v) => set({ lines: v === "all" ? undefined : v })}
      />
      <div
        className={cn("nnd-root grid gap-px rounded-sm bg-border p-px", theme === "dark" && "nnd-dark")}
        style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}
      >
        {cells.map(({ cell: c, span }) => {
          const v = str(c.props.variant);
          return (
            <button
              key={c.uid}
              type="button"
              title={labelText(c) || "Empty cell"}
              onClick={() => setActive(c.uid === active ? null : c.uid)}
              className={cn("h-5 min-w-0 truncate px-0.5 text-[9px]", v ? `nnd-box nnd-v-${v}` : "bg-background", c.uid === active && "ring-2 ring-[var(--nnd-accent,#0d99ff)] ring-inset")}
              style={{ gridColumn: `span ${span}`, ...(v ? { background: "var(--nnd-fill)", border: 0, padding: 0, borderRadius: 0 } : {}) }}
            >
              {labelText(c)}
            </button>
          );
        })}
      </div>
      {cell ? (
        <>
          <TextField
            value={labelSource(cell.children)}
            placeholder="Cell text ($LaTeX$ works)"
            onChange={(v) => {
              let children: ChildNode[];
              try {
                children = parseLabelSource(v);
              } catch {
                return;
              }
              update((n) => updateCell(n, cell.uid, (c) => ({ ...c, children })), `cell-${cell.uid}`);
            }}
          />
          <VariantPicker
            value={cellVariant}
            names={["default", "muted", ...PALETTE]}
            onChange={(v) => update((n) => updateCell(n, cell.uid, (c) => withProps(c, { variant: v === "default" ? undefined : v })))}
          />
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">Pick a cell to edit its text and fill, or double-click it on the canvas.</p>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ edges

function EdgeSection({ nodes }: { nodes: ElementNode[] }) {
  const update = useUpdate();
  const setCls = useClassSetter(nodes);
  const docColors = useDocColors();
  const set = (patch: Record<string, Value | undefined>, merge?: string) => update((n) => withProps(n, patch), merge, nodes);
  const variant = common(nodes, (n) => str(n.props.variant) || "default");
  const diagramTheme = useEd((s) => s.theme);
  const edgeTheme = useThemeColors(cx("nnd-edge", variant && variant !== "default" && `nnd-ev-${variant}`), diagramTheme);
  const color = common(nodes, (n) => JSON.stringify(colorOf(classOf(n, "edgeColor"))));
  const colorValue = color ? (JSON.parse(color) as ColorValue | null) : null;
  const widthCls = common(nodes, (n) => classOf(n, "edgeWidth"));
  const width = widthCls ? (pxOf(widthCls) ?? Number(/stroke-(\d+(?:\.\d+)?)/.exec(widthCls)?.[1] ?? 1)) : nodes.every((n) => !classOf(n, "edgeWidth")) ? 1 : null;
  const route = common(nodes, (n) => str(n.props.route) || "orthogonal");
  const head = common(nodes, (n) => str(n.props.head) || "arrow");
  const tail = common(nodes, (n) => str(n.props.tail) || "none");
  const dashed = common(nodes, (n) => n.props.dashed === true);
  const rounded = common(nodes, (n) => num(n.props.rounded) ?? 0);
  const single = nodes.length === 1 ? nodes[0] : null;
  return (
    <>
      <Section title="Theme style">
        <VariantPicker
          edge
          value={nodes.some((n) => classOf(n, "edgeColor")) ? null : variant}
          names={[...Object.keys(EDGE_VARIANTS), "red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink"]}
          onChange={(v) =>
            update((n) => {
              const cls = setClass(str(n.props.className), "edgeColor", null);
              return withProps(n, { variant: v === "default" ? undefined : v, className: cls || undefined });
            })
          }
        />
      </Section>
      <Section title="Stroke">
        <ColorRow
          value={colorValue}
          tip="Line"
          placeholder="Theme"
          themeColor={edgeTheme.edge}
          documentColors={docColors}
          allowNone={false}
          onChange={(v) => setCls("edgeColor", v ? colorClass("text", v, THEME_COLOR_VAR.edge) : null, "edge-color")}
        />
        <Grid2>
          <ScrubField
            icon={<StrokeWeight />}
            tip="Line weight"
            min={0.5}
            max={16}
            step={0.5}
            suffix="px"
            value={width}
            placeholder="Mixed"
            onChange={(v) => {
              const px = Math.round(v * 2) / 2;
              setCls("edgeWidth", px === 1 ? null : Number.isInteger(px) ? `stroke-${px}` : `stroke-[${px}px]`, "edge-w");
            }}
          />
          <Select
            tip="Line style"
            value={dashed ? "dashed" : "solid"}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dashed", label: "Dashed" },
            ]}
            onChange={(v) => set({ dashed: v === "dashed" || undefined })}
          />
        </Grid2>
      </Section>
      <Section title="Route">
        <Segmented
          value={route as "orthogonal"}
          options={[
            { value: "orthogonal", label: "Elbow" },
            { value: "straight", label: "Straight" },
            { value: "curved", label: "Curved" },
          ]}
          onChange={(v) => set({ route: v === "orthogonal" ? undefined : v, via: undefined })}
        />
        <div className="flex items-center gap-1.5">
          <ScrubField className="flex-1" icon={<SquareRoundCorner />} tip="Corner radius of bends" value={rounded} min={0} max={40} suffix="px" onChange={(v) => set({ rounded: v ? Math.round(v) : undefined }, "edge-rounded")} />
          <button type="button" className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => set({ via: undefined })}>
            Reset route
          </button>
        </div>
        <Grid2>
          <div>
            <Label>Start</Label>
            <Select value={tail as string} options={ARROW_HEADS} onChange={(v) => set({ tail: v === "none" ? undefined : v })} />
          </div>
          <div>
            <Label>End</Label>
            <Select value={head as string} options={ARROW_HEADS} onChange={(v) => set({ head: v === "arrow" ? undefined : v })} />
          </div>
        </Grid2>
      </Section>
      {single && (
        <Section title="Connection">
          <div className="flex items-center gap-2">
            <span className="w-8 text-[11px] text-muted-foreground">From</span>
            <TextField mono value={typeof single.props.from === "string" ? single.props.from : JSON.stringify(single.props.from)} onChange={(v) => set({ from: parseEndpointInput(v) })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 text-[11px] text-muted-foreground">To</span>
            <TextField mono value={typeof single.props.to === "string" ? single.props.to : JSON.stringify(single.props.to)} onChange={(v) => set({ to: parseEndpointInput(v) })} />
          </div>
          <ScrubField
            icon="⌖"
            tip="Label position along the line (0–1)"
            value={num(single.props.labelAt) ?? 0.5}
            step={0.05}
            min={0}
            max={1}
            onChange={(v) => set({ labelAt: round(v) === 0.5 ? undefined : round(v) }, "label-at")}
          />
        </Section>
      )}
    </>
  );
}

function parseEndpointInput(v: string): Value {
  const t = v.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return arr;
    } catch {
      /* fall through */
    }
  }
  return t;
}

// ---------------------------------------------------------- explanations

function ExplainSection({ node }: { node: ElementNode }) {
  const update = useUpdate();
  return (
    <Section title="Explanation">
      <TextArea value={str(node.props.tip)} placeholder={"Shown on hover in the viewer.\nMarkdown and $LaTeX$."} onChange={(v) => update((n) => withProps(n, { tip: v.trim() ? v : undefined }))} />
      <TextField mono value={str(node.props.link)} placeholder="Link: /lab/model, #file or https://…" onChange={(v) => update((n) => withProps(n, { link: v.trim() || undefined }))} />
    </Section>
  );
}

function AdvancedSection({ node }: { node: ElementNode }) {
  const update = useUpdate();
  return (
    <Section title="Tailwind classes">
      <TextField mono value={str(node.props.className)} placeholder="e.g. shadow-md tracking-wide" onChange={(v) => update((n) => withProps(n, { className: v.trim() || undefined }))} />
    </Section>
  );
}
