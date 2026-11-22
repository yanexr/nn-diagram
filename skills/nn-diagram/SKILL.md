---
name: nn-diagram
description: Write, edit and check diagrams in the nn-diagram format (*.diagram.jsx, JSX + Tailwind), and render them to SVG/PNG/PDF. Use when asked to draw, redraw, convert (e.g. from a figure, screenshot or sketch) or modify a *.diagram.jsx diagram: flowcharts, system and architecture diagrams, neural-network figures.
license: Apache-2.0
compatibility: Uses the nn-diagram CLI through npx (needs Node.js); rendering needs Chrome, Edge or Chromium.
---

# nn-diagram files (`*.diagram.jsx`)

A diagram file is **one JSX element**, parsed (never executed). It reads like React + Tailwind, but:

- Attribute values are literals only: `"string"`, `{12}`, `{true}`, `{[1, 2]}`, `{{ a: 1 }}`, or a raw template literal `` {`…`} ``. No variables, no `${}`, no imports.
- Template literals are **raw** (like `String.raw`): write LaTeX as is, e.g. ``tip={`$\frac{a}{b}$`}``.
- In JSX text, `{` `}` `<` `>` are not allowed. Use `<Math tex="…" />` for formulas with braces, `$…$` only for simple ones (`$x_t$`, `$\theta$`).
- Comments: `{/* … */}` inside elements, `//` before the root.

## Tools

```bash
npx nn-diagram check <file-or-folder>    # after every edit: errors = broken file, warnings = off-grid or unknown names
npx nn-diagram render <file>             # PNG next to the file; look at it to check the layout
npx nn-diagram render <file> -f svg -t dark -o out/   # svg | png | jpeg | webp | pdf, light | dark
npx nn-diagram fmt <file>                # rewrite in the standard form (what the editor writes)
npx nn-diagram reference                 # every element, prop, default and allowed value
```

After drawing or changing a layout, **render it and look at the image**: overlapping boxes, labels that do not fit and arrows that cross are easy to see there and hard to see in the code. If the file is open in the nn-diagram editor, the editor reloads it when it changes on disk.

## Coordinates and hierarchy

