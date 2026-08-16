DO $migration$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_delivery_status_expiry ON delivery_events(status, expires_at);
END
$migration$;
