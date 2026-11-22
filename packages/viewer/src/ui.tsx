/**
 * Small UI helpers on top of the shared shadcn/ui (Base UI) components. They
 * use the shadcn theme tokens (bg-popover, border, text-muted-foreground, …),
 * so they follow the host app's theme or a local `.dark` / `.light` scope.
 */
import { Button } from "@nn-diagram/ui/button";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Kbd } from "@nn-diagram/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider as BaseTooltipProvider, TooltipTrigger } from "@nn-diagram/ui/tooltip";
import { Children, createContext, isValidElement, useContext, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";

export { Kbd };

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = Omit<ComponentProps<typeof Button>, "size" | "variant" | "className"> & {
  className?: string;
  active?: boolean;
  size?: "xs" | "sm" | "md";
  variant?: "ghost" | "outline" | "solid";
};

/**
 * The shadcn/ui Button as an icon button (also fits an icon plus a short
 * label). `active` marks toggles and the current tool.
 */
export function IconButton({ className, active, size = "md", variant = "ghost", children, ...props }: ButtonProps) {
  const hasText = Children.toArray(children).some((c) => typeof c === "string" || typeof c === "number");
  const iconSize = size === "xs" ? "icon-xs" : size === "sm" ? "icon-sm" : "icon";
  return (
    <Button
      variant={variant === "solid" ? "default" : variant}
      size={iconSize}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        hasText && (size === "xs" ? "w-auto gap-1 px-1.5" : "w-auto gap-1.5 px-2"),
        size === "xs" && "[&_svg:not([class*='size-'])]:size-3.5",
        variant === "ghost" &&
          "text-foreground/80 hover:bg-foreground/[0.07] hover:text-foreground aria-expanded:bg-foreground/[0.07] dark:hover:bg-foreground/10",
        active && "bg-foreground/[0.08] text-foreground dark:bg-foreground/12",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

/**
 * shadcn/ui tooltip around a single element. It closes as soon as the
 * pointer leaves the trigger (the popup itself is not hoverable).
 */
interface TipPayload {
  label: ReactNode;
  side: "top" | "bottom" | "left" | "right";
  shortcut?: string;
}
const TipHandleContext = createContext<ReturnType<typeof TooltipPrimitive.createHandle<TipPayload>> | null>(null);

export function Tip({
  label,
  children,
  side = "bottom",
  delay = 400,
  shortcut,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  shortcut?: string;
}) {
  const handle = useContext(TipHandleContext);
  if (!label) return <>{children}</>;
  const trigger = <TooltipTrigger handle={handle ?? undefined} payload={{ label, side, shortcut }} delay={delay} closeDelay={0} render={isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : <span>{children}</span>} />;
  // One popup/root per provider; each control retains its own trigger, delay,
  // content and placement. Avoid mounting dozens of closed popups on selection.
  if (handle) return trigger;
  return (
    <Tooltip disableHoverablePopup>
      {trigger}
      <TooltipContent side={side}>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [handle] = useState(() => TooltipPrimitive.createHandle<TipPayload>());
  return (
    <BaseTooltipProvider delay={400}>
      <TipHandleContext.Provider value={handle}>{children}</TipHandleContext.Provider>
      <Tooltip handle={handle} disableHoverablePopup>
        {({ payload }) => (
          <TooltipContent side={payload?.side ?? "bottom"}>
            {payload?.label}
            {payload?.shortcut && <Kbd>{payload.shortcut}</Kbd>}
          </TooltipContent>
        )}
      </Tooltip>
    </BaseTooltipProvider>
  );
}


/** Floating panels over a canvas (toolbars, docks, the walkthrough card). */
export const floatingPanel =
  "rounded-xl border border-border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_20px_-6px_rgb(0_0_0/0.14)] dark:shadow-[0_6px_20px_-6px_rgb(0_0_0/0.6)]";

/** Applies a light or dark shadcn token scope to a subtree. */
export function themeScope(theme: "light" | "dark"): string {
  return theme === "dark" ? "dark" : "light";
}
