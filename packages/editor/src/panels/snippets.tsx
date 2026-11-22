/** Rendering of library snippets: sidebar thumbnails and the drag preview. */
import { memo, useEffect, useState } from "react";
import { element, parseFragment, type ElementNode } from "@nn-diagram/format";
import { DiagramView, collectClasses, ensureClasses, useDiagramLayout, type EdgeGeometry, type Layout, type Rect } from "@nn-diagram/viewer";
import { unionRect } from "../commands";

const rootCache = new Map<string, ElementNode | null>();

export function snippetRoot(snippet: string): ElementNode | null {
  if (!rootCache.has(snippet)) {
    try {
      rootCache.set(snippet, element("Diagram", { width: 2000, height: 2000 }, parseFragment(snippet)));
    } catch {
      rootCache.set(snippet, null);
    }
  }
  return rootCache.get(snippet)!;
}

/** Bounds of everything drawn (shapes and arrows). */
export function contentBounds(layout: Layout, routes: ReadonlyMap<string, EdgeGeometry>): Rect {
  const rects: Rect[] = [...layout.shapes.values()].map((s) => s.bounds);
  for (const g of routes.values()) {
    const xs = g.route.points.map((p) => p.x);
    const ys = g.route.points.map((p) => p.y);
    rects.push({ x: Math.min(...xs) - 4, y: Math.min(...ys) - 4, w: Math.max(...xs) - Math.min(...xs) + 8, h: Math.max(...ys) - Math.min(...ys) + 8 });
  }
  return unionRect(rects) ?? { x: 0, y: 0, w: 40, h: 40 };
}

/** Bounds of the shapes only (what insertSnippet positions). */
export function shapeBounds(layout: Layout): Rect {
  return unionRect([...layout.shapes.values()].filter((s) => !s.parentUid).map((s) => s.bounds)) ?? { x: 0, y: 0, w: 40, h: 40 };
}

/** A snippet scaled to fit a box (sidebar tiles). */
export const SnippetThumb = memo(function SnippetThumb({
  snippet,
  size,
  theme,
  bare,
  assets,
}: {
  snippet: string;
  size: { w: number; h: number };
  theme: "light" | "dark";
  bare?: boolean;
  /** Where the snippet's relative media paths are (library items with media). */
  assets?: Record<string, string>;
}) {
  const root = snippetRoot(snippet);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (root) ensureClasses(collectClasses(root)).then(() => setReady(true));
  }, [root]);
  const { layout, routes, onMeasure } = useDiagramLayout(root);
  if (!root || !layout) return <div style={{ width: size.w, height: size.h }} />;
  const pad = 2;
  const b = contentBounds(layout, routes);
  const scale = Math.min((size.w - pad * 2) / Math.max(b.w, 1), (size.h - pad * 2) / Math.max(b.h, 1), 1);
  return (
    <div className="pointer-events-none relative overflow-hidden" style={{ width: size.w, height: size.h, opacity: ready ? 1 : 0 }}>
      <div style={{ position: "absolute", left: (size.w - b.w * scale) / 2 - b.x * scale, top: (size.h - b.h * scale) / 2 - b.y * scale, transform: `scale(${scale})`, transformOrigin: "0 0", ["--nnd-thumb-scale" as string]: scale }}>
        <DiagramView
          root={root}
          layout={layout}
          routes={routes}
          theme={theme}
          onMeasure={onMeasure}
          resolveAsset={assets ? (src) => assets[src] : undefined}
          style={{ background: "transparent" }}
          className={bare ? "nnd-thumb nnd-thumb-bare" : "nnd-thumb"}
        />
      </div>
    </div>
  );
});

/**
 * The snippet at a given zoom, positioned so that its shapes' top-left
 * corner is at (0, 0). Used as the drag preview over the canvas.
 */
export function SnippetPreview({
  snippet,
  zoom,
  theme,
  assets,
  onBounds,
}: {
  snippet: string;
  zoom: number;
  theme: "light" | "dark";
  assets?: Record<string, string>;
  onBounds?: (b: Rect) => void;
}) {
  const root = snippetRoot(snippet);
  const { layout, routes, onMeasure } = useDiagramLayout(root);
  const b = layout ? shapeBounds(layout) : null;
  useEffect(() => {
    if (b) onBounds?.(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.x, b?.y, b?.w, b?.h]);
  if (!root || !layout || !b) return null;
  return (
    <div style={{ position: "absolute", left: -b.x * zoom, top: -b.y * zoom, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
      <DiagramView
        root={root}
        layout={layout}
        routes={routes}
        theme={theme}
        onMeasure={onMeasure}
        resolveAsset={assets ? (src) => assets[src] : undefined}
        style={{ background: "transparent" }}
        className="nnd-thumb"
      />
    </div>
  );
}
