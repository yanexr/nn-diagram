/**
 * `nn-diagram render`: renders diagram files to SVG, PNG, JPEG, WebP or PDF
 * in a headless Chrome/Edge. The page is served from a private origin that
 * maps to the local file system, so relative media paths resolve like they do
 * next to the diagram on a website.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import type { PageRenderOptions, PageRenderResult } from "./render-page";

export type RenderFormat = "svg" | "png" | "jpeg" | "webp" | "pdf";
export const RENDER_FORMATS: RenderFormat[] = ["svg", "png", "jpeg", "webp", "pdf"];

export interface RenderOptions {
  format: RenderFormat;
  theme: "light" | "dark";
  /** Pixel ratio of raster formats. */
  scale: number;
  transparent: boolean;
}

const ORIGIN = "http://nn-diagram.localhost";

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** The bundled render page: next to this file when installed, in dist/ when run from source. */
function renderPageScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "render-page.iife.js"), join(here, "..", "dist", "render-page.iife.js")]) if (existsSync(p)) return p;
  throw new Error("render-page.iife.js is missing. Build the CLI first: pnpm --filter nn-diagram build");
}

const katexDir = () => dirname(createRequire(import.meta.url).resolve("katex/dist/katex.min.css"));

/** URL path of a local folder (`/fs/C:/Users/…/`), so `../x.png` keeps working. */
const fsUrl = (dir: string) => `${ORIGIN}/fs/${resolve(dir).split(sep).join("/").replace(/^\/+/, "")}/`;

function localPath(url: URL): string | null {
  if (!url.pathname.startsWith("/fs/")) return null;
  const p = decodeURIComponent(url.pathname.slice(4));
  // Windows paths start with a drive letter, POSIX paths with "/".
  return /^[A-Za-z]:\//.test(p) ? p : `/${p}`;
}

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const executablePath = process.env.NN_DIAGRAM_BROWSER;
  if (executablePath) return chromium.launch({ executablePath });
  const errors: string[] = [];
  for (const channel of ["chrome", "msedge", "chromium"]) {
    try {
      return await chromium.launch({ channel });
    } catch (err) {
      errors.push(`${channel}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  try {
    return await chromium.launch();
  } catch {
    throw new Error(
      "render needs Chrome, Edge or Chromium. Install one of them, run `npx playwright install chromium`, " +
        "or point NN_DIAGRAM_BROWSER at a Chromium-based browser.\n  " +
        errors.join("\n  "),
    );
  }
}

async function preparePage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  const script = renderPageScript();
  const katex = katexDir();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    let file: string | null = null;
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/katex/katex.min.css"></head><body><script src="/render-page.js"></script></body></html>`,
      });
    }
    if (url.pathname === "/render-page.js") file = script;
    else if (url.pathname.startsWith("/katex/")) file = join(katex, decodeURIComponent(url.pathname.slice(7)));
    else file = localPath(url);
    if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ body: readFileSync(file), contentType: MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => "nnDiagram" in window);
  return page;
}

/** Renders diagram files in one browser session; `onDone` gets each written path. */
export async function renderFiles(jobs: { input: string; output: string }[], options: RenderOptions, onDone?: (output: string) => void): Promise<void> {
  const browser = await launch();
  try {
    const page = await preparePage(browser);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    for (const job of jobs) {
      const source = readFileSync(job.input, "utf8");
      const pageOptions: PageRenderOptions = {
        format: options.format === "pdf" ? "svg" : options.format,
        theme: options.theme,
        scale: options.scale,
        transparent: options.transparent && options.format !== "jpeg" && options.format !== "pdf",
        baseUrl: fsUrl(dirname(job.input)),
      };
      const result = await page.evaluate(
        ([src, opts]) => (window as unknown as { nnDiagram: { render: (s: string, o: PageRenderOptions) => Promise<PageRenderResult> } }).nnDiagram.render(src, opts),
        [source, pageOptions] as const,
      );
      mkdirSync(dirname(job.output), { recursive: true });
      if (options.format === "svg") writeFileSync(job.output, result.data);
      else if (options.format === "pdf") writeFileSync(job.output, await svgToPdf(browser, result));
      else writeFileSync(job.output, Buffer.from(result.data, "base64"));
      onDone?.(job.output);
    }
  } finally {
    await browser.close();
  }
}

/** Vector PDF with selectable text: the SVG printed at its own size. */
async function svgToPdf(browser: Browser, svg: PageRenderResult): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<!doctype html><html><head><style>@page{size:${svg.width}px ${svg.height}px;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg.data}</body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ width: `${svg.width}px`, height: `${svg.height}px`, printBackground: true, pageRanges: "1" });
  } finally {
    await page.close();
  }
}
