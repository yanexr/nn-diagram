import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { EdgeGeometry, Layout, Pt } from "@nn-diagram/viewer";
import type { Actions } from "./actions";
import type { LibrarySection } from "./library";
import type { EditorActions, EditorState, EditorStore } from "./store";

/** Imperative helpers shared by the canvas, panels and menus. */
export interface EditorApi {
  store: EditorStore;
  /** Latest layout of the current document. */
  layout: () => Layout | null;
  routes: () => ReadonlyMap<string, EdgeGeometry>;
  fit: () => void;
  zoomToSelection: () => void;
  zoomBy: (factor: number) => void;
  zoomTo: (zoom: number) => void;
  /** Center of the visible canvas, in diagram coordinates. */
  viewCenter: () => Pt;
  /** Inserts JSX (shapes with coordinates relative to 0,0) at a point or the view center. */
  insertSnippet: (snippet: string, at?: Pt) => void;
  startTextEdit: (uid: string) => void;
  canvasElement: () => HTMLElement | null;
  /** The app's save handler (`onSave` prop), if it stores files itself. */
  onSave: () => ((source: string, info: { name: string }) => void | Promise<void>) | undefined;
}

export interface EditorContextValue {
  api: EditorApi;
  actions: Actions;
  layout: Layout | null;
  routes: ReadonlyMap<string, EdgeGeometry>;
  onMeasure: (uid: string, size: { w: number; h: number }) => void;
  /** Sidebar shape sections. */
  libraries: LibrarySection[];
}

export const EditorContext = createContext<EditorContextValue | null>(null);
export type EditorServices = Pick<EditorContextValue, "api" | "actions" | "libraries">;
/** Store/actions do not change when the document's layout changes. */
export const EditorServicesContext = createContext<EditorServices | null>(null);

export function useEditorServices(): EditorServices {
  const ctx = useContext(EditorServicesContext);
  if (!ctx) throw new Error("Editor components must be inside <DiagramEditor>");
  return ctx;
}

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("Editor components must be inside <DiagramEditor>");
  return ctx;
}

export function useEd<T>(selector: (s: EditorState & EditorActions) => T): T {
  const { api } = useEditorServices();
  return useStore(api.store, selector);
}
