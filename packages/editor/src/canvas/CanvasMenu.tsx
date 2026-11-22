/** Right-click menu of the canvas (selection actions, or page actions on empty canvas). */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Grid3x3,
  Group,
  Pencil,
  RotateCw,
  Scan,
  Scissors,
  SquareDashedMousePointer,
  Trash2,
  Ungroup,
  BookmarkPlus,
} from "lucide-react";
import type { ReactNode } from "react";
import { findNode, getSpec } from "@nn-diagram/format";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@nn-diagram/ui/context-menu";
import { useEd, useEditorContext } from "../context";

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function CanvasMenu({ children, pasteAt }: { children: ReactNode; pasteAt: () => { x: number; y: number } | undefined }) {
  const { actions } = useEditorContext();
  const selection = useEd((s) => s.selection);
  const doc = useEd((s) => s.doc);
  const showGrid = useEd((s) => s.showGrid);
  const has = selection.length > 0;
  const single = selection.length === 1 ? findNode(doc, selection[0])?.node : null;
  const labelable = !!single && !!getSpec(single.name)?.label;
  const isGroup = single?.name === "Group";

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {has ? (
          <>
            <ContextMenuItem onClick={() => actions.cut()}>
              <Scissors /> Cut <ContextMenuShortcut>{mod}X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.copy()}>
              <Copy /> Copy as JSX <ContextMenuShortcut>{mod}C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.pasteFromClipboard(pasteAt())}>
              <ClipboardPaste /> Paste <ContextMenuShortcut>{mod}V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.duplicate()}>
              <CopyPlus /> Duplicate <ContextMenuShortcut>{mod}D</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={() => actions.deleteSelection()}>
              <Trash2 /> Delete <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            {labelable && (
              <ContextMenuItem onClick={() => actions.editText()}>
                <Pencil /> Edit label <ContextMenuShortcut>Enter</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => actions.addToScratchpad()}>
              <BookmarkPlus /> Add to scratchpad
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.reorder("front")}>
              <ArrowUpToLine /> Bring to front <ContextMenuShortcut>{mod}⇧F</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.reorder("forward")}>
              <ArrowUp /> Bring forward <ContextMenuShortcut>{mod}]</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.reorder("backward")}>
              <ArrowDown /> Send backward <ContextMenuShortcut>{mod}[</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.reorder("back")}>
              <ArrowDownToLine /> Send to back <ContextMenuShortcut>{mod}⇧B</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.group()}>
              <Group /> Group selection <ContextMenuShortcut>{mod}G</ContextMenuShortcut>
            </ContextMenuItem>
            {isGroup && (
              <ContextMenuItem onClick={() => actions.ungroup()}>
                <Ungroup /> Ungroup <ContextMenuShortcut>{mod}⇧U</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {selection.length > 1 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <AlignStartVertical /> Align
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem onClick={() => actions.align("left")}>
                    <AlignStartVertical /> Left
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => actions.align("center")}>
                    <AlignCenterVertical /> Center
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => actions.align("right")}>
                    <AlignEndVertical /> Right
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => actions.align("top")}>
                    <AlignStartHorizontal /> Top
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => actions.align("middle")}>
                    <AlignCenterHorizontal /> Middle
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => actions.align("bottom")}>
                    <AlignEndHorizontal /> Bottom
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            <ContextMenuItem onClick={() => actions.rotate90()}>
              <RotateCw /> Rotate 90° <ContextMenuShortcut>{mod}R</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={() => actions.pasteFromClipboard(pasteAt())}>
              <ClipboardPaste /> Paste here <ContextMenuShortcut>{mod}V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.selectAll()}>
              <SquareDashedMousePointer /> Select all <ContextMenuShortcut>{mod}A</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.fitPage()}>
              <Scan /> Fit page <ContextMenuShortcut>⇧1</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.toggleGrid()}>
              <Grid3x3 /> {showGrid ? "Hide grid" : "Show grid"} <ContextMenuShortcut>{mod}'</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.openExport()}>
              <Download /> Export… <ContextMenuShortcut>{mod}⇧E</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
