const MARKDOWN_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const MARKDOWN_PATH_SUFFIX = /\.md$/i;

/** Strips a trailing `.md` so `/incidentes/$slug.md` can reuse the HTML route param. */
export function splitMarkdownPathSlug(slug: string): { slug: string; fromMarkdownPath: boolean } {
  if (!MARKDOWN_PATH_SUFFIX.test(slug)) {
    return { slug, fromMarkdownPath: false };
  }

  return { slug: slug.replace(MARKDOWN_PATH_SUFFIX, ""), fromMarkdownPath: true };
}

/** True when `Accept` explicitly includes markdown (not a wildcard or HTML). */
export function prefersMarkdown(request: Request): boolean {
  const accept = request.headers.get("accept");
  if (!accept) return false;

  for (const part of accept.split(",")) {
    const [rawType, ...params] = part.split(";").map((segment) => segment.trim().toLowerCase());
    if (!rawType || !MARKDOWN_TYPES.has(rawType)) continue;

    const qParam = params.find((param) => param.startsWith("q="));
    if (!qParam) return true;

    const quality = Number(qParam.slice(2));
    if (Number.isFinite(quality) && quality > 0) return true;
  }

  return false;
}

export function markdownResponse(body: string, init?: Omit<ResponseInit, "headers">): Response {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept"
    }
  });
}
