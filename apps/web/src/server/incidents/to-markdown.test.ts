import { describe, expect, it } from "vitest";

import { incidentPageToMarkdown } from "@/server/incidents/to-markdown";

import type { IncidentPageData } from "@/server/incidents/get-incident-page";

// Reported at 20:25 on 10 October in Costa Rica, which is already the 11th in UTC.
const REPORTED_AT = "2026-10-11T02:25:19.000Z";

function page(currentYear: number): IncidentPageData {
  return {
    incident: {
      id: 1923918,
      slug: "1923918-incendio-estructural-2026-10-10",
      title: "Incendio estructural",
      headline: "Incendio estructural",
      isOpen: false,
      EEConsecutive: "2026-012345",
      address: "",
      incidentTimestamp: REPORTED_AT,
      modifiedAt: null,
      latitude: 0,
      longitude: 0,
      districtName: null,
      cantonName: null,
      provinceName: null,
      mapImageUrl: null,
      dispatchTypeName: "Incendio",
      specificDispatchTypeName: null,
      actualTypeName: null,
      specificActualTypeName: null,
      statistics: {
        currentYear,
        currentYearCount: 3,
        currentYearCantonCount: 0,
        previousYear: currentYear - 1,
        previousYearCount: 0
      }
    },
    stations: [],
    timeline: [
      { id: "dispatch", date: REPORTED_AT, title: "Despacho" },
      { id: "close", date: "2026-10-11T07:10:00.000Z", title: "Cierre" }
    ],
    responseTimes: []
  };
}

describe("incidentPageToMarkdown", () => {
  it("dates an evening incident on its Costa Rica day", () => {
    const markdown = incidentPageToMarkdown(page(2026), new Date("2026-10-11T03:00:00.000Z"));

    expect(markdown).toContain("- Reportado: 10 de octubre de 2026 a las 8:25 p. m.");
    expect(markdown).toContain("- **08:25 p. m.** — Despacho");
    expect(markdown).toContain("- **11 oct 2026, 01:10 a. m.** — Cierre");
  });

  it("treats the year as current until midnight in Costa Rica", () => {
    // 00:30 UTC on 1 January is still 31 December in Costa Rica.
    const markdown = incidentPageToMarkdown(page(2025), new Date("2026-01-01T00:30:00.000Z"));

    expect(markdown).toContain("En lo que va del 2025 se han reportado 3 incidentes");
  });
});
