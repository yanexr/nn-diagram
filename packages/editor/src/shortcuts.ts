/**
 * Keyboard shortcuts.
 * Clipboard uses the native copy/cut/paste events, so copied shapes are plain
 * JSX text that can be pasted into an LLM chat and back, and images from the
 * clipboard become image elements.
 */
import { useEffect } from "react";
import type { Actions } from "./actions";
import type { EditorApi } from "./context";
import type { Tool } from "./store";

export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Shortcut text with the platform's modifier names (⌘ and ⌥ on macOS). */
export const platformKeys = (keys: string) => (IS_MAC ? keys.replace(/Ctrl\+?/g, "⌘").replace(/Alt\+?/g, "⌥") : keys);

export const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", r: "rect", o: "ellipse", t: "text", l: "arrow", b: "table", p: "pencil" };

export const SHORTCUTS: [string, string][] = [
  ["V / H", "Move tool / hand tool"],
  ["R / O / T / L", "Rectangle / ellipse / text / arrow"],
  ["B", "Table"],
  ["P", "Pencil (freehand)"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["Ctrl+C / X / V", "Copy / cut / paste (shapes as JSX, images from the clipboard)"],
  ["Ctrl+D", "Duplicate"],
  ["Delete", "Delete (and connected arrows)"],
  ["Ctrl+A", "Select all"],
  ["Esc", "Deselect / leave group / back to the move tool"],
  ["Tab / Shift+Tab", "Select next / previous"],
  ["Enter / F2", "Edit label"],
  ["Arrows", "Move 1 px (Shift: grid)"],
  ["Ctrl+Arrows", "Resize 1 px (Shift: grid)"],
  ["Ctrl+G / Ctrl+Shift+U", "Group / ungroup"],
  ["Ctrl+Shift+F / B", "Bring to front / send to back"],
  ["Ctrl+] / Ctrl+[", "Bring forward / send backward"],
  ["Ctrl+R", "Rotate 90°"],
  ["Ctrl+S / Ctrl+Shift+S", "Save / save as"],
  ["Ctrl+O", "Open"],
  ["Ctrl+Shift+E", "Export"],
  ["Ctrl+'", "Show / hide grid"],
  ["Shift+1 / Shift+2 / Shift+0", "Fit page / zoom to selection / 100%"],
  ["Ctrl+wheel, Ctrl +/-", "Zoom"],
  ["Space+drag, middle drag, wheel", "Pan"],
  ["Shift (drag)", "Constrain axis / keep aspect ratio"],
  ["Alt (drag)", "Disable snapping, rubber band over shapes"],
  ["Ctrl (drag)", "Duplicate while dragging"],
  ["Right-click", "Context menu"],
  ["Double-click group", "Enter group"],
];

/**
 * Blocks the browser's page zoom while the editor is open:
 * Ctrl/Cmd + wheel or pinch, Ctrl/Cmd + +/-/0 and Safari's gesture zoom.
 * A zoomed page renders the canvas at fractional device pixels, where
 * outlines and selection handles no longer line up. The canvas has its own
 * zoom for these inputs; zoom from the browser menu cannot be blocked.
 */
export function usePreventPageZoom() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const zoomKey = ["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"].includes(e.code) || ["+", "-", "=", "0"].includes(e.key);
      if ((e.ctrlKey || e.metaKey) && !e.altKey && zoomKey) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("gesturestart", onGesture);
    window.addEventListener("gesturechange", onGesture);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("gesturestart", onGesture);
      window.removeEventListener("gesturechange", onGesture);
    };
  }, []);
}

export function useShortcuts(api: EditorApi, actions: Actions, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || api.store.getState().editingText) return;
      if ((e.target as Element | null)?.closest?.('[role="listbox"], [role="menu"], [role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const grid = api.layout()?.grid ?? 4;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (mod) {
        if (key === "z") return run(() => (e.shiftKey ? actions.redo() : actions.undo()));
        if (key === "y") return run(actions.redo);
        if (key === "s") return run(() => actions.save(e.shiftKey));
        if (key === "o") return run(actions.open);
        if (key === "d") return run(actions.duplicate);
        if (key === "a") return run(() => (e.shiftKey ? actions.selectNone() : actions.selectAll()));
        if (key === "g" && !e.shiftKey) return run(actions.group);
        if (e.shiftKey && key === "u") return run(actions.ungroup);
        if (e.shiftKey && key === "f") return run(() => actions.reorder("front"));
        if (e.shiftKey && key === "b") return run(() => actions.reorder("back"));
        if (e.shiftKey && key === "e") return run(actions.openExport);
        if (key === "]") return run(() => actions.reorder("forward"));
        if (key === "[") return run(() => actions.reorder("backward"));
        if (key === "r") return run(actions.rotate90);
        if (key === "'") return run(actions.toggleGrid);
        if (key === "=" || key === "+") return run(() => api.zoomBy(1.25));
        if (key === "-") return run(() => api.zoomBy(0.8));
        if (key === "0") return run(() => api.zoomTo(1));
        if (e.shiftKey && key === "h") return run(api.fit);
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[key]) {
          // Ctrl+arrows resize
          const step = e.shiftKey ? grid : 1;
          return run(() => actions.resizeBy(arrows[key][0] * step, arrows[key][1] * step));
        }
        return;
      }
      if (e.shiftKey && (e.code === "Digit1" || key === "!")) return run(api.fit);
      if (e.shiftKey && (e.code === "Digit2" || key === "@")) return run(api.zoomToSelection);
      if (e.shiftKey && (e.code === "Digit0" || key === ")")) return run(() => api.zoomTo(1));
      if (key === "Delete" || key === "Backspace") return run(actions.deleteSelection);
      if (key === "Escape") {
        const s = api.store.getState();
        return run(() => (s.tool !== "select" ? actions.setTool("select") : actions.selectNone()));
      }
      if (key === "Enter" || key === "F2") return run(actions.editText);
      if (key === "Tab") return run(() => actions.selectSibling(e.shiftKey ? -1 : 1));
      if (!e.shiftKey && !e.altKey && TOOL_KEYS[key]) return run(() => actions.setTool(TOOL_KEYS[key]));
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[key]) {
        const step = e.shiftKey ? grid : 1;
        return run(() => actions.nudge(arrows[key][0] * step, arrows[key][1] * step));
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping()) return;
      const text = actions.copyText();
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (isTyping()) return;
      const text = actions.copyText();
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
      actions.deleteSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping()) return;
      const data = e.clipboardData;
      if (!data) return;
      // Images (e.g. copied from a website) take precedence over their HTML/text.
      const files = Array.from(data.files).filter((f) => /^(image|video|audio)\//.test(f.type));
      if (files.length) {
        e.preventDefault();
        void actions.insertMedia(files);
        return;
      }
      const text = data.getData("text/plain");
      if (text && text.trim()) {
        e.preventDefault();
        actions.paste(text);
        return;
      }
      const html = data.getData("text/html");
      const src = html && /<img[^>]+src="([^"]+)"/i.exec(html)?.[1];
      if (src) {
        e.preventDefault();
        void (async () => {
          try {
            const blob = await (await fetch(src)).blob();
            await actions.insertMedia([new File([blob], src.split("/").pop()?.split("?")[0] || "pasted-image", { type: blob.type })]);
          } catch {
            api.store.getState().showToast("Could not paste that image (the website does not allow it). Save it and drop the file instead.");
          }
        })();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [api, actions, enabled]);
}
