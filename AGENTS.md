# nn-diagram

A diagram format (`*.diagram.jsx`: JSX + Tailwind, parsed, never executed) with a React viewer, a visual editor and a CLI. It is general purpose; the format should stay easy for LLMs to read and write. The main workflow: an agent edits the file on disk, the editor (open in the browser) reloads it. Exports (SVG/PDF/PNG…) are for publishing, not re-editing.

## Layout

```
packages/format   @nn-diagram/format  parser, serializer, schema (single source of truth), validator, reference
packages/viewer   @nn-diagram/viewer  renderer, viewer, routing, geometry, export, in-browser Tailwind
packages/editor   @nn-diagram/editor  editor: Editor.tsx, store.ts, actions.ts, canvas/, panels/, library.ts, file.ts
packages/ui       internal shadcn/ui components, bundled into viewer and editor (never published)
packages/cli      nn-diagram CLI (check, fmt, render, reference, skill)
skills/nn-diagram the agent skill (published via npm, `npx skills add` and .claude-plugin/)
docs/             GitHub Pages site: index.html, editor/ playground (Vite)
```

## Commands

```sh
pnpm install
pnpm build                # build all packages (needed for `render`, styles.css and docs)
pnpm docs                 # docs + editor playground on localhost, using package sources
pnpm test && pnpm typecheck
pnpm diagram check|fmt|render <path>   # CLI from source
```

## Rules

- No auto-layout: explicit coordinates on a 4px grid, children relative to their parent.
- Format changes start in `packages/format/src/schema.ts`; keep `skills/nn-diagram/SKILL.md` in sync.
- Variants are neutral styles and color names; no domain-specific names in the format. Must work in light and dark mode.
- UI uses real shadcn/ui components (Base UI) in `packages/ui`. Hosts restyle via shadcn CSS variables.
- Keep the public APIs small (viewer: `controls`, `step`/`onStepChange`, ref; editor: `libraries`, `defaultSource`, `onChange`, `onSave`).
- Media are separate files next to the diagram, referenced by relative path, never base64 by default.
- `viewer/src/routing.ts` and `editor/src/canvas/edges.ts` are ports of draw.io code (Apache-2.0): keep their headers and `NOTICE`.

## Releasing

Bump versions in `packages/*/package.json`, then `pnpm release` (build, test, `pnpm -r publish`). `scripts/prepack.mjs` copies LICENSE, NOTICE and the skill into the packages.
