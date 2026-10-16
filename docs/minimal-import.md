# Minimalimport für den Bookitup-Ausstieg (E003)

Stand: 16.10.2026. Dies ist der verbindliche Arbeitsvertrag für die nächsten
Import-Slices, keine bereits vorhandene Importfunktion und keine Freigabe echter
Daten. Der aktuelle Anwendungsstand ist C025. Private Quellbestände bleiben im
Sicherungsordner außerhalb von Git.

## Umfang und eigenständige Schritte

E003 bleibt offen, bis alle drei Schritte und der synthetische Gesamtprobelauf
bestanden sind. C074/C075 werden dadurch nicht pauschal erledigt. Jeder Schritt
wird eigenständig geprüft und gepusht; eine Migration wird mit dem sie nutzenden
Code und ihren Datenbanktests ausgeliefert.

| Slice | Lieferumfang | Abnahme |
|---|---|---|
| E003.1 | Dokumentiertes, versioniertes JSON-Eingabeformat; geschützte Vorschau mit Status-/Referenzprüfung, zukünftigen Events und Fehlerbericht | Keine Schreiboperation; unbekannte Felder/Status und kaputte Referenzen abgewiesen; Bericht ohne Inhaltsdaten in Logs; synthetische API-/Komponententests |
| E003.2 | Atomare Übernahme von Kontakten, Locations, Eventarten, Paketen und operativen Events mit mandantengebundenem Alt-ID-Mapping; gleiche Prüfungen im transaktionalen Dry-run | Wiederholung ohne Dubletten, Versionsschutz bei Delta, kompletter Rollback einschließlich Mapping/Audit, Rechte-/Tenant- und Parallelitätstests |
| E003.3 | Sichtbare Übernahmeherkunft und Ressourcen-Prüfliste für bereits zugesagte Aufträge; Mengenabgleich und privater Abschlussbericht | Keine unbemerkte Buchungszusage oder freie Kapazität bei ungeprüften Altzusagen; synthetischer Probelauf von Vorschau bis Ressourcenabgleich |

Die tatsächliche Übernahme und Bestätigung physischer Boxen folgt mit C076.
E003.3 macht offene Fälle sichtbar; es bestätigt selbst keine Ressourcen.
Produkte, Vorlagen, Originaldateien, Finanzen und Nummernkreise bleiben im
privaten Archiv beziehungsweise im geprüften externen Ersatzprozess, bis der
jeweilige Ausbau-Slice sie übernimmt. Historische Auftragsdetails gehören nicht
zum Erstimport.

## Eingabe und fachliche Grenzen

Das normalisierte Eingabeformat hat eine feste Formatversion und eine feste
Quelle `bookitup`. Es enthält getrennte Listen für Kontakte, Locations,
Eventarten, Pakete und Events. Jeder Eintrag benötigt eine stabile externe ID;
Referenzen verwenden diese Quell-IDs, nicht Namen oder erratene Ziel-UUIDs.
Externe IDs müssen pro Entitätsart eindeutig sein. Die zugehörigen Quell- und
Ziel-IDs werden später mandantengebunden gespeichert.

Die vorhandenen Bookitup-CSV-Dateien und Offline-JSON-Ansichten sind noch kein
fertiges Importformat. Eine gesonderte, privat gespeicherte Normalisierung muss
insbesondere Quell-IDs, Datumsformate, Telefonnummern, Status, Adressfelder und
Verknüpfungen klären. Die bekannte abweichende CSV-Spaltenzahl und gegebenenfalls
fehlende Quellreferenzen sind Fehlerfälle, keine Einladung zum Raten. Ein
Namensvergleich allein darf keine zwei Kontakte zusammenführen.

Die Vorschau verwendet dieselben Feldgrenzen, Datumsregeln und sicheren
Notizenregeln wie die normalen Eingabemasken. Der Mandant kommt aus der
angemeldeten Sitzung beziehungsweise lokalen Betriebskonfiguration; eine Datei
darf ihn nicht bestimmen. Unbekannte Felder, unbekannte Formatversionen,
unbekannte Status, doppelte Quell-IDs und fehlende Referenzen werden ausdrücklich
beanstandet. Ein Gesamtfehlerbericht identifiziert Abschnitt, Zeilennummer und
Fehlercode. Namen, Adressen, Nachrichtentexte und andere Eingangswerte dürfen
nicht in technische Logs oder ungefilterte Fehlermeldungen gelangen.

