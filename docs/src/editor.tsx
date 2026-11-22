import { DiagramEditor } from "@nn-diagram/editor";
import "@nn-diagram/editor/styles.css";
import "katex/dist/katex.min.css";
import { createRoot } from "react-dom/client";
import example from "./example.diagram.jsx?raw";
import { useSystemTheme } from "./theme";

// `?example` opens the example from the docs page; otherwise the editor restores the last draft.
const defaultSource = new URLSearchParams(location.search).has("example") ? example : undefined;

function Editor() {
  const theme = useSystemTheme();
  return <DiagramEditor homeHref="../" theme={theme} defaultSource={defaultSource} />;
}

createRoot(document.getElementById("editor")!).render(<Editor />);
