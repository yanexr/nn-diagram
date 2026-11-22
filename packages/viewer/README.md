# @nn-diagram/viewer

Shows [nn-diagram](https://github.com/yanexr/nn-diagram) files in a React app: pan and zoom, notes on hover, walk-through steps, a light/dark toggle and export to SVG, PDF, PNG, JPEG and WebP.

```sh
npm install @nn-diagram/viewer katex
```

```tsx
import { DiagramViewer } from "@nn-diagram/viewer";
import "@nn-diagram/viewer/styles.css";
import "katex/dist/katex.min.css";

<DiagramViewer
  source={text}                        // the file's text
  baseUrl="/diagrams/flow.diagram.jsx" // images in the diagram load relative to this
  theme="dark"                         // or "light"
  controls={{ pen: false }}            // hide single built-in controls, or controls={false}
/>;
```

Pass a `ref` to fit, zoom or export from your own buttons, and `step` / `onStepChange` to control the walk-through yourself.

## Styling

The viewer comes with a neutral look in light and dark mode (dark when an ancestor such as `<html>` has the `dark` class). To match your site, set a few CSS variables:

```css
:root {
  --primary: #4f46e5;   /* buttons and highlights */
  --radius: 0.5rem;     /* corner radius */
  --font-sans: "Inter", sans-serif;
}
```

The names are the ones [shadcn/ui](https://ui.shadcn.com/docs/theming) uses (`--background`, `--foreground`, `--border`, `--muted`, …), so a shadcn site matches without any changes. In an app that uses Tailwind v4 you can skip `styles.css` and add `@source "../node_modules/@nn-diagram";` to your CSS instead.

[Docs](https://yanexr.github.io/nn-diagram/) · Apache-2.0
