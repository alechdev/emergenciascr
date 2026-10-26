import { describe, expect, it } from "vitest";

import { LIFECYCLE, nextPoll, resolveClosedAt } from "../src/lifecycle/index";
import { incidentState, syncState } from "./builders";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const reported = new Date("2026-10-11T02:25:19.000Z");
const at = (offsetMs: number) => new Date(reported.getTime() + offsetMs);
const ok = (isOpen: boolean) => ({ kind: "ok", isOpen, incidentTimestamp: reported }) as const;
const delay = (decision: ReturnType<typeof nextPoll>, now: Date) =>
  decision.state.nextPollAt === null ? null : decision.state.nextPollAt.getTime() - now.getTime();

describe("nextPoll: active (spec 8.2)", () => {
  it("polls open incidents every 3 minutes", () => {
    const now = at(10 * MINUTE);
    const decision = nextPoll(syncState(), ok(true), now);
    expect(decision.state).toMatchObject({ phase: "active", lastPolledAt: now });
    expect(delay(decision, now)).toBe(3 * MINUTE);
  });

  it("hourly once open for more than 72 hours", () => {
    expect(delay(nextPoll(syncState(), ok(true), at(72 * HOUR)), at(72 * HOUR))).toBe(3 * MINUTE);
    const now = at(72 * HOUR + MINUTE);
    expect(delay(nextPoll(syncState(), ok(true), now), now)).toBe(HOUR);
  });

  it("stops at 30 days with OPEN_TOO_LONG, and never schedules past the cap", () => {
    const almost = at(30 * DAY - 10 * MINUTE);
    expect(nextPoll(syncState(), ok(true), almost).state.nextPollAt).toEqual(at(30 * DAY));

    const decision = nextPoll(syncState(), ok(true), at(30 * DAY));
    expect(decision.state).toMatchObject({ phase: "done", nextPollAt: null });
    expect(decision.anomalies).toEqual([
      {
        code: "OPEN_TOO_LONG",
        entity: "incident",
        entityId: 1900001,
        details: { incidentTimestamp: reported.toISOString() }
      }
    ]);
  });
});

describe("nextPoll: settling (spec 8.2)", () => {
  it("closed: settling, every 15 minutes for the first 6 hours", () => {
    const now = at(HOUR);
    const decision = nextPoll(syncState(), ok(false), now);
    expect(decision.state).toMatchObject({ phase: "settling", upstreamClosedAt: now });
    expect(delay(decision, now)).toBe(15 * MINUTE);
  });

  it("discovered closed: the first poll starts the settling window", () => {
    const now = at(2 * DAY);
    const decision = nextPoll(syncState({ phase: "active" }), ok(false), now);
    expect(decision.state.upstreamClosedAt).toEqual(now);
    expect(decision.state.phase).toBe("settling");
  });

  it("hourly after 6 hours, capped at 72 hours, then done", () => {
    const closedAt = at(HOUR);
    const state = syncState({ phase: "settling", upstreamClosedAt: closedAt });
    const after = (ms: number) => new Date(closedAt.getTime() + ms);

    expect(
      delay(nextPoll(state, ok(false), after(6 * HOUR - MINUTE)), after(6 * HOUR - MINUTE))
    ).toBe(15 * MINUTE);
    expect(delay(nextPoll(state, ok(false), after(6 * HOUR)), after(6 * HOUR))).toBe(HOUR);
    expect(nextPoll(state, ok(false), after(71.5 * HOUR)).state.nextPollAt).toEqual(
      after(72 * HOUR)
    );

    const done = nextPoll(state, ok(false), after(72 * HOUR));
    expect(done.state).toMatchObject({
      phase: "done",
      nextPollAt: null,
      upstreamClosedAt: closedAt
    });
    expect(done.anomalies).toEqual([]);
  });

  it("reopened: back to active, settling window forgotten", () => {
    const state = syncState({ phase: "settling", upstreamClosedAt: at(HOUR) });
    const now = at(2 * HOUR);
    const decision = nextPoll(state, ok(true), now);
    expect(decision.state).toMatchObject({ phase: "active", upstreamClosedAt: null });
    expect(delay(decision, now)).toBe(3 * MINUTE);
  });
});

describe("nextPoll: failures", () => {
  it("backs off exponentially and resets on success", () => {
    let state = syncState();
    const delays: (number | null)[] = [];
    for (let i = 0; i < 9; i++) {
      const decision = nextPoll(state, { kind: "failed", reason: "boom" }, at(i * HOUR));
      delays.push(delay(decision, at(i * HOUR)));
      state = decision.state;
    }
    expect(delays.map((ms) => (ms === null ? null : ms / MINUTE))).toEqual([
      3, 6, 12, 24, 48, 60, 60, 60, 60
    ]);
    expect(state).toMatchObject({ phase: "active", consecutiveFailures: 9, lastError: "boom" });

    const recovered = nextPoll(state, ok(true), at(10 * HOUR));
    expect(recovered.state).toMatchObject({ consecutiveFailures: 0, lastError: null });
  });

  it(`gives up after ${LIFECYCLE.maxConsecutiveFailures} in a row`, () => {
    const decision = nextPoll(
      syncState({ consecutiveFailures: 9 }),
      { kind: "failed", reason: "boom" },
      at(HOUR)
    );
    expect(decision.state).toMatchObject({
      phase: "failed",
      nextPollAt: null,
      consecutiveFailures: 10
    });
  });
});

