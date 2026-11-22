/** Left panel: shape library (with scratchpad), icons and the layers tree. */

import { PanelScroll } from "./controls";
import {
  ArrowRight,
  AudioLines,
  Box as BoxIcon,
  ChevronDown,
  ChevronRight,
  Circle,
  Film,
  Group,
  Image as ImageIcon,
  Network,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Square,
  Table2,
  Type,
  X,
} from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";
import { isEdge, isShape, type ElementNode } from "@nn-diagram/format";
import { Tip, cn, iconComponent, iconNames, labelText, screenToDiagram, useIconSet } from "@nn-diagram/viewer";
import { useEd, useEditorServices } from "../context";
import type { LibraryItem } from "../library";
import { useUiTheme } from "../ui-theme";
import { SnippetThumb } from "./snippets";

// --------------------------------------------------------------- library

const SMALL_TILE_SIZE = { w: 40, h: 36 };
const LARGE_TILE_SIZE = { w: 92, h: 64 };

/**
 * Library tile. Click inserts at the view center; dragging shows the shape at
 * canvas zoom under the pointer and drops it where it is released.
 */
function LibraryTile({ item, big, theme, thumb }: { item: LibraryItem; big?: boolean; theme: "light" | "dark"; thumb?: ReactNode }) {
  const { api, actions } = useEditorServices();
  const insert = (at?: { x: number; y: number }) => (item.assets ? void actions.insertLibraryItem(item, at) : actions.insertSnippet(item.snippet, at));
  const size = big ? LARGE_TILE_SIZE : SMALL_TILE_SIZE;
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const store = api.store;
    // By geometry, not elementFromPoint: the drag preview itself sits under the pointer.
    const overCanvas = (x: number, y: number) => {
      const r = api.canvasElement()?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      dragging = true;
      store.getState().set({ libraryDrag: { snippet: item.snippet, label: item.label, assets: item.assets, x: ev.clientX, y: ev.clientY, overCanvas: overCanvas(ev.clientX, ev.clientY) } });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const drag = store.getState().libraryDrag;
      store.getState().set({ libraryDrag: null });
      if (!dragging) {
        insert();
        return;
      }
      const canvas = api.canvasElement();
      if (!drag || !canvas || !overCanvas(ev.clientX, ev.clientY)) return;
      const r = canvas.getBoundingClientRect();
      const vp = store.getState().viewport;
      const p = screenToDiagram(vp, { x: ev.clientX - r.left, y: ev.clientY - r.top });
      const off = libraryDragOffset.current;
      insert({ x: p.x - off.x, y: p.y - off.y });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <Tip label={item.label} side="right" delay={150}>
      <button
        type="button"
        aria-label={item.label}
        onPointerDown={onPointerDown}
        className={cn(
          "group flex w-full min-w-0 cursor-grab touch-none flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-muted/50 p-1 transition-colors select-none hover:bg-muted active:cursor-grabbing dark:bg-muted/40",
          big && "p-1.5",
        )}
      >
        {thumb ? (
          <span className="flex size-9 items-center justify-center text-foreground/80 group-hover:text-foreground">{thumb}</span>
        ) : (
          <SnippetThumb snippet={item.snippet} assets={item.assets} size={size} theme={theme} bare={!big} />
        )}
        {big && <span className="w-full truncate text-center text-[10px] text-muted-foreground">{item.label}</span>}
      </button>
    </Tip>
  );
}

/** Offset (diagram px) from the dragged snippet's top-left to the pointer, set by the drag preview. */
export const libraryDragOffset = { current: { x: 0, y: 0 } };

function LibrarySectionView({
  title,
  children,
  defaultOpen = true,
  actions,
  className,
  dropZone,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  className?: string;
  dropZone?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("border-b border-border", className)} data-scratchpad-drop={dropZone ? "" : undefined}>
      <div className="flex items-center px-3 py-2">
        <button type="button" className="flex flex-1 items-center gap-1 text-xs font-medium" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          {title}
        </button>
        {actions}
      </div>
      {open && <div className="px-2.5 pb-3">{children}</div>}
    </div>
  );
}

function AddToScratchpad() {
  const { actions } = useEditorServices();
  const hasSelection = useEd((s) => s.selection.length > 0);
  return (
    <Tip label={hasSelection ? "Add selection to scratchpad" : "Select shapes first"} side="right" delay={200}>
      <button
        type="button"
        disabled={!hasSelection}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        onClick={() => actions.addToScratchpad()}
      >
        <Plus className="size-3.5" />
      </button>
    </Tip>
  );
}

