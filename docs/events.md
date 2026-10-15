# Events anlegen und bearbeiten

C018 verbindet Stammdaten mit Eventname, Status, Anfragequelle, Beschreibung, internen Notizen und einem primären Termin. Unbekannte Zuordnungen und ein noch unbekanntes Datum dürfen bei einer Anfrage offen bleiben. Ein Hauptkontakt und bis zu 50 weitere Kontakte können zugeordnet werden. Die Kontaktliste zeigt zugeordnete Events über „Events anzeigen“. „Duplizieren“ bereitet eine neue Anfrage vor und übernimmt nur aktive Zuordnungen. Das Original bleibt erhalten; erst Speichern legt die Kopie an.

## Termin und Status

Ein Datum ohne Uhrzeiten ist erlaubt. Werden Uhrzeiten angegeben, müssen Beginn und Ende vorhanden sein, Beginn vor Ende liegen und das Eventdatum dem lokalen Beginn entsprechen. Mehrtägige Events sind möglich. Die bei Anlage aus dem Mandanten übernommene Zeitzone bleibt am Event erhalten. Zeitpunkte werden in PostgreSQL als `timestamptz` in UTC gespeichert und in der Eventzeitzone angezeigt.

Nicht existierende Uhrzeiten bei der Frühjahrsumstellung werden abgewiesen. Für doppelte Herbst-Uhrzeiten muss der UTC-Versatz ausdrücklich angegeben werden, beispielsweise `+02:00` oder `+01:00` für Europe/Berlin. Beim Bearbeiten wird der gespeicherte Versatz übernommen; eine Änderung der Uhrzeit setzt ihn auf automatisch zurück. Sekunden und Millisekunden bleiben erhalten.

Anfrage, Option, Nicht verfügbar und Annulliert sind bearbeitbar. Annullieren erhält den Datensatz. **Gebucht bleibt bis C023 gesperrt**, weil ein bestätigter Auftrag eine geprüfte konkrete Ressourcenzuweisung benötigt. C018 erzeugt noch keine Reservierung und ist keine Kapazitätszusage. Suche und Filter stehen ab C019 bereit, die Eventakte mit Logbuch ab C020. Der Kalender folgt mit C025.

## API v1

- `GET /api/v1/events`: `{timeZone, events}` mit der aktuellen Mandantenzeitzone und den Events.
- `POST /api/v1/events`: Event anlegen.
- `PUT /api/v1/events/:id`: vollständige Änderung mit aktueller `version`.
- `GET /api/v1/contacts/:id/events`: Events mit diesem Haupt- oder weiteren Kontakt im aktuellen Mandanten.

Der Schreibdatensatz enthält `name`, `status`, `eventTypeId`, `packageId`, `locationId`, `primaryContactId`, `additionalContactIds`, `source`, `eventDate`, `startsAt`, `endsAt`, `description`, `notesHtml`. Nicht bekannte Einzelzuordnungen und Termine sind `null`, weitere Kontakte ein Array. Datum ist `YYYY-MM-DD`; Zeitpunkte sind ISO-Zeitpunkte mit Zeitzonenversatz und höchstens Millisekunden. Antworten enthalten zusätzlich `id`, `version`, `timeZone`; interne Mandanten- und Vergleichsfelder werden nicht ausgegeben.

Admin-Sitzung ist erforderlich, Änderungen brauchen Origin und CSRF-Token. Fehler: 400 bei ungültigem Termin oder Zuordnungen, 403 bei fehlenden Rechten, 404 bei unbekannter/fremder Event-ID, 409 bei veralteter Version oder vorzeitiger Buchung. Such- und Fachdaten gehören nicht in Proxy-Logs.

## Referenzen, Notizen und Migration

Migration `0011_events.sql` erzwingt Mandantengrenzen in zusammengesetzten Fremdschlüsseln, die richtige Stammdatenart für Eventart und Paket, höchstens einen Hauptkontakt und gültige Zeitintervalle. Neue Zuordnungen müssen aktiv sein. Bereits zugeordnete, inzwischen archivierte Daten bleiben am bestehenden Event bearbeitbar. Gleichzeitige Änderungen werden über Mandantensperre und Versionsprüfung serialisiert; Event, Kontaktzuordnungen und Audit-Eintrag werden gemeinsam gespeichert. Die Migration erweitert die erlaubten Audit-Aktionen; fachliche Aktivitätstexte folgen in C020.

Notizen unterstützen Absätze, Umbrüche, Fett/Kursiv/Unterstreichen, Listen und Links. Im MVP werden diese im Textfeld als einfaches HTML eingegeben, die gespeicherte Vorschau wird am Event angezeigt. Der Server bereinigt sie mit `sanitize-html`: nur die genannten Elemente und Linkattribute `href`/`title`, nur HTTP(S)/mailto, keine Skripte, Bilder, Frames, Styles oder Eventhandler. Ein visueller Editor ist noch nicht Bestandteil dieses Schritts. Sicherheitsregeln folgen der [Bibliotheksdokumentation](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html); Zeitumrechnung nutzt [Temporal](https://github.com/js-temporal/temporal-polyfill).
