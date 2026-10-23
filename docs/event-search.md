# Eventliste und gemeinsame Suche

C019 sortiert Events chronologisch nach Eventdatum, Beginn und Name, bei gleichem Namen stabil nach ID. Events ohne Datum stehen zuletzt. Die Übersicht zeigt Eventart, Hauptkontakt und den wirksamen Ort (Freitext bei `venueOverride=true`, sonst den Bestandsnamen); die konkrete Fotobox folgt mit der Ressourcenzuweisung in C023. Datum wird deutsch dargestellt. Die Hauptnavigation springt zu den bereits verfügbaren Bereichen; die globale Suche durchsucht Events und Kontakte gemeinsam.

## Filter und API

`GET /api/v1/events` unterstützt die kombinierbaren Queryparameter:

- `q`: höchstens 200 Zeichen; sucht wörtlich und ohne Beachtung der Groß-/Kleinschreibung in Eventname, Beschreibung, Quelle, zugeordneten Kontakt-/Firmennamen, Ansprechpartnern, E-Mail/Telefon und die wirksame Ortsangabe. Bei `venueOverride=true` wird ausschließlich der Freitext durchsucht, sonst ausschließlich die Bestandsanschrift; verdeckte Bestandsdaten erscheinen nicht als Treffer. HTML-Notizen sind kein Suchfeld.
- `from` und `to`: inklusive lokale Kalenderdaten in `YYYY-MM-DD`. Mehrtägige Events werden gefunden, wenn sie in den Zeitraum hineinreichen. Ein Ende genau um Mitternacht zählt zum vorherigen Tag; ein reines Datum umfasst diesen Tag.
- `status`: einer der festen Statuswerte, beispielsweise `inquiry` für neue Anfragen.
- `eventTypeId`: UUID der Eventart.
- `undated=true`: nur Events ohne Datum. Eine Kombination mit Datumsgrenzen wird mit 400 `invalid_filters` abgewiesen. Die Oberfläche setzt beim Anwenden dieser Auswahl die Datumsgrenzen zurück.

Ungültige Daten, umgekehrte Zeiträume und ungültige Parameter werden abgewiesen. Alle Filter und Suchverknüpfungen bleiben mandantengebunden. Ausgabeformat `{timeZone, events}` und Sitzungs-/CSRF-Regeln bleiben bestehen. Lesende Suchabfragen benötigen die Admin-Sitzung. SQL-Wildcards wie `%` und `_` werden als normale Zeichen gesucht.

### Zählbasis der Filterzähler (BKP007)

Die Antwort enthält zusätzlich `filterCounts: {undated, inquiries}`. Beide Werte zählen mandantensicher in derselben Lesetransaktion wie die Liste und sind additiv: bestehende Felder, Bedingungen und Statuscodes bleiben unverändert, ältere Clients ignorieren das Zusatzfeld.

| Zähler | Zählt | Zählt nicht hinein |
| --- | --- | --- |
| `undated` | alle Events mit `event_date IS NULL` | Datumsgrenzen `from`/`to`, die Sortierung „Ohne Datum“, der Statusfilter als solcher |
| `inquiries` | alle Events mit `status = 'inquiry'` | Datumsgrenzen `from`/`to`, die Sortierung „Ohne Datum“ |

Beide Zähler werden durch `q`, `status` und `eventTypeId` eingeschränkt, weil diese Filter den Bestand meint, den die jeweilige Option zeigen würde. `from`/`to` und die Sortierwahl zählen bewusst nicht hinein: sonst könnte der Zähler die undatierten Events und die Anfragen außerhalb des gewählten Zeitraums nicht nennen (H041, Beobachtung B01/A03). Der Statusfilter wirkt auch auf den Anfragenzähler; ob die Referenz das ebenso handhabt, ist nicht belegt und bleibt als offene Referenzfrage notiert.

Die Zählung ist eine einzelne SQL-Aggregation (`count(*) filter (…)`) im Repository-Pfad der Liste — keine Abfrage je Event, keine ungefilterte Gesamtliste in der Antwort, kein N+1. Der Integrationstest hält das fest, indem er die Statements eines Listenabrufs mitschreibt: genau zwei Lesezugriffe auf `events` (Liste und Aggregat).

## Navigation und Zustände

Filter werden beim Anwenden in die Browser-URL geschrieben. Neuladen, Zurück/Vorwärts und Kopieren der URL stellen sie wieder her. Eine persönliche Standardansicht ist noch nicht implementiert. Die globale Suche setzt die übrigen Eventfilter zurück und aktualisiert auch die Kontakte. Ein Sprung von einem Kontakt zu einem zugeordneten Event hebt Filter auf, damit das Ziel sichtbar wird.

Während der Abfrage gibt es eine Ladeanzeige. Leere Ergebnisse und Ladefehler werden getrennt angezeigt; bestehende Eingaben bleiben bei Fehlern erhalten. Verspätete Antworten einer älteren Suche überschreiben kein neueres Ergebnis. Der Integrationstest sucht parallel in jeweils 500 synthetischen Events und Kontakten und prüft eine API-Antwortzeit unter zwei Sekunden; der Browsertest prüft Filter, URL-Wiederherstellung und gemeinsame Suche. Das ist keine Lastmessung auf dem späteren Produktivrechner.

Die URL kann Suchbegriffe mit personenbezogenen Daten enthalten. Der vorgeschaltete TLS-Proxy darf diese nicht protokollieren. Es gibt keine öffentliche Suchschnittstelle. Die Suche nutzt die additiven Spalten aus `0032_event_venue.sql` (H034).
