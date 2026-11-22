/**
 * Property panel controls: compact
 * fields with an icon or label you can drag to scrub the value, color rows
 * with a swatch, hex value and opacity, and a color picker.
 */
import { NumberField } from "@base-ui/react/number-field";
import { ChevronDown, Minus, Pipette, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ScrollArea } from "@nn-diagram/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@nn-diagram/ui/popover";
import { Select as SelectRoot, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@nn-diagram/ui/select";
import { Switch } from "@nn-diagram/ui/switch";
import { Tip, cn, normalizeColor, tailwindColors } from "@nn-diagram/viewer";

// ---------------------------------------------------------------- layout

const COLLAPSED_KEY = "nn-diagram.collapsed";
/** Titles of the inspector sections the user collapsed (kept across sessions). */
const collapsed = new Set<string>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  })(),
);

export function Section({
  title,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const key = typeof title === "string" ? title : null;
  const [open, setOpen] = useState(() => !key || !collapsed.has(key));
  const toggle = () => {
    if (!key) return;
    if (open) collapsed.add(key);
    else collapsed.delete(key);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      /* private mode */
    }
    setOpen(!open);
  };
  return (
    <section className={cn("border-b border-border px-4 pt-3", open && children ? "pb-4" : "pb-3", className)}>
      <div className={cn("flex h-6 items-center gap-1", open && !!children && "mb-2")}>
        <button type="button" onClick={toggle} className="group/section flex flex-1 items-center gap-1 text-left text-xs font-medium text-foreground">
          {title}
          {key && children && (
            <ChevronDown
              className={cn("size-3 text-muted-foreground opacity-0 transition group-hover/section:opacity-100", !open && "-rotate-90 opacity-100")}
            />
          )}
        </button>
        {actions}
      </div>
      {children && open && <div className="space-y-2">{children}</div>}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[11px] text-muted-foreground">{children}</div>;
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

export const fieldClass =
  "h-7 w-full min-w-0 rounded-md border border-transparent bg-muted/70 px-2 text-xs outline-none transition-colors hover:border-border focus:border-[var(--nnd-accent,#0d99ff)] focus:bg-background";

// -------------------------------------------------------- scrub number field

export function ScrubField({
  icon,
  tip,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  placeholder,
  className,
  precision = 2,
  scrubStep,
}: {
  icon: ReactNode;
  tip?: string;
  value: number | null;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
  className?: string;
  precision?: number;
  /** Scrubbing moves in these steps and lands on multiples of them (e.g. the grid). Typing stays free. */
  scrubStep?: number;
}) {
  const field = (
    <NumberField.Root
      value={value}
      min={min}
      max={max}
      step={step}
      smallStep={step / 10}
      largeStep={step * 10}
      format={{ maximumFractionDigits: precision, useGrouping: false }}
      onValueChange={(v) => {
        if (v !== null && Number.isFinite(v)) onChange(v);
      }}
      className={cn("min-w-0", className)}
    >
      <NumberField.Group className="group flex h-7 items-center rounded-md border border-transparent bg-muted/70 transition-colors hover:border-border focus-within:border-[var(--nnd-accent,#0d99ff)] focus-within:bg-background">
        <ScrubHandle value={value} min={min} max={max} step={scrubStep ?? step} snap={!!scrubStep && scrubStep > 1} precision={precision} onChange={onChange}>
          {icon}
        </ScrubHandle>
        <NumberField.Input
          placeholder={placeholder}
          className="h-full w-full min-w-0 bg-transparent pr-1 text-xs tabular-nums outline-none placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
        />
        {suffix && <span className="pr-2 text-[11px] text-muted-foreground">{suffix}</span>}
      </NumberField.Group>
    </NumberField.Root>
  );
  return tip ? (
    <Tip label={tip} side="top" delay={600}>
      <div className="min-w-0">{field}</div>
    </Tip>
  ) : (
    field
  );
}

/**
 * Drag left/right on the icon to change the value (Shift: 10× steps, Alt: ⅒).
 * Uses pointer capture instead of pointer lock, so the browser shows no
 * "press Esc to show your cursor" banner, and it never focuses the input, so
 * keyboard shortcuts (Ctrl+Z) keep working afterwards.
 */
function ScrubHandle({
  value,
  min = -Infinity,
  max = Infinity,
  step,
  snap,
  precision,
  onChange,
  children,
}: {
  value: number | null;
  min?: number;
  max?: number;
  step: number;
  snap?: boolean;
  precision: number;
  onChange: (v: number) => void;
  children: ReactNode;
}) {
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const factor = 10 ** precision;
  return (
    <span
      className="flex h-full w-7 shrink-0 cursor-ew-resize touch-none items-center justify-center text-[11px] text-muted-foreground select-none [&_svg]:size-3.5"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // Leave any text field, so Ctrl+Z and other shortcuts work right after scrubbing.
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) active.blur();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, start: value ?? (Number.isFinite(min) ? min : 0), moved: false };
        document.documentElement.style.cursor = "ew-resize";
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 2) return;
        d.moved = true;
        const s = e.shiftKey ? step * 10 : e.altKey ? step / 10 : step;
        let next = d.start + Math.round(dx / (snap ? 4 : 2)) * s;
        if (snap) next = Math.round(next / s) * s;
        next = Math.min(max, Math.max(min, next));
        onChange(Math.round(next * factor) / factor);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        document.documentElement.style.cursor = "";
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        document.documentElement.style.cursor = "";
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- inputs

/** Synchronize unfocused drafts before committing the new selection to the DOM. */
function useFieldText(value: string) {
  const focused = useRef(false);
  const [draft, setDraft] = useState({ value, text: value });
  if (draft.value !== value) setDraft({ value, text: focused.current ? draft.text : value });
  const setText = (text: string) => setDraft({ value, text });
  return [draft.text, setText, focused] as const;
}

export function TextField({
  value,
  onChange,
  placeholder,
  mono,
  className,
  onFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  onFocus?: () => void;
}) {
  const [text, setText, focused] = useFieldText(value);
  return (
    <input
      className={cn(fieldClass, mono && "font-mono text-[11px]", className)}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
        onFocus?.();
      }}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onChange(text);
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function TextArea({ value, onChange, placeholder, rows = 4 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  const [text, setText, focused] = useFieldText(value);
  return (
    <textarea
      className="w-full resize-y rounded-md border border-transparent bg-muted/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed outline-none hover:border-border focus:border-[var(--nnd-accent,#0d99ff)] focus:bg-background"
      rows={rows}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onChange(text);
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  tip,
}: {
  value: T | "";
  options: readonly (T | { value: T; label: string })[];
  onChange: (v: T) => void;
  className?: string;
  tip?: string;
}) {
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const el = (
    <SelectRoot value={value || null} items={items} onValueChange={(v) => v && onChange(v as T)}>
      <SelectTrigger
        size="sm"
        className={cn(
          "h-7 w-full min-w-0 rounded-md border-transparent bg-muted/70 pr-1.5 pl-2 text-xs hover:border-border dark:bg-muted/70 dark:hover:bg-muted/70 data-popup-open:border-[var(--nnd-accent,#0d99ff)] [&_svg:not([class*='size-'])]:size-3.5",
          className,
        )}
      >
        <SelectValue placeholder="Mixed" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </SelectRoot>
  );
  return tip ? (
    <Tip label={tip} side="top" delay={600}>
      <div className="min-w-0 flex-1">{el}</div>
    </Tip>
  ) : (
    el
  );
}

/** Row of icon buttons (alignment etc.). */
export function IconGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; icon: ReactNode; tip: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-7 items-center rounded-md bg-muted/70 p-0.5">
      {options.map((o) => (
        <Tip key={o.value} label={o.tip} side="top" delay={500}>
          <button
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-6 flex-1 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
              value === o.value && "bg-background text-foreground shadow-sm dark:bg-foreground/12 dark:shadow-none",
            )}
          >
            {o.icon}
          </button>
        </Tip>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-7 w-full items-center rounded-md bg-muted/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          className={cn(
            "flex h-6 flex-1 items-center justify-center rounded text-xs text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
            value === o.value && "bg-background text-foreground shadow-sm dark:bg-foreground/12 dark:shadow-none",
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex min-h-6 cursor-pointer items-center justify-between gap-3 text-xs select-none">
      {label}
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onChange}
        className="data-checked:bg-[var(--nnd-accent,#0d99ff)]! [&_[data-slot=switch-thumb]]:data-checked:bg-white!"
      />
    </label>
  );
}

export function SmallButton({ children, onClick, tip }: { children: ReactNode; onClick: () => void; tip: string }) {
  return (
    <Tip label={tip} side="top" delay={500}>
      <button type="button" onClick={onClick} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5">
        {children}
      </button>
    </Tip>
  );
}

// ---------------------------------------------------------------- colors

/** A color as stored in classes: a Tailwind token ("red-200") or "#rrggbb", plus opacity 0–100. */
export interface ColorValue {
  token: string;
  alpha: number;
}

export const HUES = [
  "slate",
  "gray",
  "zinc",
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
export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

const palette = tailwindColors as unknown as Record<string, Record<number, string> | string>;

/** CSS color for a token ("red-200", "white", "#ff0000"). */
export function cssColor(token: string | null): string | null {
  if (!token) return null;
  if (token.startsWith("#") || token.startsWith("rgb") || token.startsWith("oklch") || token.startsWith("hsl")) return token;
  if (token === "white") return "#fff";
  if (token === "black") return "#000";
  if (token === "transparent") return "transparent";
  const m = /^([a-z]+)-(\d+)$/.exec(token);
  if (!m) return null;
  const hue = palette[m[1]];
  return typeof hue === "object" ? (hue[Number(m[2])] ?? null) : null;
}

export function toHex(token: string): string {
  const css = cssColor(token);
  if (!css || css === "transparent") return "#000000";
  return normalizeColor(css).value === "none" ? "#000000" : normalizeColor(css).value;
}

export function Swatch({ value, className, fallback, alpha }: { value: ColorValue | null; className?: string; fallback?: string; alpha?: number }) {
  const css = value ? cssColor(value.token) : fallback ?? null;
  const transparent = !css || css === "transparent";
  const opacity = (alpha ?? value?.alpha ?? 100) / 100;
  // The checkerboard only shows through (semi-)transparent colors, and stays
  // inside the border: under the translucent border it looked dashed.
  return (
    <span
      className={cn("relative inline-block size-4 shrink-0 overflow-hidden rounded-[4px] border border-black/10 dark:border-white/15", className)}
      style={{ background: transparent || opacity < 1 ? "repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 0 0 / 6px 6px padding-box" : css }}
    >
      {!transparent && opacity < 1 && <span className="absolute inset-0" style={{ background: css, opacity }} />}
    </span>
  );
}

// HSV helpers
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function useDrag(onMove: (x: number, y: number) => void) {
  return (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const update = (ev: { clientX: number; clientY: number }) =>
      onMove(Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height)));
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
}

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

/** Color picker: saturation/value area, hue and opacity sliders, eyedropper, hex and swatches. */
export function ColorPicker({
  value,
  onChange,
  documentColors = [],
  allowNone = true,
  defaultLabel = "Theme",
  themeColor,
}: {
  value: ColorValue | null;
  onChange: (v: ColorValue | null) => void;
  documentColors?: string[];
  allowNone?: boolean;
  defaultLabel?: string;
  /** #rrggbb the theme uses; the picker starts from it while no custom color is set. */
  themeColor?: string;
}) {
  const initial = value && value.token !== "transparent" ? toHex(value.token) : (themeColor ?? "#0d99ff");
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...hexToRgb(initial)));
  const [alpha, setAlpha] = useState(value?.alpha ?? 100);
  const [hexText, setHexText] = useState(initial.slice(1).toUpperCase());
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (!value || value.token === "transparent") return;
    const hex = toHex(value.token);
    if (hex === lastEmitted.current) return;
    setHsv(rgbToHsv(...hexToRgb(hex)));
    setHexText(hex.slice(1).toUpperCase());
    setAlpha(value.alpha);
  }, [value]);
  const emit = (next: [number, number, number], a = alpha) => {
    const hex = rgbToHex(...hsvToRgb(...next));
    lastEmitted.current = hex;
    setHexText(hex.slice(1).toUpperCase());
    onChange({ token: hex, alpha: a });
  };
  const [h, s, v] = hsv;
  const hueColor = rgbToHex(...hsvToRgb(h, 1, 1));
  const current = rgbToHex(...hsvToRgb(h, s, v));
  const svDrag = useDrag((x, y) => {
    const next: [number, number, number] = [h, x, 1 - y];
    setHsv(next);
    emit(next);
  });
  const hueDrag = useDrag((x) => {
    const next: [number, number, number] = [x * 359.9, s, v];
    setHsv(next);
    emit(next);
  });
  const alphaDrag = useDrag((x) => {
    const a = Math.round(x * 100);
    setAlpha(a);
    emit(hsv, a);
  });
  const EyeDropper = (globalThis as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

  return (
    <div className="w-[248px] space-y-2.5" onKeyDown={(e) => e.stopPropagation()}>
      <div
        className="relative h-40 w-full cursor-crosshair touch-none overflow-hidden rounded-md"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
        onPointerDown={svDrag}
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: current }}
        />
      </div>
      <div className="flex items-center gap-2">
        {EyeDropper && (
          <Tip label="Pick a color from the screen" side="top">
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4"
              onClick={async () => {
                try {
                  const res = await new EyeDropper().open();
                  const next = rgbToHsv(...hexToRgb(res.sRGBHex));
                  setHsv(next);
                  emit(next);
                } catch {
                  /* cancelled */
                }
              }}
            >
              <Pipette />
            </button>
          </Tip>
        )}
        <div className="flex-1 space-y-2">
          <div
            className="relative h-3 cursor-pointer touch-none rounded-full"
            style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
            onPointerDown={hueDrag}
          >
            <span className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" style={{ left: `${(h / 360) * 100}%`, background: hueColor }} />
          </div>
          <div
            className="relative h-3 cursor-pointer touch-none rounded-full"
            style={{ background: `linear-gradient(to right, transparent, ${current}), repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 0 0 / 8px 8px` }}
            onPointerDown={alphaDrag}
          >
            <span className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" style={{ left: `${alpha}%` }} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 rounded-md bg-muted/70 px-2 py-1 text-[11px] text-muted-foreground">Hex</span>
        <input
          className={cn(fieldClass, "font-mono uppercase")}
          value={hexText}
          onChange={(e) => setHexText(e.target.value.replace(/[^0-9a-f]/gi, "").slice(0, 6))}
          onBlur={() => {
            if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexText)) {
              const next = rgbToHsv(...hexToRgb(hexText));
              setHsv(next);
              emit(next);
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <div className="w-16 shrink-0">
          <ScrubField icon="%" value={alpha} min={0} max={100} onChange={(a) => {
            const r = Math.round(a);
            setAlpha(r);
            emit(hsv, r);
          }} />
        </div>
      </div>
      <div className="flex gap-1">
        <button type="button" className="h-6 flex-1 rounded-md border border-border text-[11px] hover:bg-accent" onClick={() => onChange(null)}>
          {defaultLabel}
        </button>
        {allowNone && (
          <button type="button" className="h-6 flex-1 rounded-md border border-border text-[11px] hover:bg-accent" onClick={() => onChange({ token: "transparent", alpha: 100 })}>
            None
          </button>
        )}
        <button type="button" title="White" className="size-6 rounded-md border border-border bg-white" onClick={() => onChange({ token: "white", alpha: 100 })} />
        <button type="button" title="Black" className="size-6 rounded-md border border-border bg-black" onClick={() => onChange({ token: "black", alpha: 100 })} />
      </div>
      {documentColors.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">In this diagram</div>
          <div className="flex flex-wrap gap-1">
            {documentColors.slice(0, 20).map((t) => (
              <Tip key={t} label={t} side="top" delay={300}>
                <button type="button" className="size-5 rounded-[4px] border border-black/10" style={{ background: cssColor(t) ?? undefined }} onClick={() => onChange({ token: t, alpha: 100 })} />
              </Tip>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">Tailwind</div>
        <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${HUES.length}, 1fr)` }}>
          {SHADES.map((shade) =>
            HUES.map((hue) => {
              const token = `${hue}-${shade}`;
              return (
                <button
                  key={token}
                  type="button"
                  title={token}
                  className={cn("aspect-square rounded-[2px] hover:relative hover:z-10 hover:scale-150 hover:shadow", value?.token === token && "relative z-10 ring-2 ring-ring ring-offset-1")}
                  style={{ background: cssColor(token) ?? undefined }}
                  onClick={() => onChange({ token, alpha: value?.alpha ?? 100 })}
                />
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Color row: swatch and value (open the picker) and opacity.
 * `null` and `{ token: "theme" }` mean the theme's color, which is shown as
 * the color the theme currently uses (`themeColor`).
 */
export function ColorRow({
  value,
  onChange,
  placeholder = "Theme",
  themeColor,
  documentColors,
  allowNone = true,
  tip,
}: {
  value: ColorValue | null;
  onChange: (v: ColorValue | null) => void;
  placeholder?: string;
  /** The color the theme uses here (any CSS color), shown while no custom color is set. */
  themeColor?: string;
  documentColors?: string[];
  allowNone?: boolean;
  tip?: string;
}) {
  const isTheme = !value || value.token === "theme";
  const alpha = value?.alpha ?? 100;
  const themeHex = themeColor ? resolveColor(themeColor) : null;
  const label = isTheme
    ? (themeHex?.slice(1).toUpperCase() ?? placeholder)
    : value.token.startsWith("#")
      ? value.token.slice(1).toUpperCase()
      : value.token === "transparent"
        ? "None"
        : value.token;
  const setAlpha = (a: number) => {
    const next = Math.round(a);
    if (isTheme) onChange(next >= 100 ? null : { token: "theme", alpha: next });
    else onChange({ ...value, alpha: next });
  };
  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger
          render={
            <button type="button" className={cn(fieldClass, "flex min-w-0 flex-1 items-center gap-2 text-left")}>
              <Swatch value={isTheme ? null : value} fallback={themeColor} alpha={alpha} />
              <span className="truncate font-mono text-[11px]">{label}</span>
              {isTheme && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{placeholder}</span>}
            </button>
          }
        />
        <PopoverContent side="left" align="start" sideOffset={12} className="w-auto p-3">
          <ColorPicker
            value={isTheme ? null : value}
            themeColor={themeHex ?? undefined}
            onChange={onChange}
            documentColors={documentColors}
            allowNone={allowNone}
            defaultLabel={placeholder}
          />
        </PopoverContent>
      </Popover>
      <div className="w-[60px] shrink-0">
        <ScrubField icon="%" tip={tip ? `${tip} opacity` : "Opacity"} value={value?.token === "transparent" ? 0 : alpha} min={0} max={100} onChange={setAlpha} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ theme colors

const colorCache = new Map<string, string>();
let colorCtx: CanvasRenderingContext2D | null = null;

/** Any CSS color (oklch, color-mix, rgb, names…) as #rrggbb. */
export function resolveColor(css: string): string | null {
  if (!css || css === "transparent" || typeof document === "undefined") return null;
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  const hit = colorCache.get(css);
  if (hit) return hit;
  colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!colorCtx) return null;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = "#000";
  colorCtx.fillStyle = css;
  colorCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null;
  const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  colorCache.set(css, hex);
  return hex;
}

export interface ThemeColors {
  fill: string;
  line: string;
  text: string;
  edge: string;
}

/**
 * The colors a diagram element with these classes gets from the theme in the
 * given diagram theme, read from the diagram's own CSS (so they match the
 * canvas exactly, in light and dark mode).
 */
export function probeThemeColors(classes: string, theme: "light" | "dark"): ThemeColors {
  const empty = { fill: "transparent", line: "transparent", text: "#000", edge: "#000" };
  if (typeof document === "undefined") return empty;
  const host = document.createElement("div");
  host.className = `nnd-root${theme === "dark" ? " nnd-dark" : ""}`;
  host.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
  const el = document.createElement("div");
  el.className = classes;
  host.appendChild(el);
  document.body.appendChild(host);
  const cs = getComputedStyle(el);
  const out = {
    fill: cs.backgroundColor,
    line: cs.borderTopColor,
    text: cs.color,
    edge: cs.getPropertyValue("--nnd-edge").trim() || cs.color,
  };
  host.remove();
  return out;
}

/** probeThemeColors, recomputed when the classes or the theme change. */
export function useThemeColors(classes: string, theme: "light" | "dark"): ThemeColors {
  return useMemo(() => classes ? probeThemeColors(classes, theme) : { fill: "transparent", line: "transparent", text: "#000", edge: "#000" }, [classes, theme]);
}

/** Colors used in class names of a set of class strings (for "In this diagram"). */
export function useDocumentColors(classStrings: string[]): string[] {
  return useMemo(() => {
    const out = new Set<string>();
    for (const cls of classStrings) {
      for (const c of cls.split(/\s+/)) {
        const m = /^(?:bg|border|text|fill|stroke)-(\[#[0-9a-fA-F]{3,8}\]|[a-z]+-\d{2,3})(?:\/\d+)?$/.exec(c);
        if (m) out.add(m[1].startsWith("[") ? m[1].slice(1, -1) : m[1]);
      }
    }
    return [...out];
  }, [classStrings]);
}

/** Scroll area of a side panel: the scrollbar only shows while the panel is hovered or scrolling. */
export function PanelScroll({ className, ...props }: ComponentProps<typeof ScrollArea>) {
  return (
    <ScrollArea
      className={cn(
        "[&_[data-slot=scroll-area-scrollbar]]:transition-opacity [&_[data-slot=scroll-area-scrollbar]]:duration-300",
        "[&_[data-slot=scroll-area-scrollbar]:not([data-hovering]):not([data-scrolling])]:opacity-0",
        className as string | undefined,
      )}
      {...props}
    />
  );
}
