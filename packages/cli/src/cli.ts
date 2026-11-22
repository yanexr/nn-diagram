/**
 * nn-diagram command line tool.
 *
 *   nn-diagram check <file-or-folder>…        validate diagrams
 *   nn-diagram fmt <file-or-folder>… [--check] rewrite files in the standard form
 *   nn-diagram render <file>… [options]        SVG, PNG, JPEG, WebP or PDF
 *   nn-diagram reference                       print the format reference
 *   nn-diagram skill [dir]                     install the agent skill
 */
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkSource, formatReference, serializeDiagram } from "@nn-diagram/format";
import { RENDER_FORMATS, renderFiles, type RenderFormat } from "./render";

const HELP = `nn-diagram: tools for *.diagram.jsx files

Usage:
  nn-diagram check <file-or-folder>...      Validate diagrams (exit code 1 on errors)
  nn-diagram fmt <file-or-folder>...        Rewrite files in the standard form
      --check                               Only report files that are not formatted
  nn-diagram render <file-or-folder>...     Render diagrams (default: PNG next to each file)
      -f, --format <svg|png|jpeg|webp|pdf>  Output format (default: png, or from --out)
      -o, --out <file-or-folder>            Output file (one input) or folder
      -t, --theme <light|dark>              Diagram theme (default: light)
      -s, --scale <n>                       Pixel ratio of PNG/JPEG/WebP (default: 2)
      --transparent                         No page background (SVG, PNG, WebP)
  nn-diagram reference                      Print the format reference (Markdown)
  nn-diagram skill [dir]                    Copy the agent skill to dir
                                            (default: .agents/skills/nn-diagram;
                                            Claude Code: .claude/skills/nn-diagram)

render uses an installed Chrome, Edge or Chromium (or NN_DIAGRAM_BROWSER).`;

// pnpm scripts run in the package folder; INIT_CWD is where the user ran them.
const cwd = process.env.INIT_CWD ?? process.cwd();

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

function collect(path: string, out: string[]): void {
  if (!existsSync(path)) fail(`Not found: ${relative(cwd, path) || path}`);
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      collect(join(path, entry), out);
    }
  } else if (path.endsWith(".diagram.jsx")) {
    out.push(path);
  }
}

function diagramFiles(args: string[]): string[] {
  if (!args.length) fail("No files given. Pass diagram files or folders.");
  const files: string[] = [];
  for (const arg of args) {
    const path = resolve(cwd, arg);
    // A single file is taken as is, even without the .diagram.jsx extension.
    if (existsSync(path) && statSync(path).isFile()) files.push(path);
    else collect(path, files);
  }
  return files;
}

const display = (p: string) => relative(cwd, p) || p;

