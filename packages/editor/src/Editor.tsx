"use client";
/**
 * The diagram editor: menu bar, tools, shape library, canvas and property
 * panel. Diagrams are opened from and saved to the local disk (media next to
 * the diagram file); an open file is watched so edits made by other tools
 * (e.g. an LLM) appear immediately.
 */
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  Circle,
  Download,
  FolderOpen,
  Hand,
  ImagePlus,
  Info,
  Keyboard,
  Moon,
  MousePointer2,
  Pencil,
  Redo2,
  Sparkles,
  Square,
  Sun,
  Table2,
  Type,
  Undo2,
  Wand2,
} from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { findNode, getSpec, removeNodes, validateDiagram, walk, type Issue } from "@nn-diagram/format";
import {
  ExportDialog,
  IconButton,
  Tip,
  TooltipProvider,
  cn,
  collectClasses,
  floatingPanel,
  ensureClasses,
  labelText,
  useDiagramLayout,
  type EdgeGeometry,
  type Layout,
  type Rect,
} from "@nn-diagram/viewer";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@nn-diagram/ui/menubar";
import { Button } from "@nn-diagram/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@nn-diagram/ui/dropdown-menu";
import { Logo } from "@nn-diagram/ui/logo";
import { Popover, PopoverContent, PopoverTrigger } from "@nn-diagram/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@nn-diagram/ui/resizable";
import { createActions, loadScratchpad, type Actions } from "./actions";
import { contentBounds, fittedPageRect, setPageRect } from "./commands";
import { Canvas } from "./canvas/Canvas";
import { EditorContext, EditorServicesContext, useEditorContext, useEditorServices, type EditorApi, type EditorContextValue } from "./context";
import { AboutDialog, AiDialog, FolderChooserDialog, ShortcutsDialog, VideoImportDialog } from "./dialogs";
import { lastRecent, loadDraft, loadDraftAssets, saveDraft, saveDraftAssets, supportsFolders } from "./file";
import { isRelative, mediaRefs } from "./media";
import { Inspector } from "./panels/Inspector";
import { Sidebar, libraryDragOffset } from "./panels/Sidebar";
import { SnippetPreview, SnippetThumb } from "./panels/snippets";
import { usePreventPageZoom, useShortcuts } from "./shortcuts";
import { DEFAULT_LIBRARY, type LibrarySection } from "./library";
import { DEFAULT_DIAGRAM, createEditorStore, type EditorStore, type Tool } from "./store";
import { useUiTheme } from "./ui-theme";
import { EditorLoader } from "./loader";

export interface DiagramEditorProps {
  /** URL of a diagram file to open (e.g. from the website's viewer). */
  src?: string;
  /** Link for the logo / back button. */
  homeHref?: string;
  /** App theme. Changing it also switches the diagram theme. */
  theme?: "light" | "dark";
  /** Called by the editor's app theme toggle. Without it the toggle sets the `dark` class on <html>. */
  onThemeChange?: (theme: "light" | "dark") => void;
  /** Sidebar shape sections. Default: `DEFAULT_LIBRARY` (shapes, connectors). Add your own with `[...DEFAULT_LIBRARY, mySection]`. */
  libraries?: LibrarySection[];
  /** Diagram source to start with (instead of `src` or the last local draft). The editor then keeps no local draft. */
  defaultSource?: string;
  /** Called with the diagram source after edits (debounced). */
  onChange?: (source: string) => void;
  /**
   * Stores the file yourself instead of saving to the user's disk. Media the
   * user added are embedded as data URLs in this case.
   */
  onSave?: (source: string, info: { name: string }) => void | Promise<void>;
  className?: string;
}

const EDITOR_CSS = `
.nnd-hover-arrow:hover path { fill-opacity: 1; }
.nnd-thumb .nnd-page { display: none; }
/* Small library tiles show the outline only; at that size box labels are noise. */
.nnd-thumb-bare .nnd-box > .nnd-label, .nnd-thumb-bare .nnd-cuboid .nnd-label { visibility: hidden; }
/* Scaled down, hairline outlines vanish: draw them darker and 1.2 screen px wide. */
.nnd-thumb-bare .nnd-box { --nnd-line: var(--nnd-muted) !important; }
.nnd-thumb-bare :is(.nnd-shape-rect, .nnd-shape-ellipse) { border-width: calc(1.2px / var(--nnd-thumb-scale, 1)) !important; }
.nnd-thumb-bare .nnd-box svg path { stroke-width: calc(1.2px / var(--nnd-thumb-scale, 1)) !important; }
`;

