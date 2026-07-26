import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import { z } from "zod";

import { LandingHero } from "@/components/homepage/landing-hero";
import { Separator } from "@/components/homepage/separator";
import { SITE_URL } from "@/lib/site";
// import { MapCTA } from "@/components/homepage/map-cta";

const AnnualRecapSection = lazy(async () => {
  const module = await import("@/components/homepage/annual-recap-section");
  return { default: module.AnnualRecapSection };
});

const DailyResponseTimesLineChart = lazy(async () => {
  const module = await import("@/components/homepage/charts/daily-response-times-line-chart");
  return { default: module.DailyResponseTimesLineChart };
});

const RecentIncidentsHoursBarChart = lazy(async () => {
  const module = await import("@/components/homepage/charts/recent-incidents-hours-bar-chart");
  return { default: module.RecentIncidentsHoursBarChart };
});

const HighlightedIncidents = lazy(async () => {
  const module = await import("@/components/homepage/highlighted-incidents");
  return { default: module.HighlightedIncidents };
});

const LatestIncidents = lazy(async () => {
  const module = await import("@/components/homepage/latest-incidents");
  return { default: module.LatestIncidents };
});

const IncidentTypesChart = lazy(async () => {
  const module = await import("@/components/homepage/incident-types-chart");
  return { default: module.IncidentTypesChart };
});

const title = "Emergencias CR - Incidentes de Bomberos en Tiempo Real";
const description =
  "Monitoreo en tiempo real de incidentes del Cuerpo de Bomberos de Costa Rica. Visualiza emergencias activas, mapa de estaciones y estadísticas operativas.";

export const ALLOWED_TIME_RANGE_VALUES = [7, 30, 90, 365] as const;
export const DEFAULT_TIME_RANGE = 30;

export const TIME_RANGE_LABELS = {
  7: "7 días",
  30: "1 mes",
  90: "3 meses",
  365: "1 año"
} as const;

const timeRangeSchema = z
  .union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)])
  .optional()
  .catch(DEFAULT_TIME_RANGE);

const hourlyIncidentsTimeRangeSchema = z
  .union([z.literal(24), z.literal(48), z.literal(72)])
  .optional()
  .catch(24);

export const Route = createFileRoute("/_dashboard/")({
  validateSearch: z.object({
    highlightedTimeRange: timeRangeSchema,
    incidentTypesTimeRange: timeRangeSchema,
    dailyResponseTimesTimeRange: timeRangeSchema,
    incidentsByHourTimeRange: hourlyIncidentsTimeRangeSchema
  }),
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: SITE_URL },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:url", content: SITE_URL }
    ],
    links: [{ rel: "canonical", href: SITE_URL }]
  }),
  component: HomePage
});

function SectionPlaceholder({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`w-full animate-pulse bg-muted/20 ${className}`}
    />
  );
}

function HomePage() {
  return (
    <div className="-mt-8 flex flex-col gap-8">
      <LandingHero />
      <Suspense
        fallback={<SectionPlaceholder className="mt-6 h-[920px] py-8 md:h-[980px] lg:h-[860px]" />}>
        <section className="mt-6 flex flex-col py-8">
          <AnnualRecapSection />
          <DailyResponseTimesLineChart />
          <RecentIncidentsHoursBarChart />
        </section>
      </Suspense>
      <Separator />
      <Suspense fallback={<SectionPlaceholder className="h-[560px] md:h-[620px]" />}>
        <HighlightedIncidents />
      </Suspense>
      <Suspense fallback={<SectionPlaceholder className="h-[560px] md:h-[620px]" />}>
        <LatestIncidents />
      </Suspense>
      {/* <MapCTA /> */}
      <Separator />
      <Suspense fallback={<SectionPlaceholder className="h-[420px] md:h-[460px]" />}>
        <IncidentTypesChart />
      </Suspense>
    </div>
  );
}