function check(args: string[]): number {
  const files = diagramFiles(args);
  let errors = 0;
  let warnings = 0;
  for (const file of files) {
    const { issues } = checkSource(readFileSync(file, "utf8"));
    if (issues.length === 0) {
      console.log(`✓ ${display(file)}`);
      continue;
    }
    console.log(`${issues.some((i) => i.severity === "error") ? "✗" : "!"} ${display(file)}`);
    for (const issue of issues) {
      const pos = issue.line ? `:${issue.line}:${issue.column}` : "";
      const where = issue.where ? ` ${issue.where}` : "";
      console.log(`  ${issue.severity}${pos}${where}: ${issue.message}`);
      if (issue.severity === "error") errors++;
      else warnings++;
    }
  }
  console.log(`\n${files.length} file(s), ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

function fmt(args: string[]): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { check: { type: "boolean" } } });
  let changed = 0;
  let failed = 0;
  for (const file of diagramFiles(positionals)) {
    const text = readFileSync(file, "utf8");
    const { file: parsed, issues } = checkSource(text);
    if (!parsed) {
      failed++;
      console.log(`✗ ${display(file)}: ${issues[0]?.message ?? "cannot be parsed"}`);
      continue;
    }
    const out = serializeDiagram(parsed);
    if (out === text) continue;
    changed++;
    if (values.check) console.log(`! ${display(file)} is not formatted`);
    else {
      writeFileSync(file, out);
      console.log(`✓ formatted ${display(file)}`);
    }
  }
  if (!changed && !failed) console.log("All files are formatted.");
  return failed || (values.check && changed) ? 1 : 0;
}

async function render(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      format: { type: "string", short: "f" },
      out: { type: "string", short: "o" },
      theme: { type: "string", short: "t", default: "light" },
      scale: { type: "string", short: "s", default: "2" },
      transparent: { type: "boolean" },
    },
  });
  const inputs = diagramFiles(positionals);
  const outArg = values.out ? resolve(cwd, values.out) : null;
  const outIsFile = !!outArg && inputs.length === 1 && /\.(svg|png|jpe?g|webp|pdf)$/i.test(outArg);
  let format = values.format?.toLowerCase().replace("jpg", "jpeg") as RenderFormat | undefined;
  if (!format && outIsFile) format = outArg!.split(".").pop()!.toLowerCase().replace("jpg", "jpeg") as RenderFormat;
  format ??= "png";
  if (!RENDER_FORMATS.includes(format)) fail(`Unknown format "${values.format}". Use one of: ${RENDER_FORMATS.join(", ")}`);
  const theme = values.theme === "dark" ? "dark" : values.theme === "light" ? "light" : fail(`Unknown theme "${values.theme}". Use light or dark.`);
  const scale = Number(values.scale);
  if (!(scale > 0 && scale <= 8)) fail("--scale must be a number between 0 and 8");
  const ext = format === "jpeg" ? "jpg" : format;
  const stem = (input: string) => basename(input).replace(/\.diagram\.jsx$|\.jsx$/, "");
  const jobs = inputs.map((input) => {
    // In a shared output folder, files with the same name get their folder's name as a prefix.
    const clash = !!outArg && inputs.some((other) => other !== input && stem(other) === stem(input));
    const name = `${clash ? `${basename(dirname(input))}-` : ""}${stem(input)}.${ext}`;
    const output = outIsFile ? outArg! : join(outArg ?? dirname(input), name);
    return { input, output };
  });
  // Diagrams with errors are skipped: the output would not show the file.
  const valid = jobs.filter((job) => {
    const { issues } = checkSource(readFileSync(job.input, "utf8"));
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length) console.log(`✗ ${display(job.input)}: ${errors[0].message} (run nn-diagram check)`);
    return errors.length === 0;
  });
  if (valid.length) {
    await renderFiles(valid, { format, theme, scale, transparent: !!values.transparent }, (out) => console.log(`✓ ${display(out)}`));
  }
  return valid.length === jobs.length ? 0 : 1;
}

function skill(args: string[]): number {
  const target = resolve(cwd, args[0] ?? join(".agents", "skills", "nn-diagram"));
  const here = dirname(fileURLToPath(import.meta.url));
  // Installed package: <pkg>/skill (copied at build time). From source: <repo>/skills/nn-diagram.
  const source = [join(here, "..", "skill"), join(here, "..", "..", "..", "skills", "nn-diagram")].find((p) => existsSync(join(p, "SKILL.md")));
  if (!source) fail("The skill files are missing from this installation.");
  cpSync(source, target, { recursive: true });
  console.log(`✓ Installed the nn-diagram skill to ${display(target)}`);
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "check":
      return check(args);
    case "fmt":
    case "format":
      return fmt(args);
    case "render":
      return render(args);
    case "reference":
      process.stdout.write(formatReference());
      return 0;
    case "skill":
      return skill(args);
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return 0;
    case "-v":
    case "--version": {
      const pkg = [join(dirname(fileURLToPath(import.meta.url)), "..", "package.json")].find(existsSync);
      console.log(pkg ? JSON.parse(readFileSync(pkg, "utf8")).version : "unknown");
      return 0;
    }
    default:
      return fail(`Unknown command "${command}".\n\n${HELP}`);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => fail(`Error: ${(err as Error).message}`, 1),
);
