# Interner Event- und Ressourcenkalender (C025)

Die Hauptnavigation öffnet den Kalender mit Tag, ISO-Woche (Montag bis Sonntag) oder Monat. Der Monat zeigt ein Raster mit sieben Spalten; die Ressourcen-Zeitleiste zeigt jede physische Box und jedes Zubehörstück in einer eigenen Zeile. Beide Ansichten sind bei wenig Bildschirmbreite horizontal scrollbar und per Tastatur erreichbar. Datum, Vor/Zurück, Heute und Aktualisieren steuern den Zeitraum.

Eventkarten enthalten Namen, Status, Eventart, Hauptkontakt, Location und zugewiesene Ressourcen. Mehrtägige Events erscheinen an allen betroffenen lokalen Tagen; das exklusive Ende um Mitternacht belegt nicht den Folgetag. Events mit Datum ohne Uhrzeiten erscheinen am entsprechenden Datum. Undatierte Events bleiben gezielt in der Eventliste auffindbar. Ein Eventlink entfernt die Eventlistenfilter und öffnet die Eventakte.

Die Zeitleiste zeigt den tatsächlichen Reservierungszeitraum einschließlich gespeicherter Puffer sowie den Basiszeitraum. Vormerkung, Gebucht, Sperre und Konflikt werden mit Text und zusätzlich mit Farben dargestellt. Überlappende Vormerkungen sind ein sichtbarer weicher Konflikt; feste Doppelbuchungen bleiben durch den Datenbankschutz verboten. Allgemein gesperrte und inaktive Einheiten werden nicht als frei dargestellt. Historische Belegungen archivierter Einheiten bleiben im betreffenden Zeitraum sichtbar. Freigegebene und abgelaufene Reservierungen zählen nicht. Zeitweise Sperren tragen ihren Grund.

`GET /api/v1/calendar` ist eine authentifizierte interne Leseroute. Optionale Queryfelder sind `date` (`YYYY-MM-DD`) und `view` (`day`, `week`, `month`; Standard Woche). Ohne Datum gilt Heute in der Mandantenzeitzone. Die Antwort enthält Zeitraum, Zeitzone, vorheriges/nächstes Bezugsdatum, lokale Tage mit exakten UTC-Grenzen, Events, Einheiten und aktive Reservierungen. Ungültige oder außerhalb der unterstützten Kalenderjahre liegende Ansichten ergeben 400 `invalid_calendar_period` beziehungsweise einen Schemafehler. Zeitumstellungstage dürfen 23 oder 25 Stunden haben. Alle Daten werden innerhalb eines konsistenten, mandantengebundenen Datenbank-Snapshots gelesen. Es gibt keine neue Migration und keinen öffentlichen Kalender-Endpunkt.

Ein Lese- oder Verbindungsfehler blendet veraltete Belegungen aus und bietet Aktualisieren an. Langsam eintreffende Antworten eines vorherigen Zeitraums überschreiben die aktuelle Auswahl nicht. Die Ansicht aktualisiert sich auf Anforderung; vor einer Zusage prüft die Buchungstransaktion die Verfügbarkeit erneut. Der Kalender ist noch keine öffentliche Freigabe und ersetzt weder die vollständige Übernahme zukünftiger Bestandsbuchungen noch deren Ressourcenabgleich. Die überprüfte Betriebs- und Migrationsfreigabe bleibt Voraussetzung für reale Nutzung.


Bei ungeprüften importierten Bestandszusagen meldet die Kalender-API zusätzlich
`pendingPromises`. Der Kalender zeigt dann eine Warnung und **Bestand ungeprüft**
statt freier Kapazität. Ein Link führt zur Import-Prüfliste. Normale
Buchungsbestätigungen bleiben bis zum gesonderten Ressourcenabgleich gesperrt;
die Prüfung erfolgt atomar mit dem Speichern. Nach einem Übernahmeversuch wird
der Kalender erneut geladen, auch wenn der Ausgang des Versuchs zunächst unklar ist.
