/**
 * The editor's loading screen, as its own entry (`@nn-diagram/editor/loader`)
 * so apps can show it while the editor itself is still downloading.
 */
import { LogoLoader } from "@nn-diagram/ui/logo";

export function EditorLoader({ className }: { className?: string }) {
  return (
    <div className={["nnd-ui flex h-full w-full items-center justify-center bg-background text-foreground", className].filter(Boolean).join(" ")}>
      <LogoLoader />
    </div>
  );
}
