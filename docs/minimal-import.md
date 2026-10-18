# Minimalimport für den Bookitup-Ausstieg (E003)

Stand: 16.10.2026. Dies ist der verbindliche Arbeitsvertrag für die nächsten
Import-Slices. E003.1–E003.3 sind inzwischen implementiert und synthetisch geprüft;
dies ist keine Freigabe echter Daten. Der reguläre Anwendungsstand ist C025. Private Quellbestände bleiben im
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

Die ausdrückliche Übernahme und Bestätigung physischer Boxen ist mit
[C076](import-resource-review.md) implementiert; die echte Ressourcenabnahme bleibt offen.
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

Die [private Entwurfsvorbereitung und ihre Quellanker](bookitup-normalization.md)
beschreiben die vorgezogene Offline-Klärung E003.4. Sie führt keine Übernahme aus.

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
Die Bedienung von Übernahme und Prüfliste ist im folgenden Abschnitt E003.3 beschrieben.

Die Migration `0017_minimal_import.sql` ergänzt mandantengebundene
`import_records` mit Quell-ID, normalisiertem Inhalts-Hash, letzter Zielversion,
Originalstatus und typgebundenem Fremdschlüssel. Ein Ziel darf je Art nur einer
Quell-ID zugeordnet werden. Die Datenbank erzwingt Mandanten- und Eventart-/Paketbindung.
`import_promises` bewahrt ausdrücklich ungeprüfte Quellzusagen samt bereinigten
Eventdaten und Zeitzone auf. Diese Datensätze sind noch keine bestätigten Events
im operativen Kalender. Sie werden nicht als Anfrage oder Option umbenannt.
E003.3 zeigt die gesonderte Prüfliste und kennzeichnet den unvollständigen
Kalender; die Produktivfreigabe bleibt bis zum Abgleich gesperrt.
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


## Abgleich und Bedienfolge (E003.3)

1. Normalisierte Daten privat prüfen, einfügen und **Importvorschau prüfen** wählen.
2. **Transaktionalen Probelauf starten**. Bei Dublettenvorschlägen einen vorhandenen
   Datensatz mit angezeigter Version bewusst verknüpfen oder eine eigenständige
   Anlage wählen. Eine Verknüpfung aktualisiert dessen Felder und benötigt die
   ausdrücklich aktivierte Erlaubnis für geprüfte Aktualisierungen. Danach den
   Probelauf wiederholen; bei mehreren Konflikten einzeln fortfahren.
3. Mengen für neue, verknüpfte, aktualisierte, unveränderte und ausgeschlossene
   Einträge prüfen. Erst ein erfolgreicher Probelauf ermöglicht die ausdrückliche
   Bestätigung und anschließend **Geprüfte Daten übernehmen**. Änderungen an Daten,
   Zuordnungen, Aktualisierungserlaubnis oder eine neue Vorschau verwerfen diese
   Freigabe. Die API prüft beim Übernehmen alle Regeln erneut.
4. Unter **Importbestand und Ressourcen-Prüfliste** die zugeordneten Quell-IDs je
   Abschnitt, Originalstatus und Zielversion abgleichen. Lokal geänderte Ziele
   werden markiert. Ungeprüfte Zusagen zeigen Termin, Zeitzone, Kontakt, Ort, Paket
   und Notizen als Text. Ein fehlender Zeitpunkt oder eine fehlende Zuordnung wird
   sichtbar belassen. Noch keine Box oder Zubehörteil wird automatisch bestätigt.
5. **Privaten Prüfbericht herunterladen** erzeugt auf ausdrücklichen Klick einen
   JSON-Bericht des aktuellen Abgleichs. Er enthält personenbezogene Inhalte und
   gehört in den privaten Sicherungsbestand außerhalb von Git. Der transaktionale
   Ergebnisbericht zeigt die Änderungen der aktuellen Ausführung; der herunterladbare
   Bestandsbericht zeigt Herkunft, Mengen, aktuelle Versionen und offene Zusagen.

`GET /api/v1/imports/bookitup` liefert diesen Bestandsabgleich in einer
mandantengebundenen, nur lesenden Snapshot-Transaktion mit `checkedAt`, `counts`,
`mappings`, `promises` und `pendingPromises`. Er enthält keine Hashes oder
Zugangsdaten. Die Rechte werden auch nach der Sitzungsprüfung erneut geprüft.
Bei Ladefehlern verschwindet der alte Bericht. Nach jedem Übernahmeversuch,
auch bei unklarer Verbindung, werden Bestandsbericht und Kalender neu geladen;
so wird ein möglicherweise bereits erfolgreicher Commit nicht als leerer Bestand
weiter angezeigt. Die Eingabedaten werden bei einem Seitenneuladen bewusst nicht
wiederhergestellt.

Solange irgendeine ungeprüfte Zusage des Mandanten besteht, zeigt der Kalender
`Bestand ungeprüft` anstelle einer freien Kapazität. Die normale
Event-Verfügbarkeitsabfrage liefert für alle Einheiten
`available: false, reason: import_review_required`. Gewöhnliche
Buchungsbestätigungen beziehungsweise Änderungen im Zielstatus Gebucht werden mit
HTTP 409 `import_review_required` blockiert. Die Prüfung teilt sich den Tenant-Lock
und die Transaktion mit dem Speichern; ein paralleler Import kann die Sperre nicht
zwischen Prüfung und Commit umgehen. Die Anwendung weist auf den gesonderten
Ressourcenabgleich hin. C076 bestätigt geprüfte Bestandszusagen über einen eigenen expliziten Vorgang,
bevor reguläre Buchungen freigegeben werden.

Der synthetische Chromium-Probelauf prüft Vorschau, echten transaktionalen
Dry-run ohne verbleibende Zeilen, bewusste Übernahme, Herkunft und Mengen,
ungeprüfte Zusage, Kalenderhinweis und den heruntergeladenen privaten Bericht.
Integrationstests prüfen zusätzlich Quell-/Zielversionen, Mandantenisolation und
die Buchungssperre. Das ersetzt weder den Abgleich des echten Exports noch die
fachliche Freigabe von Boxen und Zubehör.

## Sichere Feldhinweise der Vorschau (E003.5)

Bei `invalid_fields` kann ein Fehler zusätzlich das optionale `field` enthalten.
Es benennt das erste betroffene bekannte Schemafeld der jeweiligen Zeile oder
`externalId`. Fehlende Pflichtfelder werden ebenfalls zugeordnet. Der Hinweis
wird unmittelbar nach der einzelnen Validierung ermittelt, sodass spätere Zeilen
keine Fehlerzuordnung überschreiben. Alte Antworten ohne Feld bleiben nutzbar.

Es werden ausschließlich Feldnamen aus dem kontrollierten Importschema
zurückgegeben. Unbekannte Zusatzfelder, deren Namen persönliche Daten enthalten
könnten, werden nicht übernommen; Feldwerte und rohe Validator-Meldungen bleiben
weiterhin privat. Die API-Ausgabe begrenzt `field` zusätzlich per Enum.
Die Oberfläche zeigt nur eigene deutsche Feldbezeichnungen und verwendet bei
unbekannten oder fehlenden Hinweisen die bisherige allgemeine Meldung.

Das ist ein Korrekturhinweis für den normalisierten Quelldatensatz, keine
automatische Reparatur oder Freigabe. Nach einer Korrektur erneut vorschauen;
Referenzfehler können durch einen ungültigen übergeordneten Datensatz entstehen.
