import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  INTEGRATION,
  NOT_FOUND,
  type FakeAnswer,
  type FakeCall,
  type TestDatabase,
  detailsBody,
  fakeClock,
  fakeSigae,
  listBody,
  openTestDatabase,
  reportBody,
  resetDatabase,
  seedReferences,
  sigaeTime,
  station,
  unit
} from "./harness";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Upstream = { reportedAt: Date; isOpen: boolean } | "not_found";

function incidentIdOf(call: FakeCall): number {
  return Number(call.params.Id_Boleta_Incidente ?? call.params.id_boleta_incidente);
}

/** SIGAE's answer for one incident endpoint, with dispatch IDs unique to the incident. */
function answer(incidentId: number, endpoint: string, upstream: Upstream): FakeAnswer {
  if (upstream === "not_found") return { body: { ...NOT_FOUND } };
  const time = sigaeTime(upstream.reportedAt);
  const date = `${time.slice(0, 10)}T00:00:00`;
  switch (endpoint) {
    case "ObtenerBoletaIncidente":
      return {
        body: reportBody({
          Id_Boleta_Incidente: incidentId,
          Fecha: date,
          Hora_Aviso: time,
          Estado_Abierto: String(upstream.isOpen)
        })
      };
    case "ObtenerDetalleEmergencias":
      return { body: detailsBody({ fecha: date, hora_incidente: time }) };
    case "ObtenerEstacionesAtiendeIncidente":
      return { body: listBody([station({ IdBoletaEstacionAtiende: incidentId * 10 })]) };
    default:
      return {
        body: listBody([
          unit({
            IdBoletaUnidadDespachada: incidentId * 10,
            HoraDespacho: sigaeTime(new Date(upstream.reportedAt.getTime() + MINUTE))
          })
        ])
      };
  }
}