Für Events gilt ausschließlich der freigegebene operative Zukunftsumfang. Der
Prüfzeitpunkt und die Zeitzone kommen vom Zielsystem. Abgeschlossene vergangene
Events werden nicht übernommen. Ein noch laufender mehrtägiger Auftrag bleibt
operativ relevant, wenn sein bestätigtes Ende nach dem Prüfzeitpunkt liegt.
Events mit einem zukünftigen Datum ohne Uhrzeit bleiben als solche erkennbar;
fehlende Uhrzeiten werden nicht erfunden. Undatierte oder widersprüchliche
Auftragsdaten müssen vor einer Übernahme geklärt werden. Eventarten und
Paketwerte werden aus dem tatsächlichen Bestand übernommen; keine zusätzlichen
Namen oder Paketpreise werden erfunden.

## Zusagen und Ressourcen

Die fünf vorhandenen Status werden ausdrücklich zugeordnet: Anfrage, Option,
Gebucht, Nicht verfügbar und Annulliert. Der Originalstatus bleibt erhalten.
Eine externe Zusage beweist keine Zuordnung zu FB1, FB2 oder Zubehör. Deshalb
wird ein extern als Gebucht markierter Auftrag zunächst ausdrücklich als
**ungeprüfte Bestandszusage** erfasst. Er darf nicht durch ein stilles Umbenennen
zu einer normalen Anfrage oder Option unsichtbar werden.

Technisch muss die vorhandene Regel bestehen bleiben: Ein Event im Zielstatus
Gebucht hat mindestens eine konfliktfrei fest zugewiesene Fotobox. Entweder
bleibt die noch ungeprüfte Zusage außerhalb dieses Zielstatus sichtbar oder sie
wird bei C076 zusammen mit der ausdrücklich geprüften Ressourcenzuordnung
atomar bestätigt. Der Import darf den Datenbankschutz nicht abschalten und keine
Box anhand von Namen, Paketen oder Freitext automatisch fest zuweisen.

Vorschau und Prüfliste zeigen die Anzahl ungeprüfter Zusagen. Der interne
Kalender mit einem noch unvollständigen Bestand ist kein Nachweis freier
Kapazität. Die Produktivfreigabe bleibt gesperrt, bis jede zukünftige Zusage und
jedes benötigte Zubehör fachlich abgeglichen ist. Es entstehen keine
öffentlichen Verfügbarkeitsdaten und keine Kundennachrichten.

## Wiederholung, Delta und Rücknahme bei Fehlern

Eine erneute Verarbeitung gleicher Quell-IDs mit gleichem normalisiertem Inhalt
legt keine weiteren Datensätze an und verändert keine lokalen Bearbeitungen.
Geänderte Quelldaten benötigen eine ausdrückliche Delta-Prüfung gegen die zuletzt
übernommene Zielversion. Ist das Ziel inzwischen lokal bearbeitet worden, wird
kein stilles Überschreiben erlaubt. Fehlende Einträge in einem späteren Export
sind keine Löschanweisung.

Vorhandene Zielkontakte und Stammdaten werden als mögliche Dubletten gemeldet.
Eine Zusammenführung beziehungsweise Bindung an einen vorhandenen Datensatz
benötigt eine ausdrückliche Zuordnungsentscheidung und Versionsprüfung. Weder
ähnliche Namen noch gemeinsam verwendete E-Mail-Adressen rechtfertigen ein
ungeprüftes Zusammenführen.

