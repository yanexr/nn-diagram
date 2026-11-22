import { DiagramViewer } from "@nn-diagram/viewer";
import "@nn-diagram/viewer/styles.css";
import "katex/dist/katex.min.css";
import { createRoot } from "react-dom/client";
import source from "./example.diagram.jsx?raw";
import { useSystemTheme } from "./theme";

function Example() {
  const theme = useSystemTheme();
  return <DiagramViewer source={source} theme={theme} name="example" editHref="editor/?example" controls={{ pen: false }} />;
}

createRoot(document.getElementById("example")!).render(<Example />);
document.getElementById("example-source")!.textContent = source.trim();
