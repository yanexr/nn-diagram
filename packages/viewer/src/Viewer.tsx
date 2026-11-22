"use client";
/**
 * Interactive, read-only diagram viewer: pan/zoom, hover explanations,
 * temporary dragging of components, explainer steps, a presentation pencil
 * and exports. Nothing done here changes the file.
 */
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Expand,
  Minus,
  Moon,
  Pencil,
  PencilRuler,
  Play,
  Plus,
  RotateCcw,
  Scan,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { getSpec, setProps, type DiagramFile, type ElementNode } from "@nn-diagram/format";
import { ExportDialog } from "./ExportDialog";
import { exportDiagram, renderDiagram, type ExportFormat, type ExportOptions } from "./export";
import type { Pt, Rect } from "./geometry";
import { Markdown } from "./markdown";
import { dimmedFor, readSteps, safeParse, useDiagramLayout, type StepInfo } from "./model";
import type { DiagramTheme } from "./render/context";
import { DiagramView } from "./render/DiagramView";
import { inkPath } from "./render/shapes";
import { collectClasses, ensureClasses } from "./tailwind/engine";
import { IconButton, Tip, TooltipProvider, cn, floatingPanel, themeScope } from "./ui";
import { diagramToScreen, fitRect, screenToDiagram, useViewportState, useWheelPanZoom, zoomAround } from "./viewport";

export interface DiagramViewerProps {
  /** Diagram file source. */
  source?: string;
  /** Or an already parsed file. */
  file?: DiagramFile;
  /** The app theme. The viewer's own toggle overrides it for the diagram until the app theme changes. */
  theme?: DiagramTheme;
  /** URL of the diagram file; relative image paths resolve against it. */
  baseUrl?: string;
  /** Used for export file names. */
  name?: string;
  /** Shows an "Open in editor" button linking here. */
  editHref?: string;
  /** Called when a component with a `link` is clicked. Defaults to normal navigation. */
  onNavigate?: (link: string) => void;
  /**
   * Which built-in controls to show. `true` (default) shows all, `false`
   * none (panning, wheel zoom and hover explanations still work).
   */
  controls?: boolean | ViewerControls;
  /** Current walk-through step (-1 = the whole diagram). Set it to control the steps yourself. */
  step?: number;
  /** Called when the step changes (step bar, arrow keys, Esc). */
  onStepChange?: (step: number) => void;
  /** Imperative API: fit, zoom, steps, export. */
  ref?: Ref<DiagramViewerHandle>;
  className?: string;
}

/** Built-in viewer controls; each defaults to true. */
export interface ViewerControls {
  /** Zoom buttons and fit. */
  zoom?: boolean;
  /** The presentation pencil. */
  pen?: boolean;
  /** Light/dark diagram toggle. */
  theme?: boolean;
  /** Export dialog. */
  export?: boolean;
  fullscreen?: boolean;
  /** The walk-through bar (for diagrams with <Steps>). */
  steps?: boolean;
}

export interface DiagramViewerHandle {
  fit(): void;
  /** Zoom to an absolute level (1 = 100%) around the center. */
  zoomTo(zoom: number): void;
  zoomBy(factor: number): void;
  /** The diagram's walk-through steps. */
  readonly steps: StepInfo[];
  /** Go to a step (-1 = the whole diagram). */
  setStep(step: number): void;
  /** Downloads the diagram (PDF opens the print dialog). Uses the current theme unless given. */
  export(format: ExportFormat, options?: Partial<Omit<ExportOptions, "format">>): Promise<void>;
  /** Renders the diagram to an image file in memory (not PDF). */
  render(format: Exclude<ExportFormat, "pdf">, options?: Partial<Omit<ExportOptions, "format" | "fileName">>): Promise<Blob>;
}

const ALL_CONTROLS: Required<ViewerControls> = { zoom: true, pen: true, theme: true, export: true, fullscreen: true, steps: true };

