import { createDatabase } from "@bomberoscr/db/client";
/**
 * Exports a real incident's history from `sigae_snapshots` into a fixture scenario (spec
 * section 12, "Fixtures"):
 *
 *   CAPTURE_DATABASE_URL=postgres://… bun run --cwd packages/sync-domain capture-fixture \
 *     --incident 1512345 --scenario coordinates-moved
 *
 * Writes `fixtures/<scenario>/001.json, …`, one poll per distinct snapshot time. Then run
 * `UPDATE_FIXTURES=1 bun run --cwd packages/sync-domain test` to create `expected.json` and
 * review both before committing.
 *
 * Read-only: the session is `default_transaction_read_only`. The database comes only from
 * `CAPTURE_DATABASE_URL`, never from the app's `DRIZZLE_POSTGRES_URL`. Snapshots are already
 * redacted; they are redacted again with the current allowlists, locations are replaced with
 * synthetic values (fixtures are public) and the result is checked before anything is
 * written. Nothing from a payload is printed.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  buildFixturePolls,
  loadSnapshotRows,
  readOnlyConnection,
  writeFixturePolls
} from "./fixture-capture";

const { values: args } = parseArgs({
  options: {
    incident: { type: "string" },
    scenario: { type: "string" },
    output: { type: "string" }
  }
});

const incidentId = Number(args.incident);
if (!Number.isInteger(incidentId) || incidentId <= 0) {
  console.error("--incident <id> is required");
  process.exit(1);
}
if (!args.scenario || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.scenario)) {
  console.error("--scenario <kebab-case-name> is required");
  process.exit(1);
}
const url = process.env.CAPTURE_DATABASE_URL;
if (!url) {
  console.error("CAPTURE_DATABASE_URL is not set");
  process.exit(1);
}

const directory = join(args.output ?? join(import.meta.dirname, "..", "fixtures"), args.scenario);
const db = createDatabase(readOnlyConnection(url));

try {
  const rows = await loadSnapshotRows(db, incidentId);
  if (rows.length === 0) {
    console.error(`no snapshots for incident ${incidentId}`);
    process.exitCode = 1;
  } else {
    const polls = buildFixturePolls(incidentId, rows);
    const files = writeFixturePolls(directory, polls);
    console.log(`wrote ${files.length} polls from ${rows.length} snapshots to ${directory}`);
    console.log("next: UPDATE_FIXTURES=1 bun run --cwd packages/sync-domain test, then review");
  }
} catch (error) {
  // Messages from the checks name the poll and field, never a value.
  console.error(error instanceof Error ? error.message : "capture failed");
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
