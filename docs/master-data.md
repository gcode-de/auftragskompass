# Eventarten, Paketwerte und Status

C012 bietet im angemeldeten Administrationsbereich die Pflege von Eventarten und
Paketwerten. Bezeichnung, Sortierung (0–9999) und Zustand (aktiv/inaktiv/archiviert)
sind konfigurierbar. Archivierung erhält die ID und bestehende Verweise. Es gibt
keinen Löschendpunkt; historische Zuordnungen können später zusammengesetzte
Mandanten-/Datensatz-/Art-Fremdschlüssel nutzen. Feste Auftragsstatus sind Anfrage,
Option, Gebucht, Nicht verfügbar und Annulliert; sie sind nicht frei änderbar.

Migration `0005_master_data.sql` legt für vorhandene Mandanten die fünf vom Inhaber
bestätigten Eventarten Hochzeit, Geburtstag, Firmenfeier, Weihnachtsfeier und
sonstiges an. Neue Mandanten erhalten dieselben Startwerte beim Anlegen. Spätere
Neustarts legen keine umbenannten oder archivierten Einträge erneut an. Paketwerte
werden über die Oberfläche eingetragen. Es gibt keine Obergrenze von fünf oder sieben
Eventarten. Details der Mengenklärung stehen in [decisions.md](decisions.md).

Die geschützten Routen liegen unter `/api/v1/master-data/:kind`, mit `kind` gleich
`event_type`, `package` oder (ab C013) `cancellation_reason`:

- GET listet alle Einträge in Sortierreihenfolge, einschließlich archivierter Werte.
- POST erwartet `{ "name": "Beispiel", "position": 0, "state": "active" }` und liefert 201.
- PUT `/:id` erwartet dieselben Werte und zusätzlich `version` aus dem gelesenen
  Datensatz. Erfolg liefert 200 mit erhöhter Version. Gleichzeitige Änderungen
  führen zu 409 `conflict`; Eingaben bleiben im Formular erhalten.
- Doppelte Bezeichnungen werden pro Mandant und Art ohne Beachtung von Großschreibung
  und äußeren Leerzeichen mit 409 `name_exists` abgewiesen, ungültige Eingaben mit
  400 und fremde/unbekannte IDs mit 404. Schreiben benötigt Session, Origin und
  CSRF-Token; die aktive Administratorberechtigung wird in der Transaktion erneut geprüft.
- GET `/api/v1/statuses` liefert die fünf festen Status; Schreibendpunkte fehlen.

Änderungen und `master_data.created`/`master_data.updated` werden zusammen committed.
Der Auditdatensatz enthält nur Akteur-/Datensatz-ID und keine Bezeichnung. Die
zusätzliche `record_id` ist ein unveränderbarer Belegverweis, ohne Löschkaskade.
Scheitert das Audit, wird die Stammdatenänderung zurückgerollt.

Die Prüfung der sieben synthetischen, zusätzlich angelegten Eventarten sowie
historischer Verweise erfolgt in PostgreSQL. Chromium prüft Paket anlegen und
archivieren nach echtem Browser-Login mit synthetischem OIDC-Provider.


## Absagegründe (C013)

Die gemeinsame Stammdatenoberfläche verwaltet auch Absagegründe mit denselben
Versions-, Berechtigungs- und Archivierungsregeln. Migration `0006_cancellation_reasons.sql`
ergänzt pro vorhandenem und künftigem Mandanten acht aktive Startwerte: Termin belegt,
Zubehör nicht verfügbar, Preis, keine Rückmeldung, anderer Anbieter, Kunde abgesagt,
Termin verschoben und Sonstiges. Änderungen in der Oberfläche bleiben bei Neustarts
bestehen. Archivierte Gründe erhalten ihre ID; vorhandene Referenzen bleiben lesbar.
Die Zuordnung zu Events und die Auswertung folgen in den dafür vorgesehenen Slices.
