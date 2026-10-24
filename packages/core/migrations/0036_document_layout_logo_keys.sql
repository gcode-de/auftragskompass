ALTER TABLE document_layouts
  DROP CONSTRAINT document_layouts_logo_key_check;

ALTER TABLE document_layouts
  ADD CONSTRAINT document_layouts_logo_key_scope CHECK (
    logo_key IS NULL
    OR (
      logo_key = 'logo-' || tenant_id::text || '.png'
      AND logo_media_type = 'image/png'
    )
    OR (
      logo_key = 'logo-' || tenant_id::text || '.jpg'
      AND logo_media_type = 'image/jpeg'
    )
    OR (
      logo_key ~ (
        '^logo-' || tenant_id::text || '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]png$'
      )
      AND logo_media_type = 'image/png'
    )
    OR (
      logo_key ~ (
        '^logo-' || tenant_id::text || '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
      )
      AND logo_media_type = 'image/jpeg'
    )
  );
