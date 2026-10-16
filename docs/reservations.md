# Reservierungsmodell

C021 speichert Dispositionszeiträume unabhängig vom Eventtermin. Dies ist die interne Grundlage für die Zuweisungsoberfläche C023. **Es gibt noch keine Reservierungs-Schreibrouten und keine Freigabe fester Buchungen.** C022 schützt feste Belegungen bereits in PostgreSQL gegen Überschneidungen; die nutzbare Buchungsverwaltung folgt mit C023.

## Einheiten, Zeiträume und Zustände

Migration `0013_reservations.sql` ergänzt `resource_units` und `reservations`. Jede physische Bestandseinheit erhält eine stabile ID und laufende Nummer pro Ressource. Bestandsverkleinerung deaktiviert unbenutzte Einheiten; Wiedervergrößerung aktiviert dieselben IDs. Archivieren oder Verkleinern wird abgewiesen, wenn betroffene Einheiten künftig noch aktiv reserviert sind. Historische Referenzen bleiben erhalten. Alle Fremdschlüssel sind mandantengebunden.

Eine Reservierung enthält Event-/Einheitsreferenz, Basiszeitraum, Herkunft `event`/`manual`, Zeitzone und Momentaufnahme der Vor-/Nachpuffer sowie den daraus berechneten effektiven UTC-Zeitraum. Bei `event` wird der Basiszeitraum aus Beginn/Ende des Events übernommen; bei `manual` muss ein vollständiger eigener Zeitraum vorliegen. Ein Event ohne Uhrzeiten kann nur mit ausdrücklich manuellem Dispositionszeitraum vorgemerkt werden. Unbekannte, gleiche oder umgekehrte Zeitpunkte werden abgewiesen.

Puffer sind Kalendertage in der Eventzeitzone und werden genau einmal auf den Basiszeitraum angewandt. Zwei Tage können beim Sommerzeitwechsel 47 beziehungsweise 49 Stunden dauern. Spätere Änderungen der Standardpuffer verschieben keine bestehende Reservierung. Intervalle sind halboffen `[Beginn, Ende)`; angrenzende Intervalle überschneiden sich nicht.

Zustände sind `hold` (Vormerkung), `booked` (fest), `blocked` (Sperre), `released` (freigegeben) und `expired` (abgelaufen). Gebucht/Blockiert haben keine Ablaufzeit. Vormerkungen dürfen zeitlich begrenzt oder als interne Option unbefristet sein; für öffentliche Anfragen folgt eine zwingende Frist mit dem Anfrageprotokoll. Wartungssperren ohne Event sind im Modell vorbereitet; deren Bedienung folgt mit C024.

## Interne Schreibregeln

`reservationRepository.createHold` benötigt Admin, aktuelle Eventversion, Einheit und eine stabile UUID `requestId`. Es erzeugt ausschließlich Vormerkungen für Anfrage/Option. Ein Wiederholungsaufruf mit gleicher UUID und gleichem Inhalt liefert denselben Datensatz, auch nach Ablauf/Freigabe; die Frist wird nicht verlängert. Andere Inhalte unter derselben UUID ergeben `idempotency_conflict`. Eine bewusste neue Vormerkung benötigt eine neue UUID. Gleiche aktive Event-/Einheitszuordnungen werden nicht doppelt angelegt.

UUIDs werden für die gemeinsame Anwendung-/SQL-Sperre kanonisch normalisiert, damit Groß-/Kleinschreibung keine getrennten Sperren erzeugt. Änderungen prüfen Rechte und Daten unter der bestehenden Mandantensperre und speichern Audit und Reservierung gemeinsam. Annullieren/Nicht verfügbar gibt zukünftige aktive Eventbelegungen frei. Vergangene und bereits beendete Zustände bleiben als Historie stehen. Der Übergang von Gebucht zurück zu Anfrage/Option führt feste zukünftige Belegungen in Vormerkungen über, sobald Buchungen mit C023 freigeschaltet werden. Terminänderungen mit verbleibender aktiver Reservierung scheitern vorerst mit 409 `reservations_need_review`; die spätere Zuweisungsoberfläche führt die gemeinsame Neuprüfung durch. Bestand/Archiv kann 409 `resource_in_use` ergeben.

## Ablauf und Worker

Belegungsabfragen ignorieren eine Vormerkung bereits bei `expires_at <= jetzt`. Ein ausgefallener Worker blockiert dadurch keine Kapazität dauerhaft. Der Worker prüft alle fünf Sekunden und schreibt abgelaufene Vormerkungen samt minimiertem Audit auf `expired`. Parallele Durchläufe werden durch Mandantensperren serialisiert; bereits bereinigte Datensätze erzeugen keine weiteren Audit-Einträge. Neue Vormerkungen bereinigen abgelaufene Vorgänger ebenfalls innerhalb ihrer Transaktion.

Der Worker führt beim Start die gemeinsamen, serialisierten Migrationen aus. Fehler bei der Bereinigung setzen seine Readiness auf nicht bereit und werden ohne Fachdaten protokolliert; der nächste Durchlauf versucht es erneut. Langsame Durchläufe überlappen sich nicht. Beim Beenden wartet der Worker auf die laufende Transaktion und schließt den Pool. Der Bereitschaftsstatus ist kein Ersatz für den separaten Überlappungsschutz C022.

## Datenbankschutz gegen Doppelbelegung

Migration `0014_reservation_overlap.sql` aktiviert die PostgreSQL-Erweiterung `btree_gist` und den GiST-Exclusion-Constraint `reservations_no_overlap`. Innerhalb eines Mandanten darf dieselbe physische Einheit keine überlappenden effektiven Zeitbereiche besitzen, wenn beide Zeilen `booked` oder `blocked` sind. Der Constraint gilt für Inserts und Updates, auch bei parallelen Transaktionen, einschließlich bereits gespeicherter Puffer und vergangener Belegungen. Angrenzende halboffene Intervalle, andere Einheiten und andere Mandanten bleiben möglich. Vormerkungen, freigegebene und abgelaufene Zeilen nehmen nicht an diesem harten Ausschluss teil.

Ein Konflikt bricht die Transaktion mit SQLSTATE `23P01` ab; bestehende Buchungen bleiben erhalten. Anwendungssperren ergänzen diese Datenbankgarantie. Die Migration wird atomar ausgeführt und scheitert bei bereits widersprüchlichen festen Daten vollständig; solche Daten müssen vor einem erneuten Lauf fachlich bereinigt werden. Der Datenbankbenutzer benötigt das Recht zum Installieren der vertrauenswürdigen Erweiterung `btree_gist` (im lokalen PostgreSQL-Image vorhanden). Bestehende Migrationen werden nicht geändert. Es entstehen keine neuen API-Routen.
