import { describe, expect, it } from "vitest";
import {
  DiagramParseError,
  SHAPES,
  formatReference,
  checkSource,
  endpointAnchor,
  formatAnchorFor,
  formatEndpoint,
  parseDiagram,
  parseEndpoint,
  parseFragment,
  serializeDiagram,
  snapToGrid,
  labelSource,
  parseLabelSource,
  type ElementNode,
} from "../src";

const SAMPLE = `// GPT-2 block
<Diagram width={640} height={480} grid={4} title="Test">
  <Box id="panel" x={40} y={40} w={240} h={200} variant="panel-blue" className="items-start justify-start p-2 font-semibold">
    Transformer block
    <Box id="attn" x={20} y={40} w={200} h={28} variant="orange" tip={\`Masked self-attention: $\\mathrm{softmax}(QK^\\top/\\sqrt{d})V$\`}>Masked MHA</Box>
    <Box id="ln" x={20} y={100} w={200} h={28} variant="norm">LayerNorm</Box>
  </Box>
  <Text x={300} y={40}>Timestep <Math tex="\\frac{t}{T}" /> and v<sub>θ</sub></Text>
  <Arrow from="ln@top" to="attn@bottom" />
  <Arrow from="attn" to={[400, 300]} via={[[120, 300]]} dashed />
  {/* explainer */}
  <Steps>
    <Step title="Attention" focus="attn">{\`Tokens attend to {previous} tokens.\`}</Step>
  </Steps>
</Diagram>
`;

describe("parse", () => {
  it("parses a diagram", () => {
    const { root, header } = parseDiagram(SAMPLE);
    expect(header).toEqual(["// GPT-2 block"]);
    expect(root.name).toBe("Diagram");
    expect(root.props).toMatchObject({ width: 640, height: 480, grid: 4, title: "Test" });
    const panel = root.children[0] as ElementNode;
    expect(panel.children[0]).toEqual({ kind: "text", value: "Transformer block" });
    const attn = panel.children[1] as ElementNode;
    expect(attn.props.tip).toBe("Masked self-attention: $\\mathrm{softmax}(QK^\\top/\\sqrt{d})V$");
  });

  it("keeps backslashes raw in attribute strings", () => {
    const { root } = parseDiagram(`<Diagram><Text x={0} y={0}><Math tex="\\frac{a}{b}" /></Text></Diagram>`);
    const math = (root.children[0] as ElementNode).children[0] as ElementNode;
    expect(math.props.tex).toBe("\\frac{a}{b}");
  });

  it("applies JSX whitespace rules", () => {
    const { root } = parseDiagram(`<Diagram>
      <Box x={0} y={0} w={8} h={8}>
        A red fox
        curled up
      </Box>
    </Diagram>`);
    const box = root.children[0] as ElementNode;
    expect(box.children).toEqual([{ kind: "text", value: "A red fox curled up" }]);
  });

  it("decodes entities", () => {
    const { root } = parseDiagram(`<Diagram><Text x={0} y={0}>a &lt; b &times; c</Text></Diagram>`);
    expect((root.children[0] as ElementNode).children[0]).toEqual({ kind: "text", value: "a < b × c" });
  });

  it("reports helpful errors with position", () => {
    expect(() => parseDiagram(`<Diagram>\n  <Box x={foo} />\n</Diagram>`)).toThrowError(/not a literal.*line 2/);
    expect(() => parseDiagram(`<Diagram><Box></Text></Diagram>`)).toThrowError(DiagramParseError);
    expect(() => parseDiagram(`<Diagram><Text x={0} y={0}>$\\frac{a}{b}$</Text></Diagram>`)).toThrowError(/not allowed in JSX text/);
    expect(() => parseDiagram("<Diagram tip={`${x}`} />")).toThrowError(/substitutions/);
  });

  it("accepts export default and parentheses", () => {
    const { root } = parseDiagram(`export default (\n  <Diagram width={10} />\n);\n`);
    expect(root.props.width).toBe(10);
  });

  it("parses fragments", () => {
    const nodes = parseFragment(`<>\n<Box x={0} y={0} w={4} h={4} />\n<Box x={4} y={0} w={4} h={4} />\n</>`);
    expect(nodes).toHaveLength(2);
  });
});

