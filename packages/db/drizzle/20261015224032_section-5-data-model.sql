-- Edited after generation: `timestamp` columns hold UTC instants, so the conversion to
-- `timestamptz` reads them as UTC (`USING ... AT TIME ZONE 'UTC'`) instead of in the session
-- timezone, which is what a bare `SET DATA TYPE` does.
CREATE TABLE "incident_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"incidentId" integer NOT NULL,
	"entity" text NOT NULL,
	"entityId" integer NOT NULL,
	"field" text NOT NULL,
	"kind" text NOT NULL,
	"oldValue" jsonb,
	"newValue" jsonb,
	"snapshotIds" bigint[] DEFAULT '{}' NOT NULL,
	"detectedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_sync_state" (
	"incidentId" integer PRIMARY KEY NOT NULL,
	"phase" text NOT NULL,
	"nextPollAt" timestamp with time zone,
	"lastPolledAt" timestamp with time zone,
	"upstreamClosedAt" timestamp with time zone,
	"consecutiveFailures" integer DEFAULT 0 NOT NULL,
	"notFoundCount" integer DEFAULT 0 NOT NULL,
	"emptyUnitsCount" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"firstSeenAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sigae_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"incidentId" integer NOT NULL,
	"endpoint" text NOT NULL,
	"codigo" text,
	"fetchedAt" timestamp with time zone NOT NULL,
	"payloadHash" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_anomalies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"incidentId" integer NOT NULL,
	"entity" text NOT NULL,
	"entityId" integer,
	"code" text NOT NULL,
	"details" jsonb,
	"detectedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ALTER COLUMN "dispatchedTime" SET DATA TYPE timestamp with time zone USING "dispatchedTime" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ALTER COLUMN "dispatchedTime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ALTER COLUMN "arrivalTime" SET DATA TYPE timestamp with time zone USING "arrivalTime" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ALTER COLUMN "arrivalTime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ALTER COLUMN "departureTime" SET DATA TYPE timestamp with time zone USING "departureTime" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ALTER COLUMN "departureTime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ALTER COLUMN "baseReturnTime" SET DATA TYPE timestamp with time zone USING "baseReturnTime" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ALTER COLUMN "baseReturnTime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ALTER COLUMN "incidentTimestamp" SET DATA TYPE timestamp with time zone USING "incidentTimestamp" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "incidents" ALTER COLUMN "modifiedAt" SET DATA TYPE timestamp with time zone USING "modifiedAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "incidents" ALTER COLUMN "modifiedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "news_articles" ALTER COLUMN "publishedAt" SET DATA TYPE timestamp with time zone USING "publishedAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ADD COLUMN "vehicleInternalNumber" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "closedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "closedAtSource" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "controlledAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "fireUnderControlAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "lossesStoppedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "allClearAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "incident_changes_incident_detected_idx" ON "incident_changes" USING btree ("incidentId","detectedAt");--> statement-breakpoint
CREATE INDEX "incident_sync_state_phase_next_poll_idx" ON "incident_sync_state" USING btree ("phase","nextPollAt");--> statement-breakpoint
CREATE INDEX "sigae_snapshots_incident_endpoint_fetched_idx" ON "sigae_snapshots" USING btree ("incidentId","endpoint","fetchedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_anomalies_incident_idx" ON "sync_anomalies" USING btree ("incidentId");--> statement-breakpoint
CREATE INDEX "sync_anomalies_code_detected_idx" ON "sync_anomalies" USING btree ("code","detectedAt");