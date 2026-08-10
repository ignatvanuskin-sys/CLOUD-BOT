DO $migration$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'pg_trgm unavailable: catalog search keeps safe LIKE fallback without trigram index';
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_products_catalog_search_trgm
    ON products USING gin ((lower(coalesce(title,'') || ' ' || coalesce(result,'') || ' ' || coalesce(description,'') || ' ' || coalesce(stack,''))) gin_trgm_ops)
    WHERE status = 'published';
  END IF;
END
$migration$;
