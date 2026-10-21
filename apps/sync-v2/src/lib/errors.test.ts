import { describe, expect, it } from "vitest";

import { SyncError, serializeError } from "@/lib/errors";

describe("serializeError", () => {
  it("keeps the whole cause chain and known fields", () => {
    const pg = Object.assign(new Error("insert violates foreign key"), {
      code: "23503",
      constraint: "dispatched_vehicles_vehicleId_vehicles_id_fk",
      detail: 'Key (vehicleId)=(8380) is not present in table "vehicles".'
    });
    const error = new SyncError("failed to store incident 1", {
      cause: new Error("Failed query", { cause: pg })
    });

    const serialized = serializeError(error);

    expect(serialized).toMatchObject({
      name: "SyncError",
      message: "failed to store incident 1",
      cause: {
        name: "Error",
        message: "Failed query",
        cause: {
          message: "insert violates foreign key",
          code: "23503",
          constraint: "dispatched_vehicles_vehicleId_vehicles_id_fk",
          detail: 'Key (vehicleId)=(…) is not present in table "vehicles".'
        }
      }
    });
    expect(serialized.stack).toContain("SyncError");
    expect(serialized.cause?.stack).toBeUndefined();
  });

  it("keeps only key names from Postgres details", () => {
    const pgError = (detail: string) =>
      serializeError(Object.assign(new Error("violation"), { code: "23505", detail }));

    expect(pgError("Key (id, name)=(1, SAN (JOSE)) already exists.").detail).toBe(
      "Key (id, name)=(…) already exists."
    );
    expect(pgError("Failing row contains (1, null, SAN JOSE).")).not.toHaveProperty("detail");
  });

  it("serializes aggregated errors", () => {
    const error = new AggregateError([new Error("a"), "b"], "two failed");

    expect(serializeError(error)).toMatchObject({
      name: "AggregateError",
      message: "two failed",
      errors: [
        { name: "Error", message: "a" },
        { name: "NonError", message: "b" }
      ]
    });
  });

  it("stops at a fixed depth", () => {
    let error = new Error("root");
    for (let index = 0; index < 20; index++) error = new Error(`level ${index}`, { cause: error });

    let depth = 0;
    let current = serializeError(error);
    while (current.cause) {
      current = current.cause;
      depth++;
    }
    expect(depth).toBe(8);
  });

  it("drops the parameters of failed database queries", () => {
    const error = new Error(
      'Failed query: insert into "incidents" ("id", "address") values ($1, $2)\nparams: 1,CALLE 1'
    );

    expect(serializeError(error).message).toBe('Failed query: insert into "incidents" ("id", …');
  });

  it("drops the parameters of failed database queries from the stack", () => {
    const error = new Error(
      'Failed query: insert into "incidents" ("id", "address") values ($1, $2)\nparams: 1,CALLE 1'
    );

    const { stack } = serializeError(error);
    expect(stack).toMatch(/^Error: Failed query: insert into "incidents" \("id", …\n/);
    expect(stack).not.toContain("CALLE 1");

    error.message = "Failed query: select 1\nparams: CALLE 2";
    expect(serializeError(error)).not.toHaveProperty("stack");
  });
});
