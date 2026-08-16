DO $migration$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_products_status_updated ON products(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_license_plans_product_price ON license_plans(product_id, price_xtr);
END
$migration$;
