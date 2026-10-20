# Events anlegen und bearbeiten

C018 verbindet Stammdaten mit Eventname, Status, Anfragequelle, Beschreibung, internen Notizen und einem primären Termin. Unbekannte Zuordnungen und ein noch unbekanntes Datum dürfen bei einer Anfrage offen bleiben. Ein Hauptkontakt und bis zu 50 weitere Kontakte können zugeordnet werden. Die Kontaktliste zeigt zugeordnete Events über „Events anzeigen“. „Duplizieren“ bereitet eine neue Anfrage vor und übernimmt nur aktive Zuordnungen. Das Original bleibt erhalten; erst Speichern legt die Kopie an.

## Kompaktes Anlegen (H029)

„Event anlegen“ öffnet einen modalen Dialog mit nativem Datumsfeld, Kundenauswahl und Eventart. Diese drei Angaben genügen; jede für sich bleibt optional, damit auch undatierte oder noch nicht zugeordnete Anfragen möglich sind. Uhrzeiten, Status, Paket, Ort, Quelle, weitere Kontakte, Beschreibung und interne Notizen liegen zugeklappt unter „Weitere Angaben“ und behalten ihre Eingaben beim Auf- und Zuklappen. Es gibt genau eine primäre Speichern-Aktion und ein zugänglich benanntes Schließen; Fokus startet im Datumsfeld, bleibt per Tab im Dialog, Escape und Schließen schreiben nichts und geben den Fokus an den Auslöser zurück.

Der serverseitig erforderliche Name wird deterministisch aus Eventart und Kunde gebildet („Eventart – Kunde“), bei nur einer Angabe aus dieser, sonst „Neues Event“. Das Namensfeld unter „Weitere Angaben“ zeigt den Vorschlag als Platzhalter, nicht als Wert; eine eigene Eingabe hat Vorrang. Datum ohne Zeiten sendet `eventDate` und `startsAt`/`endsAt: null`, undatiert sendet `eventDate: null`; es wird nie Mitternacht erfunden. Ein laufender POST sperrt Schließen und Escape, bis Erfolg oder Fehler feststehen; Erfolg schließt den Dialog auch bei anschließend fehlgeschlagener Listenabfrage. Ein offener, geänderter Bearbeiten-Editor sperrt Anlegen und Duplizieren, damit kein zweites Formular mit doppelten IDs entsteht und kein Entwurf still verworfen wird. Kein Autosave.

## Termin und Status

Ein Datum ohne Uhrzeiten ist erlaubt. Werden Uhrzeiten angegeben, müssen Beginn und Ende vorhanden sein, Beginn vor Ende liegen und das Eventdatum dem lokalen Beginn entsprechen. Mehrtägige Events sind möglich. Die bei Anlage aus dem Mandanten übernommene Zeitzone bleibt am Event erhalten. Zeitpunkte werden in PostgreSQL als `timestamptz` in UTC gespeichert und in der Eventzeitzone angezeigt.

Die Oberfläche fragt für Anlegen, Bearbeiten und Duplizieren nur lokales Datum und lokale Uhrzeit ab; UTC-Versätze werden nicht eingegeben. Eindeutige lokale Zeiten löst sie automatisch in der Eventzeitzone auf. Nicht existierende Uhrzeiten der Frühjahrsumstellung erklärt ein Feldfehler, gespeichert werden sie nicht. Ausschließlich für doppelte Herbst-Uhrzeiten erscheint eine Auswahl zwischen Sommerzeit und Normalzeit mit dem jeweiligen Versatz (für Europe/Berlin `+02:00` beziehungsweise `+01:00`); eindeutige Zeiten zeigen keine Auswahl. Neue oder geänderte doppelte Uhrzeiten starten ohne Vorauswahl („Bitte wählen“) und lassen sich ohne bewusste Wahl nicht speichern. Liegt ein gespeicherter Zeitpunkt in der doppelten Stunde, ist dessen Versatz vorausgewählt; ein bewusster Wechsel auf den anderen Versatz derselben Wanduhrzeit ist möglich und hat Vorrang vor dem gespeicherten Zeitpunkt. Bleibt eine Zeit beim Bearbeiten oder Duplizieren unverändert, übernimmt die Oberfläche den gespeicherten Zeitpunkt unverändert, auch innerhalb der doppelten Stunde; ein unlesbarer gespeicherter Zeitstempel blockiert eine gültige Wanduhrzeit nicht. Ändert sich Datum oder Uhrzeit, gilt allein die neue lokale Zeit; ein früherer Versatz wird nie weiterverwendet. Sekunden und Millisekunden bleiben erhalten.

