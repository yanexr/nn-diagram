# @nn-diagram/editor

The visual editor for [nn-diagram](https://github.com/yanexr/nn-diagram) files as a React component. [Try it here](https://yanexr.github.io/nn-diagram/editor/).

```sh
npm install @nn-diagram/editor katex
```

```tsx
import { DiagramEditor, DEFAULT_LIBRARY } from "@nn-diagram/editor";
import "@nn-diagram/editor/styles.css";
import "katex/dist/katex.min.css";

<DiagramEditor
  libraries={[...DEFAULT_LIBRARY, mySection]} // shapes in the sidebar; add your own sections
  defaultSource={text}                        // optional starting diagram
  onChange={(source) => preview(source)}      // optional
  onSave={(source) => store(source)}          // optional: store files yourself
/>;
```

Without `onSave`, the editor saves to the user's disk. In Chrome and Edge it writes the file back in place, keeps images next to it, and reloads the file when another program changes it. Other browsers download the file instead.

`@nn-diagram/editor/loader` exports a small loading animation for while the editor loads. For styling, see [`@nn-diagram/viewer`](https://www.npmjs.com/package/@nn-diagram/viewer#styling).

[Docs](https://yanexr.github.io/nn-diagram/) · Apache-2.0