const MENU_TRIGGER = "h-8 rounded-md px-2.5 text-[13px] font-normal text-foreground/85 hover:bg-foreground/[0.07] hover:text-foreground aria-expanded:bg-foreground/[0.07] aria-expanded:text-foreground dark:hover:bg-foreground/10";

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

function useApi(
  store: EditorStore,
  layoutRef: React.RefObject<Layout | null>,
  routesRef: React.RefObject<ReadonlyMap<string, EdgeGeometry>>,
  propsRef: React.RefObject<DiagramEditorProps>,
): EditorApi {
  return useMemo<EditorApi>(
    () => ({
      store,
      layout: () => layoutRef.current,
      routes: () => routesRef.current ?? new Map(),
      fit: () => {},
      zoomToSelection: () => {},
      zoomBy: () => {},
      zoomTo: () => {},
      viewCenter: () => ({ x: 0, y: 0 }),
      insertSnippet: () => {},
      startTextEdit: (uid) => {
        const s = store.getState();
        const node = findNode(s.doc, uid)?.node;
        if (!node || !getSpec(node.name)?.label) return;
        s.set({ editingText: uid, selection: [uid], tool: "select" });
      },
      canvasElement: () => null,
      onSave: () => propsRef.current.onSave,
    }),
    [store, layoutRef, routesRef, propsRef],
  );
}

