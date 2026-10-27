import { describe, expect, it } from "vitest";

import { parseTheme, readThemeCookie, serializeThemeCookie } from "@/lib/theme-cookie";

describe("parseTheme", () => {
  it("accepts the two known themes", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("falls back to light for missing, empty or unknown values", () => {
    expect(parseTheme(undefined)).toBe("light");
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme("")).toBe("light");
    expect(parseTheme("system")).toBe("light");
    expect(parseTheme("DARK")).toBe("light");
  });
});

describe("readThemeCookie", () => {
  it("reads the value after the cookie name", () => {
    expect(readThemeCookie("theme=dark")).toBe("dark");
    expect(readThemeCookie("_ga=GA1.1; theme=dark; other=1")).toBe("dark");
  });

  it("tolerates missing spaces between cookies", () => {
    expect(readThemeCookie("_ga=GA1.1;theme=dark")).toBe("dark");
  });

  it("ignores cookies whose name only starts with theme", () => {
    expect(readThemeCookie("themes=dark")).toBe("light");
    expect(readThemeCookie("theme-color=dark")).toBe("light");
  });

  it("falls back to light without a theme cookie", () => {
    expect(readThemeCookie("")).toBe("light");
    expect(readThemeCookie("theme=")).toBe("light");
    expect(readThemeCookie("other=dark")).toBe("light");
  });
});

describe("serializeThemeCookie", () => {
  it("writes a site-wide cookie that readThemeCookie reads back", () => {
    const cookie = serializeThemeCookie("dark");
    expect(cookie).toBe("theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(readThemeCookie(cookie.split(";")[0]!)).toBe("dark");
  });
});
