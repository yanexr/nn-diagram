# @nn-diagram/format

Reads, checks and writes [nn-diagram](https://github.com/yanexr/nn-diagram) files (`*.diagram.jsx`). No React needed: diagram files are parsed, never run as code.

```sh
npm install @nn-diagram/format
```

```ts
import { checkSource, parseDiagram, serializeDiagram, formatReference } from "@nn-diagram/format";

const { issues } = checkSource(text);      // errors and warnings with line numbers
const file = parseDiagram(text);           // the diagram as a tree
const tidy = serializeDiagram(file);       // back to text, in the standard form
const docs = formatReference();            // every element and prop, as Markdown
```

[Docs](https://yanexr.github.io/nn-diagram/) · [Format reference](https://yanexr.github.io/nn-diagram/reference.md) · Apache-2.0
