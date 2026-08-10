ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_attempted_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_external_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_last_error text;
ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS last_error text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency ON orders(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
DO $migration$
DECLARE
  current_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_definition
  FROM pg_constraint
  WHERE conrelid = 'orders'::regclass AND conname = 'orders_status_check';

  IF current_definition IS NULL THEN
    ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status in ('pending','paid','fulfilled','expired','cancelled','delivery_failed','refund_pending','refund_requested','refund_manual_review','refunded')) NOT VALID;
  ELSIF current_definition NOT LIKE '%refund_requested%' OR current_definition NOT LIKE '%refund_manual_review%' THEN
    ALTER TABLE orders DROP CONSTRAINT orders_status_check;
    ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status in ('pending','paid','fulfilled','expired','cancelled','delivery_failed','refund_pending','refund_requested','refund_manual_review','refunded')) NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE orders VALIDATE CONSTRAINT orders_status_check;
