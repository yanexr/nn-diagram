/** Editor commands used by menus, toolbars, the context menu and shortcuts. */
import {
  checkSource,
  element,
  findNode,
  getSpec,
  parseDiagram,
  parseFragment,
  serializeDiagram,
  serializeNodes,
  setProps,
  snapToGrid,
  text,
  updateNodes,
  withProps,
  type ChildNode,
  type ElementNode,
} from "@nn-diagram/format";
import { labelText, type Pt, type Rect } from "@nn-diagram/viewer";
import {
  align as alignCmd,
  copySelection,
  deleteSelection,
  distribute as distributeCmd,
  duplicate,
  groupSelection,
  insertNodes,
  nudge,
  reorder,
  topLevel,
  translateNode,
  ungroup,
  unionRect,
  type Align,
  type ZOrder,
} from "./commands";
import type { EditorApi } from "./context";
import {
  DIAGRAM_SUFFIX,
  dataUrlToBlob,
  diagramFileName,
  download,
  fileExists,
  folderContains,
  lastRecent,
  listDiagrams,
  mediaFileName,
  mediaKind,
  openFile,
  pickFiles,
  pickFolder,
  readFile,
  readIfChanged,
  remember,
  removeFile,
  renameHandle,
  reopen,
  supportsFileSystemAccess,
  supportsFolders,
  writeFile,
  writeHandle,
} from "./file";
import { blobToDataUrl, fitSize, imageSize, isRelative, mediaRefs, replaceSrcs, videoInfo } from "./media";
import { DEFAULT_DIAGRAM, type Asset, type FileInfo, type ScratchItem } from "./store";

const SCRATCH_KEY = "nn-diagram.editor.scratchpad";

