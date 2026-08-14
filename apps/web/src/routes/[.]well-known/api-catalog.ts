import { createFileRoute } from "@tanstack/react-router";

const CONTENT_TYPE = 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

function catalogResponse(request: Request, includeBody: boolean) {
  const origin = new URL(request.url).origin;
  const api = `${origin}/api`;
  const body = {
    linkset: [
      {
        anchor: api,
        "service-desc": [{ href: `${api}/doc`, type: "application/json" }],
        "service-doc": [{ href: api, type: "text/html" }],
        status: [{ href: `${api}/health`, type: "application/json" }]
      }
    ]
  };

  return new Response(includeBody ? JSON.stringify(body) : null, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE,
      Link: '</.well-known/api-catalog>; rel="api-catalog"'
    }
  });
}

export const Route = createFileRoute("/.well-known/api-catalog")({
  server: {
    handlers: {
      GET: ({ request }) => catalogResponse(request, true),
      HEAD: ({ request }) => catalogResponse(request, false)
    }
  }
});
