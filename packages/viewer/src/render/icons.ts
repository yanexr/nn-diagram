/**
 * Lucide icons for <Icon name="…">. The icon set is one lazily loaded chunk,
 * so pages whose diagrams use no icons never download it.
 */
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { walk, type ElementNode } from "@nn-diagram/format";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

/** Lookup key: "brain-circuit", "BrainCircuit" and "brain_circuit" are the same icon. */
export const iconKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "BrainCircuit" → "brain-circuit", "Grid2x2" → "grid-2x2". */
const kebab = (pascal: string) =>
  pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();

let byKey: Map<string, IconComponent> | null = null;
let names: string[] = [];
let loading: Promise<void> | null = null;

/** Loads the icon set (once). */
export function loadIcons(): Promise<void> {
  loading ??= import("./icon-set").then(({ icons, lucide }) => {
    const map = new Map<string, IconComponent>();
    const list: string[] = [];
    for (const [pascal, component] of Object.entries(icons)) {
      map.set(iconKey(pascal), component as IconComponent);
      list.push(kebab(pascal));
    }
    // Renamed icons keep their old names as aliases of the same component.
    const components = new Set<unknown>(Object.values(icons));
    for (const [name, value] of Object.entries(lucide)) {
      if (name.startsWith("Lucide") || name.endsWith("Icon") || !components.has(value)) continue;
      const key = iconKey(name);
      if (!map.has(key)) map.set(key, value as IconComponent);
    }
    byKey = map;
    names = list.sort();
  });
  return loading;
}

export const iconsLoaded = () => byKey !== null;

/** The icon component, `null` for an unknown name, `undefined` while the set loads. */
export function iconComponent(name: string): IconComponent | null | undefined {
  if (!byKey) return undefined;
  return byKey.get(iconKey(name)) ?? null;
}

/** All icon names in kebab-case (empty until loaded). */
export const iconNames = () => names;

export function useIconSet(): boolean {
  const [ready, setReady] = useState(iconsLoaded);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadIcons().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}

export function usesIcons(root: ElementNode): boolean {
  let found = false;
  walk(root, (n) => {
    if (n.name === "Icon") found = true;
  });
  return found;
}
