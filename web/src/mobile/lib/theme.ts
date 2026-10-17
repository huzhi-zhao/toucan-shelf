import { useEffect, useState } from "react";
import { getSystemTheme, loadTheme } from "@/utils/theme";

/**
 * Dark mode follows the system (requirement §7). Two switches have to agree: the
 * web theme's CSS variables, which the shared renderer reads, and the `dark`
 * class Konsta keys its own palette off.
 */
export function useSystemDarkMode(): boolean {
  const [dark, setDark] = useState(() => getSystemTheme() === "default-dark");
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setDark(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    loadTheme(dark ? "default-dark" : "default");
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return dark;
}
