-- RES-BKP-02: Bookitup types every resource as an Item (a single thing), a Set
-- (a logical collection, e.g. a package) or a Case (things only used
-- together, e.g. a photo box with its built-in camera). Existing resources
-- are single things until someone says otherwise.
ALTER TABLE resources
  ADD COLUMN kind text NOT NULL DEFAULT 'item'
    CHECK (kind IN ('item', 'set', 'case'));