function Library() {
  const { actions, libraries } = useEditorServices();
  const theme = useUiTheme();
  const scratch = useEd((s) => s.scratchpad);
  const scratchHover = useEd((s) => s.scratchHover);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (i: LibraryItem) => !q || i.label.toLowerCase().includes(q) || (i.keywords ?? "").includes(q);

  return (
    <div className="flex h-full flex-col">
      <div className="px-2.5 pt-2.5 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-transparent bg-muted/70 pr-2 pl-8 text-xs outline-none hover:border-border focus:border-[var(--nnd-accent,#0d99ff)] focus:bg-background"
            placeholder="Search shapes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <PanelScroll className="min-h-0 flex-1">
        <LibrarySectionView
          title="Scratchpad"
          dropZone
          className={cn(scratchHover && "bg-[var(--nnd-accent,#0d99ff)]/10 ring-2 ring-[var(--nnd-accent,#0d99ff)]/60 ring-inset")}
          actions={<AddToScratchpad />}
        >
          {scratch.length === 0 ? (
            <div className={cn("mx-0.5 rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground", scratchHover && "border-[var(--nnd-accent,#0d99ff)] text-foreground")}>
              {scratchHover ? "Drop to keep a copy here" : "Drag shapes here, or select them and press +"}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {scratch.filter(match).map((item) => (
                <div key={item.id} className="group relative">
                  <LibraryTile item={item} big theme={theme} />
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 hidden rounded bg-background/90 p-0.5 text-muted-foreground shadow-sm group-hover:block hover:text-foreground"
                    onClick={() => actions.setScratchpad(scratch.filter((s) => s.id !== item.id))}
                    aria-label="Remove from scratchpad"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </LibrarySectionView>
        {libraries.map((section) => {
          const items = section.items.filter(match);
          if (!items.length) return null;
          const big = section.size === "large";
          return (
            <LibrarySectionView key={section.id} title={section.title}>
              <div className={cn("grid gap-1", big ? "grid-cols-2" : "grid-cols-4")}>
                {items.map((item) => (
                  <LibraryTile key={item.id} item={item} big={big} theme={theme} />
                ))}
              </div>
            </LibrarySectionView>
          );
        })}
      </PanelScroll>
    </div>
  );
}

// ----------------------------------------------------------------- icons

/** Icons shown before searching: the usual suspects of system and ML diagrams. */
const COMMON_ICONS = [
  "user", "users", "bot", "brain", "brain-circuit", "sparkles", "cpu", "gpu", "microchip", "server", "database", "hard-drive",
  "cloud", "globe", "network", "smartphone", "laptop", "monitor", "file", "file-text", "file-code", "folder", "image", "images",
  "video", "camera", "mic", "audio-waveform", "music", "message-square", "mail", "search", "scan", "scan-face", "eye", "lock",
  "key-round", "shield", "settings", "wrench", "zap", "flame", "snowflake", "lightbulb", "target", "trophy", "chart-line", "chart-bar",
  "chart-scatter", "activity", "trending-up", "gauge", "clock", "calendar", "map-pin", "car", "heart-pulse", "stethoscope", "dna",
  "microscope", "flask-conical", "atom", "leaf", "book-open", "code", "terminal", "git-branch", "layers", "layout-grid", "table",
  "filter", "shuffle", "repeat", "refresh-cw", "play", "check", "x", "plus", "circle-alert", "info", "thumbs-up", "thumbs-down",
];

const PAGE = 240;

function IconTile({ name, theme }: { name: string; theme: "light" | "dark" }) {
  const item = useMemo<LibraryItem>(() => ({ id: `icon-${name}`, label: name, snippet: `<Icon x={0} y={0} w={32} h={32} name="${name}" />` }), [name]);
  const Icon = iconComponent(name);
  return <LibraryTile item={item} theme={theme} thumb={Icon ? <Icon width={18} height={18} strokeWidth={1.75} /> : null} />;
}

/** Lucide icons: search by name, click or drag to insert an <Icon>. */
function IconsPanel() {
  const ready = useIconSet();
  const theme = useUiTheme();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const terms = query.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  const all = ready ? iconNames() : [];
  const matches = terms.length ? all.filter((n) => terms.every((t) => n.includes(t))) : all;
  const common = ready ? COMMON_ICONS.filter((n) => iconComponent(n) && (!terms.length || terms.every((t) => n.includes(t)))) : [];
  const grid = "grid grid-cols-6 gap-1";
  return (
    <div className="flex h-full flex-col">
      <div className="px-2.5 pt-2.5 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-transparent bg-muted/70 pr-2 pl-8 text-xs outline-none hover:border-border focus:border-[var(--nnd-accent,#0d99ff)] focus:bg-background"
            placeholder={ready ? `Search ${all.length} icons` : "Loading icons…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <PanelScroll className="min-h-0 flex-1">
        {!terms.length && common.length > 0 && (
          <LibrarySectionView title="Common">
            <div className={grid}>
              {common.map((n) => (
                <IconTile key={n} name={n} theme={theme} />
              ))}
            </div>
          </LibrarySectionView>
        )}
        {ready && (
          <LibrarySectionView title={terms.length ? `${matches.length} matching` : "All icons"}>
            {matches.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">No icon named “{query}”</div>
            ) : (
              <div className={grid}>
                {matches.slice(0, limit).map((n) => (
                  <IconTile key={n} name={n} theme={theme} />
                ))}
              </div>
            )}
            {matches.length > limit && (
              <button type="button" className="mt-1 w-full rounded-md py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setLimit(limit + PAGE * 2)}>
                Show more ({matches.length - limit})
              </button>
            )}
          </LibrarySectionView>
        )}
        <p className="px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          <a className="underline-offset-2 hover:underline" href="https://lucide.dev/icons" target="_blank" rel="noreferrer">
            Lucide
          </a>{" "}
          icons (ISC). They follow the text color; a theme style tints them.
        </p>
      </PanelScroll>
    </div>
  );
}

// ---------------------------------------------------------------- layers

function iconFor(node: ElementNode) {
  switch (node.name) {
    case "Text":
      return <Type />;
    case "Arrow":
      return <ArrowRight />;
    case "Image":
      return <ImageIcon />;
    case "Video":
      return <Film />;
    case "Audio":
      return <AudioLines />;
    case "Ink":
      return <PenLine />;
    case "Group":
      return <Group />;
    case "Cuboid":
      return <BoxIcon />;
    case "Neurons":
      return <Network />;
    case "Icon":
      return <Sparkles />;
    case "Table":
      return <Table2 />;
    case "Op":
      return <Circle />;
    default:
      return node.props.shape === "ellipse" ? <Circle /> : <Square />;
  }
}

function nameOf(node: ElementNode): string {
  const label = labelText(node);
  const id = typeof node.props.id === "string" ? node.props.id : "";
  if (node.name === "Arrow") {
    const f = typeof node.props.from === "string" ? node.props.from.split("@")[0] : "·";
    const t = typeof node.props.to === "string" ? node.props.to.split("@")[0] : "·";
    return label || `${f} → ${t}`;
  }
  if (node.name === "Ink") return "Drawing";
  if (node.name === "Icon") return id || (typeof node.props.name === "string" ? node.props.name : "Icon");
  return label || id || node.name;
}

const LayerRow = memo(function LayerRowView({ node, depth }: { node: ElementNode; depth: number }) {
  const { api } = useEditorServices();
  const selected = useEd((s) => selectedUids(s.selection).has(node.uid));
  const kids = useMemo(() => node.children.filter((c): c is ElementNode => c.kind === "element" && (isShape(c) || isEdge(c))), [node.children]);
  const [open, setOpen] = useState(depth < 1);
  // Selection only changes the row background. Keep label/icon trees stable
  // when thousands of rows are selected together, including expanded children.
  const content = useMemo(() => {
    const name = nameOf(node);
    return <>
      <span className="text-muted-foreground">{iconFor(node)}</span>
      <span className="truncate">{name}</span>
      {typeof node.props.id === "string" && name !== node.props.id && <span className="ml-auto truncate pl-2 font-mono text-[10px] text-muted-foreground">{node.props.id}</span>}
    </>;
  }, [node]);
  const chevron = useMemo(() => open ? <ChevronDown /> : <ChevronRight />, [open]);
  const childRows = useMemo(() => open ? [...kids].reverse().map((k) => <LayerRow key={k.uid} node={k} depth={depth + 1} />) : null, [open, kids, depth]);
  return (
    <>
      <div
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1 pr-2 text-xs select-none hover:bg-accent/60 [&_svg]:size-3.5 [&_svg]:shrink-0",
          selected && "bg-[var(--nnd-accent,#0d99ff)]/12 text-foreground hover:bg-[var(--nnd-accent,#0d99ff)]/18",
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
        onPointerEnter={() => api.store.getState().set({ hoverUid: node.uid })}
        onPointerLeave={() => api.store.getState().set({ hoverUid: null })}
        onClick={(e) => {
          const s = api.store.getState();
          if (e.shiftKey || e.ctrlKey || e.metaKey) s.select(selected ? s.selection.filter((u) => u !== node.uid) : [...s.selection, node.uid]);
          else s.select([node.uid]);
        }}
        onDoubleClick={() => api.zoomToSelection()}
      >
        <button type="button" className={cn("rounded p-0.5 text-muted-foreground hover:text-foreground", !kids.length && "invisible")} onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
          {chevron}
        </button>
        {content}
      </div>
      {childRows}
    </>
  );
});

const selectionSets = new WeakMap<string[], ReadonlySet<string>>();
function selectedUids(selection: string[]): ReadonlySet<string> {
  let set = selectionSets.get(selection);
  if (!set) selectionSets.set(selection, set = new Set(selection));
  return set;
}

function LayersPanel() {
  const doc = useEd((s) => s.doc);
  const kids = doc.children.filter((c): c is ElementNode => c.kind === "element" && (isShape(c) || isEdge(c)));
  return (
    <PanelScroll className="h-full">
      <div className="py-1">
      {kids.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">No elements yet</div>}
      {[...kids].reverse().map((k) => (
        <LayerRow key={k.uid} node={k} depth={0} />
      ))}
      </div>
    </PanelScroll>
  );
}

export const Sidebar = memo(function Sidebar() {
  const [tab, setTab] = useState<"shapes" | "icons" | "layers">("shapes");
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-0.5 border-b border-border px-2.5">
        {(
          [
            ["shapes", "Shapes"],
            ["icons", "Icons"],
            ["layers", "Layers"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              tab === id && "bg-muted text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === "shapes" ? <Library /> : tab === "icons" ? <IconsPanel /> : <LayersPanel />}</div>
    </div>
  );
});