- `<Diagram width height grid={4}>` is the page. All geometry is in px. Optional: `background` (`"#fafaf9"`, `"transparent"`; omit for the theme's page color), `title` (title of exported SVG/PDF files), `className` (page-wide font or text size, e.g. `font-serif`), `autoSize` (the editor keeps the page fitted around the content with `padding`, default 24).
- Every shape has `x y w h` (and optional `rotate` in whole degrees). Use **multiples of the grid** (4).
- Children are positioned **relative to their parent shape's top-left** (like CSS `position: absolute`). Put shapes inside the container they belong to, so moving the container moves them.
- Later elements draw on top. Badges that sit on a line (`<Op>`) go after the arrow.

## Elements

| Element | Purpose | Key props |
|---|---|---|
| `Box` | Shape with a centered label; can contain shapes | `shape`, `narrow` (trapezoid short side), `inset` (slant / arrow head / corner, a fraction) |
| `Group` | Invisible container (a click selects the whole group) | — |
| `Text` | Text without a box: one line, left-aligned, vertically centered; `w`/`h` optional (auto size). To center it, give `w` and `className="justify-center"` | `variant`: title (28 px, bold), heading (15 px), caption (10 px mono caps), label (12 px, gray), math (15 px italic serif) |
| `Image` | Image | `src` (URL or path relative to the diagram file), `fit`, `grid={[cols, rows]}` patch lines |
| `Video` | Video clip | `src`, `start`/`end` (seconds), `autoplay` `muted` `loop` (default true), `controls`, `poster`, `fit` |
| `Audio` | Audio player card; children = title | `src`, `loop` |
| `Ink` | Freehand stroke (the editor's pencil) | `points="x y x y …"`, `color`, `size` |
| `Arrow` | Connector; children = label | `from`, `to`, `via`, `route`, `head`, `tail`, `dashed`, `rounded`, `labelAt` |
| `Op` | Circle operator or badge | `symbol`: `"+"` ⊕, `"x"` ⊗, `"concat"` ⊙, `"sigma"` σ, or short text like `"1"` or `"c"` |
| `Cuboid` | 2.5D block; `w`/`h` include the depth | `depth`, `side` (`left`: depth recedes to the upper left) |
| `Icon` | Line icon from [Lucide](https://lucide.dev/icons) (cpu, gpu, database, brain, flame, snowflake, bot, file-text …) | `name` (kebab-case), `strokeWidth`; a color `variant` tints it |
| `Table` | Grid of cells: tables, matrices, embedding rows, heatmaps; children `<Row>` → `<Cell>` | `cols`/`rows` (px sizes, default equal), `header`, `lines` (all, rows, none); `Cell`: `variant`, `className`, `span` |
| `Brace` | Curly brace | `side` (direction of the tip) |
| `Tokens` | Compact row of token squares (not editable square by square) | `segments={["text:4", "...", "image:5"]}`, `vertical` |
| `Neurons` | Compact dense network (not editable neuron by neuron) | `layers={[3, 5, 2]}`, `connect="none"` |
| `Math` | Inline KaTeX inside any label | `tex`, `display` |

Box shapes: `rect` (default; `className="rounded-xl"` or `rounded-full` for rounded/pill), `ellipse`, `diamond`, `triangle`, `hexagon`, `octagon`, `parallelogram`, `trapezoid`, `cylinder`, `document`, `note`, `callout` (speech bubble), `arrow` (block arrow), `chevron`, `star`, `cross`, `cloud`, `person` (label below). `arrow` and `chevron` point right; use `rotate` for other directions.

`Tokens` and `Neurons` are shorthands. When the user should be able to edit single tokens or neurons in the editor, draw them as boxes and circles (the editor's library inserts them that way).

Tables keep each row on one line:

```jsx
<Table x={0} y={0} w={240} h={84} cols={[80, 80, 80]} header>
  <Row><Cell>Model</Cell><Cell>Params</Cell><Cell>Layers</Cell></Row>
  <Row><Cell>GPT-2</Cell><Cell>1.5B</Cell><Cell variant="blue">48</Cell></Row>
  <Row><Cell span={2}>Total</Cell><Cell>…</Cell></Row>
</Table>
```
`cols`/`rows` must add up to `w`/`h`. A table `variant` colors the whole table, the header row is a stronger tint of it (or give `<Row variant>`); inner lines use the table's border color, width and style (`border-red-500 border-2 border-dashed`). Cells center their label; `className="justify-start text-left"` aligns left. Heatmaps: `lines="none"` and cells with `className="bg-orange-500/40"` (opacity reads on light and dark pages). Arrows attach to the table's outline (`"t@top:24px"`).

Labels may contain `<b> <i> <u> <s> <sub> <sup> <br /> <span className> <small> <code> <mark>` and `<Math>`. Box labels wrap; Text labels need `<br />` for a second line.

Common props on shapes: `id` (needed for arrows and steps), `variant`, `className`, `tip` (Markdown + LaTeX shown on hover), `link` (URL, page path, or `#other.diagram.jsx`).

## Arrows

```jsx
<Arrow from="a" to="b" />                              // floating ends (the outline facing the other end)
<Arrow from="a@top:34px" to="b" />                     // 34 px from the left end of a's top edge
<Arrow from="a@right" to="b@left" />                   // named: top bottom left right center top-left …
<Arrow from="a@bottom:0.25" to="b@0.5,0" />            // fraction along a side / unit coordinates
<Arrow from={[160, 380]} to="c@left" via={[[24, 380], [24, 244]]} />  // free point + waypoints
<Arrow from="d" to="main@0.4" />                       // ends on the arrow with id="main", 40 % along it
```

- Routing is orthogonal by default; `route="straight"` or `"curved"`. A curved arrow's `via` points are quadratic control points: the curve starts at `from`, passes through the midpoints between consecutive `via` points and ends at `to` (it bends toward the points, it does not pass through them).
- Free points and `via` are relative to the **arrow's parent**. Arrows between children of a container belong inside that container.
- **Attach ends to shapes and arrows, not to coordinates.** A free point `[x, y]` that happens to sit on an outline is not connected: it stays put when the shape moves, and on rounded shapes (panels) it misses the visible corner. Use anchors (`"panel@top-left"` lands on the rounded corner) and, for branches off a line, `"arrowId@0.4"`. Free points are for open ends (an input arrow coming from nowhere, an output leaving the figure).
- Floating ends connect centers. Centers up to 16 px apart get a straight line; larger offsets get a jog. For exact lines, align centers or use fixed anchors (`@top:72px`).
- `head`/`tail`: arrow (default head), open, classic, diamond, circle, bar, none. `tail="arrow"` for bidirectional.
- Arrows can start or end on another arrow (`"id@0.5"`: 0 = its start, 1 = its end); they meet it at a right angle. Use this for branches instead of overlapping arrows.

## Styling: variants first, Tailwind for everything else

`variant` gives the theme style. It works in light and dark mode, so prefer it over raw colors.

- Neutral: `default` (white box, gray outline), `muted` (light gray, secondary elements), `outline` (no fill), `ghost` (no fill, no outline), `panel` (large light container).
- Colors: any Tailwind hue (`blue`, `orange`, `green`, `violet`, `rose`, …) for a soft colored box; `panel-<hue>` for a large light container (label top-left, bold, rounded).
- Arrows: `muted` or a hue; add `dashed` for dashed lines.

Use colors consistently within a diagram (and across related diagrams): one color per kind of element, with a legend when the meaning is not obvious.

`className` takes **any Tailwind class** and overrides the variant: `font-semibold`, `text-[12px]`, `bg-red-100 border-red-400`, `rounded-lg`, `border-dashed`, `items-start justify-start px-3` (label top-left), `dark:bg-zinc-800`, fonts `font-serif`, `font-mono`, `font-math` (STIX Two) and the web fonts `font-inter`, `font-geist`, `font-plex-sans`, `font-space-grotesk`, `font-source-serif`, `font-plex-serif`, `font-jetbrains-mono`, `font-plex-mono`, `font-caveat` (handwritten), loaded on demand. Arrow color: `text-<color>`, width: `stroke-2`, custom dash: `[--nnd-dash:2_2]`. Raw colors (`bg-[#fbe9c9]`) do not adapt to dark mode, so use them only to match a figure exactly.

Defaults: boxes are white with a 1 px gray border, 3 px radius, 13 px text. Keep boxes 24–32 px tall for one line, gaps of 8–28 px, and widths that fit the label (about 7 px per character at 13 px).

## Media files

Images, videos and audio are separate files **next to the diagram**, referenced by relative path (`src="sample.mp4"`, `src="media/fig.png"`). Do not embed base64 data. To use an image from an app's media library, copy the file next to the diagram first.

## Walk-through steps (optional)

```jsx
<Steps>
  <Step title="Read the input" focus="input parser">{`Markdown with $LaTeX$.`}</Step>
</Steps>
```
`focus` lists ids. Everything else is dimmed; focusing a container keeps its children. The text appears in a small card over the diagram: keep each step to a few short paragraphs.

## Example

```jsx
<Diagram width={400} height={264} grid={4} title="Request flow">
  <Box id="api" x={40} y={24} w={320} h={200} variant="panel-blue">
    API service
    <Box id="auth" x={56} y={160} w={208} h={28} variant="muted">Auth middleware</Box>
    <Box id="handler" x={56} y={108} w={208} h={32} variant="blue" tip="Validates the request and calls the store.">Handler</Box>
    <Op id="sum" x={152} y={64} w={16} h={16} />
    <Arrow from="auth" to="handler" />
    <Arrow from="handler" to="sum" />
    <Arrow from="in@0.8" to="sum@left" via={[[24, 196]]} variant="muted" dashed />
  </Box>
  <Arrow id="in" from={[200, 252]} to="auth" />
  <Arrow from="sum" to={[200, 8]} />
</Diagram>
```

## Redrawing a figure from an image

1. Pick the page size from the figure. Snap every coordinate to multiples of 4.
2. Identify containers first (panels, outlines), then their children in relative coordinates.
3. Map colors to variants; match the figure exactly with `className` only where it matters.
4. Give every connected element an `id`; draw arrows last, using anchors so lines are straight.
5. Add `tip`s with short, factual explanations, and optionally `<Steps>`.
6. Run `nn-diagram check`, then `nn-diagram render` and compare the image with the figure.
