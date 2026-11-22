/**
 * The format reference as Markdown, generated from the schema so it always
 * matches what the validator accepts. `nn-diagram reference` prints it.
 */
import { ARROW_HEADS, BASE_VARIANTS, COMPONENTS, EDGE_VARIANTS, INLINE_TAGS, PALETTE, ROUTES, SHAPES, TOKEN_KINDS, type PropSpec } from "./schema";

const code = (s: string) => `\`${s}\``;

function propDefault(p: PropSpec): string {
  if (p.default === undefined) return "";
  return code(typeof p.default === "string" ? `"${p.default}"` : JSON.stringify(p.default));
}

function propType(p: PropSpec): string {
  if (p.type === "enum" && p.options) return p.options.map((o) => code(o)).join(" ");
  return p.type;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function formatReference(): string {
  const out: string[] = [];
  out.push("# nn-diagram format reference", "");
  out.push(
    "Generated from the schema of @nn-diagram/format. A file is one `<Diagram>` element written in JSX with literal attribute values; it is parsed, never executed.",
    "",
  );
  out.push("## Elements", "");
  for (const spec of Object.values(COMPONENTS)) {
    const traits = [spec.container && "can contain shapes", spec.label && "children are its label", spec.defaultSize && `default size ${spec.defaultSize.join("×")}`]
      .filter(Boolean)
      .join(", ");
    out.push(`### \`<${spec.name}>\``, "", spec.description + (traits ? ` Traits: ${traits}.` : ""), "");
    if (!spec.props.length) continue;
    out.push("| Prop | Type | Default | Description |", "|---|---|---|---|");
    for (const p of spec.props) out.push(`| ${code(p.name)} | ${cell(propType(p))} | ${propDefault(p)} | ${cell(p.description)} |`);
    out.push("");
  }
  out.push("## Values", "");
  out.push(`- Shapes (\`<Box shape>\`): ${SHAPES.map(code).join(", ")}`);
  out.push(`- Box variants: ${Object.entries(BASE_VARIANTS).map(([k, v]) => `${code(k)} (${v.description.toLowerCase()})`).join(", ")}`);
  out.push(`- Colors (variant \`<color>\` for a filled box, \`panel-<color>\` for a large light area): ${PALETTE.map(code).join(", ")}`);
  out.push(`- Arrow variants: ${Object.keys(EDGE_VARIANTS).map(code).join(", ")} or a color; add \`dashed\` for dashed lines`);
  out.push(`- Arrow heads (\`head\`, \`tail\`): ${ARROW_HEADS.map(code).join(", ")}`);
  out.push(`- Routes: ${ROUTES.map(code).join(", ")}`);
  out.push(`- Token kinds (\`<Tokens segments>\`): ${Object.entries(TOKEN_KINDS).map(([k, c]) => `${code(k)} (${c})`).join(", ")}, or a color`);
  out.push(`- Inline tags in labels: ${[...INLINE_TAGS].map((t) => code(`<${t}>`)).join(" ")} and \`<Math tex>\``);
  out.push("");
  return out.join("\n");
}