Schreiben, Referenzen, Mapping und Audit gehören in eine Transaktion. Der
transaktionale Dry-run führt dieselben Regeln einschließlich verzögerter
Datenbankprüfungen aus und nimmt danach sämtliche Änderungen zurück. Die
bestehenden Fachservices für Kontakte, Events und Ressourcen bleiben für
Validierung, Rechte, Versionsschutz und Zustandsübergänge maßgeblich. Ein
Fehlschlag darf keine halben Kontakte, verwaisten Referenzen, dauerhaften
Mapping-Zeilen oder erfolgreichen Audit-Einträge zurücklassen.

Die Abschlusskontrolle vergleicht Mengen pro Entitätsart, unveränderte,
geänderte, ausgeschlossene und fehlerhafte Zeilen sowie offene Zusagen. Der
echte Bericht bleibt privat. Synthetische Fixtures müssen sichtbar fiktiv sein;
Produktionsdateien und daraus abgeleitete Beispiele gehören niemals in Git.

## Vorschau bedienen (E003.1)

Unter **Einstellungen → Bookitup-Importvorschau** normalisiertes JSON einfügen
und **Importvorschau prüfen** wählen. Die Vorschau benötigt eine gültige
Administratorsitzung. Sie zeigt Mengen, Fehler und Hinweise mit Abschnitt und
1-basierter Zeilennummer sowie den Originalstatus zukünftiger Events. Zeile 0
bezeichnet einen Fehler des Gesamtformats. Eine Änderung der Eingabe entfernt
den alten Bericht. Die Eingabe wird nicht im Browser dauerhaft gespeichert.

`POST /api/v1/imports/bookitup/preview` ist Teil der lokalen Admin-API und
benötigt dieselben Sitzungs-, Origin- und CSRF-Prüfungen wie andere Schreibmethoden.
Der Endpunkt selbst läuft in einer **nur lesenden Datenbanktransaktion**; es
entstehen keine Kontakte, Events, Reservierungen oder Audit-Einträge. Er ist auf
4 MiB JSON und 10 Vorschauen je Minute begrenzt. Jeder Abschnitt enthält höchstens
10.000 Einträge. Fehlerhafte Feldwerte werden weder zurückgespiegelt noch geloggt.
Bei syntaktisch gültigem JSON liefert der Endpunkt einen Bericht mit `valid`,
`checkedAt`, `timeZone`, `counts`, `errors`, `warnings`, `events` und
`pendingPromises`. Ein ungültiges Gesamtformat ergibt `invalid_format` mit leeren
Mengen, einzelne ungültige Zeilen ergeben `invalid_fields`. Das ist noch kein
transaktionaler Dry-run der Übernahme aus E003.2 und kein Abgleich mit vorhandenen
Zieldaten auf Dubletten.

### Eingabeformat Version 1

Alle sieben Wurzelfelder sind erforderlich; leere Listen sind erlaubt:

```json
{
  "formatVersion": 1,
  "source": "bookitup",
  "contacts": [],
  "locations": [],
  "eventTypes": [],
  "packages": [],
  "events": []
}
```

Jede Liste enthält Objekte der Form `{ "externalId": "stabile-quell-id", "data": { ... } }`.
Die Quell-ID ist 1–200 Zeichen lang, ohne führende oder nachgestellte Leerzeichen.
Alle folgenden `data`-Felder müssen vorhanden sein, auch wenn ihr Wert leer oder
`null` ist. Unbekannte Felder werden abgewiesen, Zahlen oder andere Typen nicht
stillschweigend in Text umgewandelt. Die Feldgrenzen entsprechen den normalen
Admin-Eingaben; die Vorschau verwendet deren gemeinsame Schemas.

| Abschnitt | `data`-Felder |
|---|---|
| `contacts` | `kind` (`private`/`company`), `name`, `contactPerson`, `street`, `postalCode`, `city`, `country`, `email`, `phone`, `mobile`, `state` (`active`/`archived`) |
| `locations` | `name`, `street`, `postalCode`, `city`, `country`, `state` (`active`/`archived`) |
| `eventTypes`, `packages` | `name`, `position` (Ganzzahl 0–9999), `state` (`active`/`inactive`/`archived`) |
| `events` | `name`, `status`, `eventTypeId`, `packageId`, `locationId`, `primaryContactId`, `additionalContactIds`, `source`, `eventDate`, `startsAt`, `endsAt`, `description`, `notesHtml` |