export function DiagramEditor(props: DiagramEditorProps) {
  const { src, homeHref = "/", theme: appThemeProp, onThemeChange, libraries = DEFAULT_LIBRARY, defaultSource, className } = props;
  const propsRef = useRef(props);
  propsRef.current = props;
  const [store] = useState(() => {
    const s = createEditorStore();
    const dark = appThemeProp ? appThemeProp === "dark" : typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    s.getState().set({ theme: dark ? "dark" : "light" });
    return s;
  });
  const doc = useStore(store, (s) => s.doc);
  const { layout, routes, onMeasure } = useDiagramLayout(doc);
  const layoutRef = useRef<Layout | null>(layout);
  const routesRef = useRef<ReadonlyMap<string, EdgeGeometry>>(routes);
  layoutRef.current = layout;
  routesRef.current = routes;
  const api = useApi(store, layoutRef, routesRef, propsRef);
  const actions = useMemo(() => createActions(api), [api]);
  api.insertSnippet = actions.insertSnippet;
  const [booted, setBooted] = useState(false);

  // The app theme (top bar toggle / host) drives the diagram theme; the
  // diagram settings can preview the other theme until the app theme changes.
  // Without onThemeChange the toggle switches the theme itself; that choice
  // holds until the host passes a different `theme`.
  const detected = useUiTheme();
  const [own, setOwn] = useState<{ prop: typeof appThemeProp; theme: "light" | "dark" } | null>(null);
  const appTheme = own && own.prop === appThemeProp ? own.theme : (appThemeProp ?? detected);
  useEffect(() => {
    store.getState().set({ theme: appTheme });
  }, [appTheme, store]);
  const toggleAppTheme = useCallback(() => {
    const next = appTheme === "dark" ? "light" : "dark";
    if (onThemeChange) return onThemeChange(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    setOwn({ prop: appThemeProp, theme: next });
  }, [appTheme, appThemeProp, onThemeChange]);

  // Diagram Tailwind classes
  useEffect(() => {
    ensureClasses(collectClasses(doc));
  }, [doc]);

  // Initial document: defaultSource, ?src, else the last draft.
  const hostOwned = defaultSource !== undefined;
  useEffect(() => {
    store.getState().set({ scratchpad: loadScratchpad() });
    (async () => {
      try {
        if (defaultSource !== undefined) actions.loadText(defaultSource, { name: store.getState().file.name });
        else if (src) await actions.openUrl(src);
        else {
          const draft = loadDraft();
          if (draft && draft.text.trim() && draft.text !== DEFAULT_DIAGRAM) {
            // Its media come back as pending files, written next to the diagram on save.
            // Read before loading, so they are set in the same render as the document.
            const blobs = await loadDraftAssets();
            if (actions.loadText(draft.text, { name: draft.name })) {
              const assets = { ...store.getState().assets };
              for (const [name, blob] of Object.entries(blobs)) assets[name] ??= { url: URL.createObjectURL(blob), blob };
              store.getState().set({ dirty: true, assets, missingAssets: [] });
            }
          }
        }
      } catch (err) {
        store.getState().showToast((err as Error).message);
      }
      setBooted(true);
    })();
    // The initial document is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, actions, store]);

  // Draft autosave and onChange
  const lastChanged = useRef<string | null>(null);
  const draftMedia = useRef("");
  useEffect(() => {
    if (!booted) return;
    const id = window.setTimeout(() => {
      const s = store.getState();
      const onChange = propsRef.current.onChange;
      if (!onChange && (hostOwned || !s.dirty)) return;
      const text = s.serialize();
      if (s.dirty && !hostOwned) {
        saveDraft(text, s.file.name);
        // The draft's media, when the set of files changes.
        const used = [...new Set(mediaRefs(s.doc).map((r) => r.src))].filter((src) => isRelative(src) && s.assets[src]).sort();
        const key = used.map((src) => `${src}=${s.assets[src].url}`).join("|");
        if (key !== draftMedia.current) {
          draftMedia.current = key;
          void Promise.all(used.map(async (src) => [src, s.assets[src].blob ?? (await (await fetch(s.assets[src].url)).blob())] as const)).then(
            (entries) => saveDraftAssets(Object.fromEntries(entries)),
            () => undefined,
          );
        }
      }
      if (onChange && text !== lastChanged.current) {
        lastChanged.current = text;
        onChange(text);
      }
    }, 600);
    return () => window.clearTimeout(id);
  }, [doc, booted, store, hostOwned]);

  // Watch the open file for external changes.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = store.getState();
      if (document.visibilityState === "visible" && s.file.handle && !s.gesture) actions.checkExternalChange().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(id);
  }, [actions, store]);

  // Warn before leaving with unsaved changes to a file on disk.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.getState().dirty && store.getState().file.handle) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store]);

  // Auto size: keep the page fitted around the content (after each edit, not while dragging).
  const gestureActive = useStore(store, (s) => !!s.gesture);
  useEffect(() => {
    const s = store.getState();
    if (s.doc.props.autoSize !== true || gestureActive || !layout) return;
    const content = contentBounds(layout, routes.values());
    if (!content) return;
    const padding = typeof s.doc.props.padding === "number" ? s.doc.props.padding : 24;
    const rect = fittedPageRect(content, layout.grid, padding);
    if (rect.x === 0 && rect.y === 0 && rect.w === layout.page.w && rect.h === layout.page.h) return;
    const vp = s.viewport;
    // The content moves by -rect.x/-rect.y; the view moves with it so nothing jumps.
    store.setState({ doc: setPageRect(s.doc, rect), dirty: true, viewport: { ...vp, x: vp.x + rect.x * vp.zoom, y: vp.y + rect.y * vp.zoom } });
  }, [layout, routes, gestureActive, store]);

  // Text elements left empty disappear once they are no longer selected or edited,
  // so there are no invisible elements on the page.
  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.selection === prev.selection && state.editingText === prev.editingText) return;
        if (state.gesture) return;
        const active = new Set([...state.selection, ...(state.editingText ? [state.editingText] : [])]);
        const empty = new Set<string>();
        const left = new Set([...prev.selection, ...(prev.editingText ? [prev.editingText] : [])].filter((uid) => !active.has(uid)));
        if (!left.size) return;
        walk(state.doc, (node) => {
          if (left.has(node.uid) && node.name === "Text" && !labelText(node).trim() && !node.children.some((c) => c.kind === "element")) empty.add(node.uid);
        });
        // Not an undo step of its own: undo goes back to before the text was created.
        if (empty.size) store.setState({ doc: removeNodes(state.doc, empty) });
      }),
    [store],
  );

  useShortcuts(api, actions, true);
  usePreventPageZoom();

  const ctx = useMemo<EditorContextValue>(() => ({ api, actions, layout, routes, onMeasure, libraries }), [api, actions, layout, routes, onMeasure, libraries]);
  const services = useMemo(() => ({ api, actions, libraries }), [api, actions, libraries]);

  return (
    <EditorServicesContext.Provider value={services}>
    <EditorContext.Provider value={ctx}>
      <TooltipProvider>
        <style>{EDITOR_CSS}</style>
        <div className={cn("nnd-ui relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground", className)}>
          {!booted && <EditorLoader className="absolute inset-0 z-50" />}
          <TopBar actions={actions} homeHref={homeHref} appTheme={appTheme} onToggleTheme={toggleAppTheme} />
          <Banners actions={actions} />
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel id="sidebar" defaultSize={244} minSize={196} maxSize={380} groupResizeBehavior="preserve-pixel-size" className="bg-background">
              <Sidebar />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="canvas" minSize="30">
              <main className="relative h-full min-w-0">
                <Canvas />
                <EmptyCanvas actions={actions} />
                <CanvasInfo />
                <ToolDock actions={actions} />
                <IssuesBadge actions={actions} />
                <Toast />
              </main>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="inspector" defaultSize={272} minSize={240} maxSize={400} groupResizeBehavior="preserve-pixel-size" className="bg-background">
              <Inspector />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <EditorDialogs />
        <LibraryDragGhost />
      </TooltipProvider>
    </EditorContext.Provider>
    </EditorServicesContext.Provider>
  );
}

