-- BKP019.d: money that actually arrived is its own append-only row, never a
-- column on the invoice. A finalized invoice stays immutable (BKP019.0/.c2), so
-- a payment cannot be an edit of it: one row per incoming amount, and every
-- status ("offen", "teilweise bezahlt", "bezahlt") is derived from those rows.
--
-- `amount_minor` is a magnitude in minor units between 1 and the safe integer
-- bound, exactly like every other stored sum: 0 and negative payments are
-- structurally impossible, and the sign never travels with the number.
--
-- There is deliberately NO unique index: partial payments are legitimate. A
-- double POST therefore creates two rows, which is why the application sums the
-- payments under the tenant lock instead of trusting the client.
--
-- There is deliberately NO ON DELETE CASCADE, unlike `document_lines`: a final
-- document and the money recorded against it are never deleted, and a cascade
-- would turn a deleted document into a silent deletion of money. The tenant-bound
-- foreign key (default NO ACTION) refuses both a foreign document and a deletion
-- while payments exist.
--
-- `recorded_by` names the operator who entered the row; the audit entry
-- `payment.recorded` names the same actor and the payment id, so the two never
-- disagree. `recorded_at` is the instant the row was written, not the day the
-- money arrived - that is `received_on`, a plain tenant-local calendar day.
CREATE TABLE document_payments (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL,
 document_id uuid NOT NULL,
 received_on date NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
 method text NOT NULL CHECK(method IN ('bank_transfer','cash','card','other')),
 -- Trimmed before it is stored, so the printed and listed note never carries
 -- accidental whitespace; an empty note is NULL instead of an empty string.
 note text CHECK(note IS NULL OR (note = btrim(note) AND length(note) BETWEEN 1 AND 2000)),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 recorded_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES documents(tenant_id,id),
 FOREIGN KEY(tenant_id,recorded_by) REFERENCES users(tenant_id,id)
);
-- One index for the only read pattern: the payments of one document, in order.
CREATE INDEX document_payments_document ON document_payments(tenant_id,document_id,received_on,recorded_at);

-- What the database cannot express is "the target is a final invoice with an
-- open balance": that needs the corrections and the earlier payments of the same
-- document, so it stays an application rule under the tenant lock - exactly like
-- the source-kind rule of a correction (0043).
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN (
 'login.succeeded','login.denied','login.failed','logout','master_data.created','master_data.updated',
 'resource.created','resource.updated','product.created','product.updated','contact.created','contact.updated',
 'location.created','location.updated','event.created','event.updated','reservation.created','reservation.updated','reservation.expired',
 'import.created','import.updated','import.reviewed','password.changed','password.change_denied','password.reset',
 'feed.created','feed.rotated','feed.revoked',
 'document_template.created','document_template.updated',
 'document_number.updated','document_layout.updated',
 'document.created','document.updated','document.finalized',
 'document.sent','document.accepted','document.withdrawn',
 'file.uploaded','file.archived',
 'payment.recorded'
));