describe("serialize", () => {
  it("round-trips to a fixed point", () => {
    const once = serializeDiagram(parseDiagram(SAMPLE));
    const twice = serializeDiagram(parseDiagram(once));
    expect(twice).toBe(once);
  });

  it("prints canonical output", () => {
    const out = serializeDiagram(parseDiagram(SAMPLE));
    expect(out).toContain('<Box id="ln" x={20} y={100} w={200} h={28} variant="norm">LayerNorm</Box>');
    expect(out).toContain('<Arrow from="attn" to={[400, 300]} via={[[120, 300]]} dashed />');
    expect(out).toContain('<Math tex="\\frac{t}{T}" />');
    expect(out).toContain("{/* explainer */}");
    expect(out).toContain("Tokens attend to {previous} tokens.");
  });

  it("orders props", () => {
    const out = serializeDiagram(parseDiagram(`<Diagram><Box variant="orange" h={4} id="a" w={4} y={0} x={0} /></Diagram>`));
    expect(out).toContain('<Box id="a" x={0} y={0} w={4} h={4} variant="orange" />');
  });
});

describe("endpoints", () => {
  it("parses and formats anchors", () => {
    expect(parseEndpoint("a")).toEqual({ kind: "node", id: "a", at: null });
    expect(parseEndpoint("a@top")).toEqual({ kind: "node", id: "a", at: [0.5, 0] });
    expect(parseEndpoint("a@left:0.25")).toEqual({ kind: "node", id: "a", at: [0, 0.25] });
    expect(parseEndpoint("a@0.3,0.7")).toEqual({ kind: "node", id: "a", at: [0.3, 0.7] });
    expect(parseEndpoint([3, 4])).toEqual({ kind: "point", x: 3, y: 4 });
    expect(formatEndpoint({ kind: "node", id: "a", at: [0.25, 0] })).toBe("a@top:0.25");
    expect(formatEndpoint({ kind: "node", id: "a", at: [1, 1] })).toBe("a@bottom-right");
  });

  it("supports pixel offsets along a side", () => {
    const ep = parseEndpoint("row@bottom:72px");
    expect(ep).toEqual({ kind: "node", id: "row", at: null, offset: { side: "bottom", px: 72 } });
    expect(endpointAnchor(ep!, { w: 288, h: 24 })).toEqual([0.25, 1]);
    expect(formatEndpoint(ep!)).toBe("row@bottom:72px");
    expect(formatAnchorFor([0.25, 1], { w: 288, h: 24 })).toBe("bottom:72px");
    expect(formatAnchorFor([0.5, 1], { w: 288, h: 24 })).toBe("bottom");
  });

  it("supports positions along another arrow", () => {
    const ep = parseEndpoint("skip@0.4");
    expect(ep).toEqual({ kind: "node", id: "skip", at: null, along: 0.4 });
    expect(formatEndpoint(ep!)).toBe("skip@0.4");
    expect(parseEndpoint("skip@1.5")).toMatchObject({ along: 1 });
  });
});

describe("snapToGrid", () => {
  it("rounds positions and sizes relative to the parent", () => {
    const { root } = parseDiagram(`<Diagram grid={4}>
  <Box id="p" x={10} y={21} w={101} h={2} variant="panel">
    <Box id="c" x={6} y={7} w={30} h={30} />
  </Box>
  <Op x={3} y={3} symbol="+" />
</Diagram>`);
    const snapped = snapToGrid(root, 4);
    const [panel, op] = snapped.children.filter((c): c is ElementNode => c.kind === "element");
    expect(panel.props).toMatchObject({ x: 12, y: 20, w: 100, h: 4 });
    const child = panel.children.find((c): c is ElementNode => c.kind === "element")!;
    expect(child.props).toMatchObject({ x: 8, y: 8, w: 32, h: 32 });
    // Operators are centered on their position and exempt from the grid.
    expect(op.props).toMatchObject({ x: 3, y: 3 });
  });
});

