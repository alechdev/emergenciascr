import { describe, expect, it } from "vitest";

import {
  buildIncidentDeck,
  formatElapsed,
  formatIncidentHeadline,
  formatPlaceName,
  getAttentionSeconds,
  getFirstArrival,
  toSentenceCase
} from "@/lib/incident-editorial";

const location = { districtName: "QUITIRRISI", cantonName: "MORA", provinceName: "SAN JOSE" };

describe("formatPlaceName", () => {
  it("proper-cases words and keeps connectors lower case", () => {
    expect(formatPlaceName("SAN RAFAEL DE ALAJUELA")).toBe("San Rafael de Alajuela");
    expect(formatPlaceName("LA UNION")).toBe("La Union");
  });

  it("keeps the connectors of a free-text address lower case", () => {
    expect(formatPlaceName("PUNTARENAS GARABITO JACO EN EL HOTEL BALCON DEL MAR")).toBe(
      "Puntarenas Garabito Jaco en el Hotel Balcon del Mar"
    );
    expect(formatPlaceName("200 M AL NORTE DE LA ESCUELA")).toBe("200 M al Norte de la Escuela");
  });
});

describe("toSentenceCase", () => {
  it("lower-cases everything but the first letter and acronym-like words", () => {
    expect(toSentenceCase("C.C. EN LINEAS PRIMARIAS")).toBe("C.C. en lineas primarias");
    expect(toSentenceCase("CHOQUE DE LA M-128")).toBe("Choque de la M-128");
  });

  it("lower-cases a word that only ends a sentence with a period", () => {
    expect(toSentenceCase("ACCIDENTE DE TRANSITO.")).toBe("Accidente de transito.");
    expect(toSentenceCase("RETIRO DE S.A. Y TRANSITO.")).toBe("Retiro de S.A. y transito.");
  });
});

describe("formatIncidentHeadline", () => {
  it("splits the location suffix getIncidentTitle appends", () => {
    expect(
      formatIncidentHeadline(
        "COLISION CON PERSONA ATRAPADA EN QUITIRRISI, MORA, SAN JOSE",
        location
      )
    ).toBe("Colision con persona atrapada en Quitirrisi, Mora, San Jose");
  });

  it("falls back to sentence case when the title has no location suffix", () => {
    expect(formatIncidentHeadline("C.C. EN LINEAS PRIMARIAS", location)).toBe(
      "C.C. en lineas primarias"
    );
    expect(
      formatIncidentHeadline("INCENDIO", {
        districtName: null,
        cantonName: null,
        provinceName: null
      })
    ).toBe("Incendio");
  });
});

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
    { name: "PURISCAL", vehicles: [1] },
    { name: "PAVAS", vehicles: [1, 2] }
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
        stations: [{ name: "PURISCAL", vehicles: [1] }],
        responseTimes: [],
        attentionSeconds: 3600
      })
    ).toBe("Se despachó una unidad de la estación Puriscal.");
  });

  it("describes the arrival of a single unit", () => {
    expect(
      buildIncidentDeck({
        isOpen: false,
        stations: [{ name: "PURISCAL", vehicles: [1] }],
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
