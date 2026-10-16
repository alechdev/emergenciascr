import { describe, expect, it } from "vitest";

import {
  GAP_FILL_WINDOW_MS,
  discoveryDelaySeconds,
  gapFillRange,
  incidentPollJobId,
  listedIncidentTime,
  nextPollFor,
  pollDelayMs,
  pollLagSeconds,
  withinGapFill
} from "@/lib/schedule";

const now = new Date("2026-10-11T02:30:00.000Z");

describe("incidentPollJobId", () => {
  it("is one ID per incident without colons", () => {
    expect(incidentPollJobId(1923918)).toBe("incident-poll-1923918");
    expect(incidentPollJobId(1923918)).not.toContain(":");
  });
});

describe("pollDelayMs", () => {
  it("waits until the poll is due, never a negative time", () => {
    expect(pollDelayMs(new Date(now.getTime() + 180_000), now)).toBe(180_000);
    expect(pollDelayMs(new Date(now.getTime() - 60_000), now)).toBe(0);
    expect(pollDelayMs(null, now)).toBe(0);
  });
});

describe("pollLagSeconds", () => {
  it("measures how late a poll started", () => {
    expect(pollLagSeconds(new Date(now.getTime() - 2_500), now)).toBe(2.5);
    expect(pollLagSeconds(new Date(now.getTime() + 1_000), now)).toBe(0);
    expect(pollLagSeconds(null, now)).toBeNull();
  });
});

describe("nextPollFor", () => {
  const at = new Date(now.getTime() + 900_000);

  it("polls active and settling incidents again", () => {
    expect(nextPollFor({ phase: "active", nextPollAt: at })).toBe(at);
    expect(nextPollFor({ phase: "settling", nextPollAt: at })).toBe(at);
  });

  it("stops for every other phase", () => {
    for (const phase of ["done", "deleted", "failed"]) {
      expect(nextPollFor({ phase, nextPollAt: at })).toBeNull();
    }
    expect(nextPollFor({ phase: "active", nextPollAt: null })).toBeNull();
  });
});

describe("listedIncidentTime", () => {
  it("reads SIGAE list times as Costa Rica time", () => {
    expect(
      listedIncidentTime({ fecha: "2026-10-10T00:00:00", horaIncidente: "2026-10-10T20:25:19" })
    ).toEqual(new Date("2026-10-11T02:25:19.000Z"));
    expect(
      listedIncidentTime({ fecha: "0001-01-01T00:00:00", horaIncidente: "2026-10-10T20:25:19" })
    ).toBeNull();
  });
});

describe("discoveryDelaySeconds", () => {
  it("is the time from the incident to first seeing it", () => {
    expect(discoveryDelaySeconds(new Date(now.getTime() - 90_000), now)).toBe(90);
    expect(discoveryDelaySeconds(new Date(now.getTime() + 90_000), now)).toBe(0);
    expect(discoveryDelaySeconds(null, now)).toBeNull();
  });
});

describe("gap fill", () => {
  it("asks for the last 6 hours", () => {
    const range = gapFillRange(now);
    expect(range.to).toEqual(now);
    expect(now.getTime() - range.from.getTime()).toBe(GAP_FILL_WINDOW_MS);
    expect(range.since).toEqual(range.from);
  });

  it("keeps incidents within the window and those without a time", () => {
    const { since } = gapFillRange(now);
    const items = [
      { id: 1, fecha: "2026-10-10T00:00:00", horaIncidente: "2026-10-10T20:25:19" },
      { id: 2, fecha: "2026-10-10T00:00:00", horaIncidente: "2026-10-10T14:29:59" },
      { id: 3, fecha: "2026-10-10T00:00:00", horaIncidente: "2026-10-10T14:30:00" },
      { id: 4, fecha: "0001-01-01T00:00:00", horaIncidente: "0001-01-01T00:00:00" }
    ];
    expect(withinGapFill(items, since).map((item) => item.id)).toEqual([1, 3, 4]);
  });
});
