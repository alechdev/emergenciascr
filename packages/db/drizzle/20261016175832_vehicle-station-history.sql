CREATE TABLE "vehicle_station_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicleId" integer NOT NULL,
	"stationId" integer NOT NULL,
	"operationalStatus" text,
	"firstSeenAt" timestamp with time zone NOT NULL,
	"lastSeenAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_station_history" ADD CONSTRAINT "vehicle_station_history_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_station_history" ADD CONSTRAINT "vehicle_station_history_stationId_stations_id_fk" FOREIGN KEY ("stationId") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_station_history_vehicle_last_seen_idx" ON "vehicle_station_history" USING btree ("vehicleId","lastSeenAt");