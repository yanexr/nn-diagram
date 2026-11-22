/** Editor dialogs: video import (trim + playback options), folder chooser, shortcuts, help. */
import { Check, Copy, FileCode2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@nn-diagram/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@nn-diagram/ui/dialog";
import { Slider } from "@nn-diagram/ui/slider";
import { cn } from "@nn-diagram/viewer";
import { Logo } from "@nn-diagram/ui/logo";
import pkg from "../package.json";
import { useEd, useEditorContext } from "./context";
import { platformKeys, SHORTCUTS } from "./shortcuts";
import { Toggle } from "./panels/controls";

const fmt = (t: number) => {
  if (!Number.isFinite(t)) return "0:00.0";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

/** Trim a video (start/end points, the file is not re-encoded) and choose playback options. */
export function VideoImportDialog() {
  const { api, actions } = useEditorContext();
  const media = useEd((s) => s.mediaDialog);
  const ref = useRef<HTMLVideoElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [opts, setOpts] = useState({ autoplay: true, muted: true, loop: true, controls: false });
  const duration = media?.duration ?? 0;
  useEffect(() => {
    if (media) {
      setRange([0, media.duration]);
      setOpts({ autoplay: true, muted: true, loop: true, controls: false });
      setTime(0);
    }
  }, [media]);
  const close = () => {
    if (media) {
      // Cancelled: forget the media file again.
      const s = api.store.getState();
      const assets = { ...s.assets };
      delete assets[media.name];
      s.set({ mediaDialog: null, assets });
    }
  };
  if (!media) return null;
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < range[0] || v.currentTime >= range[1]) v.currentTime = range[0];
      v.play();
    } else v.pause();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-xl" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Insert video</DialogTitle>
          <DialogDescription>Pick the part to play. The file is kept as it is; the diagram stores start and end times.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video
              ref={ref}
              src={media.url}
              muted={opts.muted}
              playsInline
              className="aspect-video w-full object-contain"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                setTime(v.currentTime);
                if (v.currentTime >= range[1]) {
                  if (opts.loop) v.currentTime = range[0];
                  else v.pause();
                }
              }}
            />
            <button
              type="button"
              onClick={toggle}
              className="absolute bottom-3 left-3 flex size-9 items-center justify-center rounded-full bg-white/90 text-black shadow hover:bg-white"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
            </button>
            <span className="absolute right-3 bottom-3 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">{fmt(time)}</span>
          </div>
          <div>
            <div className="mb-2 flex justify-between text-xs text-muted-foreground">
              <span>Start {fmt(range[0])}</span>
              <span>{fmt(range[1] - range[0])} selected</span>
              <span>End {fmt(range[1])}</span>
            </div>
            <Slider
              value={range}
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.1}
              onValueChange={(v) => {
                const next = (Array.isArray(v) ? v : [v, v]) as [number, number];
                if (ref.current) ref.current.currentTime = next[0] !== range[0] ? next[0] : next[1];
                setRange(next);
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Toggle checked={opts.autoplay} onChange={(v) => setOpts({ ...opts, autoplay: v })} label="Autoplay" />
            <Toggle checked={opts.muted} onChange={(v) => setOpts({ ...opts, muted: v })} label="Mute audio" />
            <Toggle checked={opts.loop} onChange={(v) => setOpts({ ...opts, loop: v })} label="Loop" />
            <Toggle checked={opts.controls} onChange={(v) => setOpts({ ...opts, controls: v })} label="Show controls in the viewer" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button
            onClick={() =>
              actions.insertVideo({
                name: media.name,
                size: media.size,
                start: range[0] > 0.05 ? range[0] : 0,
                end: range[1] < duration - 0.05 ? range[1] : null,
                ...opts,
                at: media.at,
              })
            }
          >
            Insert video
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FolderChooserDialog() {
  const { api, actions } = useEditorContext();
  const chooser = useEd((s) => s.folderChooser);
  if (!chooser) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && api.store.getState().set({ folderChooser: null })}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open a diagram from “{chooser.folder.name}”</DialogTitle>
          <DialogDescription>This folder contains several diagrams.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {chooser.names.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => actions.openFromFolder(chooser.folder, name)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground"
            >
              <FileCode2 /> {name}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ShortcutsDialog() {
  const { api } = useEditorContext();
  const open = useEd((s) => s.shortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={(o) => api.store.getState().set({ shortcutsOpen: o })}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <table className="w-full text-xs">
          <tbody>
            {SHORTCUTS.map(([keys, desc]) => (
              <tr key={keys} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-4 font-mono text-[11px] whitespace-nowrap text-muted-foreground">{platformKeys(keys)}</td>
                <td className="py-1.5">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-muted/60 pr-1 pl-3.5 font-mono text-[12.5px]">
      <span className="flex-1 truncate">{text}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="space-y-5 text-sm [counter-reset:step] [&>li]:relative [&>li]:pl-9 [&>li]:[counter-increment:step] [&>li]:before:absolute [&>li]:before:top-px [&>li]:before:left-0 [&>li]:before:flex [&>li]:before:size-5 [&>li]:before:items-center [&>li]:before:justify-center [&>li]:before:rounded-full [&>li]:before:bg-foreground/[0.07] [&>li]:before:text-[11px] [&>li]:before:font-semibold [&>li]:before:tabular-nums [&>li]:before:content-[counter(step)]">{children}</ol>;
}

/** How to let an AI coding agent edit diagrams (the file on disk is the interface). */
export function AiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit with AI</DialogTitle>
          <DialogDescription>
            Diagrams are plain JSX files, so AI agents such as Claude Code, Codex or Cursor can draw and edit them. Changes appear here as soon as the agent saves.
          </DialogDescription>
        </DialogHeader>
        <Steps>
          <li>
            <div className="font-medium">Save the diagram to your project</div>
            <div className="mt-0.5 leading-relaxed text-muted-foreground">File → Save. Keep it open here while the agent works.</div>
          </li>
          <li>
            <div className="font-medium">Teach your agent the format</div>
            <div className="mt-0.5 mb-2.5 leading-relaxed text-muted-foreground">Run this in the project folder. It installs a skill with the format reference.</div>
            <CopyLine text="npx nn-diagram skill" />
          </li>
          <li>
            <div className="font-medium">Ask for changes</div>
            <div className="mt-0.5 leading-relaxed text-muted-foreground">For example: “Add a residual connection around the attention block in training.diagram.jsx”.</div>
          </li>
        </Steps>
      </DialogContent>
    </Dialog>
  );
}

const TIPS: [string, string][] = [
  ["Add shapes", "Drag them from the left panel, or use the tools at the bottom (R, O, T, L, P)."],
  ["Connect", "Hover a shape and drag from an ×, or click a blue arrow to add a connected copy."],
  ["Formulas", "Type LaTeX between dollar signs in any label, e.g. $\\theta$."],
  ["Modifiers", "Shift constrains, Alt disables snapping, Ctrl+drag duplicates."],
  ["More actions", "Right-click a shape or the canvas."],
];

export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center gap-1 px-6 pt-1 text-center">
          <Logo className="mb-2 size-9" />
          <DialogTitle>nn-diagram</DialogTitle>
          <DialogDescription>
            Version {pkg.version} ·{" "}
            <a href="https://github.com/yanexr/nn-diagram" target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">
              GitHub
            </a>
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border border-t border-border text-[13px]">
          {TIPS.map(([title, text]) => (
            <div key={title} className="grid grid-cols-[104px_1fr] gap-4 py-3 last:pb-0">
              <dt className="font-medium">{title}</dt>
              <dd className="leading-relaxed text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
