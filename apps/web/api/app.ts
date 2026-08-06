import configureOpenAPI from "@api/lib/configure-open-api";
import createApp from "@api/lib/create-app";
import { healthRouter } from "@api/routers/health";
import { incidentsRouter } from "@api/routers/incidents";
import { ogRouter } from "@api/routers/og";
import { sitemapRouter } from "@api/routers/sitemap";
import { stationsRouter } from "@api/routers/stations";
import { statsRouter } from "@api/routers/stats";
import { typesRouter } from "@api/routers/types";

const app = createApp();

const api = createApp();

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
