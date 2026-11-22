import { createContext, useContext } from "react";
import type { ElementNode } from "@nn-diagram/format";
import type { ReactNode } from "react";

export type DiagramTheme = "light" | "dark";

export interface RenderContextValue {
  theme: DiagramTheme;
  /** Base URL for relative image paths (the diagram file's URL). */
  baseUrl?: string;
  /** Reports the rendered size of auto-sized elements (Text without w/h). */
  onMeasure?: (uid: string, size: { w: number; h: number }) => void;
  /** uids that are dimmed (explainer steps). */
  dimmed?: ReadonlySet<string> | null;
  /** Lets the editor replace a label while it is being edited. */
  renderLabel?: (node: ElementNode, defaultLabel: ReactNode) => ReactNode;
  /** Maps media `src` values to URLs (e.g. blob URLs for local files). Return undefined to fall back to `baseUrl`. */
  resolveAsset?: (src: string) => string | undefined;
  /** False in the editor: media controls do not capture the pointer. */
  interactive?: boolean;
  /** Media placeholders make small previews cheap: no media URLs are loaded or decoded. */
  media?: "full" | "placeholder";
}

export const RenderContext = createContext<RenderContextValue>({ theme: "light" });

export const useRenderContext = () => useContext(RenderContext);
