ALTER TABLE document_layouts
  ADD COLUMN footer_left text NOT NULL DEFAULT '',
  ADD COLUMN footer_center text NOT NULL DEFAULT '',
  ADD COLUMN footer_right text NOT NULL DEFAULT '';
