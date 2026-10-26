-- BKP019.a: how an offer was accepted. The status axis (0039) says *that* an
-- offer was accepted; this slice records *how*: the channel of the customer's
-- yes, its own instant, an optional note and an optional own library file.
--
-- `accepted_at` is deliberately not `status_changed_at`: a withdrawal
-- overwrites the latter, and AG-08's record must stay true afterwards.
ALTER TABLE documents
  ADD COLUMN accepted_at timestamptz,
  -- AG-06: e-mail, phone, signed PDF or something else. No other value.
  ADD COLUMN acceptance_channel text,
  ADD COLUMN acceptance_note text,
  -- A reference to an own library file, never bytes at the document.
  ADD COLUMN acceptance_file_id uuid;

-- An acceptance exists only on a final offer that was actually accepted. The
-- `withdrawn` case is allowed on purpose: withdrawing keeps the record instead
-- of rewriting history, and only the domain decides who may write it.
ALTER TABLE documents ADD CONSTRAINT documents_acceptance_state_check CHECK (
  accepted_at IS NULL
  OR (
    kind = 'offer'
    AND state = 'final'
    AND offer_status IN ('accepted', 'withdrawn')
  )
);
-- Channel and instant exist together, and only the four documented channels.
ALTER TABLE documents ADD CONSTRAINT documents_acceptance_channel_check CHECK (
  (accepted_at IS NULL) = (acceptance_channel IS NULL)
  AND (
    acceptance_channel IS NULL
    OR acceptance_channel IN ('email', 'phone', 'pdf', 'other')
  )
);
-- A note belongs to an acceptance. Trimmed and bounded, like every other text
-- this tenant types (0038 display_name).
ALTER TABLE documents ADD CONSTRAINT documents_acceptance_note_check CHECK (
  acceptance_note IS NULL
  OR (
    accepted_at IS NOT NULL
    AND length(acceptance_note) BETWEEN 1 AND 2000
    AND acceptance_note = btrim(acceptance_note)
  )
);
-- A file belongs to an acceptance, and to this tenant's own library.
ALTER TABLE documents ADD CONSTRAINT documents_acceptance_file_check CHECK (
  acceptance_file_id IS NULL OR accepted_at IS NOT NULL
);
ALTER TABLE documents ADD CONSTRAINT documents_acceptance_file_fk
  FOREIGN KEY (tenant_id, acceptance_file_id)
  REFERENCES library_files (tenant_id, id);

-- No backfill: an offer accepted before this slice has no recorded channel, and
-- inventing one would be a lie. `NULL` stays the honest "no record".
