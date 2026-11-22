/** Media references in a document (Image/Video src and poster, Audio src). */
import { updateNodes, walk, withProps, type ElementNode } from "@nn-diagram/format";

const MEDIA_PROPS: Record<string, string[]> = { Image: ["src"], Video: ["src", "poster"], Audio: ["src"] };

export function mediaRefs(root: ElementNode): { uid: string; prop: string; src: string }[] {
  const refs: { uid: string; prop: string; src: string }[] = [];
  walk(root, (n) => {
    for (const prop of MEDIA_PROPS[n.name] ?? []) {
      const v = n.props[prop];
      if (typeof v === "string" && v) refs.push({ uid: n.uid, prop, src: v });
    }
  });
  return refs;
}

/** Relative paths (not URLs, data URLs or absolute paths). */
export const isRelative = (src: string) => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

export function replaceSrcs(root: ElementNode, map: ReadonlyMap<string, string>): ElementNode {
  if (map.size === 0) return root;
  const updates = new Map<string, (n: ElementNode) => ElementNode>();
  for (const ref of mediaRefs(root)) {
    const next = map.get(ref.src);
    if (next !== undefined) {
      const prev = updates.get(ref.uid);
      updates.set(ref.uid, (n) => withProps(prev ? prev(n) : n, { [ref.prop]: next }));
    }
  }
  return updateNodes(root, updates);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function imageSize(url: string): Promise<{ w: number; h: number }> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    /* use defaults */
  }
  return { w: img.naturalWidth || 160, h: img.naturalHeight || 120 };
}

export async function videoInfo(url: string): Promise<{ w: number; h: number; duration: number }> {
  const v = document.createElement("video");
  v.preload = "metadata";
  v.muted = true;
  v.src = url;
  await new Promise<void>((resolve) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => resolve();
    setTimeout(resolve, 4000);
  });
  return { w: v.videoWidth || 320, h: v.videoHeight || 180, duration: Number.isFinite(v.duration) ? v.duration : 0 };
}

/** Fits a natural size into `max` px (longest side), on the grid. */
export function fitSize(size: { w: number; h: number }, max: number, grid: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(size.w, size.h, 1));
  const g = Math.max(1, grid);
  return { w: Math.max(g, Math.round((size.w * k) / g) * g), h: Math.max(g, Math.round((size.h * k) / g) * g) };
}
