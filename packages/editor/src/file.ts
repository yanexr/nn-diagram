/**
 * Local files via the File System Access API (Chromium browsers), with a
 * download/upload fallback elsewhere.
 *
 * A diagram lives in a folder: media (images, videos, audio) are separate
 * files next to the diagram and referenced by relative path, so the diagram
 * file stays small and readable for LLMs. Saving a diagram with new media
 * therefore needs access to its folder. Open files are watched for changes
 * made by other tools (e.g. an LLM editing the file).
 */

interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

type StartIn = FileSystemHandle | "desktop" | "documents" | "downloads";

interface PickerWindow {
  showOpenFilePicker?: (opts: { types?: FilePickerType[]; multiple?: boolean; id?: string; startIn?: StartIn }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts: { suggestedName?: string; types?: FilePickerType[]; id?: string; startIn?: StartIn }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (opts: { id?: string; mode?: "read" | "readwrite"; startIn?: StartIn }) => Promise<FileSystemDirectoryHandle>;
}

type Permissioned = {
  queryPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
};

type WritableHandle = FileSystemFileHandle &
  Permissioned & {
    createWritable?: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }>;
    move?: (name: string) => Promise<void>;
  };

type Folder = FileSystemDirectoryHandle &
  Permissioned & {
    values?: () => AsyncIterable<FileSystemHandle>;
  };

const TYPES: FilePickerType[] = [{ description: "nn-diagram file", accept: { "text/javascript": [".jsx"] } }];
const PICKER_ID = "nn-diagram-diagrams";

const picker = () => (typeof window !== "undefined" ? (window as unknown as PickerWindow) : {});

export const supportsFileSystemAccess = () => typeof picker().showOpenFilePicker === "function";
export const supportsFolders = () => typeof picker().showDirectoryPicker === "function";

export const DIAGRAM_SUFFIX = ".diagram.jsx";

/** Normalizes a user-typed file name to `<name>.diagram.jsx`. */
export function diagramFileName(name: string): string {
  const base = name
    .trim()
    .replace(/\.diagram\.jsx$|\.jsx$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim();
  return `${base || "untitled"}${DIAGRAM_SUFFIX}`;
}

const isAbort = (err: unknown) => (err as DOMException)?.name === "AbortError";

async function ensurePermission(handle: Permissioned, mode: "read" | "readwrite"): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  return (await handle.requestPermission?.({ mode })) === "granted";
}

export interface OpenedFile {
  text: string;
  name: string;
  handle: FileSystemFileHandle | null;
  lastModified: number;
}

export async function openFile(): Promise<OpenedFile | null> {
  const w = picker();
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: TYPES, multiple: false, id: PICKER_ID });
      const file = await handle.getFile();
      await remember({ file: handle });
      return { text: await file.text(), name: file.name, handle, lastModified: file.lastModified };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const [file] = await pickFiles(".jsx,.diagram.jsx,text/javascript", false);
  return file ? { text: await file.text(), name: file.name, handle: null, lastModified: file.lastModified } : null;
}

/** Plain file input (works in every browser). */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

// ---------------------------------------------------------------- folders

/** Asks for the folder that holds (or will hold) the diagram and its media. */
export async function pickFolder(startIn?: FileSystemHandle | null): Promise<FileSystemDirectoryHandle | null> {
  const w = picker();
  if (!w.showDirectoryPicker) return null;
  try {
    const folder = await w.showDirectoryPicker({ id: PICKER_ID, mode: "readwrite", startIn: startIn ?? "documents" });
    return folder;
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/** Whether a file handle is inside a folder. */
export async function folderContains(folder: FileSystemDirectoryHandle, file: FileSystemFileHandle): Promise<boolean> {
  try {
    const path = await folder.resolve(file);
    return path !== null;
  } catch {
    return false;
  }
}

async function dirFor(folder: FileSystemDirectoryHandle, path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) throw new Error(`Paths outside the diagram folder are not supported: ${path}`);
  let dir = folder;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, name: parts[parts.length - 1] ?? "" };
}

export async function writeFile(folder: FileSystemDirectoryHandle, path: string, data: string | Blob): Promise<FileSystemFileHandle> {
  if (!(await ensurePermission(folder as Folder, "readwrite"))) throw new Error("No permission to write to the folder");
  const { dir, name } = await dirFor(folder, path, true);
  const handle = (await dir.getFileHandle(name, { create: true })) as WritableHandle;
  const writable = await handle.createWritable!();
  await writable.write(data);
  await writable.close();
  return handle;
}