function useCtx() {
  return useEditorServices();
}

function EditorDialogs() {
  const { api } = useCtx();
  const open = useStore(api.store, (s) => s.exportOpen);
  const doc = useStore(api.store, (s) => s.doc);
  const theme = useStore(api.store, (s) => s.theme);
  const name = useStore(api.store, (s) => s.file.name);
  const url = useStore(api.store, (s) => s.file.url);
  const assets = useStore(api.store, (s) => s.assets);
  return (
    <>
      <ExportDialog
        open={open}
        onOpenChange={(o) => api.store.getState().set({ exportOpen: o })}
        root={doc}
        theme={theme}
        baseUrl={url ?? undefined}
        resolveAsset={(src) => assets[src]?.url}
        defaultName={name.replace(/\.diagram\.jsx$|\.jsx$/, "")}
      />
      <VideoImportDialog />
      <FolderChooserDialog />
      <ShortcutsDialog />
    </>
  );
}

// ---------------------------------------------------------------- top bar

const TOOLS: { tool: Tool; icon: ReactNode; label: string; key: string }[] = [
  { tool: "select", icon: <MousePointer2 />, label: "Move", key: "V" },
  { tool: "hand", icon: <Hand />, label: "Hand", key: "H" },
  { tool: "rect", icon: <Square />, label: "Rectangle", key: "R" },
  { tool: "ellipse", icon: <Circle />, label: "Ellipse", key: "O" },
  { tool: "text", icon: <Type />, label: "Text", key: "T" },
  { tool: "arrow", icon: <ArrowUpRight />, label: "Arrow", key: "L" },
  { tool: "table", icon: <Table2 />, label: "Table", key: "B" },
  { tool: "pencil", icon: <Pencil />, label: "Pencil", key: "P" },
];

