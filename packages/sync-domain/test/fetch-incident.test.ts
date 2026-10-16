import { type Result, errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { fetchIncident } from "../src/fetch-incident";
import {
  CAST_ERROR,
  INCIDENT_ID,
  NOT_FOUND,
  pollResponses,
  reportBody,
  type PollInput
} from "./builders";

import type { SigaeClient } from "@bomberoscr/sigae/client";

const notFoundList = { body: { ...NOT_FOUND, Items: [] } };

function fakeClient(input: PollInput): SigaeClient {
  const responses = pollResponses(input);
  const answer = <T, E>(result: Result<T, E>) =>
    result.isOk() ? okAsync(result.value) : errAsync(result.error);
  return {
    getIncidentDetails: () => answer(responses.details),
    getIncidentReport: () => answer(responses.report),
    getDispatchedStations: () => answer(responses.stations),
    getDispatchedUnits: () => answer(responses.units)
  } as unknown as SigaeClient;
}

async function fetchKind(input: PollInput) {
  const result = await fetchIncident(fakeClient(input), INCIDENT_ID);
  return result.isOk() ? "ok" : result.error.kind;
}

describe("fetchIncident", () => {
  it("all four 00: the upsert input", async () => {
    const result = await fetchIncident(fakeClient({}), INCIDENT_ID);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.stationsAttending).toHaveLength(1);
    expect(result.value.vehiclesDispatched).toHaveLength(1);
  });

  it("detail and report 03: not_found", async () => {
    expect(
      await fetchKind({
        details: { body: NOT_FOUND },
        report: { body: NOT_FOUND },
        stations: notFoundList,
        units: notFoundList
      })
    ).toBe("not_found");
  });

  it("only detail or only report 03: failed", async () => {
    expect(await fetchKind({ details: { body: NOT_FOUND } })).toBe("failed");
    expect(await fetchKind({ report: { body: NOT_FOUND } })).toBe("failed");
  });

  it("uses a 99 report that has the required fields", async () => {
    expect(await fetchKind({ report: { body: reportBody(CAST_ERROR) } })).toBe("ok");
  });

  it("rejects a report answering any other error code, even with a full body", async () => {
    const dbError = { Codigo: "04", Descripcion: "Ha ocurrido un error con la base de datos." };
    expect(await fetchKind({ report: { body: reportBody(dbError) } })).toBe("failed");
  });

  it("stations 03: an empty station list, keeping the units", async () => {
    const result = await fetchIncident(fakeClient({ stations: notFoundList }), INCIDENT_ID);
    expect(result.isOk() && result.value.stationsAttending).toEqual([]);
    expect(result.isOk() && result.value.vehiclesDispatched).toHaveLength(1);
  });

  it("units 03: an empty unit list, keeping the stations", async () => {
    const result = await fetchIncident(fakeClient({ units: notFoundList }), INCIDENT_ID);
    expect(result.isOk() && result.value.vehiclesDispatched).toEqual([]);
    expect(result.isOk() && result.value.stationsAttending).toHaveLength(1);
  });
});
