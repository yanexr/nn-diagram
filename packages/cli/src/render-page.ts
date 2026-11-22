/**
 * Runs inside the headless browser that `nn-diagram render` starts. It uses
 * the viewer's own export code, so the CLI renders exactly what the viewer
 * and the editor export.
 */
import { parseDiagram } from "@nn-diagram/format";
import { renderDiagram, type ExportFormat } from "@nn-diagram/viewer";

export interface PageRenderOptions {
  format: Exclude<ExportFormat, "pdf">;
  theme: "light" | "dark";
  scale: number;
  transparent: boolean;
  baseUrl: string;
}

export interface PageRenderResult {
  /** Text for SVG, base64 for raster formats. */
  data: string;
  width: number;
  height: number;
}

async function render(source: string, options: PageRenderOptions): Promise<PageRenderResult> {
  const file = parseDiagram(source);
  const { blob, width, height } = await renderDiagram(file.root, options);
  if (options.format === "svg") return { data: await blob.text(), width, height };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), width, height };
}

(window as unknown as { nnDiagram: { render: typeof render } }).nnDiagram = { render };
