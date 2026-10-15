CREATE TYPE "public"."media_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TABLE "cantons" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"provinceId" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatched_stations" (
	"id" integer PRIMARY KEY NOT NULL,
	"stationId" integer NOT NULL,
	"incidentId" integer NOT NULL,
	"serviceTypeId" integer,
	"attentionOnFoot" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatched_vehicles" (
	"id" integer PRIMARY KEY NOT NULL,
	"vehicleId" integer,
	"incidentId" integer NOT NULL,
	"stationId" integer NOT NULL,
	"dispatchedTime" timestamp NOT NULL,
	"arrivalTime" timestamp NOT NULL,
	"departureTime" timestamp NOT NULL,
	"baseReturnTime" timestamp NOT NULL,
	"attentionOnFoot" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"cantonId" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_types" (
	"id" integer PRIMARY KEY NOT NULL,
	"incidentCode" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	CONSTRAINT "incident_types_incidentCode_unique" UNIQUE("incidentCode")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" integer PRIMARY KEY NOT NULL,
	"incidentCode" text,
	"specificIncidentCode" text,
	"dispatchIncidentCode" text,
	"specificDispatchIncidentCode" text,
	"EEConsecutive" text NOT NULL,
	"address" text NOT NULL,
	"responsibleStation" integer,
	"incidentTimestamp" timestamp NOT NULL,
	"importantDetails" text NOT NULL,
	"latitude" numeric NOT NULL,
	"longitude" numeric NOT NULL,
	"provinceId" integer,
	"cantonId" integer,
	"districtId" integer,
	"isOpen" boolean NOT NULL,
	"modifiedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_article_media" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"type" "media_type" NOT NULL,
	"articleId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"aiSummary" text NOT NULL,
	"incidentId" integer,
	"publishedAt" timestamp NOT NULL,
	"outletId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_outlets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"stationKey" text NOT NULL,
	"radioChannel" text,
	"latitude" numeric NOT NULL,
	"longitude" numeric NOT NULL,
	"address" text,
	"phoneNumber" text,
	"fax" text,
	"email" text,
	"isOperative" boolean
);
--> statement-breakpoint
CREATE TABLE "vehicle_disponibility" (
	"id" integer PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" integer PRIMARY KEY NOT NULL,
	"internalNumber" text NOT NULL,
	"plate" text NOT NULL,
	"stationId" integer NOT NULL,
	"descriptionType" text NOT NULL,
	"class" text NOT NULL,
	"descriptionOperationalStatus" text NOT NULL,
	CONSTRAINT "vehicles_internalNumber_unique" UNIQUE("internalNumber")
);
--> statement-breakpoint
ALTER TABLE "cantons" ADD CONSTRAINT "cantons_provinceId_provinces_id_fk" FOREIGN KEY ("provinceId") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatched_stations" ADD CONSTRAINT "dispatched_stations_stationId_stations_id_fk" FOREIGN KEY ("stationId") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatched_stations" ADD CONSTRAINT "dispatched_stations_incidentId_incidents_id_fk" FOREIGN KEY ("incidentId") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ADD CONSTRAINT "dispatched_vehicles_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ADD CONSTRAINT "dispatched_vehicles_incidentId_incidents_id_fk" FOREIGN KEY ("incidentId") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatched_vehicles" ADD CONSTRAINT "dispatched_vehicles_stationId_stations_id_fk" FOREIGN KEY ("stationId") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_cantonId_cantons_id_fk" FOREIGN KEY ("cantonId") REFERENCES "public"."cantons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_types" ADD CONSTRAINT "incident_types_parent_id_incident_types_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."incident_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_incidentCode_incident_types_incidentCode_fk" FOREIGN KEY ("incidentCode") REFERENCES "public"."incident_types"("incidentCode") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_specificIncidentCode_incident_types_incidentCode_fk" FOREIGN KEY ("specificIncidentCode") REFERENCES "public"."incident_types"("incidentCode") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_dispatchIncidentCode_incident_types_incidentCode_fk" FOREIGN KEY ("dispatchIncidentCode") REFERENCES "public"."incident_types"("incidentCode") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_specificDispatchIncidentCode_incident_types_incidentCode_fk" FOREIGN KEY ("specificDispatchIncidentCode") REFERENCES "public"."incident_types"("incidentCode") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_responsibleStation_stations_id_fk" FOREIGN KEY ("responsibleStation") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_provinceId_provinces_id_fk" FOREIGN KEY ("provinceId") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_cantonId_cantons_id_fk" FOREIGN KEY ("cantonId") REFERENCES "public"."cantons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_districtId_districts_id_fk" FOREIGN KEY ("districtId") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_article_media" ADD CONSTRAINT "news_article_media_articleId_news_articles_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."news_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_incidentId_incidents_id_fk" FOREIGN KEY ("incidentId") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_outletId_news_outlets_id_fk" FOREIGN KEY ("outletId") REFERENCES "public"."news_outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_stationId_stations_id_fk" FOREIGN KEY ("stationId") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidents_latitude_idx" ON "incidents" USING btree ("latitude");--> statement-breakpoint
CREATE INDEX "incidents_longitude_idx" ON "incidents" USING btree ("longitude");--> statement-breakpoint
CREATE INDEX "incidents_latitude_longitude_idx" ON "incidents" USING btree ("latitude","longitude");