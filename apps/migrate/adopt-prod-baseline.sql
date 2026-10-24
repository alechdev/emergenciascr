-- One-off, before the first `apps/migrate` run on prod (sync-v2 spec section 14). Prod was
-- built with `drizzle-kit push`, so it has no record of the baseline migration
-- (20261014181940_baseline). This fixes the drift the rehearsal found and marks the baseline
-- as applied, so `apps/migrate` applies only the migrations after it.
--
-- Check the drift first (schema-only dump of prod against a database migrated to the
-- baseline only). In the rehearsal the only drift was the news tables and the `media_type`
-- enum, which prod never had. The later migrations alter and then drop them, so they are
-- created here as the baseline has them. Prod also keeps a `drizzle.__drizzle_migrations`
-- row from an old `0000` migration (created_at 1744096674961); it is older than the
-- baseline and harmless.
--
--   psql "$PROD_URL" -v ON_ERROR_STOP=1 -f apps/migrate/adopt-prod-baseline.sql
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.incidents') IS NULL THEN
    RAISE EXCEPTION 'no incidents table: this is not the prod schema';
  END IF;
  IF to_regclass('public.incident_sync_state') IS NOT NULL THEN
    RAISE EXCEPTION 'incident_sync_state exists: migrations after the baseline already ran';
  END IF;
END $$;

-- The news objects, from the baseline.
DO $$
DECLARE
  present int := (to_regtype('public.media_type') IS NOT NULL)::int
    + (to_regclass('public.news_article_media') IS NOT NULL)::int
    + (to_regclass('public.news_articles') IS NOT NULL)::int
    + (to_regclass('public.news_outlets') IS NOT NULL)::int;
BEGIN
  IF present = 4 THEN
    RETURN;
  END IF;
  IF present > 0 THEN
    RAISE EXCEPTION 'only some news objects exist: compare them with the baseline by hand';
  END IF;

  CREATE TYPE "public"."media_type" AS ENUM('image', 'video');
  CREATE TABLE "news_article_media" (
    "id" text PRIMARY KEY NOT NULL,
    "url" text NOT NULL,
    "type" "media_type" NOT NULL,
    "articleId" text NOT NULL
  );
  CREATE TABLE "news_articles" (
    "id" text PRIMARY KEY NOT NULL,
    "title" text NOT NULL,
    "url" text NOT NULL,
    "aiSummary" text NOT NULL,
    "incidentId" integer,
    "publishedAt" timestamp NOT NULL,
    "outletId" text NOT NULL
  );
  CREATE TABLE "news_outlets" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL
  );
  ALTER TABLE "news_article_media" ADD CONSTRAINT "news_article_media_articleId_news_articles_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."news_articles"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_incidentId_incidents_id_fk" FOREIGN KEY ("incidentId") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_outletId_news_outlets_id_fk" FOREIGN KEY ("outletId") REFERENCES "public"."news_outlets"("id") ON DELETE no action ON UPDATE no action;
END $$;

-- Same table drizzle's migrator creates.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

-- hash: sha256 of the baseline file; created_at: its `when` in drizzle/meta/_journal.json.
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '27320d08e35eac1e26d6f14940b56de441bd93865b330f75d13133a65027f9ef', 1792001980581
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1792001980581
);

COMMIT;
