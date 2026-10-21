# Wiederverwendbare Locations (Bestand)

Seit H034 ist der Ort eine optionale Freitextangabe der Buchung (`venue` +
`venueOverride`, siehe [Events](events.md)); die Oberfläche verwaltet Locations
nicht mehr und die Hauptnavigation enthält keinen Eintrag. Der alte Hash
`#locations` leitet ohne neuen History-Eintrag auf die Eventübersicht um. Tabelle,
Zeilen, IDs, Anschriften und die unten beschriebene API bleiben unverändert und
dienen weiterhin als Bestandsort bestehender Events. Es gibt keine
Rückfüllung, keine Umwandlung in Freitext und kein Löschen. Ein Bestandsort wird
nur noch angezeigt, solange `venueOverride` false ist.

C017 verwaltet Veranstaltungsorte mit Name, Straße, Postleitzahl, Ort und zweistelligem Ländercode. Name und Ländercode sind Pflichtfelder; eine noch unvollständige Anschrift ist erlaubt. Die Datenbank startet ohne erfundene Locations. Locations können ab C018 einem Event zugeordnet werden.

## API v1

- `GET /api/v1/locations?q=Suchtext`: mandantengebundene Suche in Name und Anschrift, einschließlich Archiv; Suchzeichen wie `%` werden wörtlich behandelt.
- `POST /api/v1/locations`: anlegen mit `name`, `street`, `postalCode`, `city`, `country` und `state` (`active` oder `archived`).
- `PUT /api/v1/locations/:id`: vollständiger Datensatz und aktuelle `version`; 409 bei veralteter Version, 404 bei unbekannter oder fremder ID.

Alle Routen erfordern die Admin-Sitzung, Änderungen zusätzlich Origin und CSRF-Token. Antworten enthalten `id` und `version`, keinen Mandanten. Löschen wird nicht angeboten. Archivierte Datensätze behalten ihre ID, damit bestehende Referenzen gültig bleiben.

Migration `0010_locations.sql` erstellt die mandantengebundene Tabelle. Änderungen und Audit-Eintrag sind atomar; Adminrechte und Version werden unter derselben Mandantensperre geprüft. Suchparameter und Anschriften dürfen nicht in Proxy-Logs stehen. Die Migration ergänzt ausschließlich Tabellen und erlaubte Audit-Aktionen.