## Vereinfachter Editor und Terminprüfung

Der übliche Weg zeigt nur Eventname, Status, Hauptkontakt und den Termin. Eventart, Fotobox-Paket, Veranstaltungsort, Anfragequelle, weitere Kontakte, Beschreibung und interne Notizen liegen im aufklappbaren Bereich „Weitere Angaben“, der die volle Formularbreite nutzt und seine Felder in einem responsiven Raster anordnet (auf schmalen Geräten eine Spalte). Beim Öffnen bleiben alle gespeicherten Werte und die bestehende HTML-Eingabe samt serverseitiger Bereinigung unverändert; ein Rich-Text-Editor kommt nicht hinzu. Ein gebuchtes Event behält beim Bearbeiten seinen Status, solange er nicht bewusst geändert wird.

Die Terminprüfung ist feldbezogen und erklärt jeden Fehler am betroffenen Feld: Beginn und Ende werden nur gemeinsam oder gar nicht gespeichert, das Ende muss nach dem Beginn liegen, und eine unvollständige oder umgekehrte Eingabe blockiert das Speichern, ohne den Entwurf zu verwerfen. Sobald ein Beginn vorliegt, übernimmt die Oberfläche das fachliche Eventdatum aus dessen lokalem Starttag und macht das Datumsfeld schreibgeschützt; ein Hinweis erklärt die Ableitung. Das gilt auch über Mitternacht und an Zeitumstellungstagen. Wird der Beginn wieder geleert, ist das Datum erneut eingebbar. Ohne Uhrzeiten bleibt ein Datum oder ein undatiertes Event möglich (EV-05). In der Eventakte verschwindet ein Feldfehler samt `aria-invalid`, sobald das betroffene Feld korrigiert wird, ohne dass erneut gespeichert werden muss; Partnerfehler von Beginn und Ende beziehungsweise eines eigenen Dispositionszeitraums löschen sich mit, während eine weiterhin unmögliche lokale Uhrzeit ihren aktuellen Feldfehler behält. Termin-Editor und Eventakte halten ihre Fehlerkennungen eindeutig, damit `aria-describedby` jeweils den eigenen Text nennt. Der Hauptkontakt wird in den weiteren Kontakten nicht angeboten; ein Wechsel des Hauptkontakts entfernt ihn dort. Eine gespeicherte oder duplizierte doppelte Zuordnung bereinigt die Oberfläche beim Laden beziehungsweise beim Duplizieren, sodass kein unsichtbarer Zustand das Speichern blockiert; die Serverprüfung gegen doppelte Zuordnungen bleibt unverändert.

### Speichern und Neuladen

Die Oberfläche trennt eine bestätigte Schreibantwort von einem anschließenden Ladefehler. Liefert `POST`/`PUT` eine 2xx-Antwort, meldet sie „Event gespeichert“ und schließt den Anlegeeditor, auch wenn die folgende Listenabfrage scheitert. Statt einer Fehlermeldung erscheint ein Hinweis „gespeichert, aber nicht neu geladen“ mit einer Schaltfläche zum erneuten Laden; ein zweiter Speicherversuch wird nicht nahegelegt. Nur ein tatsächlich fehlgeschlagener Schreibzugriff behält die Eingabe und verlangt eine Prüfung. Ein laufender Speichervorgang und wiederholte Klicks lösen höchstens eine Mutation aus. Die Eventakte verwirft außerdem verspätete Antworten einer älteren Ladeanfrage, damit ein neuerer Stand nicht von einem langsameren überschrieben wird. Jeder erfolgreiche Listenabruf löscht den Hinweis wieder, auch wenn er nicht über dessen Schaltfläche ausgelöst wurde. Eine bestätigte Ressourcenspeicherung meldet die Liste als stabiles Elternteil auch dann, wenn die Kindkomponente nach dem Neuladen neu eingehängt wird und eine anschließende Listenabfrage scheitert. Vor einem erneuten Laden prüft die Akte, ob ungespeicherte Status- oder Ressourceneingaben vorliegen, und verlangt dann eine ausdrückliche Bestätigung; ohne Bestätigung bleiben Entwurf und Hinweis stehen, und die danach übernommene Fassung ist die Grundlage des nächsten Schreibzugriffs. Hinweistext und Schaltfläche stehen getrennt; die Live-Region enthält nur den Text.

