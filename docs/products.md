# Produktkatalog (C015)

Der angemeldete Administrationsbereich verwaltet Produktname, optionale Beschreibung,
Einheit, Preis, Preisbasis netto/brutto, Steuersatz, Sortierung und Aktiv-/Archivzustand.
Duplizieren öffnet eine neue, noch nicht gespeicherte Kopie; Änderungen am neuen
Produkt verändern das Original nicht. Archivierte Produkte behalten ihre ID.
Der echte Bestandskatalog wird im Migrationsschritt übernommen; die Installation
legt keine erfundenen verkaufbaren Positionen oder Preise an.

Preise werden ausschließlich als ganze Euro-Centwerte (`priceMinor`) gespeichert.
Die Datenbank begrenzt sie auf 0 bis 9007199254740991, damit auch die JSON-/JavaScript-
Darstellung exakt bleibt. `taxBasisPoints` enthält Hundertstel-Prozentwerte
(1900 bedeutet 19,00 %), zulässig sind 0 bis 10000. Eingaben mit Komma oder Punkt
werden ohne Gleitkomma-Multiplikation in ganze Einheiten umgerechnet; mehr als zwei
Nachkommastellen, negative und zu große Werte werden abgewiesen. Preise werden nicht
zwischen Netto und Brutto umgerechnet: `priceBasis` dokumentiert die Eingabebasis.
Dokumentpositionen und Summenberechnung folgen in den Dokument-Slices.

Migration `0008_products.sql` ergänzt den mandantengebundenen Katalog. Die geschützte
API bietet GET/POST `/api/v1/products` und PUT `/api/v1/products/:id`. Schreibfelder:
`name`, `description` (darf leer sein), `unit`, `priceMinor`, `priceBasis` (`net`/`gross`),
`taxBasisPoints`, `position` (0–9999), `state` (`active`/`inactive`/`archived`). PUT
verlangt zusätzlich die zuletzt gelesene `version`; Konflikte ergeben 409,
unbekannte/fremde IDs 404 und ungültige Eingaben 400. GET sortiert nach Position/Name.
Gleiche Namen sind für Varianten und Kopien erlaubt. Ein Löschendpunkt fehlt.

Session, Origin, CSRF-Token und eine innerhalb der Transaktion erneut geprüfte
Administratorfreigabe schützen Schreibzugriffe. Produktänderung und minimierter
Audit-Eintrag werden atomar gespeichert. Fremdschlüssel `(tenant_id,id)` ermöglichen
spätere historische Bezüge. Tests prüfen Centgenauigkeit, die sichere Ganzzahlgrenze,
Netto/Brutto, Steuergrenzen, unabhängige Kopien, Archivierung und Fehler-Rollback.