function FileName({ actions }: { actions: Actions }) {
  const { api } = useCtx();
  const name = useStore(api.store, (s) => s.file.name);
  const dirty = useStore(api.store, (s) => s.dirty);
  const folder = useStore(api.store, (s) => s.file.folder);
  const handle = useStore(api.store, (s) => s.file.handle);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const base = name.replace(/\.diagram\.jsx$/, "");
  const where = folder ? `In “${folder.name}”` : handle ? "File on disk" : "Not saved yet";
  if (editing) {
    return (
      <input
        autoFocus
        className="h-7 w-56 rounded-md border border-ring bg-background px-2 text-center text-sm outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          setEditing(false);
          if (text.trim() && text.trim() !== base) void actions.rename(text);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(base);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <Tip label={`${where} · click to rename`} delay={300}>
      <Button
        variant="ghost"
        size="default"
        onClick={() => {
          setText(base);
          setEditing(true);
        }}
        className="max-w-full min-w-0 gap-1.5 text-sm"
      >
        <span className="truncate font-medium">{base}</span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground max-lg:hidden">.diagram.jsx</span>
        {dirty && <span aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />}
      </Button>
    </Tip>
  );
}

const TopBar = memo(function TopBar({ actions, homeHref, appTheme, onToggleTheme }: { actions: Actions; homeHref: string; appTheme: "light" | "dark"; onToggleTheme: () => void }) {
  const { api } = useCtx();
  const canUndo = useStore(api.store, (s) => s.past.length > 0);
  const canRedo = useStore(api.store, (s) => s.future.length > 0);
  const hasSel = useStore(api.store, (s) => s.selection.length > 0);
  const zoom = useStore(api.store, (s) => s.viewport.zoom);
  const showGrid = useStore(api.store, (s) => s.showGrid);
  const [recent, setRecent] = useState<string | null>(null);
  const help = useStore(api.store, (s) => s.help);
  const setHelp = (h: "ai" | "about" | null) => st().set({ help: h });
  useEffect(() => {
    lastRecent().then((r) => setRecent(r?.name ?? r?.file?.name ?? null));
  }, []);
  const st = api.store.getState;

  return (
    <header className="grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border px-2.5">
      <div className="flex min-w-0 items-center gap-1">
      <a href={homeHref} className="mr-1 flex size-8 items-center justify-center rounded-md hover:bg-foreground/[0.07]">
        <Logo className="size-[18px] text-foreground" />
      </a>
      {/* Avoid modal backdrop cutout measurements on every hover handoff. */}
      <Menubar modal={false} className="h-8 shrink-0 gap-0 border-none p-0">
        <MenubarMenu>
          <MenubarTrigger className={MENU_TRIGGER}>File</MenubarTrigger>
          <MenubarContent className="w-64">
            <MenubarItem onClick={actions.newFile}>New diagram</MenubarItem>
            <MenubarItem onClick={actions.open}>
              Open file… <MenubarShortcut>{mod}O</MenubarShortcut>
            </MenubarItem>
            {supportsFolders() && <MenubarItem onClick={actions.openFolder}>Open folder…</MenubarItem>}
            {recent && <MenubarItem onClick={actions.reopenLast}>Reopen {recent}</MenubarItem>}
            <MenubarSeparator />
            <MenubarItem onClick={() => actions.save(false)}>
              Save <MenubarShortcut>{mod}S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => actions.save(true)}>
              Save to another folder… <MenubarShortcut>{mod}⇧S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={actions.importFiles}>
              Import images, video, audio…
            </MenubarItem>
            <MenubarItem onClick={actions.openExport}>
              Export… <MenubarShortcut>{mod}⇧E</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className={MENU_TRIGGER}>Edit</MenubarTrigger>
          <MenubarContent className="w-60">
            <MenubarItem onClick={actions.undo} disabled={!canUndo}>
              Undo <MenubarShortcut>{mod}Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={actions.redo} disabled={!canRedo}>
              Redo <MenubarShortcut>{mod}⇧Z</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => actions.cut()} disabled={!hasSel}>
              Cut <MenubarShortcut>{mod}X</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => actions.copy()} disabled={!hasSel}>
              Copy as JSX <MenubarShortcut>{mod}C</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => actions.pasteFromClipboard()}>
              Paste <MenubarShortcut>{mod}V</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={actions.duplicate} disabled={!hasSel}>
              Duplicate <MenubarShortcut>{mod}D</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={actions.deleteSelection} disabled={!hasSel} variant="destructive">
              Delete <MenubarShortcut>Del</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={actions.selectAll}>
              Select all <MenubarShortcut>{mod}A</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={actions.selectNone}>
              Select none <MenubarShortcut>Esc</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={actions.editText} disabled={!hasSel}>
              Edit label <MenubarShortcut>Enter</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => actions.addToScratchpad()} disabled={!hasSel}>
              Add to scratchpad
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className={MENU_TRIGGER}>View</MenubarTrigger>
          <MenubarContent className="w-56">
            <MenubarItem onClick={() => api.zoomBy(1.25)}>
              Zoom in <MenubarShortcut>{mod}+</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => api.zoomBy(0.8)}>
              Zoom out <MenubarShortcut>{mod}−</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => api.zoomTo(1)}>
              Actual size <MenubarShortcut>⇧0</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={api.fit}>
              Fit page <MenubarShortcut>⇧1</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={api.zoomToSelection} disabled={!hasSel}>
              Zoom to selection <MenubarShortcut>⇧2</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={actions.toggleGrid}>
              {showGrid ? "Hide grid" : "Show grid"} <MenubarShortcut>{mod}'</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={onToggleTheme}>{appTheme === "dark" ? "Light mode" : "Dark mode"}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className={MENU_TRIGGER}>Arrange</MenubarTrigger>
          <MenubarContent className="w-60">
            <MenubarItem onClick={() => actions.reorder("front")} disabled={!hasSel}>
              Bring to front <MenubarShortcut>{mod}⇧F</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => actions.reorder("forward")} disabled={!hasSel}>
              Bring forward <MenubarShortcut>{mod}]</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => actions.reorder("backward")} disabled={!hasSel}>
              Send backward <MenubarShortcut>{mod}[</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => actions.reorder("back")} disabled={!hasSel}>
              Send to back <MenubarShortcut>{mod}⇧B</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger disabled={!hasSel}>Align</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onClick={() => actions.align("left")}>Left</MenubarItem>
                <MenubarItem onClick={() => actions.align("center")}>Center</MenubarItem>
                <MenubarItem onClick={() => actions.align("right")}>Right</MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => actions.align("top")}>Top</MenubarItem>
                <MenubarItem onClick={() => actions.align("middle")}>Middle</MenubarItem>
                <MenubarItem onClick={() => actions.align("bottom")}>Bottom</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSub>
              <MenubarSubTrigger disabled={!hasSel}>Distribute</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onClick={() => actions.distribute("h")}>Horizontally</MenubarItem>
                <MenubarItem onClick={() => actions.distribute("v")}>Vertically</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onClick={actions.group} disabled={!hasSel}>
              Group <MenubarShortcut>{mod}G</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={actions.ungroup} disabled={!hasSel}>
              Ungroup <MenubarShortcut>{mod}⇧U</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={actions.rotate90} disabled={!hasSel}>
              Rotate 90° <MenubarShortcut>{mod}R</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={actions.snapAllToGrid}>Snap everything to the grid</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className={MENU_TRIGGER}>Help</MenubarTrigger>
          <MenubarContent className="w-56">
            <MenubarItem onClick={() => setHelp("ai")}>
              <Sparkles /> Edit with AI…
            </MenubarItem>
            <MenubarItem onClick={() => st().set({ shortcutsOpen: true })}>
              <Keyboard /> Keyboard shortcuts
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => setHelp("about")}>
              <Info /> About nn-diagram
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <AiDialog open={help === "ai"} onOpenChange={(o) => setHelp(o ? "ai" : null)} />
      <AboutDialog open={help === "about"} onOpenChange={(o) => setHelp(o ? "about" : null)} />

      </div>

      <div className="flex max-w-[36vw] min-w-0 justify-center">
        <FileName actions={actions} />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1">
        <Tip label="Undo" shortcut={`${mod}Z`}>
          <IconButton disabled={!canUndo} onClick={actions.undo} aria-label="Undo">
            <Undo2 />
          </IconButton>
        </Tip>
        <Tip label="Redo" shortcut={`${mod}⇧Z`}>
          <IconButton disabled={!canRedo} onClick={actions.redo} aria-label="Redo">
            <Redo2 />
          </IconButton>
        </Tip>
        <div className="mx-1.5 h-4 w-px shrink-0 bg-border" />
        <DropdownMenu>
          <Tip label="Zoom and view">
            <DropdownMenuTrigger render={<Button variant="ghost" className="gap-1 px-2.5 text-[13px] font-normal tabular-nums hover:bg-foreground/[0.07] aria-expanded:bg-foreground/[0.07] dark:hover:bg-foreground/10" />}>
              {Math.round(zoom * 100)}%
              <ChevronDown className="size-3 text-muted-foreground" />
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => api.zoomBy(1.25)}>
              Zoom in <DropdownMenuShortcut>{mod}+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => api.zoomBy(0.8)}>
              Zoom out <DropdownMenuShortcut>{mod}−</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => api.zoomTo(1)}>
              Zoom to 100% <DropdownMenuShortcut>⇧0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={api.fit}>
              Zoom to fit <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={api.zoomToSelection} disabled={!hasSel}>
              Zoom to selection <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={actions.toggleGrid}>
              Show grid <DropdownMenuShortcut>{mod}'</DropdownMenuShortcut>
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tip label={appTheme === "dark" ? "Light mode" : "Dark mode"}>
          <IconButton onClick={onToggleTheme} aria-label="Toggle light/dark mode">
            {appTheme === "dark" ? <Sun /> : <Moon />}
          </IconButton>
        </Tip>
        <Tip label="Export…" shortcut={`${mod}⇧E`}>
          <IconButton onClick={actions.openExport} aria-label="Export">
            <Download />
          </IconButton>
        </Tip>
        <Button className="ml-1.5 px-3.5" onClick={() => actions.save(false)}>
          Save
        </Button>
      </div>
    </header>
  );
});

