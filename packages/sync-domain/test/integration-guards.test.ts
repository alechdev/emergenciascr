import { afterEach, describe, expect, it } from "vitest";

import {
  TEST_DATABASE_MARKER,
  assertTestDatabaseUrl,
  assertTestRedisUrl,
  assertThrowaway,
  isThrowawayDatabase,
  redisDatabase
} from "./integration/guards";

describe("integration test guards", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("only accepts loopback servers other than the app's own", () => {
    expect(() => assertThrowaway("postgres://u@db.example.com/x_test", "V", [])).toThrow(
      /loopback, not db.example.com/
    );
    process.env.APP_URL = "redis://127.0.0.1:6379/15";
    expect(() => assertThrowaway("redis://127.0.0.1:6379/15", "V", ["APP_URL"])).toThrow(
      /must not be the same as APP_URL/
    );
    expect(() => assertThrowaway("redis://127.0.0.1:6380/15", "V", ["APP_URL"])).not.toThrow();
    expect(() => assertThrowaway("redis://127.0.0.1:6379/14", "V", ["APP_URL"])).not.toThrow();
  });

  it("recognizes the app's server however its URL is spelled", () => {
    process.env.APP_URL = "redis://localhost:6379/15";
    for (const url of [
      "redis://127.0.0.1/15",
      "redis://[::1]:6379/15",
      "redis://127.0.0.1:6379?db=15",
      "rediss://127.0.0.1:6379/15"
    ]) {
      expect(() => assertThrowaway(url, "V", ["APP_URL"]), url).toThrow(/same as APP_URL/);
    }
    process.env.APP_URL = "postgresql://app:secret@localhost/sync_test";
    for (const url of [
      "postgres://test:test@127.0.0.1:5432/sync_test",
      "postgres://test@[::1]/sync_test"
    ]) {
      expect(() => assertThrowaway(url, "V", ["APP_URL"]), url).toThrow(/same as APP_URL/);
    }
    expect(() =>
      assertThrowaway("postgres://u@127.0.0.1:55432/sync_test", "V", ["APP_URL"])
    ).not.toThrow();
    process.env.APP_URL = "postgres://sync_test@localhost";
    expect(() => assertThrowaway("postgres://u@127.0.0.1/sync_test", "V", ["APP_URL"])).toThrow(
      /same as APP_URL/
    );
    process.env.APP_URL = "not a url";
    expect(() =>
      assertThrowaway("postgres://u@127.0.0.1/sync_test", "V", ["APP_URL"])
    ).not.toThrow();
  });

  it("requires `test` in the database name", () => {
    expect(() => assertTestDatabaseUrl("postgres://u:p@127.0.0.1:5432/sync_test")).not.toThrow();
    expect(() => assertTestDatabaseUrl("postgres://u:p@localhost:5432/TEST")).not.toThrow();
    expect(() => assertTestDatabaseUrl("postgres://u:p@127.0.0.1:5432/emergencias")).toThrow(
      /`test` in its name/
    );
    expect(() => assertTestDatabaseUrl("postgres://u:p@127.0.0.1:5432")).toThrow(/`test`/);
  });

  it("requires a Redis database other than 0", () => {
    expect(() => assertTestRedisUrl("redis://127.0.0.1:6379/15")).not.toThrow();
    expect(() => assertTestRedisUrl("redis://127.0.0.1:6379?db=3")).not.toThrow();
    for (const url of [
      "redis://127.0.0.1:6379",
      "redis://127.0.0.1:6379/",
      "redis://127.0.0.1:6379/0",
      "redis://127.0.0.1:6379/0?db=15",
      "redis://127.0.0.1:6379/x"
    ]) {
      expect(() => assertTestRedisUrl(url), url).toThrow(/other than 0/);
    }
    expect(redisDatabase("redis://127.0.0.1:6379/7?db=2")).toBe(7);
  });

  it("only empties databases that are empty or marked by the harness", () => {
    expect(isThrowawayDatabase([])).toBe(true);
    expect(isThrowawayDatabase(["incidents", TEST_DATABASE_MARKER])).toBe(true);
    expect(isThrowawayDatabase(["incidents"])).toBe(false);
  });
});
