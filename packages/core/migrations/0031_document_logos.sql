ALTER TABLE document_layouts
 ADD COLUMN logo_key text CHECK(logo_key IS NULL OR logo_key ~ '^logo-[0-9a-f-]{36}\.(png|jpg)$'),
 ADD COLUMN logo_media_type text CHECK(logo_media_type IS NULL OR logo_media_type IN ('image/png','image/jpeg')),
 ADD CONSTRAINT document_layouts_logo_pair CHECK((logo_key IS NULL)=(logo_media_type IS NULL));
