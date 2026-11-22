/** Pan/zoom state shared by the viewer and the editor. */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Pt } from "./geometry";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function screenToDiagram(vp: Viewport, p: Pt): Pt {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

export function diagramToScreen(vp: Viewport, p: Pt): Pt {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}

export function zoomAround(vp: Viewport, factor: number, at: Pt): Viewport {
  const zoom = clampZoom(vp.zoom * factor);
  const k = zoom / vp.zoom;
  return { zoom, x: at.x - (at.x - vp.x) * k, y: at.y - (at.y - vp.y) * k };
}

export function fitRect(
  container: { w: number; h: number },
  rect: { x: number; y: number; w: number; h: number },
  padding = 32,
  maxZoom = 2,
): Viewport {
  const zoom = clampZoom(
    Math.min((container.w - padding * 2) / Math.max(rect.w, 1), (container.h - padding * 2) / Math.max(rect.h, 1), maxZoom),
  );
  return {
    zoom,
    x: (container.w - rect.w * zoom) / 2 - rect.x * zoom,
    y: (container.h - rect.h * zoom) / 2 - rect.y * zoom,
  };
}

/**
 * Wheel handling: wheel/trackpad scroll pans, ctrl/cmd + wheel and pinch zoom
 * at the cursor. Shift + wheel pans horizontally.
 */
export function useWheelPanZoom(
  ref: RefObject<HTMLElement | null>,
  setViewport: (fn: (vp: Viewport) => Viewport) => void,
  enabled = true,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      // Scrollable overlay text (the walk-through card) scrolls natively.
      if (!e.ctrlKey && !e.metaKey && e.target instanceof Element) {
        const scroller = e.target.closest<HTMLElement>("[data-nnd-scroll]");
        if (scroller && scroller.scrollHeight > scroller.clientHeight) return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * unit * 0.0022);
        const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setViewport((vp) => zoomAround(vp, factor, at));
      } else {
        let dx = e.deltaX * unit;
        let dy = e.deltaY * unit;
        if (e.shiftKey && Math.abs(dx) < 0.01) {
          dx = dy;
          dy = 0;
        }
        setViewport((vp) => ({ ...vp, x: vp.x - dx, y: vp.y - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, setViewport, enabled]);
}

/** Tracks the size of an element. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Viewport state that fits the page to the container, and keeps refitting
 * on resize until the user pans or zooms.
 */
/**
 * Viewport with auto-fit until the user pans or zooms. `insets` keeps strips
 * at the top/bottom free (floating toolbars) when fitting.
 */
export function useViewportState(
  containerRef: RefObject<HTMLElement | null>,
  page: { w: number; h: number } | null,
  insets: { top?: number; bottom?: number } = {},
) {
  const top = insets.top ?? 0;
  const bottom = insets.bottom ?? 0;
  const size = useElementSize(containerRef);
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const autoFit = useRef(true);
  const setViewport = useCallback((fn: Viewport | ((vp: Viewport) => Viewport)) => {
    autoFit.current = false;
    setViewportState((vp) => (typeof fn === "function" ? fn(vp) : fn));
  }, []);
  const fit = useCallback(
    (maxZoom = 2) => {
      if (!size || !page) return;
      autoFit.current = true;
      const vp = fitRect({ w: size.w, h: Math.max(1, size.h - top - bottom) }, { x: 0, y: 0, w: page.w, h: page.h }, Math.min(32, size.w * 0.04), maxZoom);
      setViewportState({ ...vp, y: vp.y + top });
    },
    [size, page, top, bottom],
  );
  useEffect(() => {
    if (autoFit.current && size && page && size.w > 0 && size.h > 0) fit();
  }, [size, page, fit]);
  return { viewport, setViewport, fit, size };
}
