import { describe, expect, it } from "vitest";

import { describeError, redactQueryMessage } from "../src/pipeline/errors";
import { newSyncState, snapshotInputs } from "../src/pipeline/sync-incident";
import { payloadHash } from "../src/redact/redact";
import { CAST_ERROR, INCIDENT_ID, NOT_FOUND, pollResponses, reportBody } from "./builders";

describe("snapshotInputs", () => {
  it("redacts and hashes every endpoint that answered", () => {
    const responses = pollResponses({
      report: {
        body: reportBody({ ...CAST_ERROR, Telefono_Avisa: "8888-8888", Nombre_Avisa: "X" })
      },
      units: { error: { kind: "timeout", message: "timed out after 15000ms" } },
      stations: { body: { ...NOT_FOUND, Items: [] } }
    });

    const inputs = snapshotInputs(responses);

    expect(inputs.map((input) => [input.endpoint, input.codigo])).toEqual([
      ["ObtenerDetalleEmergencias", "00"],
      ["ObtenerBoletaIncidente", "99"],
      ["ObtenerEstacionesAtiendeIncidente", "03"]
    ]);
    const report = inputs[1];
    expect(report?.payload).not.toHaveProperty("Telefono_Avisa");
    expect(report?.payload).not.toHaveProperty("Nombre_Avisa");
    expect(report?.payload).toMatchObject({ Consecutivo: "51234-2026" });
    for (const input of inputs) expect(input.payloadHash).toBe(payloadHash(input.payload));
  });

  it("hashes equal payloads equally", () => {
    const [first] = snapshotInputs(pollResponses());
    const [second] = snapshotInputs(pollResponses());
    expect(first?.payloadHash).toBe(second?.payloadHash);
  });
});

describe("describeError", () => {
  it("joins the cause chain and drops query parameters", () => {
    const pg = new Error('insert or update on table "incidents" violates foreign key constraint');
    const query = new Error(
      'Failed query: insert into "incidents" ("id", "address") values ($1, $2)\nparams: 1,CALLE 1',
      { cause: pg }
    );

    expect(describeError(new Error("transaction failed", { cause: query }))).toBe(
      'transaction failed: Failed query: insert into "incidents" ("id", …: insert or update on table "incidents" violates foreign key constraint'
    );
    expect(redactQueryMessage("connection refused")).toBe("connection refused");
    expect(describeError("boom")).toBe("boom");
  });
});

describe("newSyncState", () => {
  it("starts active, unscheduled and with no counters", () => {
    const now = new Date("2026-10-11T02:30:00.000Z");
    expect(newSyncState(INCIDENT_ID, now)).toEqual({
      incidentId: INCIDENT_ID,
      phase: "active",
      nextPollAt: null,
      lastPolledAt: null,
      upstreamClosedAt: null,
      consecutiveFailures: 0,
      notFoundCount: 0,
      emptyUnitsCount: 0,
      lastError: null,
      firstSeenAt: now
    });
  });
});
