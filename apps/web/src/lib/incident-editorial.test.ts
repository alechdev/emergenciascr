import { describe, expect, it } from "vitest";

import {
  buildIncidentDeck,
  formatElapsed,
  getAttentionSeconds,
  getFirstArrival
} from "@/lib/incident-editorial";

const nbsp = (text: string) => text.replaceAll(" ", "\u00A0");

describe("formatElapsed", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatElapsed(45)).toBe(nbsp("45 s"));
    expect(formatElapsed(17 * 60 + 8)).toBe(nbsp("17 min 8 s"));
    expect(formatElapsed(17 * 60 + 8, { withSeconds: false })).toBe(nbsp("17 min"));
    expect(formatElapsed(2 * 3600 + 16 * 60 + 5)).toBe(nbsp("2 h 16 min"));
    expect(formatElapsed(3600)).toBe(nbsp("1 h"));
  });
});

const responseTimes = [
  {
    vehicle: "R-08",
    station: "PAVAS",
    arrivalTime: "2025-04-08T17:40:00.000Z",
    responseTimeSeconds: 900
  },
  {
    vehicle: "M-128",
    station: "PURISCAL",
    arrivalTime: "2025-04-08T17:33:00.000Z",
    responseTimeSeconds: 1028
  },
  { vehicle: "M-113", station: "SANTA ANA", arrivalTime: null, responseTimeSeconds: 0 }
];

describe("getFirstArrival", () => {
  it("picks the earliest arrival rather than the fastest response", () => {
    expect(getFirstArrival(responseTimes)?.vehicle).toBe("M-128");
  });

  it("returns null when no unit arrived", () => {
    expect(getFirstArrival([responseTimes[2]!])).toBeNull();
  });
});

describe("getAttentionSeconds", () => {
  it("measures from the report to the close event", () => {
    expect(
      getAttentionSeconds("2025-04-08T17:14:00.000Z", [
        { id: "incident:1:reported", date: "2025-04-08T17:14:00.000Z" },
        { id: "incident:1:closed", date: "2025-04-08T19:30:00.000Z" }
      ])
    ).toBe(8160);
  });

  it("returns null without a close event", () => {
    expect(getAttentionSeconds("2025-04-08T17:14:00.000Z", [])).toBeNull();
  });
});

describe("buildIncidentDeck", () => {
  const stations = [
    { displayName: "Puriscal", vehicles: [1] },
    { displayName: "Pavas", vehicles: [1, 2] }
  ];

  it("summarizes the dispatch, first arrival and duration", () => {
    expect(
      buildIncidentDeck({ isOpen: false, stations, responseTimes, attentionSeconds: 8160 })
    ).toBe(
      `Se despacharon 3 unidades de 2 estaciones. La primera en llegar, la M-128, lo hizo ${nbsp("17 min 8 s")} después del despacho. El incidente se cerró tras ${nbsp("2 h 16 min")}.`
    );
  });

  it("uses the singular for a single unit and skips the duration of open incidents", () => {
    expect(
      buildIncidentDeck({
        isOpen: true,
        stations: [{ displayName: "Puriscal", vehicles: [1] }],
        responseTimes: [],
        attentionSeconds: 3600
      })
    ).toBe("Se despachó una unidad de la estación Puriscal.");
  });

  it("describes the arrival of a single unit", () => {
    expect(
      buildIncidentDeck({
        isOpen: false,
        stations: [{ displayName: "Puriscal", vehicles: [1] }],
        responseTimes: [responseTimes[1]!],
        attentionSeconds: 8160
      })
    ).toBe(
      `Se despachó una unidad de la estación Puriscal. La M-128 llegó a la escena ${nbsp("17 min 8 s")} después del despacho. El incidente se cerró tras ${nbsp("2 h 16 min")}.`
    );
  });

  it("returns null when nothing was dispatched", () => {
    expect(
      buildIncidentDeck({ isOpen: false, stations: [], responseTimes, attentionSeconds: null })
    ).toBeNull();
  });
});