export async function readFile(folder: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  try {
    const { dir, name } = await dirFor(folder, path, false);
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

export async function fileExists(folder: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  return (await readFile(folder, path)) !== null;
}

export async function removeFile(folder: FileSystemDirectoryHandle, path: string): Promise<void> {
  try {
    const { dir, name } = await dirFor(folder, path, false);
    await dir.removeEntry(name);
  } catch {
    /* already gone */
  }
}

export async function listDiagrams(folder: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  const values = (folder as Folder).values?.();
  if (!values) return names;
  for await (const entry of values) {
    if (entry.kind === "file" && entry.name.endsWith(DIAGRAM_SUFFIX)) names.push(entry.name);
  }
  return names.sort();
}

/** Renames a file in place when the browser supports it. */
export async function renameHandle(handle: FileSystemFileHandle, name: string): Promise<boolean> {
  const h = handle as WritableHandle;
  if (!h.move) return false;
  try {
    await h.move(name);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ save

export async function writeHandle(handle: FileSystemFileHandle, text: string): Promise<number> {
  const h = handle as WritableHandle;
  if (!(await ensurePermission(h, "readwrite"))) throw new Error("No permission to write the file");
  const writable = await h.createWritable!();
  await writable.write(text);
  await writable.close();
  return (await handle.getFile()).lastModified;
}

export async function saveAsFile(text: string, name: string, startIn?: FileSystemHandle | null): Promise<FileSystemFileHandle | null> {
  const w = picker();
  if (!w.showSaveFilePicker) return null;
  try {
    const handle = await w.showSaveFilePicker({ suggestedName: name, types: TYPES, id: PICKER_ID, startIn: startIn ?? undefined });
    await writeHandle(handle, text);
    await remember({ file: handle });
    return handle;
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Reads the file if it changed on disk since `since`. */
export async function readIfChanged(handle: FileSystemFileHandle, since: number | null): Promise<{ text: string; lastModified: number } | null> {
  const file = await handle.getFile();
  if (since !== null && file.lastModified <= since) return null;
  return { text: await file.text(), lastModified: file.lastModified };
}

// ----------------------------------------------------------------- media

const MEDIA_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

/** A readable, unique file name for a media file, e.g. "noisy-fox-2.png". */
export function mediaFileName(original: string, type: string, taken: ReadonlySet<string>): string {
  const extFromName = /\.([a-z0-9]{2,5})$/i.exec(original)?.[1]?.toLowerCase();
  const ext = extFromName ?? MEDIA_EXT[type] ?? type.split("/")[1] ?? "bin";
  const base =
    original
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || (type.startsWith("video") ? "video" : type.startsWith("audio") ? "audio" : "image");
  let name = `${base}.${ext}`;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}.${ext}`;
  return name;
}

export function mediaKind(type: string, name = ""): "image" | "video" | "audio" | null {
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name)) return "image";
  if (type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name)) return "video";
  if (type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return "audio";
  return null;
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

// ------------------------------------------------------------- IndexedDB

const DB = "nn-diagram-editor";
const STORE = "handles";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface Recent {
  file?: FileSystemFileHandle;
  folder?: FileSystemDirectoryHandle;
  name?: string;
}

export async function remember(recent: Recent): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(recent, "recent");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* private mode etc. */
  }
}

export async function lastRecent(): Promise<Recent | null> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction(STORE).objectStore(STORE).get("recent");
      req.onsuccess = () => resolve((req.result as Recent) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Reopens the most recent file (asks for permission again). */
export async function reopen(recent: Recent): Promise<(OpenedFile & { folder: FileSystemDirectoryHandle | null }) | null> {
  let handle = recent.file ?? null;
  const folder = recent.folder ?? null;
  if (folder) {
    if (!(await ensurePermission(folder as Folder, "readwrite"))) return null;
    if (recent.name) handle = await folder.getFileHandle(recent.name).catch(() => handle);
  } else if (handle && !(await ensurePermission(handle as WritableHandle, "read"))) return null;
  if (!handle) return null;
  const file = await handle.getFile();
  return { text: await file.text(), name: file.name, handle, lastModified: file.lastModified, folder };
}

// ----------------------------------------------------------------- draft

const DRAFT_KEY = "nn-diagram.editor.draft";

export function saveDraft(text: string, name: string) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, name, time: Date.now() }));
  } catch {
    /* storage full or blocked */
  }
}

/**
 * Media of the draft (images dropped in or inserted from the library). They
 * are binary, so they go to IndexedDB instead of localStorage.
 */
export async function saveDraftAssets(assets: Record<string, Blob>): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(assets, "draft-assets");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* private mode, quota */
  }
}

export async function loadDraftAssets(): Promise<Record<string, Blob>> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction(STORE).objectStore(STORE).get("draft-assets");
      req.onsuccess = () => resolve((req.result as Record<string, Blob>) ?? {});
      req.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

export function loadDraft(): { text: string; name: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
