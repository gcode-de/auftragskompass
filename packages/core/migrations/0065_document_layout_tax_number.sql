-- DOC-RG04-01: a business names a tax number or a VAT ID on its invoices
-- (§ 14 Abs. 4 Nr. 2 UStG asks for one of the two). One optional field on the
-- layout holds whichever the business uses, printed word for word. Additive and
-- without backfill: NULL is the honest value for every layout that existed
-- before this slice, so no layout is touched and no number is invented.
--
-- This column can *show* a tax number; it never judges one - no checksum, no
-- format, no country check, exactly like the printed account of RG-07b.
ALTER TABLE document_layouts
  ADD COLUMN tax_number text;

ALTER TABLE document_layouts ADD CONSTRAINT document_layouts_tax_number_check CHECK (
  tax_number IS NULL
  OR (
    -- A USt-IdNr has at most 11 characters and a German Steuernummer 13, so 100
    -- leaves room for the label or a delimiter a business prefixes. Bounded and
    -- trimmed like every other text this tenant types, measured in characters.
    length(tax_number) BETWEEN 1 AND 100
    AND tax_number = btrim(tax_number)
    -- No control characters except the line break: the print may be multi-line,
    -- never a smuggled delimiter. The route schema and the repository repeat
    -- this rule; the database keeps it true for every path.
    AND replace(tax_number, E'\n', '') !~ '[[:cntrl:]]'
  )
);

-- No change to `audit_events_action_check`: the layout path already writes
-- `document_layout.updated`.