export function loadScratchpad(): ScratchItem[] {
  try {
    return JSON.parse(localStorage.getItem(SCRATCH_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function createActions(api: EditorApi) {
  const st = () => api.store.getState();

  const confirmDiscard = () => !st().dirty || window.confirm("Discard unsaved changes?");

  const loadText = (text: string, info: Partial<FileInfo> & { name: string }, keepView = false) => {
    const { file, issues } = checkSource(text);
    if (!file) {
      window.alert(`Could not open ${info.name}:\n\n${issues.map((i) => i.message).join("\n")}`);
      return false;
    }
    st().load(
      file,
      {
        handle: null,
        folder: null,
        lastModified: null,
        url: null,
        renamedFrom: null,
        ...info,
        savedText: text,
      },
      { keepView },
    );
    if (!keepView) requestAnimationFrame(() => api.fit());
    void loadFolderAssets();
    return true;
  };

  /** Reads media referenced by the diagram from its folder into object URLs. */
  async function loadFolderAssets() {
    const s = st();
    const folder = s.file.folder;
    const wanted = mediaRefs(s.doc)
      .map((r) => r.src)
      .filter((src) => isRelative(src) && !s.assets[src]);
    if (!folder) {
      st().set({ missingAssets: s.file.handle && !s.file.url ? [...new Set(wanted)] : [] });
      return;
    }
    const assets: Record<string, Asset> = {};
    const missing: string[] = [];
    for (const src of new Set(wanted)) {
      const file = await readFile(folder, src);
      if (file) assets[src] = { url: URL.createObjectURL(file), blob: null };
      else missing.push(src);
    }
    st().set({ assets: { ...st().assets, ...assets }, missingAssets: missing });
  }

  /** Registers a media file; it is written next to the diagram on save. */
  function addAsset(blob: Blob, originalName: string): string {
    const s = st();
    const taken = new Set([...Object.keys(s.assets), ...mediaRefs(s.doc).map((r) => r.src)]);
    const name = mediaFileName(originalName, blob.type, taken);
    st().set({ assets: { ...s.assets, [name]: { url: URL.createObjectURL(blob), blob } } });
    return name;
  }

  /**
   * Writes everything the diagram needs into the folder: new media, media
   * embedded as data URLs (they become files) and media that so far only
   * existed on the website. Returns the document with updated paths.
   */
  async function materializeMedia(doc: ElementNode, folder: FileSystemDirectoryHandle): Promise<ElementNode> {
    const s = st();
    const renames = new Map<string, string>();
    const assets: Record<string, Asset> = { ...s.assets };
    const taken = new Set([...Object.keys(assets), ...mediaRefs(doc).map((r) => r.src)]);
    for (const ref of mediaRefs(doc)) {
      const src = ref.src;
      if (renames.has(src)) continue;
      if (src.startsWith("data:")) {
        const blob = await dataUrlToBlob(src);
        let name = mediaFileName(ref.prop === "poster" ? "poster" : "embedded", blob.type, taken);
        while (await fileExists(folder, name)) name = mediaFileName(name, blob.type, new Set([...taken, name]));
        taken.add(name);
        await writeFile(folder, name, blob);
        assets[name] = { url: URL.createObjectURL(blob), blob: null };
        renames.set(src, name);
        continue;
      }
      if (!isRelative(src)) continue;
      const asset = assets[src];
      if (asset?.blob) {
        let name = src;
        const existing = await readFile(folder, name);
        if (existing && existing.size !== asset.blob.size) {
          name = mediaFileName(src, asset.blob.type, taken);
          while (await fileExists(folder, name)) name = mediaFileName(name, asset.blob.type, new Set([...taken, name]));
          taken.add(name);
          renames.set(src, name);
        }
        await writeFile(folder, name, asset.blob);
        assets[name] = { url: asset.url, blob: null };
        if (name !== src) delete assets[src];
      } else if (!asset && s.file.url && !(await fileExists(folder, src))) {
        // Opened from the website: bring the media along.
        try {
          const res = await fetch(new URL(src, new URL(s.file.url, location.href)).toString());
          if (res.ok) {
            const blob = await res.blob();
            await writeFile(folder, src, blob);
            assets[src] = { url: URL.createObjectURL(blob), blob: null };
          }
        } catch {
          /* leave the reference as it is */
        }
      }
    }
    st().set({ assets });
    return replaceSrcs(doc, renames);
  }

  async function embedMedia(doc: ElementNode): Promise<ElementNode> {
    const map = new Map<string, string>();
    for (const [name, asset] of Object.entries(st().assets)) {
      if (asset.blob) map.set(name, await blobToDataUrl(asset.blob));
    }
    return replaceSrcs(doc, map);
  }

  const needsFolder = (doc: ElementNode) => {
    const s = st();
    return mediaRefs(doc).some(
      (r) => r.src.startsWith("data:") || (isRelative(r.src) && (s.assets[r.src]?.blob || (s.file.url && !s.file.folder))),
    );
  };

  const actions = {
    loadText,
    loadFolderAssets,
    addAsset,

    newFile() {
      if (!confirmDiscard()) return;
      loadText(DEFAULT_DIAGRAM, { name: `untitled${DIAGRAM_SUFFIX}` });
    },

    async open() {
      if (!confirmDiscard()) return;
      const file = await openFile();
      if (file) loadText(file.text, { name: file.name, handle: file.handle, lastModified: file.lastModified });
    },

    /** Opens a folder: one of its diagrams, or a new diagram saved there. */
    async openFolder() {
      if (!confirmDiscard()) return;
      const folder = await pickFolder();
      if (!folder) return;
      const names = await listDiagrams(folder);
      if (names.length === 1) await actions.openFromFolder(folder, names[0]);
      else if (names.length > 1) st().set({ folderChooser: { folder, names } });
      else {
        loadText(DEFAULT_DIAGRAM, { name: `untitled${DIAGRAM_SUFFIX}`, folder });
        st().showToast(`New diagram in “${folder.name}”`);
      }
    },

    async openFromFolder(folder: FileSystemDirectoryHandle, name: string) {
      st().set({ folderChooser: null });
      const handle = await folder.getFileHandle(name);
      const file = await handle.getFile();
      loadText(await file.text(), { name, handle, folder, lastModified: file.lastModified });
      await remember({ file: handle, folder, name });
    },

    async reopenLast() {
      const recent = await lastRecent();
      if (!recent) return st().showToast("No recent file");
      if (!confirmDiscard()) return;
      const file = await reopen(recent);
      if (file) loadText(file.text, { name: file.name, handle: file.handle, folder: file.folder, lastModified: file.lastModified });
    },

    async openUrl(url: string) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
      const text = await res.text();
      const name = decodeURIComponent(url.split("/").pop() || `diagram${DIAGRAM_SUFFIX}`);
      loadText(text, { name, url });
    },

    /** Grants access to the diagram's folder so its media can be shown and saved. */
    async connectFolder() {
      const s = st();
      const folder = await pickFolder(s.file.handle);
      if (!folder) return;
      if (s.file.handle && !(await folderContains(folder, s.file.handle))) {
        window.alert(`“${s.file.name}” is not in that folder. Choose the folder that contains the diagram.`);
        return;
      }
      st().set({ file: { ...st().file, folder } });
      await loadFolderAssets();
      await remember({ file: s.file.handle ?? undefined, folder, name: s.file.name });
    },

    async save(saveAs = false) {
      const s = st();
      let doc = s.doc;
      let folder = saveAs ? null : s.file.folder;
      let handle = saveAs ? null : s.file.handle;
      const name = diagramFileName(s.file.name);
      try {
        const onSave = api.onSave();
        if (onSave) {
          // The app stores the file: media go along as data URLs.
          const text = serializeDiagram({ root: await embedMedia(doc), header: s.header });
          await onSave(text, { name });
          st().markSaved(serializeDiagram({ root: doc, header: s.header }), { name, renamedFrom: null });
          st().showToast(`Saved ${name}`);
          return;
        }
        if (supportsFolders() && (folder || needsFolder(doc) || !handle)) {
          if (!folder) {
            folder = await pickFolder(s.file.handle);
            if (!folder) return;
            const sameFile = s.file.handle ? await folderContains(folder, s.file.handle) : false;
            if (!sameFile && (await fileExists(folder, name)) && !window.confirm(`Replace “${name}” in “${folder.name}”?`)) return;
          }
          doc = await materializeMedia(doc, folder);
          const text = serializeDiagram({ root: doc, header: s.header });
          handle = await writeFile(folder, name, text);
          if (s.file.renamedFrom && s.file.renamedFrom !== name) await removeFile(folder, s.file.renamedFrom);
          if (doc !== s.doc) st().set({ doc });
          const lastModified = (await handle.getFile()).lastModified;
          st().markSaved(text, { name, handle, folder, lastModified, renamedFrom: null, url: null });
          await remember({ file: handle, folder, name });
          st().showToast(`Saved ${folder.name}/${name}`);
          return;
        }
        if (handle && supportsFileSystemAccess()) {
          const text = serializeDiagram({ root: doc, header: s.header });
          const lastModified = await writeHandle(handle, text);
          st().markSaved(text, { name: handle.name, handle, lastModified, renamedFrom: null });
          st().showToast(`Saved ${handle.name}`);
          return;
        }
        // No file system access (e.g. Firefox): download, with media embedded.
        const embedded = await embedMedia(doc);
        const text = serializeDiagram({ root: embedded, header: s.header });
        download(new Blob([text], { type: "text/javascript" }), name);
        st().markSaved(serializeDiagram({ root: doc, header: s.header }), { name, renamedFrom: null });
        st().showToast(`Downloaded ${name}`);
      } catch (err) {
        window.alert(`Saving failed: ${(err as Error).message}`);
      }
    },

    /** Renames the diagram file (on disk too, when possible). */
    async rename(input: string) {
      const s = st();
      const name = diagramFileName(input);
      if (name === s.file.name) return;
      if (s.file.folder && s.file.handle) {
        if (await fileExists(s.file.folder, name)) return window.alert(`“${name}” already exists in this folder.`);
        st().set({ file: { ...s.file, name, renamedFrom: s.file.renamedFrom ?? s.file.name } });
        await actions.save();
        return;
      }
      if (s.file.handle && (await renameHandle(s.file.handle, name))) {
        st().set({ file: { ...s.file, name } });
        st().showToast(`Renamed to ${name}`);
        return;
      }
      st().set({ file: { ...s.file, name }, dirty: s.file.handle ? true : s.dirty });
    },

    /** Reloads the open file if another program changed it. */
    async checkExternalChange() {
      const s = st();
      if (!s.file.handle) return;
      const changed = await readIfChanged(s.file.handle, s.file.lastModified);
      if (!changed) return;
      if (changed.text === s.file.savedText) {
        st().set({ file: { ...st().file, lastModified: changed.lastModified } });
        return;
      }
      if (!st().dirty) {
        if (loadText(changed.text, { ...s.file, lastModified: changed.lastModified }, true)) st().showToast("Reloaded: the file changed on disk");
      } else {
        st().set({ externalChange: changed.text, file: { ...st().file, lastModified: changed.lastModified } });
      }
    },

    acceptExternalChange() {
      const s = st();
      if (s.externalChange) loadText(s.externalChange, { ...s.file }, true);
    },

    openExport: () => st().set({ exportOpen: true }),
    fitPage: () => api.fit(),
    toggleGrid: () => st().set({ showGrid: !st().showGrid }),

    // ---------------------------------------------------------- editing
    undo: () => st().undo(),
    redo: () => st().redo(),

    deleteSelection() {
      const s = st();
      if (!s.selection.length) return;
      s.commit(deleteSelection(s.doc, s.selection), { selection: [] });
    },

    duplicate() {
      const s = st();
      const l = api.layout();
      if (!l || !s.selection.length) return;
      const res = duplicate(s.doc, l, s.selection, l.grid * 4);
      s.commit(res.doc, { selection: res.uids });
    },

    selectAll() {
      const s = st();
      const scope = s.enteredGroup ? findNode(s.doc, s.enteredGroup)?.node : s.doc;
      if (!scope) return;
      s.select(scope.children.filter((c): c is ElementNode => c.kind === "element" && (getSpec(c.name)?.kind === "shape" || getSpec(c.name)?.kind === "edge")).map((c) => c.uid));
    },

    selectNone() {
      st().select([]);
      st().set({ enteredGroup: null, tool: st().tool === "pencil" ? "pencil" : "select" });
    },

    copyText(): string | null {
      const s = st();
      const l = api.layout();
      return l ? copySelection(s.doc, l, s.selection) : null;
    },

    async copy() {
      const t = actions.copyText();
      if (t) await navigator.clipboard?.writeText(t).catch(() => undefined);
    },

    async cut() {
      const t = actions.copyText();
      if (!t) return;
      await navigator.clipboard?.writeText(t).catch(() => undefined);
      actions.deleteSelection();
    },

    /** Paste from the system clipboard (context menu / menu bar). */
    async pasteFromClipboard(at?: Pt) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            await actions.insertMedia([new File([blob], `pasted.${type.split("/")[1]}`, { type })], at);
            return;
          }
        }
        for (const item of items) {
          if (item.types.includes("text/plain")) {
            actions.paste(await (await item.getType("text/plain")).text());
            return;
          }
        }
      } catch {
        const t = await navigator.clipboard?.readText().catch(() => "");
        if (t) actions.paste(t);
      }
    },

    paste(textValue: string) {
      const s = st();
      const l = api.layout();
      if (!l) return;
      let nodes: ChildNode[];
      try {
        nodes = parseFragment(textValue.trim());
      } catch {
        try {
          nodes = parseDiagram(textValue).root.children;
        } catch {
          // Plain text: paste it as a text element.
          const t = textValue.trim();
          if (!t) return;
          nodes = [element("Text", { x: 0, y: 0 }, [text(t.slice(0, 2000))])];
          const c = api.viewCenter();
          const res = insertNodes(s.doc, l, nodes, { offset: { x: Math.round(c.x / l.grid) * l.grid, y: Math.round(c.y / l.grid) * l.grid } });
          s.commit(res.doc, { selection: res.uids });
          return;
        }
      }
      if (!nodes.length) return;
      pasteCount = textValue === lastPaste ? pasteCount + 1 : 1;
      lastPaste = textValue;
      const off = l.grid * 4 * pasteCount;
      const res = insertNodes(s.doc, l, nodes, { parentUid: s.enteredGroup ?? null, offset: { x: off, y: off } });
      s.commit(res.doc, { selection: res.uids });
    },

    nudge(dx: number, dy: number) {
      const s = st();
      const l = api.layout();
      if (!l || !s.selection.length) return;
      s.commit(nudge(s.doc, l, s.selection, dx, dy), { merge: "nudge" });
    },

    /** Ctrl+arrows: resize. */
    resizeBy(dw: number, dh: number) {
      const s = st();
      const l = api.layout();
      if (!l) return;
      const map = new Map<string, (n: ElementNode) => ElementNode>();
      for (const uid of topLevel(l, s.selection)) {
        const shape = l.shapes.get(uid);
        if (!shape) continue;
        map.set(uid, (n) => withProps(n, { w: Math.max(1, Math.round(shape.bounds.w + dw)), h: Math.max(1, Math.round(shape.bounds.h + dh)) }));
      }
      s.commit(updateNodes(s.doc, map), { merge: "resize-key" });
    },

    rotate90() {
      const s = st();
      const map = new Map<string, (n: ElementNode) => ElementNode>();
      for (const uid of s.selection) {
        map.set(uid, (n) => {
          if (getSpec(n.name)?.kind !== "shape") return n;
          const r = ((typeof n.props.rotate === "number" ? n.props.rotate : 0) + 90) % 360;
          return withProps(n, { rotate: r === 0 ? undefined : r > 180 ? r - 360 : r });
        });
      }
      s.commit(updateNodes(s.doc, map));
    },

    reorder(op: ZOrder) {
      const s = st();
      if (s.selection.length) s.commit(reorder(s.doc, s.selection, op));
    },

    align(how: Align) {
      const s = st();
      const l = api.layout();
      if (l) s.commit(alignCmd(s.doc, l, s.selection, how));
    },

    distribute(axis: "h" | "v") {
      const s = st();
      const l = api.layout();
      if (l) s.commit(distributeCmd(s.doc, l, s.selection, axis));
    },

    group() {
      const s = st();
      const l = api.layout();
      if (!l || s.selection.length < 1) return;
      const res = groupSelection(s.doc, l, s.selection);
      s.commit(res.doc, { selection: res.uids });
    },

    ungroup() {
      const s = st();
      const l = api.layout();
      if (!l) return;
      const res = ungroup(s.doc, l, s.selection);
      if (res.uids.length) s.commit(res.doc, { selection: res.uids });
    },

    editText() {
      const s = st();
      if (s.selection.length === 1) api.startTextEdit(s.selection[0]);
    },

    /** Tab / Shift+Tab: select the next or previous sibling. */
    selectSibling(dir: 1 | -1) {
      const s = st();
      const l = api.layout();
      if (!l) return;
      const current = s.selection[0];
      const parentUid = current ? (l.parents.get(current) ?? null) : (s.enteredGroup ?? null);
      const parent = parentUid ? findNode(s.doc, parentUid)?.node : s.doc;
      if (!parent) return;
      const kids = parent.children.filter((c): c is ElementNode => c.kind === "element" && (getSpec(c.name)?.kind === "shape" || getSpec(c.name)?.kind === "edge"));
      if (!kids.length) return;
      const i = current ? kids.findIndex((k) => k.uid === current) : -1;
      s.select([kids[(i + dir + kids.length) % kids.length].uid]);
    },

    /** Rounds the geometry of every shape to the grid (fixes grid warnings). */
    snapAllToGrid() {
      const s = st();
      const l = api.layout();
      const next = snapToGrid(s.doc, l?.grid ?? 4);
      if (next !== s.doc) {
        s.commit(next);
        s.showToast("Snapped all shapes to the grid");
      }
    },

    setTool(tool: ReturnType<typeof st>["tool"]) {
      st().set({ tool, editingText: null });
    },

    // ------------------------------------------------------- scratchpad
    addToScratchpad(uids?: string[]) {
      const s = st();
      const l = api.layout();
      const sel = uids ?? s.selection;
      if (!l || sel.length === 0) return;
      const top = topLevel(l, sel);
      const rect = unionRect(top.map((u) => l.shapes.get(u)?.bounds).filter((r): r is Rect => !!r));
      const copied = copySelection(s.doc, l, sel);
      if (!copied || !rect) return;
      const nodes = parseFragment(copied).map((n) => (n.kind === "element" ? translateNode(n, -rect.x, -rect.y) : n));
      const label = top.map((u) => (l.shapes.get(u) ? labelText(l.shapes.get(u)!.node) : "")).filter(Boolean)[0] || top.map((u) => l.shapes.get(u)?.node.name).filter(Boolean)[0] || "Snippet";
      actions.setScratchpad([{ id: `s${Date.now()}`, label, snippet: serializeNodes(nodes) }, ...s.scratchpad]);
      s.showToast("Added to scratchpad");
    },

    setScratchpad(items: ScratchItem[]) {
      st().set({ scratchpad: items });
      try {
        localStorage.setItem(SCRATCH_KEY, JSON.stringify(items));
      } catch {
        /* ignore */
      }
    },

    // ------------------------------------------------------------ insert
    insertSnippet(snippet: string, at?: Pt) {
      const s = st();
      const l = api.layout();
      if (!l) return;
      let nodes;
      try {
        nodes = parseFragment(snippet);
      } catch (err) {
        return st().showToast((err as Error).message);
      }
      const temp = element("Diagram", {}, nodes);
      const xs: number[] = [];
      const ys: number[] = [];
      const ws: number[] = [];
      const hs: number[] = [];
      for (const n of temp.children) {
        if (n.kind !== "element" || getSpec(n.name)?.kind !== "shape") continue;
        xs.push(Number(n.props.x) || 0);
        ys.push(Number(n.props.y) || 0);
        ws.push((Number(n.props.x) || 0) + (Number(n.props.w) || 0));
        hs.push((Number(n.props.y) || 0) + (Number(n.props.h) || 0));
      }
      const w = xs.length ? Math.max(...ws) - Math.min(...xs) : 0;
      const h = ys.length ? Math.max(...hs) - Math.min(...ys) : 0;
      const c = at ?? api.viewCenter();
      const g = l.grid;
      // Drop into a container under the drop point.
      let parentUid: string | null = s.enteredGroup;
      if (at) {
        let best: { uid: string; depth: number } | null = null;
        for (const sh of l.shapes.values()) {
          const b = sh.bounds;
          const container = sh.node.name === "Group" || (sh.node.name === "Box" && String(sh.node.props.variant ?? "").startsWith("panel"));
          if (container && at.x >= b.x && at.y >= b.y && at.x <= b.x + b.w && at.y <= b.y + b.h && (!best || sh.depth > best.depth)) best = { uid: sh.uid, depth: sh.depth };
        }
        if (best) parentUid = best.uid;
      }
      const origin = l.origins.get(parentUid ?? s.doc.uid) ?? { x: 0, y: 0 };
      // Snap relative to the parent so the stored values are on the grid.
      const ox = Math.round((c.x - (at ? 0 : w / 2) - origin.x) / g) * g + origin.x - (xs.length ? Math.min(...xs) : 0);
      const oy = Math.round((c.y - (at ? 0 : h / 2) - origin.y) / g) * g + origin.y - (ys.length ? Math.min(...ys) : 0);
      const res = insertNodes(s.doc, l, nodes, { parentUid, offset: { x: ox, y: oy } });
      s.commit(res.doc, { selection: res.uids, merge: undefined });
      if (s.tool !== "pencil") st().set({ tool: "select" });
    },

    /**
     * Inserts a library item. Media it brings along are fetched and added to
     * the diagram (saved next to it), under a free name.
     */
    async insertLibraryItem(item: { snippet: string; assets?: Record<string, string> }, at?: Pt) {
      let snippet = item.snippet;
      for (const [name, url] of Object.entries(item.assets ?? {})) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          const added = addAsset(await res.blob(), name);
          if (added !== name) snippet = snippet.split(`"${name}"`).join(`"${added}"`);
        } catch {
          // Keep the reference: the diagram shows a missing image instead of failing.
          st().showToast(`Could not load ${name}`);
        }
      }
      actions.insertSnippet(snippet, at);
    },

    /** Imports images, videos and audio files (video first opens the trim dialog). */
    async insertMedia(files: File[], at?: Pt) {
      const l = api.layout();
      const g = l?.grid ?? 4;
      let offset = 0;
      for (const file of files) {
        const kind = mediaKind(file.type, file.name);
        if (!kind) continue;
        const name = addAsset(file, file.name);
        const url = st().assets[name].url;
        const pos = at ? { x: at.x + offset, y: at.y + offset } : undefined;
        if (kind === "image") {
          const size = fitSize(await imageSize(url), 320, g);
          actions.insertSnippet(`<Image x={0} y={0} w={${size.w}} h={${size.h}} src="${name}" />`, pos);
        } else if (kind === "audio") {
          const title = file.name.replace(/\.[^.]+$/, "").replace(/[{}<>]/g, "");
          actions.insertSnippet(`<Audio x={0} y={0} w={280} h={56} src="${name}">${title}</Audio>`, pos);
        } else {
          const info = await videoInfo(url);
          st().set({ mediaDialog: { name, url, duration: info.duration, size: { w: info.w, h: info.h }, at: pos ?? null } });
        }
        offset += g * 4;
      }
    },

    /** Inserts a video after the trim dialog. */
    insertVideo(opts: { name: string; size: { w: number; h: number }; start: number; end: number | null; autoplay: boolean; muted: boolean; loop: boolean; controls: boolean; at: Pt | null }) {
      const l = api.layout();
      const size = fitSize(opts.size, 360, l?.grid ?? 4);
      const props = [
        `x={0} y={0} w={${size.w}} h={${size.h}} src="${opts.name}"`,
        opts.start > 0 ? `start={${Math.round(opts.start * 10) / 10}}` : "",
        opts.end !== null ? `end={${Math.round(opts.end * 10) / 10}}` : "",
        opts.autoplay ? "" : "autoplay={false}",
        opts.muted ? "" : "muted={false}",
        opts.loop ? "" : "loop={false}",
        opts.controls ? "controls" : "",
      ]
        .filter(Boolean)
        .join(" ");
      st().set({ mediaDialog: null });
      actions.insertSnippet(`<Video ${props} />`, opts.at ?? undefined);
    },

    /** File → Import: media files or diagram JSX snippets. */
    async importFiles() {
      const files = await pickFiles("image/*,video/*,audio/*,.jsx");
      const jsx = files.filter((f) => f.name.endsWith(".jsx"));
      for (const f of jsx) {
        const t = await f.text();
        try {
          const doc = parseDiagram(t);
          actions.paste(serializeNodes(doc.root.children));
        } catch {
          actions.paste(t);
        }
      }
      await actions.insertMedia(files.filter((f) => !f.name.endsWith(".jsx")));
    },

    setProp(uid: string, patch: Record<string, unknown>) {
      const s = st();
      s.commit(setProps(s.doc, uid, patch as never));
    },
  };
  return actions;
}

let pasteCount = 0;
let lastPaste = "";

export type Actions = ReturnType<typeof createActions>;
