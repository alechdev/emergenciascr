export type Theme = "light" | "dark";

const DEFAULT_THEME: Theme = "light";

export const THEME_COOKIE = "theme";
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" || value === "light" ? value : DEFAULT_THEME;
}

/** Reads the theme from a `Cookie` header or `document.cookie` string. */
export function readThemeCookie(cookies: string): Theme {
  const prefix = `${THEME_COOKIE}=`;
  const entry = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return parseTheme(entry?.slice(prefix.length));
}

export function serializeThemeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
