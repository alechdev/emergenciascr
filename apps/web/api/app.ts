import configureOpenAPI from "@api/lib/configure-open-api";
import createApp, { createRouter } from "@api/lib/create-app";
import { healthRouter } from "@api/routers/health";
import { incidentsRouter } from "@api/routers/incidents";
import { ogRouter } from "@api/routers/og";
import { sitemapRouter } from "@api/routers/sitemap";
import { stationsRouter } from "@api/routers/stations";
import { statsRouter } from "@api/routers/stats";
import { typesRouter } from "@api/routers/types";

const app = createApp();

// Nested router only — createApp() would re-apply logger/cors/requestId middleware.
const api = createRouter();

configureOpenAPI(api);

api.route("/health", healthRouter);
api.route("/incidents", incidentsRouter);
api.route("/og", ogRouter);
api.route("/sitemap", sitemapRouter);
api.route("/stations", stationsRouter);
api.route("/stats", statsRouter);
api.route("/types", typesRouter);

app.route("/api", api);

export default app;