describe.skipIf(!INTEGRATION)("adopting the legacy sync's open incidents", () => {
  let db: TestDatabase;
  let modules: {
    adopt: typeof import("@/services/legacyOpen.service");
    pipeline: typeof import("@bomberoscr/sync-domain/pipeline");
    persist: typeof import("@bomberoscr/sync-domain/persist");
    schema: typeof import("@bomberoscr/db/schema");
    operators: typeof import("@bomberoscr/db/operators");
  };

  beforeAll(async () => {
    db = await openTestDatabase();
    modules = {
      adopt: await import("@/services/legacyOpen.service"),
      pipeline: await import("@bomberoscr/sync-domain/pipeline"),
      persist: await import("@bomberoscr/sync-domain/persist"),
      schema: await import("@bomberoscr/db/schema"),
      operators: await import("@bomberoscr/db/operators")
    };
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    await seedReferences(db);
  });

  it("polls each one once, closes old ones and tracks the rest", async () => {
    const { adopt, operators, persist, pipeline, schema } = modules;
    const clock = fakeClock();
    const ago = (ms: number) => new Date(clock.now().getTime() - ms);
    const upstream = new Map<number, Upstream>();
    const sigae = fakeSigae((call) => {
      const id = incidentIdOf(call);
      const state = upstream.get(id);
      return state ? answer(id, call.endpoint, state) : { body: { ...NOT_FOUND } };
    });
    const deps = {
      db,
      sigae: sigae.client,
      references: pipeline.createReferenceResolver({ db, sigae: sigae.client, now: clock.now }),
      now: clock.now
    };

    const ids = {
      closedLongAgo: 1900101,
      closedRecently: 1900102,
      stillOpen: 1900103,
      openTooLong: 1900104,
      notFound: 1900105,
      tracked: 1900106,
      closedInDatabase: 1900107
    };
    const reportedAt = new Map([
      [ids.closedLongAgo, ago(40 * DAY)],
      [ids.closedRecently, ago(DAY)],
      [ids.stillOpen, ago(2 * DAY)],
      [ids.openTooLong, ago(40 * DAY)],
      [ids.notFound, ago(40 * DAY)],
      [ids.tracked, ago(10 * DAY)],
      [ids.closedInDatabase, ago(40 * DAY)]
    ]);
    const upstreamNow = (id: number, isOpen: boolean): Upstream => ({
      reportedAt: reportedAt.get(id) as Date,
      isOpen
    });

    // What the legacy sync left: these incidents stored as SIGAE had them, none tracked but
    // one, all open but one.
    for (const id of reportedAt.keys()) {
      upstream.set(id, upstreamNow(id, id !== ids.closedInDatabase));
      expect((await pipeline.syncIncident(deps, id)).kind).toBe("ok");
    }
    await db
      .delete(schema.incidentSyncState)
      .where(operators.ne(schema.incidentSyncState.incidentId, ids.tracked));

    // SIGAE since then.
    clock.advance(MINUTE);
    upstream.set(ids.closedLongAgo, upstreamNow(ids.closedLongAgo, false));
    upstream.set(ids.closedRecently, upstreamNow(ids.closedRecently, false));
    upstream.set(ids.tracked, upstreamNow(ids.tracked, false));
    upstream.set(ids.notFound, "not_found");
    sigae.calls.length = 0;

    const result = await adopt.adoptLegacyOpenIncidents(deps, { concurrency: 2 });
    expect(result).toEqual({
      found: 5,
      closed: [ids.closedLongAgo],
      settling: [ids.closedRecently],
      active: [ids.stillOpen],
      openTooLong: [ids.openTooLong],
      skipped: [],
      notFound: [ids.notFound],
      failed: []
    });
    expect([...new Set(sigae.calls.map(incidentIdOf))].sort()).toEqual([
      ids.closedLongAgo,
      ids.closedRecently,
      ids.stillOpen,
      ids.openTooLong,
      ids.notFound
    ]);

    const phase = async (id: number) => (await persist.loadSyncState(db, id))?.phase ?? null;
    expect(await phase(ids.closedLongAgo)).toBe("done");
    expect(await phase(ids.closedRecently)).toBe("settling");
    expect(await phase(ids.stillOpen)).toBe("active");
    expect(await phase(ids.openTooLong)).toBe("done");
    expect(await phase(ids.notFound)).toBeNull();
    expect(await phase(ids.tracked)).toBe("active");

    const stored = await db
      .select({ id: schema.incidents.id, isOpen: schema.incidents.isOpen })
      .from(schema.incidents)
      .orderBy(schema.incidents.id);
    expect(stored).toEqual([
      { id: ids.closedLongAgo, isOpen: false },
      { id: ids.closedRecently, isOpen: false },
      { id: ids.stillOpen, isOpen: true },
      { id: ids.openTooLong, isOpen: true },
      // Not found once: kept as it was, and not counted toward deleting it.
      { id: ids.notFound, isOpen: true },
      // Tracked already: left to its scheduled polls.
      { id: ids.tracked, isOpen: true },
      { id: ids.closedInDatabase, isOpen: false }
    ]);

    // A second run only finds what is still untracked, and still doesn't delete it.
    clock.advance(5 * MINUTE);
    expect(await adopt.adoptLegacyOpenIncidents(deps)).toMatchObject({
      found: 1,
      notFound: [ids.notFound]
    });
    expect(await phase(ids.notFound)).toBeNull();
    const kept = await db
      .select({ id: schema.incidents.id })
      .from(schema.incidents)
      .where(operators.eq(schema.incidents.id, ids.notFound));
    expect(kept).toHaveLength(1);
  });

  it("keeps going past a poll that throws, and leaves a superseded one to the service", async () => {
    const { adopt, operators, persist, pipeline, schema } = modules;
    const clock = fakeClock();
    const ids = { throws: 1900201, superseded: 1900202, closed: 1900203 };
    const reportedAt = new Date(clock.now().getTime() - 40 * DAY);
    const upstream = new Map<number, Upstream>(
      Object.values(ids).map((id) => [id, { reportedAt, isOpen: true }])
    );
    let serviceTracks: number | null = null;
    const sigae = fakeSigae(async (call) => {
      const id = incidentIdOf(call);
      if (id === serviceTracks) {
        // The running service tracks and polls it while the adoption waits for SIGAE.
        serviceTracks = null;
        await persist.trackNewIncidents(db, [{ incidentId: id, firstSeenAt: clock.now() }]);
        await db
          .update(schema.incidentSyncState)
          .set({ lastPolledAt: new Date(clock.now().getTime() + MINUTE) })
          .where(operators.eq(schema.incidentSyncState.incidentId, id));
      }
      const state = upstream.get(id);
      return state ? answer(id, call.endpoint, state) : { body: { ...NOT_FOUND } };
    });
    const deps = {
      db,
      sigae: sigae.client,
      references: pipeline.createReferenceResolver({ db, sigae: sigae.client, now: clock.now }),
      now: clock.now
    };
    for (const id of upstream.keys()) await pipeline.syncIncident(deps, id);
    await db.delete(schema.incidentSyncState);

    clock.advance(MINUTE);
    for (const id of upstream.keys()) upstream.set(id, { reportedAt, isOpen: false });
    serviceTracks = ids.superseded;
    let calls = 0;
    const failures: [number, string][] = [];
    const result = await adopt.adoptLegacyOpenIncidents(
      {
        ...deps,
        // The first poll (the lowest ID) breaks before it reads anything.
        now: () => {
          if (calls++ === 0) throw new Error("clock broke");
          return clock.now();
        }
      },
      { concurrency: 1, onFailed: (id, reason) => failures.push([id, reason]) }
    );

    expect(result).toMatchObject({
      found: 3,
      closed: [ids.closed],
      skipped: [ids.superseded],
      failed: [ids.throws]
    });
    expect(failures).toEqual([[ids.throws, "clock broke"]]);
    expect(await persist.loadSyncState(db, ids.throws)).toBeNull();
    expect((await persist.loadSyncState(db, ids.superseded))?.phase).toBe("active");
  });
});
