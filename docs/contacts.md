# Kontakte

C016 unterstützt Privatpersonen und Firmen mit Ansprechpartner, Anschrift, E-Mail, Festnetz und Mobilnummer. Kontakte werden archiviert, nicht gelöscht; IDs bleiben für spätere Event- und E-Mail-Verknüpfungen erhalten. Diese Verknüpfungen folgen mit den entsprechenden Fachmodellen ab C018 beziehungsweise C042. Es werden keine vorhandenen Kundendaten automatisch importiert.

## API v1

Alle Routen benötigen die lokale Admin-Sitzung. Schreibende Routen verlangen zusätzlich Origin und CSRF-Token. Der Mandant kommt ausschließlich aus der Serverkonfiguration.

- `GET /api/v1/contacts?q=Suchtext`: Suche über Name, Ansprechpartner, E-Mail, Telefonnummern und Anschrift; archivierte Kontakte bleiben sichtbar. SQL-Suchzeichen werden wörtlich gesucht.
- `POST /api/v1/contacts`: Kontakt anlegen.
- `PUT /api/v1/contacts/:id`: vollständige Änderung mit aktueller `version`; veraltete Version ergibt 409, fremde oder fehlende ID 404.
- `POST /api/v1/contacts/duplicates`: `email`, `phone`, `mobile`, `country`, optional `excludeId`; schlägt Kontakte desselben Mandanten mit gleicher E-Mail oder Telefonnummer vor, einschließlich Archiv.
- `GET /api/v1/contacts/export.csv`: vollständiger Export als UTF-8-CSV mit BOM, zitierten Feldern und Schutz vor Tabellenformeln. Enthält personenbezogene Daten und ist entsprechend aufzubewahren.

Der vollständige Schreibdatensatz enthält `kind` (`private`/`company`), `name`, `contactPerson`, `street`, `postalCode`, `city`, `country` (zweistelliger Großbuchstabencode), `email`, `phone`, `mobile`, `state` (`active`/`archived`). Leere optionale Felder werden als leere Zeichenketten übertragen. Antworten enthalten zusätzlich `id` und `version`, keine Mandanten- oder Vergleichsschlüssel.

## Normalisierung und Speicherung

Migration `0009_contacts.sql` ergänzt mandantengebundene Kontakte und Suchindizes. E-Mail-Adressen werden getrimmt und kleingeschrieben. Telefonnummern behalten ihre Schreibweise; der Vergleich entfernt Trennzeichen und gleicht internationale `+`-/`00`-Schreibweise sowie die optionale `(0)` an. Für `DE` wird eine nationale führende Null zu `49`. Für andere Länder werden keine Landesvorwahlen geraten. Leere Werte erzeugen keine Dubletten; gemeinsame Firmenanschriften oder Telefonnummern verbieten keine Anlage. Dublettenvorschläge sind Hinweise und führen keine Kontakte automatisch zusammen.

Änderungen prüfen Adminrechte und Version innerhalb derselben Transaktion wie der Audit-Eintrag. Das Audit enthält nur Aktion und interne Referenzen. CSV-Downloads und Suchparameter dürfen vom vorgeschalteten TLS-Proxy nicht protokolliert werden. Direkte E-Mail-/Anruflinks öffnen das lokale Standardprogramm.
