-- BKP002: a valid website message becomes an Option even when no contact can
-- be resolved. Only the NOT NULL flag is relaxed; the tenant-scoped foreign
-- key, UNIQUE(tenant_id,event_id), payload/hash CHECKs and idempotency rules
-- stay unchanged, and existing rows keep their contact reference.
ALTER TABLE website_inquiries ALTER COLUMN contact_id DROP NOT NULL;