function Banners({ actions }: { actions: Actions }) {
  const { api } = useCtx();
  const pending = useStore(api.store, (s) => s.externalChange);
  const missing = useStore(api.store, (s) => s.missingAssets);
  const hasFolder = useStore(api.store, (s) => !!s.file.folder);
  return (
    <>
      {pending && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs">
          <AlertTriangle className="size-4 text-amber-600" />
          <span>The file changed on disk while you have unsaved edits.</span>
          <button type="button" className="rounded-md border border-border bg-background px-2 py-0.5 hover:bg-accent" onClick={actions.acceptExternalChange}>
            Load file from disk
          </button>
          <button type="button" className="rounded-md px-2 py-0.5 text-muted-foreground hover:bg-accent" onClick={() => api.store.getState().set({ externalChange: null })}>
            Keep my version
          </button>
        </div>
      )}
      {missing.length > 0 && !hasFolder && supportsFolders() && (
        <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-3 py-1.5 text-xs">
          <ImagePlus className="size-4 text-muted-foreground" />
          <span>
            This diagram uses {missing.length} media file{missing.length > 1 ? "s" : ""} next to it ({missing.slice(0, 3).join(", ")}
            {missing.length > 3 ? ", …" : ""}). Allow access to its folder to show them.
          </span>
          <button type="button" className="rounded-md border border-border bg-background px-2 py-0.5 hover:bg-accent" onClick={actions.connectFolder}>
            Choose folder…
          </button>
        </div>
      )}
    </>
  );
}

