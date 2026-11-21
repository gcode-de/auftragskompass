-- MAIL-021-B2: additive only. TLS became mandatory for accounts with
-- credentials, and "the provider would not encrypt the session, so not even the
-- password left the client" is a different operator task than a refused
-- message: it names one configuration, not one recipient. The closed outbox
-- vocabulary grows by exactly this code; every earlier code keeps its meaning.
ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_last_error_code_check;
ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_last_error_code_check
  CHECK(last_error_code IS NULL OR last_error_code IN
    ('provider_missing','provider_timeout','provider_rejected','provider_uncertain','internal',
     'provider_auth_failed','provider_recipient_rejected','encryption_unavailable',
     'provider_tls_required'));