describe("nextPoll: not found (spec 8.4)", () => {
  it("not found once: kept and checked again in 3 minutes", () => {
    const now = at(HOUR);
    const decision = nextPoll(
      syncState({ lastPolledAt: at(HOUR - 3 * MINUTE) }),
      { kind: "not_found" },
      now
    );
    expect(decision.deleteIncident).toBe(false);
    expect(decision.state.notFoundCount).toBe(1);
    expect(delay(decision, now)).toBe(3 * MINUTE);
  });

  it("twice, at least 3 minutes apart: deleted", () => {
    const state = syncState({ notFoundCount: 1, lastPolledAt: at(HOUR) });
    const decision = nextPoll(state, { kind: "not_found" }, at(HOUR + 3 * MINUTE));
    expect(decision.deleteIncident).toBe(true);
    expect(decision.state).toMatchObject({ phase: "deleted", nextPollAt: null, notFoundCount: 2 });
    expect(decision.anomalies).toEqual([
      {
        code: "INCIDENT_DELETED_UPSTREAM",
        entity: "incident",
        entityId: 1900001,
        details: { notFoundPolls: 2 }
      }
    ]);
  });

  it("twice within 3 minutes: not deleted yet", () => {
    const state = syncState({ notFoundCount: 1, lastPolledAt: at(HOUR) });
    const decision = nextPoll(state, { kind: "not_found" }, at(HOUR + MINUTE));
    expect(decision.deleteIncident).toBe(false);
    expect(decision.state.notFoundCount).toBe(1);
  });

  it("any other result resets the count", () => {
    const state = syncState({ notFoundCount: 1, lastPolledAt: at(HOUR) });
    expect(nextPoll(state, ok(true), at(2 * HOUR)).state.notFoundCount).toBe(0);
    expect(nextPoll(state, { kind: "failed", reason: "x" }, at(2 * HOUR)).state.notFoundCount).toBe(
      0
    );
  });
});

describe("resolveClosedAt (spec 8.3)", () => {
  const open = { isOpen: true, closedAt: null, closedAtSource: null } as const;
  const vehicles = incidentState().vehicles.map((vehicle, index) => ({
    ...vehicle,
    departureTime: index === 0 ? at(70 * MINUTE) : null
  }));
  const polling = syncState({ lastPolledAt: at(HOUR), nextPollAt: at(HOUR + 3 * MINUTE) });

  it("open: no closing time", () => {
    expect(
      resolveClosedAt({
        previous: open,
        isOpen: true,
        controlledAt: null,
        vehicles,
        syncState: polling,
        now: at(HOUR + 3 * MINUTE)
      })
    ).toEqual({ closedAt: null, closedAtSource: null });
  });

  it("seen open, then closed: observed at that poll, and kept", () => {
    const now = at(HOUR + 3 * MINUTE);
    const observed = resolveClosedAt({
      previous: open,
      isOpen: false,
      controlledAt: null,
      vehicles,
      syncState: polling,
      now
    });
    expect(observed).toEqual({ closedAt: now, closedAtSource: "observed" });
    expect(
      resolveClosedAt({
        previous: { isOpen: false, ...observed },
        isOpen: false,
        controlledAt: null,
        vehicles,
        syncState: polling,
        now: at(5 * HOUR)
      })
    ).toEqual(observed);
  });

  it("closed when first seen: latest departure, else controlledAt, else first seen", () => {
    const input = {
      previous: null,
      isOpen: false,
      controlledAt: at(50 * MINUTE),
      vehicles,
      syncState: syncState(),
      now: at(DAY)
    };
    expect(resolveClosedAt(input)).toEqual({
      closedAt: at(70 * MINUTE),
      closedAtSource: "estimated"
    });
    expect(resolveClosedAt({ ...input, vehicles: [] })).toEqual({
      closedAt: at(50 * MINUTE),
      closedAtSource: "estimated"
    });
    expect(resolveClosedAt({ ...input, vehicles: [], controlledAt: null })).toEqual({
      closedAt: syncState().firstSeenAt,
      closedAtSource: "estimated"
    });
  });

  it("seen open, but the sync wasn't polling when it closed: estimated", () => {
    const base = { previous: open, isOpen: false, controlledAt: null, vehicles };
    expect(resolveClosedAt({ ...base, syncState: polling, now: at(4 * HOUR) }).closedAtSource).toBe(
      "estimated"
    );
    expect(
      resolveClosedAt({
        ...base,
        syncState: { ...polling, consecutiveFailures: 2 },
        now: at(HOUR + 3 * MINUTE)
      }).closedAtSource
    ).toBe("estimated");
  });
});
