# nn-diagram

Command line tool for [nn-diagram](https://github.com/yanexr/nn-diagram) files (`*.diagram.jsx`).

```sh
npx nn-diagram check diagrams/                     # find mistakes (exit code 1 on errors)
npx nn-diagram fmt diagrams/                       # tidy the files
npx nn-diagram render flow.diagram.jsx             # PNG next to the file
npx nn-diagram render flow.diagram.jsx -f pdf -t dark -o out/
npx nn-diagram reference                           # the full format reference
npx nn-diagram skill                               # add the agent skill to .agents/skills/
```

`render` supports svg, png, jpeg, webp and pdf and needs Chrome, Edge or Chromium installed (or the path to one in `NN_DIAGRAM_BROWSER`).

The agent skill is also available with `npx skills add yanexr/nn-diagram`.

[Docs](https://yanexr.github.io/nn-diagram/) · Apache-2.0
