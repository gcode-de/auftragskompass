-- MAIL-EDITOR-01a: the contact's own first name, separate from the full
-- `name`. Additive only: optional and empty by default, so every existing row
-- keeps its meaning and no first name is ever guessed from a full name.
ALTER TABLE contacts
  ADD COLUMN first_name text NOT NULL DEFAULT '' CHECK(length(first_name)<=200);
