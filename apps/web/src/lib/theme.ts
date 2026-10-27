import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { createContext, useContext } from "react";

export type Theme = "light" | "dark";

const DEFAULT_THEME: Theme = "light";

const THEME_COOKIE = "theme";
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" || value === "light" ? value : DEFAULT_THEME;
}

function readThemeFromDocumentCookie(): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${THEME_COOKIE}=`))
    ?.slice(THEME_COOKIE.length + 1);
}

// The choice lives in a cookie (not localStorage) so the server renders the right class on <html>
// and the page never flashes the other theme. The device's color-scheme is ignored on purpose:
// light is the default for everyone until they pick otherwise.
export const getStoredTheme = createIsomorphicFn()
  .server(() => parseTheme(getCookie(THEME_COOKIE)))
  .client(() => parseTheme(readThemeFromDocumentCookie()));

export function storeTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
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