`country` ist ein zweistelliger Großbuchstabencode. Kontaktdaten und sonstige
Textfelder dürfen soweit von den normalen Masken erlaubt leer bleiben; ein Name
ist immer erforderlich. Referenzen in Events sind Quell-IDs im jeweiligen
Abschnitt oder `null`, weitere Kontakte sind eine Liste von Quell-IDs. Jede
verwendete Referenz muss auf einen aktiven, gültigen, eindeutigen Eintrag zeigen.
Der Hauptkontakt darf nicht zugleich weiterer Kontakt sein.

`status` ist exakt einer der fünf Quelltexte: `Anfrage`, `Option`, `Gebucht`,
`Nicht verfügbar`, `Annulliert`. Der Bericht zeigt den zugehörigen Zielcode und
kennzeichnet `Gebucht` als ungeprüfte Bestandszusage. Damit wird noch kein
Zielevent im Status `booked` angelegt.

`eventDate` ist `YYYY-MM-DD`. `startsAt` und `endsAt` sind beide `null` oder
vollständige ISO-Zeitpunkte mit Sekunden, explizitem Offset/`Z` und höchstens drei
Nachkommastellen. Beide Zeitpunkte benötigen ein Datum, einen positiven Zeitraum
und einen Beginn am angegebenen Tag in der Mandantenzeitzone. Undatierte Events
und widersprüchliche Daten sind Fehler. Bei Zeitpunkten entscheidet das Ende
streng nach dem Prüfzeitpunkt über den Zukunftsumfang; damit bleiben laufende
mehrtägige Events enthalten. Bei reinen Datumsangaben zählen heute und spätere
Tage in der Mandantenzeitzone. Vergangene Events zählen als ausgeschlossen,
nicht als übernommen. Unsichere Notizinhalte ergeben `notes_sanitized`; eine
Übernahme muss dieselbe Bereinigung anwenden.

Ein vollständiges, ausschließlich fiktives Beispiel wird durch
[`fictionalImport()`](../tests/fixtures/minimal-import.ts) erzeugt. Es dient den
Unit-, API- und Chromium-Tests und ist keine Vorlage aus dem echten Sicherungsbestand.

## Atomare Übernahme und Dry-run (E003.2)

`POST /api/v1/imports/bookitup` nimmt im geschützten lokalen Admin-Kontext genau
folgendes Objekt entgegen:

```json
{
  "manifest": {},
  "mode": "dry_run",
  "allowUpdates": false,
  "decisions": []
}
```

`manifest` enthält das vollständige oben beschriebene Version-1-Format; `{}` ist
hier nur ein Platzhalter. `mode` ist `dry_run` oder `apply`. Der Standardablauf
ist zuerst ein Dry-run, dann die bewusste Übernahme derselben geprüften Eingabe.
Der Endpunkt erzeugt keine Kundennachricht, Ressourcenzuweisung oder Datei.
Für echte Bestände ist weiterhin eine fachlich freigegebene Normalisierung nötig.
Die Oberfläche dieses Schritts bietet weiterhin nur die Vorschau; Bedienung der
Übernahme und Prüfliste werden mit E003.3 ergänzt.

Die Migration `0017_minimal_import.sql` ergänzt mandantengebundene
`import_records` mit Quell-ID, normalisiertem Inhalts-Hash, letzter Zielversion,
Originalstatus und typgebundenem Fremdschlüssel. Ein Ziel darf je Art nur einer
Quell-ID zugeordnet werden. Die Datenbank erzwingt Mandanten- und Eventart-/Paketbindung.
`import_promises` bewahrt ausdrücklich ungeprüfte Quellzusagen samt bereinigten
Eventdaten und Zeitzone auf. Diese Datensätze sind noch keine bestätigten Events
im operativen Kalender. Sie werden nicht als Anfrage oder Option umbenannt.
Die gesonderte, sichtbare Prüfliste und der Hinweis auf den unvollständigen
Kalender folgen mit E003.3; Produktivfreigabe bleibt bis zum Abgleich gesperrt.
C076 muss vor endgültiger Übernahme Zeitangaben und Verknüpfungen erneut durch
den Event-Fachservice prüfen und eine konfliktfreie physische Box zuweisen.

