-- BKP019.e: the file index filters by due day. The due day is frozen at
-- finalization (RG-07) and only ever lives on the invoice family, so the
-- matching index is the tenant, the kind and the day - exactly the shape the
-- list query sends: `tenant_id = $1 AND kind = $2 AND due_date BETWEEN $3 AND $4`.
--
-- Additive and small: no column, no backfill, no rewrite of existing rows. A
-- document without a due day is simply absent from the index, which is the same
-- truth the filter tells - an offer has no deadline to be inside a window.
CREATE INDEX documents_due_date ON documents (tenant_id, kind, due_date);
