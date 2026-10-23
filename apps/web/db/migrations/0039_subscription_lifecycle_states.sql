BEGIN;
-- The expiry sweep writes grace/lapsed; the consolidated schema's older
-- constraint rejected both states and aborted the first expiry update.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
 CHECK(status IN ('active','cancelled','expired','paused','trialing','grace','lapsed'));
COMMIT;