describe("validate", () => {
  it("finds unknown references and off-grid values", () => {
    const { issues } = checkSource(`<Diagram grid={4}>
      <Box id="a" x={1} y={0} w={8} h={8} />
      <Box id="a" x={0} y={0} w={8} h={8} variant="nope" />
      <Arrow from="a" to="b@top" />
    </Diagram>`);
    const messages = issues.map((i) => i.message);
    expect(messages).toContain("x={1} is not on the 4px grid");
    expect(messages).toContain('Duplicate id "a"');
    expect(messages).toContain('Unknown variant "nope"');
    expect(messages).toContain('to references unknown id "b"');
  });

  it("accepts arrows that end on other arrows", () => {
    const { issues } = checkSource(`<Diagram grid={4}>
      <Box id="a" x={0} y={0} w={40} h={40} />
      <Box id="b" x={80} y={0} w={40} h={40} />
      <Arrow id="main" from="a" to="b" />
      <Arrow from={[60, 80]} to="main@0.5" />
    </Diagram>`);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports parse errors as issues", () => {
    const { file, issues } = checkSource("<Diagram>");
    expect(file).toBeNull();
    expect(issues[0].line).toBe(1);
  });
});

describe("label source", () => {
  it("round-trips text, LaTeX with braces, tags and line breaks", () => {
    const src = String.raw`Attention $\frac{QK^\top}{\sqrt{d}}$` + "\n" + String.raw`v<sub>θ</sub> &amp; <Math tex="\frac{t}{T}" /> x &lt; y`;
    const children = parseLabelSource(src);
    expect(children.some((c) => c.kind === "element" && c.name === "br")).toBe(true);
    expect(children.some((c) => c.kind === "element" && c.name === "Math" && c.props.tex === String.raw`\frac{t}{T}`)).toBe(true);
    expect(children.some((c) => c.kind === "text" && c.value.includes(String.raw`\sqrt{d}`))).toBe(true);
    expect(labelSource(children)).toBe(src);
  });

  it("serializes edited labels as valid diagram JSX", () => {
    const children = parseLabelSource(String.raw`Loss $\{x\}$`);
    const { root } = parseDiagram(`<Diagram><Box x={0} y={0} w={8} h={8}>A</Box></Diagram>`);
    const box = root.children.find((c): c is ElementNode => c.kind === "element")!;
    const text = serializeDiagram({ root: { ...root, children: [{ ...box, children }] }, header: [] });
    const again = parseDiagram(text).root.children.find((c): c is ElementNode => c.kind === "element")!;
    expect(labelSource(again.children)).toBe(String.raw`Loss $\{x\}$`);
  });
});

describe("variants and shapes", () => {
  it("accepts color variants and new shapes, and points renamed variants to their color", () => {
    const ok = checkSource(`<Diagram width={200} height={100}><Box x={0} y={0} w={40} h={40} shape="cloud" variant="orange" /><Box x={40} y={0} w={40} h={40} shape="arrow" inset={0.4} variant="panel-blue" /></Diagram>`);
    expect(ok.issues).toEqual([]);
    const old = checkSource(`<Diagram width={200} height={100}><Box x={0} y={0} w={40} h={40} variant="attn" /></Diagram>`);
    expect(old.issues[0].message).toContain('renamed to "orange"');
  });

  it("generates a reference that lists every element and shape", () => {
    const ref = formatReference();
    for (const name of ["<Diagram>", "<Box>", "<Arrow>", "<Cuboid>"]) expect(ref).toContain(name);
    for (const shape of SHAPES) expect(ref).toContain("`" + shape + "`");
  });
});

describe("tables and icons", () => {
  const TABLE = `<Diagram width={200} height={100}>
  <Table x={0} y={0} w={120} h={48} cols={[40, 80]} header>
    <Row><Cell>Model</Cell><Cell>Params</Cell></Row>
    <Row><Cell>GPT-2</Cell><Cell variant="blue">1.5B</Cell></Row>
  </Table>
  <Icon x={140} y={0} w={24} h={24} name="cpu" variant="orange" />
</Diagram>
`;

  it("validates and keeps each row on one line", () => {
    const { file, issues } = checkSource(TABLE);
    expect(issues).toEqual([]);
    expect(serializeDiagram(file!)).toBe(TABLE);
  });

  it("reports cells outside rows, uneven rows and sizes that do not add up", () => {
    const bad = checkSource(`<Diagram><Table x={0} y={0} w={100} h={40} cols={[40, 40]}><Row><Cell>a</Cell></Row><Cell>b</Cell></Table></Diagram>`);
    const messages = bad.issues.map((i) => i.message).join("\n");
    expect(messages).toContain("<Cell> must be inside <Row>");
    expect(messages).toContain("different numbers of cells");
    expect(messages).toContain("cols add up to 80");
  });
});
