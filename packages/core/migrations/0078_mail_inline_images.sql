-- MAIL-SIG-01b: the signature logo travels as an inline image. Additive only:
-- one new tenant-bound table, no change to any existing row or contract.
--
-- A mail freezes the logo bytes it was ordered with (key, type, size, hash),
-- exactly like a library file attachment: a later logo upload or a deleted
-- signature never changes what a queued mail carries, and every attempt
-- verifies the hash, so a replaced or corrupted store is a named failure.
CREATE TABLE mail_inline_images (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 message_id uuid NOT NULL,
 -- Server-generated; the body references it as `cid:<content_id>`.
 content_id text NOT NULL CHECK(content_id ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
 filename text NOT NULL CHECK(filename ~ '^[A-Za-z0-9._-]{1,64}$'),
 media_type text NOT NULL CHECK(media_type IN ('image/png','image/jpeg')),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 524288),
 storage_key text NOT NULL CHECK(storage_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,message_id,content_id),
 FOREIGN KEY(tenant_id,message_id) REFERENCES mail_messages(tenant_id,id) ON DELETE CASCADE
);
