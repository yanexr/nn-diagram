"use client";
/** Export settings (format, resolution, theme, background) for the viewer and the editor. */
import { Button } from "@nn-diagram/ui/button";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ElementNode } from "@nn-diagram/format";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@nn-diagram/ui/dialog";
import { EXPORT_FORMATS, exportDiagram, type ExportFormat } from "./export";
import type { DiagramTheme } from "./render/context";
import { cn } from "./ui";

interface Settings {
  format: ExportFormat;
  scale: number;
  transparent: boolean;
}

const KEY = "nn-diagram.export";

function loadSettings(): Settings {
  try {
    return { format: "png", scale: 2, transparent: false, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { format: "png", scale: 2, transparent: false };
  }
}

function Choice<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex h-8 w-full items-center rounded-lg bg-foreground/[0.055] p-0.5", disabled && "pointer-events-none opacity-40")} aria-disabled={disabled}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            value === o.value && "bg-background text-foreground shadow-sm dark:bg-foreground/12 dark:shadow-none",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-start gap-3">
      {/* As tall as the control, so the label lines up with it and not with the hint below. */}
      <div className="flex h-8 items-center text-sm text-muted-foreground">{label}</div>
      <div>
        {children}
        {hint !== undefined && <div className="mt-1 h-4 truncate text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: ElementNode | null;
  theme: DiagramTheme;
  baseUrl?: string;
  resolveAsset?: (src: string) => string | undefined;
  defaultName: string;
}

export function ExportDialog({ open, onOpenChange, root, theme: initialTheme, baseUrl, resolveAsset, defaultName }: ExportDialogProps) {
  const [settings, setSettings] = useState<Settings>({ format: "png", scale: 2, transparent: false });
  const [theme, setTheme] = useState<DiagramTheme>(initialTheme);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSettings(loadSettings());
    setTheme(initialTheme);
    setName(defaultName);
  }, [open, initialTheme, defaultName]);
  const update = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const meta = EXPORT_FORMATS.find((f) => f.value === settings.format)!;
  const w = typeof root?.props.width === "number" ? root.props.width : 1200;
  const h = typeof root?.props.height === "number" ? root.props.height : 800;
  const ext = settings.format === "jpeg" ? "jpg" : settings.format;

  const run = async () => {
    if (!root) return;
    setBusy(true);
    try {
      await exportDiagram(root, {
        format: settings.format,
        scale: settings.scale,
        transparent: settings.transparent,
        theme,
        baseUrl,
        resolveAsset,
        fileName: name.trim() || "diagram",
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Export diagram</DialogTitle>
          <DialogDescription>Raster images for slides and the web, SVG or PDF with selectable text for papers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Field label="Format">
            <Choice value={settings.format} options={EXPORT_FORMATS.map((f) => ({ value: f.value, label: f.label }))} onChange={(format) => update({ format })} />
          </Field>
          <Field label="Resolution" hint={meta.raster ? `${Math.round(w * settings.scale)} × ${Math.round(h * settings.scale)} px` : "Vector: sharp at any size"}>
            <Choice
              value={settings.scale}
              disabled={!meta.raster}
              options={[1, 2, 3, 4].map((s) => ({ value: s, label: `${s}×`, hint: `${s} image pixel${s > 1 ? "s" : ""} per diagram pixel` }))}
              onChange={(scale) => update({ scale })}
            />
          </Field>
          <Field label="Theme">
            <Choice
              value={theme}
              options={[
                { value: "light" as DiagramTheme, label: "Light" },
                { value: "dark" as DiagramTheme, label: "Dark" },
              ]}
              onChange={setTheme}
            />
          </Field>
          <Field label="Background">
            <Choice
              disabled={!meta.alpha}
              value={settings.transparent && meta.alpha ? "transparent" : "page"}
              options={[
                { value: "page", label: "Page color" },
                { value: "transparent", label: "Transparent" },
              ]}
              onChange={(v) => update({ transparent: v === "transparent" })}
            />
          </Field>
          <Field label="File name" hint={settings.format === "pdf" ? "Opens the print dialog: choose “Save as PDF”." : ""}>
            <div className="flex h-8 items-center rounded-lg border border-input bg-transparent pr-2 focus-within:ring-2 focus-within:ring-ring/40">
              <input className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
              <span className="text-sm text-muted-foreground">.{ext}</span>
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !root} onClick={run}>
            {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Export {meta.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
