function getPublicApiBaseUrl(): string | null {
  const value = import.meta.env.VITE_SERVER_URL || process.env.VITE_SERVER_URL;

  if (!value) {
    return null;
  }

  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return null;
  }

  return value.replace(/\/$/, "");
}

export async function proxyInternalSitemap(path: string) {
  const apiBaseUrl = getPublicApiBaseUrl();
  const sitemapToken = process.env.SITEMAP_TOKEN;

  if (!apiBaseUrl) {
    return new Response("VITE_SERVER_URL must be an absolute URL", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }

  if (!sitemapToken) {
    return new Response("SITEMAP_TOKEN is not configured", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }

  const targetUrl = new URL(`${apiBaseUrl}/sitemap/internal/${path}`);
  targetUrl.searchParams.set("token", sitemapToken);

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8"
      }
    });

    const body = await upstream.text();
    const contentType = upstream.headers.get("content-type") ?? "application/xml; charset=utf-8";
    const cacheControl = upstream.headers.get("cache-control") ?? "no-store";

    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl
      }
    });
  } catch {
    return new Response("Failed to fetch sitemap", {
      status: 502,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
}
