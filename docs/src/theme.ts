import { useEffect, useState } from "react";

const query = matchMedia("(prefers-color-scheme: dark)");
const apply = () => document.documentElement.classList.toggle("dark", query.matches);
apply();
query.addEventListener("change", apply);

/** The system color scheme. */
export function useSystemTheme(): "light" | "dark" {
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const update = () => setDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return dark ? "dark" : "light";
}