Anfrage, Option, Nicht verfügbar und Annulliert sind bearbeitbar. Annullieren erhält den Datensatz. **Gebucht bleibt bis C023 gesperrt**, weil ein bestätigter Auftrag eine geprüfte konkrete Ressourcenzuweisung benötigt. C018 erzeugt noch keine Reservierung und ist keine Kapazitätszusage. Suche und Filter stehen ab C019 bereit, die Eventakte mit Logbuch ab C020. Der Kalender folgt mit C025.

## Ressourcen und Termin in der Eventakte

Die Ressourcenzuweisung bearbeitet Termin, Buchungsstatus und Einheiten in einem Formular mit einer ausdrücklichen Speicherung. Der Terminblock verwendet dieselben lokalen Datum-/Uhrzeitfelder wie der Event-Editor; UTC-Versätze werden nicht eingegeben, doppelte Herbst-Uhrzeiten verlangen eine Auswahl, Frühjahrslücken erzeugen einen Feldfehler und fokussieren das betroffene Feld. Ein unveränderter gespeicherter Zeitpunkt bleibt exakt erhalten. Das Eventdatum folgt dem lokalen Starttag und ist dann schreibgeschützt; ohne Uhrzeiten bleibt ein Datum oder ein undatiertes Event möglich. Eigene Dispositionszeiträume einer Einheit liegen unter „Erweitert“, nennen ihre gespeicherten Werte bereits im zugeklappten Zustand und werden unverändert übernommen. Bei einem verborgenen fehlerhaften Feld öffnet die Prüfung den Bereich und fokussiert es, statt zu speichern. Erfolgreiches Speichern und ein anschließender Ladefehler bleiben getrennt; ungespeicherte Eingaben werden vor einem erneuten Laden nur nach Bestätigung verworfen.

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

## Eventexport (E005.3)

`GET /api/v1/events/export.csv` lädt alle Events des angemeldeten Mandanten herunter,
auch undatierte und annullierte Events. Filterparameter werden absichtlich nicht
angewendet: Dies ist ein vollständiger Bestandsexport. Die bestehende
Administratorsitzung ist erforderlich; fremde Sitzungen werden abgewiesen.
Antworten sind `text/csv; charset=utf-8`, Downloadname `events.csv`, `no-store`.

Die erste Zeile enthält Feldnamen. UTF-8-BOM und CRLF unterstützen Tabellenprogramme;
Kommas, Anführungszeichen und Zeilenumbrüche werden gemäß CSV maskiert.
Führende Formelzeichen werden mit einem Apostroph entschärft. Der Export ist
zur offenen Weiterverwendung bestimmt, nicht als verlustfreier Rückimportvertrag.

Enthalten sind ID, Version, Name, Statuscode, Datum, Beginn/Ende in UTC,
Eventzeitzone, IDs der Eventart, des Pakets, Orts und Hauptkontakts, zusätzliche
Kontakt-IDs als JSON-Array, Anfragequelle, Beschreibung und bereinigte HTML-Notizen.
Leere Einzelwerte bleiben leer. Die Referenz-IDs bleiben erhalten; zusätzlich
folgen seit E005.10 `eventTypeName`, `packageName`, `locationName`,
`primaryContactName` und `additionalContactNames`. Weitere Kontaktnamen sind ein
JSON-Array in derselben Reihenfolge wie `additionalContactIds`. Namen stammen aus
dem aktuellen, gegebenenfalls archivierten Stammdatensatz; sie sind keine
historischen Dokumentbezeichnungen. Events und Namen werden in einem gemeinsamen
schreibgeschützten Repeatable-Read-Snapshot gelesen, mit gebündelten Abfragen
statt einzelner Abfragen je Event. Die Datei enthält keine tenant_id oder
Zugangsdaten. Vollständige Stammdaten, Reservierungen,
Logbuch und Importherkunft sind nicht Bestandteil dieses Exports. Für eine
Wiederherstellung bleibt die vollständige verschlüsselte Datenbanksicherung
maßgeblich. Downloads enthalten personenbezogene Inhalte und gehören in den
privaten Sicherungsbestand außerhalb von Git.
