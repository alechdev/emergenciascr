import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { createContext, useContext } from "react";

import {
  parseTheme,
  readThemeCookie,
  serializeThemeCookie,
  THEME_COOKIE,
  type Theme
} from "@/lib/theme-cookie";

export type { Theme } from "@/lib/theme-cookie";
export { parseTheme } from "@/lib/theme-cookie";

// The choice lives in a cookie (not localStorage) so the server renders the right class on <html>
// and the page never flashes the other theme. The device's color-scheme is ignored on purpose:
// light is the default for everyone until they pick otherwise.
export const getStoredTheme = createIsomorphicFn()
  .server(() => parseTheme(getCookie(THEME_COOKIE)))
  .client(() => readThemeCookie(document.cookie));

export function storeTheme(theme: Theme) {
  document.cookie = serializeThemeCookie(theme);
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeContext.");
  }

  return context;
}
