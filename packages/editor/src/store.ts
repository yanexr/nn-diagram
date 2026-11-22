/**
 * Editor state: the document, selection, undo history, viewport and file.
 *
 * Every edit produces a new immutable document root. Undo snapshots are just
 * previous roots (structural sharing keeps them cheap). Continuous gestures
 * (dragging, typing in a field) are merged into a single undo step.
 */
import { createStore, useStore } from "zustand";
import {
  element,
  parseDiagram,
  serializeDiagram,
  walk,
  type DiagramFile,
  type ElementNode,
} from "@nn-diagram/format";
import type { DiagramTheme, Viewport } from "@nn-diagram/viewer";

export interface Snapshot {
  doc: ElementNode;
  selection: string[];
}

export interface FileInfo {
  name: string;
  handle: FileSystemFileHandle | null;
  /** Folder of the diagram: media files are saved next to the diagram file. */
  folder: FileSystemDirectoryHandle | null;
  /** Previous name after a rename that is not on disk yet. */
  renamedFrom: string | null;
  /** lastModified of the file on disk when we last read or wrote it. */
  lastModified: number | null;
  /** Text as last loaded or saved, to detect unsaved changes. */
  savedText: string;
  /** Source URL when opened from the website. */
  url: string | null;
}

export type Tool = "select" | "hand" | "rect" | "ellipse" | "text" | "arrow" | "table" | "pencil";

/** A media file used by the diagram (`src` = its path relative to the diagram). */
export interface Asset {
  /** Object URL for rendering. */
  url: string;
  /** File content when it still has to be written next to the diagram. */
  blob: Blob | null;
}

export interface ScratchItem {
  id: string;
  label: string;
  snippet: string;
}

export interface EditorState {
  doc: ElementNode;
  header: string[];
  selection: string[];
  /** Selection displayed by the inspector during a marquee. Null outside the gesture. */
  marqueeInspectorSelection?: string[] | null;
  /** Group the user double-clicked into; its children are selected directly. */
  enteredGroup: string | null;
  past: Snapshot[];
  future: Snapshot[];
  /** Key of the last commit, used to merge continuous edits into one undo step. */
  lastMerge: { key: string; time: number } | null;
  gesture: Snapshot | null;
  dirty: boolean;
  editingText: string | null;
  viewport: Viewport;
  theme: DiagramTheme;
  showGrid: boolean;
  snapToGrid: boolean;
  file: FileInfo;
  /** File on disk changed while there are unsaved edits. */
  externalChange: string | null;
  toast: { message: string; time: number } | null;
  /** Hovered element in the layers panel. */
  hoverUid: string | null;
  tool: Tool;
  pen: { color: string; size: number };
  /** Media by relative path. */
  assets: Record<string, Asset>;
  /** Relative media paths that exist but could not be read yet (no folder access). */
  missingAssets: string[];
  scratchpad: ScratchItem[];
  /** A drag from the canvas is over the scratchpad. */
  scratchHover: boolean;
  /** Snippet being dragged from the library. */
  libraryDrag: { snippet: string; label: string; assets?: Record<string, string>; x: number; y: number; overCanvas: boolean } | null;
  exportOpen: boolean;
  /** Video waiting for trim/playback options before it is inserted. */
  mediaDialog: { name: string; url: string; duration: number; size: { w: number; h: number }; at: { x: number; y: number } | null } | null;
  /** Diagrams found in a folder the user opened. */
  folderChooser: { folder: FileSystemDirectoryHandle; names: string[] } | null;
  shortcutsOpen: boolean;
  /** Open help dialog. */
  help: "ai" | "about" | null;
}

export const DEFAULT_DIAGRAM = `<Diagram width={960} height={640} grid={4}>
</Diagram>
`;

const HISTORY_LIMIT = 200;
const MERGE_WINDOW = 1200;

