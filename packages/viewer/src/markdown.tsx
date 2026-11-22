import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** Removes common indentation and surrounding blank lines (template literals). */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

/** Markdown with GFM tables and $LaTeX$, used for tooltips and step text. */
export function Markdown({ children, className, scroll }: { children: string; className?: string; scroll?: boolean }) {
  return (
    <div className={className} data-nnd-scroll={scroll || undefined}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {dedent(children)}
      </ReactMarkdown>
    </div>
  );
}
