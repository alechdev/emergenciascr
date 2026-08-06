import { Scalar } from "@scalar/hono-api-reference";

import type { AppOpenAPI } from "@api/lib/types";

const BASE_PATH = "/api";

export default function configureOpenAPI(app: AppOpenAPI) {
  app.doc("/doc", {
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "Bomberos CR API"
    },
    servers: [
      {
        url: BASE_PATH,
        description: "Bomberos CR API"
      }
    ]
  });

  app.get(
    "/",
    Scalar({
      url: `${BASE_PATH}/doc`,
      theme: "moon",
      layout: "modern",
      defaultOpenAllTags: false,
      hideClientButton: true,
      showDeveloperTools: "localhost",
      telemetry: false,
      pageTitle: "Emergencias CR API Reference",
      favicon: "/favicon.ico",
      defaultHttpClient: {
        targetKey: "shell",
        clientKey: "curl"
      }
    })
  );
}