Ein Tenant-Lock serialisiert Wiederholungen und parallele Importe mit normalen
Fachänderungen. Die vorhandenen Repositories laufen innerhalb der äußeren
Importtransaktion mit Savepoints. Der Dry-run durchläuft dieselben Schreib- und
Versionsprüfungen wie `apply`, führt auch verzögerte Datenbank-Constraints aus
und rollt anschließend einschließlich Mapping, Prüfliste und Audit zurück.
Er liefert `applied: false`; eine erfolgreiche echte Übernahme `applied: true`.
`counts` enthält je Abschnitt `created`, `bound`, `updated`, `unchanged` und
`excluded`. `pendingPromises` zählt alle noch ungeprüften Zusagen des Mandanten.
`bound` zählt bewusste Zuordnungen zu vorhandenen Zielen, keine neu angelegten
Fachdatensätze. Identische Wiederholungen erzeugen weder neue Datensätze noch
weitere Audit-Einträge. Ausgelassene Exportzeilen löschen nichts.

Bei geändertem normalisiertem Inhalt ist `allowUpdates: true` erforderlich;
der Dry-run muss diese Änderung zuvor prüfen. Die gespeicherte Zielversion darf
sich seit dem letzten Import nicht verändert haben. Identische Exporte lassen
lokale Bearbeitungen unangetastet. Namens- und E-Mail-Normalisierung sowie
Notizbereinigung erfolgen vor dem Hash-Vergleich, Zeitpunkte werden in UTC
normalisiert. Eine geänderte Quellzusage, die zwischen ungeprüfter Zusage und
operativem Event wechseln würde, erfordert eine gesonderte fachliche Klärung
(`status_review_required`); der Import entscheidet das nicht automatisch.

### Dublettenentscheidungen

Unzugeordnete Kontakte werden über vorhandene E-Mail-/Telefonregeln und exakten
normalisierten Namen geprüft; Locations, Eventarten, Pakete und operative Events
über den exakten normalisierten Namen. Das sind Vorschläge, keine automatische
Zusammenführung. Ein Konflikt liefert `duplicate_review_required`, Abschnitt,
Zeile und eine Liste mandantengebundener Kandidaten-IDs mit Versionen. Es werden
keine Eingabewerte in den technischen Fehler zurückgeschrieben.

Eine nach fachlicher Prüfung bewusst eigenständige Anlage wird so angegeben:

```json
{ "section": "contacts", "externalId": "stabile-quell-id", "action": "create" }
```

Eine bestehende Entität kann mit expliziter Ziel-ID und deren aktueller Version
gebunden und anhand der geprüften Quelldaten aktualisiert werden:

```json
{
  "section": "eventTypes",
  "externalId": "stabile-quell-id",
  "action": "bind",
  "targetId": "00000000-0000-4000-8000-000000000001",
  "version": 1
}
```

Diese Objekte stehen in `decisions`. Eine Bindung benötigt zusätzlich
`allowUpdates: true`. Eine falsche Version, ein fremder Mandant, eine falsche
Stammdatenart, ein bereits anderweitig gebundenes Ziel oder eine abweichende
bestehende Quellzuordnung wird abgewiesen. Ungeprüfte Zusagen werden nicht an
bestehende Events gebunden. Auch eine bewusste Neuanlage darf bestehende
Datenbankregeln wie eindeutige Stammdatennamen nicht umgehen.

Erwartete Format-/Feldfehler ergeben HTTP 400, Dubletten-, Delta-, Versions- und
Datenbankkonflikte HTTP 409; fehlende Sitzungen oder Rechte HTTP 401/403. Der
Fehlervertrag enthält `error`, `section`, `row` und `candidates` für fachliche
Importfehler. Unerwartete Fehler verwenden den allgemeinen, inhaltsfreien
HTTP-500-Vertrag. Jeder Fehler verwirft die gesamte Übernahme.