function Toast() {
  const { api } = useCtx();
  const toast = useStore(api.store, (s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);
  if (!toast || !visible) return null;
  return <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">{toast.message}</div>;
}

/** Tools, floating at the bottom of the canvas. */
function ToolDock({ actions }: { actions: Actions }) {
  const { api } = useCtx();
  const tool = useStore(api.store, (s) => s.tool);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
      <div className={cn(floatingPanel, "pointer-events-auto flex items-center gap-0.5 p-1")}>
        {TOOLS.map((t, i) => (
          <Fragment key={t.tool}>
            {(i === 2 || i === 7) && <div className="mx-1 h-5 w-px bg-border" />}
            <Tip label={t.label} shortcut={t.key} side="top">
              <IconButton
                aria-pressed={tool === t.tool}
                className={cn(tool === t.tool && "bg-[var(--nnd-accent,#0d99ff)]! text-white!")}
                onClick={() => actions.setTool(t.tool)}
                aria-label={t.label}
              >
                {t.icon}
              </IconButton>
            </Tip>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const TOOL_HINTS: Partial<Record<Tool, string>> = {
  rect: "Drag to draw a box, click for the default size. Shift: square.",
  ellipse: "Drag to draw an ellipse. Shift: circle.",
  text: "Click to place text.",
  arrow: "Drag from a shape, an arrow or empty space to connect.",
  table: "Click to place a table. Double-click a cell to edit it.",
  pencil: "Draw freehand. Esc to stop.",
  hand: "Drag to pan.",
};

/** Shown on an empty page: how to start. Clicks go through to the canvas except on the buttons. */
function EmptyCanvas({ actions }: { actions: Actions }) {
  const { api } = useCtx();
  const empty = useStore(api.store, (s) => !s.doc.children.some((c) => c.kind === "element"));
  const tool = useStore(api.store, (s) => s.tool);
  // The hint sits on the page, so it follows the diagram theme, not the UI theme.
  const theme = useStore(api.store, (s) => s.theme);
  if (!empty || tool !== "select") return null;
  return (
    <div className={cn(theme === "dark" ? "dark" : "light", "pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-foreground")}>
      <div className="flex max-w-xs flex-col items-center text-center animate-in fade-in-0 zoom-in-95 duration-300">
        <div className="text-sm font-medium">Start your diagram</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Drag a shape from the left, press R to draw a box, or let an AI agent draw it for you.</p>
        <div className="pointer-events-auto mt-4 flex gap-2">
          <Button variant="outline" size="sm" onClick={actions.open}>
            <FolderOpen data-icon="inline-start" /> Open file
          </Button>
          <Button variant="outline" size="sm" onClick={() => api.store.getState().set({ help: "ai" })}>
            <Sparkles data-icon="inline-start" /> Edit with AI
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Small info in the bottom-left corner of the canvas: counts, selection or tool hint. */
function CanvasInfo() {
  const { api, layout } = useEditorContext();
  const selection = useStore(api.store, (s) => s.selection);
  const tool = useStore(api.store, (s) => s.tool);
  const sel = selection.length === 1 ? layout?.shapes.get(selection[0]) : null;
  const text =
    TOOL_HINTS[tool] ??
    (selection.length === 0
      ? `${layout?.shapes.size ?? 0} shapes · ${layout?.edges.length ?? 0} arrows`
      : sel
        ? `${sel.node.name}${sel.id ? ` #${sel.id}` : ""} · ${Math.round(sel.bounds.w)} × ${Math.round(sel.bounds.h)}`
        : `${selection.length} selected`);
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(50%-11rem)] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums backdrop-blur max-md:hidden">
      {text}
    </div>
  );
}

/** Validation problems, shown in the bottom-right corner of the canvas only when there are any. */
function IssuesBadge({ actions }: { actions: Actions }) {
  const { api } = useCtx();
  const doc = useStore(api.store, (s) => s.doc);
  const header = useStore(api.store, (s) => s.header);
  const [issues, setIssues] = useState<Issue[]>([]);
  useEffect(() => {
    const id = window.setTimeout(() => setIssues(validateDiagram({ root: doc, header })), 300);
    return () => window.clearTimeout(id);
  }, [doc, header]);
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const gridWarnings = issues.filter((i) => i.message.includes("grid")).length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return (
    <div className="absolute right-3 bottom-3 z-10">
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="xs" className={cn("bg-background/90 shadow-sm backdrop-blur", errors ? "text-destructive" : "text-amber-600 dark:text-amber-500")}>
              <AlertTriangle data-icon="inline-start" />
              {[errors && plural(errors, "error"), warnings && plural(warnings, "warning")].filter(Boolean).join(" · ")}
            </Button>
          }
        />
        <PopoverContent side="top" align="end" sideOffset={6} className="max-h-80 w-96 gap-0 overflow-y-auto p-2 text-xs">
          {gridWarnings > 0 && (
            <Button variant="outline" size="sm" className="mb-2 w-full justify-start" onClick={actions.snapAllToGrid}>
              <Wand2 data-icon="inline-start" /> Snap everything to the grid ({plural(gridWarnings, "warning")})
            </Button>
          )}
          {issues.map((i, k) => (
            <div key={k} className="flex gap-2 border-b border-border px-1 py-1.5 last:border-0">
              <span className={i.severity === "error" ? "text-destructive" : "text-amber-600"}>{i.severity === "error" ? "●" : "▲"}</span>
              <span>
                {i.where && <span className="font-mono text-[10px] text-muted-foreground">{i.where} </span>}
                {i.message}
              </span>
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Preview of a library item while it is dragged: the real shape at canvas zoom. */
function LibraryDragGhost() {
  const { api } = useCtx();
  const drag = useStore(api.store, (s) => s.libraryDrag);
  const zoom = useStore(api.store, (s) => s.viewport.zoom);
  const theme = useStore(api.store, (s) => s.theme);
  const [bounds, setBounds] = useState<Rect | null>(null);
  if (!drag || typeof document === "undefined") return null;
  const b = bounds ?? { x: 0, y: 0, w: 0, h: 0 };
  return createPortal(
    drag.overCanvas ? (
      <div className="pointer-events-none fixed z-[100] opacity-80" style={{ left: drag.x - (b.w * zoom) / 2, top: drag.y - (b.h * zoom) / 2 }}>
        <SnippetPreview
          snippet={drag.snippet}
          assets={drag.assets}
          zoom={zoom}
          theme={theme}
          onBounds={(r) => {
            setBounds(r);
            libraryDragOffset.current = { x: r.w / 2, y: r.h / 2 };
          }}
        />
      </div>
    ) : (
      <div className="pointer-events-none fixed z-[100] flex items-center gap-2 rounded-lg border border-border bg-popover px-2 py-1.5 text-xs shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>
        <SnippetThumb snippet={drag.snippet} assets={drag.assets} size={{ w: 36, h: 28 }} theme={theme} />
        {drag.label}
      </div>
    ),
    document.body,
  );
}

export type { EditorStore };