function resolveControls(c: boolean | ViewerControls | undefined): Required<ViewerControls> {
  if (c === undefined || c === true) return ALL_CONTROLS;
  if (c === false) return { zoom: false, pen: false, theme: false, export: false, fullscreen: false, steps: false };
  return { ...ALL_CONTROLS, ...c };
}

interface HoverState {
  uid: string;
  tipUid: string | null;
  /** Pointer position (for arrows). */
  at: { x: number; y: number };
}

interface Stroke {
  points: number[][];
  color: string;
  size: number;
}

const PEN_COLORS = ["#e11d48", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed", "#111827", "#ffffff"];
const PEN_SIZES = [2, 4, 8];

/** True after the first client render. Diagrams render client-side only (uids are runtime state). */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Wait until diagram styles exist before showing anything, to avoid a flash. */
export function useDiagramStyles(root: ElementNode | null) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!root) return;
    let alive = true;
    ensureClasses(collectClasses(root)).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [root]);
  return ready;
}

function navigate(link: string) {
  if (/^https?:/.test(link)) window.open(link, "_blank", "noopener");
  else window.location.href = link;
}

export const PAGE_COLORS: Record<DiagramTheme, string> = { light: "#ffffff", dark: "#141414" };

export function DiagramViewer({
  source,
  file: fileProp,
  theme: themeProp = "light",
  baseUrl,
  name = "diagram",
  editHref,
  onNavigate,
  controls: controlsProp,
  step: stepProp,
  onStepChange,
  ref,
  className,
}: DiagramViewerProps) {
  const controls = resolveControls(controlsProp);
  const toolbar = controls.zoom || controls.pen || controls.theme || controls.export || controls.fullscreen || !!editHref;
  const parsed = useMemo(() => (fileProp ? { file: fileProp, error: null } : safeParse(source ?? "")), [fileProp, source]);
  const original = parsed.file?.root ?? null;
  const [doc, setDoc] = useState<ElementNode | null>(original);
  useEffect(() => setDoc(original), [original]);

  const mounted = useMounted();
  // The local toggle only changes the diagram (and the viewer's docks); a
  // change of the app theme resets it.
  const [themeOverride, setThemeOverride] = useState<DiagramTheme | null>(null);
  useEffect(() => setThemeOverride(null), [themeProp]);
  const theme = themeOverride ?? themeProp;
  const ready = useDiagramStyles(doc);
  const { layout, routes, onMeasure } = useDiagramLayout(doc);

  const containerRef = useRef<HTMLDivElement>(null);
  const page = layout?.page ?? null;
  const steps = useMemo(() => (original ? readSteps(original) : []), [original]);
  const stepCount = steps.length;
  const stepsBar = controls.steps && stepCount > 0;
  // Keep the floating toolbar (top) and the steps bar (bottom) clear when fitting.
  const { viewport, setViewport, fit, size } = useViewportState(containerRef, page, { top: toolbar ? 36 : 0, bottom: stepsBar ? 48 : 0 });
  useWheelPanZoom(containerRef, setViewport);

  // ----------------------------------------------------------------- steps
  // Controlled when the `step` prop is set, otherwise local state.
  const [localStep, setLocalStep] = useState(-1);
  const step = stepProp ?? localStep;
  const stepRef = useRef(step);
  stepRef.current = step;
  const setStep = useCallback(
    (next: number | ((s: number) => number)) => {
      const value = typeof next === "function" ? next(stepRef.current) : next;
      const clamped = Math.max(-1, Math.min(steps.length - 1, value));
      if (clamped === stepRef.current) return;
      setLocalStep(clamped);
      onStepChange?.(clamped);
    },
    [steps.length, onStepChange],
  );
  // The camera glides to each step's focus, clear of the walk-through card
  // (left of it on wide viewers, above it on narrow ones), and back to the
  // whole page after the last step.
  const [glide, setGlide] = useState(false);
  const shownStep = useRef(step);
  // Steps pan and may zoom out to show their focus, but never zoom in: a reader who zoomed out keeps the overview.
  const zoomRef = useRef(viewport.zoom);
  zoomRef.current = viewport.zoom;
  const glideTimer = useRef(0);
  useEffect(() => {
    if (shownStep.current === step || !layout || !size) return;
    shownStep.current = step;
    const rects = step >= 0 ? (steps[step]?.focus ?? []).map((id) => layout.byId.get(id)?.bounds).filter((b): b is Rect => !!b) : [];
    setGlide(true);
    window.clearTimeout(glideTimer.current);
    glideTimer.current = window.setTimeout(() => setGlide(false), 500);
    if (!rects.length) {
      fit();
      return;
    }
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    const rect = { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
    const wide = size.w >= 640;
    const inset = { left: wide ? 340 : 0, top: toolbar ? 52 : 12, bottom: wide ? 12 : Math.min(240, size.h * 0.45) };
    const vp = fitRect({ w: size.w - inset.left, h: Math.max(1, size.h - inset.top - inset.bottom) }, rect, 48, zoomRef.current);
    setViewport({ ...vp, x: vp.x + inset.left, y: vp.y + inset.top });
  }, [step, steps, layout, size, toolbar, fit, setViewport]);

  const dimmed = useMemo(
    () => (doc && layout && step >= 0 && steps[step] ? dimmedFor(doc, layout, steps[step].focus) : null),
    [doc, layout, step, steps],
  );

  // ---------------------------------------------------------------- pencil
  const [pen, setPen] = useState(false);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(4);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState<Stroke | null>(null);

  // ----------------------------------------------------------------- hover
  const [hover, setHover] = useState<HoverState | null>(null);
  // State (not just the drag ref) so the cursor switches between grab and grabbing right away.
  const [panning, setPanning] = useState(false);

  const tipOwner = useCallback(
    (uid: string): string | null => {
      if (!layout || !doc) return null;
      let cur: string | null | undefined = uid;
      while (cur) {
        const node = layout.shapes.get(cur)?.node ?? layout.edges.find((e) => e.uid === cur)?.node;
        if (node && (typeof node.props.tip === "string" || typeof node.props.link === "string")) return cur;
        cur = layout.parents.get(cur);
      }
      return null;
    },
    [layout, doc],
  );

  // ----------------------------------------------------------- interaction
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; vx: number; vy: number; moved: boolean }
    | { kind: "move"; uid: string; hit: string; startX: number; startY: number; ox: number; oy: number; moved: boolean; link: string | null }
    | { kind: "draw" }
    | null
  >(null);

  const selectable = useCallback(
    (uid: string): string => {
      // A click inside a <Group> moves the outermost group, like in the editor.
      if (!layout) return uid;
      let target = uid;
      let cur = layout.parents.get(uid);
      while (cur) {
        const node = layout.shapes.get(cur)?.node;
        if (node && getSpec(node.name)?.selectAsGroup) target = cur;
        cur = layout.parents.get(cur);
      }
      return target;
    },
    [layout],
  );

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const toDiagram = (e: { clientX: number; clientY: number }): Pt => screenToDiagram(viewport, localPoint(e));

  // Two-finger pinch zoom and pan on touch screens.
  const touches = useRef(new Map<number, Pt>());
  const pinch = useRef<{ dist: number; mid: Pt } | null>(null);
  const pinchState = () => {
    const [a, b] = [...touches.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    containerRef.current?.focus({ preventScroll: true });
    containerRef.current?.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, localPoint(e));
      if (touches.current.size === 2) {
        drag.current = null;
        setPanning(false);
        setDrawing(null);
        pinch.current = pinchState();
        return;
      }
    }
    if (pen && e.button === 0) {
      const p = toDiagram(e);
      drag.current = { kind: "draw" };
      setDrawing({ points: [[p.x, p.y]], color: penColor, size: penSize });
      setHover(null);
      return;
    }
    const target = (e.target as Element).closest("[data-uid]");
    const uid = target?.getAttribute("data-uid");
    const shape = uid && layout?.shapes.get(uid);
    if (shape && e.button === 0 && !e.shiftKey) {
      const moveUid = selectable(uid);
      const node = layout!.shapes.get(moveUid)!.node;
      const linkOwner = tipOwner(uid);
      const linkNode = linkOwner ? (layout!.shapes.get(linkOwner)?.node ?? null) : null;
      drag.current = {
        kind: "move",
        uid: moveUid,
        hit: uid,
        startX: e.clientX,
        startY: e.clientY,
        ox: typeof node.props.x === "number" ? node.props.x : 0,
        oy: typeof node.props.y === "number" ? node.props.y : 0,
        moved: false,
        link: linkNode && typeof linkNode.props.link === "string" ? linkNode.props.link : null,
      };
    } else {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, vx: viewport.x, vy: viewport.y, moved: false };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, localPoint(e));
    const p0 = pinch.current;
    if (p0 && touches.current.size === 2) {
      const p = pinchState();
      pinch.current = p;
      setViewport((vp) => {
        const z = zoomAround(vp, p.dist / Math.max(p0.dist, 1), p.mid);
        return { ...z, x: z.x + p.mid.x - p0.mid.x, y: z.y + p.mid.y - p0.mid.y };
      });
      return;
    }
    const d = drag.current;
    if (d?.kind === "draw") {
      const p = toDiagram(e);
      setDrawing((s) => (s ? { ...s, points: [...s.points, [p.x, p.y]] } : s));
      return;
    }
    if (d) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      if (!d.moved && d.kind === "pan") setPanning(true);
      d.moved = true;
      setHover(null);
      if (d.kind === "pan") {
        setViewport((vp) => ({ ...vp, x: d.vx + dx, y: d.vy + dy }));
      } else if (layout) {
        const g = layout.grid;
        const nx = Math.round((d.ox + dx / viewport.zoom) / g) * g;
        const ny = Math.round((d.oy + dy / viewport.zoom) / g) * g;
        setDoc((cur) => (cur ? setProps(cur, d.uid, { x: nx, y: ny }) : cur));
      }
      return;
    }
    if (pen) return;
    // Hover: the explanation follows the element under the pointer and
    // disappears as soon as the pointer leaves it.
    const target = (e.target as Element).closest("[data-uid]");
    const uid = target?.getAttribute("data-uid") ?? null;
    if (!uid) {
      setHover(null);
      return;
    }
    const at = localPoint(e);
    const tipUid = tipOwner(uid);
    setHover((prev) => (prev && prev.uid === uid && prev.tipUid === tipUid ? prev : { uid, tipUid, at }));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (pinch.current) {
      if (touches.current.size < 2) pinch.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    if (d?.kind === "draw") {
      setDrawing((s) => {
        if (s && s.points.length > 0) setStrokes((all) => [...all, s]);
        return null;
      });
      return;
    }
    if (d && d.kind === "move" && !d.moved && d.link) (onNavigate ?? navigate)(d.link);
    // Touch has no hover: a tap shows the explanation, a tap elsewhere hides it.
    else if (d && !d.moved && e.pointerType !== "mouse") {
      const hit = d.kind === "move" ? d.hit : null;
      setHover(hit ? { uid: hit, tipUid: tipOwner(hit), at: localPoint(e) } : null);
    }
  };

  const moved = doc !== original;

  // -------------------------------------------------------------- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (steps.length && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      setStep((s) => Math.max(-1, Math.min(steps.length - 1, s + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Escape") {
      if (pen) setPen(false);
      else setStep(-1);
    } else if (controls.pen && e.key.toLowerCase() === "p" && !e.ctrlKey && !e.metaKey) setPen((v) => !v);
    else if ((e.key === "1" && e.shiftKey) || e.key === "!") fit();
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
  };

  const zoomBy = (f: number) => setViewport((vp) => zoomAround(vp, f, { x: (size?.w ?? 0) / 2, y: (size?.h ?? 0) / 2 }));
  const [exportOpen, setExportOpen] = useState(false);

  const handleState = useRef({ doc, theme, size, fit, setViewport, setStep, steps });
  handleState.current = { doc, theme, size, fit, setViewport, setStep, steps };
  useImperativeHandle(
    ref,
    (): DiagramViewerHandle => {
      const h = handleState;
      const zoomAt = (f: (zoom: number) => number) =>
        h.current.setViewport((vp) => zoomAround(vp, f(vp.zoom) / vp.zoom, { x: (h.current.size?.w ?? 0) / 2, y: (h.current.size?.h ?? 0) / 2 }));
      const rootOrThrow = () => {
        if (!h.current.doc) throw new Error("No diagram loaded");
        return h.current.doc;
      };
      return {
        fit: () => h.current.fit(),
        zoomTo: (zoom) => zoomAt(() => zoom),
        zoomBy: (factor) => zoomAt((z) => z * factor),
        get steps() {
          return h.current.steps;
        },
        setStep: (s) => h.current.setStep(s),
        export: (format, options) => exportDiagram(rootOrThrow(), { theme: h.current.theme, baseUrl, fileName: name, ...options, format }),
        render: async (format, options) => (await renderDiagram(rootOrThrow(), { theme: h.current.theme, baseUrl, ...options, format })).blob,
      };
    },
    [baseUrl, name],
  );

  // ------------------------------------------------------------- overlays
  const highlight = (() => {
    if (!hover || !layout) return null;
    const uid = hover.tipUid ?? hover.uid;
    const shape = layout.shapes.get(uid);
    if (!shape) return null;
    return shapeScreenRect(shape.bounds);
  })();

  function shapeScreenRect(b: Rect) {
    const p = diagramToScreen(viewport, { x: b.x, y: b.y });
    return { x: p.x, y: p.y, w: b.w * viewport.zoom, h: b.h * viewport.zoom };
  }

  const tipNode = hover?.tipUid
    ? (layout?.shapes.get(hover.tipUid)?.node ?? layout?.edges.find((x) => x.uid === hover.tipUid)?.node ?? null)
    : null;
  const tipText = tipNode && typeof tipNode.props.tip === "string" ? tipNode.props.tip : null;
  const tipLink = tipNode && typeof tipNode.props.link === "string" ? tipNode.props.link : null;

  if (parsed.error) {
    return (
      <div className={cn("nnd-ui flex h-full w-full items-center justify-center p-6", className)}>
        <div className="max-w-lg rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="mb-1 font-medium text-destructive">Could not read this diagram</div>
          <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">{parsed.error.message}</pre>
        </div>
      </div>
    );
  }

  const customBg = original && typeof original.props.background === "string" ? original.props.background : null;
  const pageBg = customBg && customBg !== "transparent" ? customBg : PAGE_COLORS[theme];
  const allStrokes = drawing ? [...strokes, drawing] : strokes;

  return (
    <TooltipProvider>
      <div
        ref={containerRef}
        tabIndex={0}
        className={cn(mounted && themeScope(theme), "nnd-ui @container relative h-full w-full touch-none overflow-hidden text-foreground outline-none select-none", className)}
        style={{
          background: mounted ? pageBg : undefined,
          cursor: pen ? "crosshair" : panning ? "grabbing" : "grab",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !drag.current && setHover(null)}
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => {
          if (!pen && !(e.target as Element).closest("[data-uid]")) fit();
        }}
      >
        {mounted && doc && layout && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transformOrigin: "0 0",
              // Release the raster layer after panning so zoomed text and vectors
              // are painted at the current scale instead of stretching a cached bitmap.
              willChange: panning ? "transform" : undefined,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
              opacity: ready && size ? 1 : 0,
              transition: glide ? "opacity 120ms, transform 480ms cubic-bezier(.22,1,.36,1)" : "opacity 120ms",
            }}
          >
            <DiagramView root={doc} layout={layout} routes={routes} theme={theme} baseUrl={baseUrl} onMeasure={onMeasure} dimmed={dimmed}>
              {allStrokes.length > 0 && (
                <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
                  {allStrokes.map((s, i) => (
                    <path key={i} d={inkPath(s.points, s.size)} fill={s.color} />
                  ))}
                </svg>
              )}
            </DiagramView>
          </div>
        )}

        {highlight && !pen && (
          <div
            className="pointer-events-none absolute rounded-[4px]"
            style={{
              left: highlight.x - 3,
              top: highlight.y - 3,
              width: highlight.w + 6,
              height: highlight.h + 6,
              boxShadow: "0 0 0 1.5px var(--nnd-accent, #0d99ff)",
            }}
          />
        )}

        {hover && !pen && (tipText || tipLink) && (
          <TipCard text={tipText} link={tipLink} anchor={highlight ?? { x: hover.at.x, y: hover.at.y, w: 0, h: 0 }} container={size} />
        )}

        {/* Toolbar. Zoom buttons and the pencil give way on narrow viewers (pinch zooms there). */}
        {toolbar && (
          <div className={cn(floatingPanel, "absolute top-3 right-3 flex items-center gap-0.5 p-1")} onPointerDown={(e) => e.stopPropagation()}>
            {controls.zoom && (
              <>
                <Tip label="Zoom out" shortcut="−">
                  <IconButton size="sm" className="@max-lg:hidden" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
                    <Minus />
                  </IconButton>
                </Tip>
                <Tip label="Reset to 100%">
                  <button
                    type="button"
                    className="h-7 w-11 rounded-md text-xs text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground @max-lg:hidden"
                    onClick={() => setViewport((vp) => zoomAround(vp, 1 / vp.zoom, { x: (size?.w ?? 0) / 2, y: (size?.h ?? 0) / 2 }))}
                  >
                    {Math.round(viewport.zoom * 100)}%
                  </button>
                </Tip>
                <Tip label="Zoom in" shortcut="+">
                  <IconButton size="sm" className="@max-lg:hidden" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
                    <Plus />
                  </IconButton>
                </Tip>
                <Tip label="Fit" shortcut="Shift+1">
                  <IconButton size="sm" onClick={() => fit()} aria-label="Fit to screen">
                    <Scan />
                  </IconButton>
                </Tip>
                <div className="mx-1 h-4 w-px bg-border" />
              </>
            )}
            {moved && (
              <Tip label="Reset layout">
                <IconButton size="sm" onClick={() => setDoc(original)} aria-label="Reset layout">
                  <RotateCcw />
                </IconButton>
              </Tip>
            )}
            {controls.pen && (
              <Tip label="Draw on the diagram (not saved)" shortcut="P">
                <IconButton size="sm" className="@max-sm:hidden" active={pen} onClick={() => setPen(!pen)} aria-label="Pencil">
                  <Pencil />
                </IconButton>
              </Tip>
            )}
            {controls.theme && (
              <Tip label={theme === "dark" ? "Light diagram" : "Dark diagram"}>
                <IconButton size="sm" onClick={() => setThemeOverride(theme === "dark" ? "light" : "dark")} aria-label="Toggle diagram theme">
                  {theme === "dark" ? <Sun /> : <Moon />}
                </IconButton>
              </Tip>
            )}
            {controls.export && (
              <Tip label="Export…">
                <IconButton size="sm" aria-label="Export" onClick={() => setExportOpen(true)}>
                  <Download />
                </IconButton>
              </Tip>
            )}
            {controls.fullscreen && (
              <Tip label="Fullscreen">
                <IconButton
                  size="sm"
                  aria-label="Fullscreen"
                  onClick={() => {
                    const el = containerRef.current;
                    if (!el) return;
                    if (document.fullscreenElement) document.exitFullscreen();
                    else el.requestFullscreen?.().then(() => setTimeout(() => fit(), 50));
                  }}
                >
                  <Expand />
                </IconButton>
              </Tip>
            )}
            {editHref && (
              <Tip label="Open in the editor">
                <a
                  href={editHref}
                  aria-label="Edit"
                  className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 @max-sm:px-2 [&_svg]:size-3.5"
                >
                  <PencilRuler /> <span className="@max-sm:hidden">Edit</span>
                </a>
              </Tip>
            )}
          </div>
        )}

        {pen && (
          <div className={cn(floatingPanel, "absolute top-15 right-3 flex items-center gap-1 p-1.5")} onPointerDown={(e) => e.stopPropagation()}>
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setPenColor(c)}
                className={cn(
                  "size-5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] transition-transform hover:scale-110",
                  penColor === c && "ring-2 ring-[var(--nnd-accent,#0d99ff)] ring-offset-2 ring-offset-background",
                )}
                style={{ background: c }}
              />
            ))}
            <div className="mx-1 h-4 w-px bg-border" />
            {PEN_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Brush ${s}px`}
                onClick={() => setPenSize(s)}
                className={cn("flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted", penSize === s && "bg-muted")}
              >
                <span className="rounded-full bg-foreground" style={{ width: s + 2, height: s + 2 }} />
              </button>
            ))}
            <div className="mx-1 h-4 w-px bg-border" />
            <Tip label="Clear drawing">
              <IconButton size="xs" onClick={() => setStrokes([])} disabled={!strokes.length} aria-label="Clear drawing">
                <Eraser />
              </IconButton>
            </Tip>
            <Tip label="Stop drawing" shortcut="Esc">
              <IconButton size="xs" onClick={() => setPen(false)} aria-label="Stop drawing">
                <X />
              </IconButton>
            </Tip>
          </div>
        )}

        {stepsBar && (
          <StepsBar
            steps={steps}
            step={step}
            onStep={(s) => {
              setStep(s);
              // Keep arrow keys working after a click on the card (its buttons come and go).
              containerRef.current?.focus({ preventScroll: true });
            }}
          />
        )}

      </div>
      {/* Outside the canvas: React events bubble through portals, and the canvas captures pointers. */}
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} root={doc} theme={theme} baseUrl={baseUrl} defaultName={name} />
    </TooltipProvider>
  );
}

/** Explanation card. Not interactive: it disappears when the pointer leaves the element. */
function TipCard({
  text,
  link,
  anchor,
  container,
}: {
  text: string | null;
  link: string | null;
  anchor: { x: number; y: number; w: number; h: number };
  container: { w: number; h: number } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !container) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 10;
    let left = anchor.x + anchor.w + gap;
    let top = anchor.y;
    if (left + w > container.w - 8) left = anchor.x - w - gap;
    if (left < 8) {
      left = Math.min(Math.max(8, anchor.x), container.w - w - 8);
      top = anchor.y + anchor.h + gap;
      if (top + h > container.h - 8) top = anchor.y - h - gap;
    }
    top = Math.min(Math.max(8, top), Math.max(8, container.h - h - 8));
    setPos({ left, top });
  }, [anchor.x, anchor.y, anchor.w, anchor.h, container, text]);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-20 w-max max-w-80 rounded-lg border border-border bg-popover p-3 text-sm leading-relaxed text-popover-foreground shadow-lg"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {text && <Markdown className="nnd-markdown space-y-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_table]:text-xs">{text}</Markdown>}
      {link && (
        <div className={cn("inline-flex items-center gap-1 text-xs font-medium text-muted-foreground", text && "mt-2")}>
          Click to open {link.startsWith("http") ? "link" : "diagram"} <ChevronRight className="size-3" />
        </div>
      )}
    </div>
  );
}

/**
 * The walk-through: a button in the bottom-left corner that opens into a
 * card. The card grows upwards, so its buttons stay in place while stepping
 * through steps of different lengths.
 */
function StepsBar({ steps, step, onStep }: { steps: ReturnType<typeof readSteps>; step: number; onStep: (s: number) => void }) {
  const current = step >= 0 ? steps[step] : null;
  const stop = (e: ReactPointerEvent) => e.stopPropagation();
  if (!current) {
    return (
      <button
        type="button"
        onPointerDown={stop}
        onClick={() => onStep(0)}
        className={cn(floatingPanel, "absolute bottom-3 left-3 flex h-9 items-center gap-2 pr-3.5 pl-1.5 text-sm font-medium transition-colors hover:bg-muted")}
      >
        <span className="flex size-6 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Play className="size-3 fill-current" />
        </span>
        Walk through
        <span className="font-normal text-muted-foreground">{steps.length} steps</span>
      </button>
    );
  }
  const last = step === steps.length - 1;
  return (
    <div className={cn(floatingPanel, "absolute bottom-3 left-3 flex max-h-[calc(100%-1.5rem)] w-80 flex-col @max-md:right-3 @max-md:w-auto")} onPointerDown={stop}>
      <div className="flex items-center justify-between pt-2 pr-2 pl-4">
        <span className="text-xs text-muted-foreground tabular-nums">
          Step {step + 1} of {steps.length}
        </span>
        <Tip label="Close" shortcut="Esc" side="top">
          <IconButton size="xs" onClick={() => onStep(-1)} aria-label="Close walk-through">
            <X />
          </IconButton>
        </Tip>
      </div>
      <div key={step} className="flex min-h-0 animate-in flex-col px-4 pt-0.5 pb-4 duration-200 fade-in-0 slide-in-from-bottom-1">
        <div className="text-sm font-semibold">{current.title || `Step ${step + 1}`}</div>
        {current.text && (
          <Markdown scroll className="mt-1.5 max-h-88 min-h-0 space-y-2 overflow-y-auto overscroll-contain text-[13px] leading-relaxed text-foreground/80 @max-md:max-h-32">{current.text}</Markdown>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-border py-2 pr-2 pl-4">
        <div className="flex flex-1 gap-1">
          {steps.map((s, i) => (
            <button key={i} type="button" aria-label={s.title || `Step ${i + 1}`} className="group flex-1 py-2" onClick={() => onStep(i)}>
              <span className={cn("block h-1 rounded-full transition-colors", i <= step ? "bg-foreground" : "bg-border group-hover:bg-muted-foreground/40")} />
            </button>
          ))}
        </div>
        <IconButton size="sm" variant="outline" disabled={step <= 0} onClick={() => onStep(step - 1)} aria-label="Previous step">
          <ChevronLeft />
        </IconButton>
        <IconButton size="sm" variant="solid" className={cn(last && "w-auto px-2.5 text-xs")} onClick={() => onStep(last ? -1 : step + 1)} aria-label={last ? "Finish" : "Next step"}>
          {last ? "Done" : <ChevronRight />}
        </IconButton>
      </div>
    </div>
  );
}

export interface DiagramThumbnailProps {
  source: string;
  theme?: DiagramTheme;
  baseUrl?: string;
  className?: string;
  /** Default: placeholders with no media requests/decoding/playback. Opt in for detailed previews. */
  media?: "placeholder" | "full";
}

/** Static, non-interactive rendering scaled to fit its container (gallery cards). */
export function DiagramThumbnail({ source, theme = "light", baseUrl, className, media = "placeholder" }: DiagramThumbnailProps) {
  const parsed = useMemo(() => safeParse(source), [source]);
  const root = parsed.file?.root ?? null;
  const ready = useDiagramStyles(root);
  const { layout, routes, onMeasure } = useDiagramLayout(root);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mounted = useMounted();
  const scale = layout && box ? Math.min(box.w / layout.page.w, box.h / layout.page.h) : 0;
  const customBg = root && typeof root.props.background === "string" && root.props.background !== "transparent" ? root.props.background : null;
  return (
    <div ref={ref} className={cn("nnd-ui relative overflow-hidden", className)} style={{ background: customBg ?? PAGE_COLORS[theme] }}>
      {mounted && root && layout && box && (
        <div
          style={{
            position: "absolute",
            left: (box.w - layout.page.w * scale) / 2,
            top: (box.h - layout.page.h * scale) / 2,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            opacity: ready ? 1 : 0,
            transition: "opacity 150ms",
            pointerEvents: "none",
          }}
        >
          <DiagramView root={root} layout={layout} routes={routes} theme={theme} baseUrl={baseUrl} onMeasure={onMeasure} media={media} interactive={false} />
        </div>
      )}
    </div>
  );
}

export { screenToDiagram };
