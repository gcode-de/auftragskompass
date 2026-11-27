-- RES-BKP-04: Bookitup relates resources to each other and to products: a
-- resource has accessories and alternatives, a Set or a Case has components
-- (the reverse view shows "Verbaut in folgenden Cases" / "Bestandteil
-- folgender Sets"), and a resource can be linked to products. These links
-- are information for planning; they do not reserve anything by themselves.
CREATE TABLE resource_links (
  tenant_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  related_id uuid NOT NULL,
  relation text NOT NULL
    CHECK (relation IN ('accessory', 'alternative', 'component')),
  PRIMARY KEY (tenant_id, resource_id, relation, related_id),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES resources(tenant_id, id),
  FOREIGN KEY (tenant_id, related_id) REFERENCES resources(tenant_id, id),
  CHECK (resource_id <> related_id)
);
CREATE INDEX resource_links_related ON resource_links (tenant_id, related_id);

-- A product link is a hint only; deleting an unused product drops it.
CREATE TABLE resource_products (
  tenant_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  product_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, resource_id, product_id),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES resources(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id) ON DELETE CASCADE
);