function initialState(): EditorState {
  const file = parseDiagram(DEFAULT_DIAGRAM);
  return {
    doc: file.root,
    header: file.header,
    selection: [],
    marqueeInspectorSelection: null,
    enteredGroup: null,
    past: [],
    future: [],
    lastMerge: null,
    gesture: null,
    dirty: false,
    editingText: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    theme: "light",
    showGrid: true,
    snapToGrid: true,
    file: { name: "untitled.diagram.jsx", handle: null, folder: null, renamedFrom: null, lastModified: null, savedText: DEFAULT_DIAGRAM, url: null },
    externalChange: null,
    toast: null,
    hoverUid: null,
    tool: "select",
    pen: { color: "#e11d48", size: 4 },
    assets: {},
    missingAssets: [],
    scratchpad: [],
    scratchHover: false,
    libraryDrag: null,
    exportOpen: false,
    mediaDialog: null,
    folderChooser: null,
    shortcutsOpen: false,
    help: null,
  };
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export function createEditorStore() {
  return createStore<EditorState & EditorActions>()((set, get) => ({
    ...initialState(),

    commit(doc, opts = {}) {
      const s = get();
      if (doc === s.doc && !opts.selection) return;
      const now = Date.now();
      const merge = opts.merge && s.lastMerge && s.lastMerge.key === opts.merge && now - s.lastMerge.time < MERGE_WINDOW;
      const past = merge ? s.past : [...s.past, { doc: s.doc, selection: s.selection }].slice(-HISTORY_LIMIT);
      set({
        doc,
        past,
        future: [],
        selection: opts.selection ?? pruneSelection(doc, s.selection),
        dirty: doc !== s.doc ? true : s.dirty,
        lastMerge: opts.merge ? { key: opts.merge, time: now } : null,
      });
    },

    beginGesture() {
      const s = get();
      set({ gesture: { doc: s.doc, selection: s.selection }, lastMerge: null });
    },

    updateGesture(doc, selection) {
      set(selection ? { doc, selection } : { doc });
    },

    endGesture() {
      const s = get();
      const g = s.gesture;
      if (!g) return;
      if (g.doc !== s.doc) {
        set({ gesture: null, past: [...s.past, g].slice(-HISTORY_LIMIT), future: [], dirty: true });
      } else {
        set({ gesture: null });
      }
    },

    cancelGesture() {
      const g = get().gesture;
      if (g) set({ doc: g.doc, selection: g.selection, gesture: null });
    },

    undo() {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        doc: prev.doc,
        selection: pruneSelection(prev.doc, prev.selection),
        past: s.past.slice(0, -1),
        future: [{ doc: s.doc, selection: s.selection }, ...s.future],
        dirty: true,
        lastMerge: null,
        editingText: null,
      });
    },

    redo() {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({
        doc: next.doc,
        selection: pruneSelection(next.doc, next.selection),
        past: [...s.past, { doc: s.doc, selection: s.selection }],
        future: s.future.slice(1),
        dirty: true,
        lastMerge: null,
        editingText: null,
      });
    },

    select(uids) {
      const s = get();
      // Pointer down/up can select the same shape. Preserve identity so the
      // canvas and inspector do not render again for an unchanged selection.
      if (s.selection.length === uids.length && s.selection.every((uid, i) => uid === uids[i])) {
        if (s.lastMerge) set({ lastMerge: null });
        return;
      }
      const marqueeInspectorSelection = s.marqueeInspectorSelection != null && uids.length !== 1 ? uids : s.marqueeInspectorSelection;
      set({ selection: uids, marqueeInspectorSelection, lastMerge: null });
    },

    setViewport(fn) {
      set((s) => ({ viewport: typeof fn === "function" ? fn(s.viewport) : fn }));
    },

    load(file, info, opts = {}) {
      const s = get();
      // Keep the selection across reloads by matching ids.
      const selectedIds = opts.keepView ? idsOf(s.doc, s.selection) : [];
      const selection = opts.keepView ? uidsForIds(file.root, selectedIds) : [];
      set({
        doc: file.root,
        header: file.header,
        selection,
        enteredGroup: null,
        past: opts.keepView ? [...s.past, { doc: s.doc, selection: s.selection }].slice(-HISTORY_LIMIT) : [],
        future: [],
        dirty: false,
        editingText: null,
        file: { ...s.file, ...info },
        externalChange: null,
        lastMerge: null,
        ...(opts.keepView ? {} : { assets: {}, missingAssets: [] }),
      });
      if (!opts.keepView) for (const a of Object.values(s.assets)) URL.revokeObjectURL(a.url);
    },

    markSaved(text, info) {
      set((s) => ({ dirty: false, file: { ...s.file, ...info, savedText: text }, externalChange: null }));
    },

    serialize() {
      const s = get();
      return serializeDiagram({ root: s.doc, header: s.header });
    },

    showToast(message) {
      set({ toast: { message, time: Date.now() } });
    },

    set: (partial) => set(partial),
  }));
}

export interface EditorActions {
  commit(doc: ElementNode, opts?: { selection?: string[]; merge?: string }): void;
  beginGesture(): void;
  updateGesture(doc: ElementNode, selection?: string[]): void;
  endGesture(): void;
  cancelGesture(): void;
  undo(): void;
  redo(): void;
  select(uids: string[]): void;
  setViewport(fn: Viewport | ((vp: Viewport) => Viewport)): void;
  load(file: DiagramFile, info: Partial<FileInfo>, opts?: { keepView?: boolean }): void;
  markSaved(text: string, info: Partial<FileInfo>): void;
  serialize(): string;
  showToast(message: string): void;
  set(partial: Partial<EditorState>): void;
}

function allUids(root: ElementNode): Set<string> {
  const uids = new Set<string>();
  walk(root, (n) => {
    uids.add(n.uid);
  });
  return uids;
}

function pruneSelection(doc: ElementNode, selection: string[]): string[] {
  if (selection.length === 0) return selection;
  const uids = allUids(doc);
  const next = selection.filter((u) => uids.has(u));
  return next.length === selection.length ? selection : next;
}

function idsOf(doc: ElementNode, uids: string[]): string[] {
  const set = new Set(uids);
  const ids: string[] = [];
  walk(doc, (n) => {
    if (set.has(n.uid) && typeof n.props.id === "string") ids.push(n.props.id);
  });
  return ids;
}

function uidsForIds(doc: ElementNode, ids: string[]): string[] {
  const set = new Set(ids);
  const uids: string[] = [];
  walk(doc, (n) => {
    if (typeof n.props.id === "string" && set.has(n.props.id)) uids.push(n.uid);
  });
  return uids;
}

export function useEditor<T>(store: EditorStore, selector: (s: EditorState & EditorActions) => T): T {
  return useStore(store, selector);
}

export function emptyDiagram(): ElementNode {
  return element("Diagram", { width: 960, height: 640, grid: 4 });
}
