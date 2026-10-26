# Geschäftsdokumente: Entwurf, Nummer und finale PDF

Stand: 26.10.2026, einschließlich BKP015.8 und BKP017.1. Dokumente entstehen aus einer
Dokumentvorlage; Angebote können auch ohne Vorlage beginnen. Sie tragen eigene
Inhalte und Positionen als Snapshot und werden
beim Finalisieren mit einer Nummer aus dem Nummernkreis unveränderlich
festgeschrieben. Angebotsentwürfe lassen sich in der Eventakte bearbeiten und
vorab als PDF ansehen; finale PDFs können heruntergeladen werden.

## Lebenszyklus

| Zustand | Bedeutung | Nummer | Snapshot/PDF |
|---|---|---|---|
| `draft` | bearbeitbarer Snapshot, Angebot auch ohne Vorlage | keine | keiner |
| `final` | finalisiert, unveränderbar | eindeutig je Mandant | HTML-Hash und PDF-Hash gesetzt |
| `withdrawn` | zurückgezogen (Domänenregel vorhanden, noch kein Endpunkt) | keine | keiner |

Die Übersicht `GET /api/v1/documents` liefert die Kopfdaten ohne Positionen und
Hashes, neueste zuerst, und lässt sich nach Event, Art und Zustand filtern.
Ein `POST /api/v1/documents` kopiert ohne eigene `lines` die Positionen der
Vorlage. Die Dokumentart stammt immer aus der Vorlage, damit Art und Vorlage
nicht auseinanderlaufen. Summen werden aus den Bruttopreisen in Cent berechnet
und schon im Entwurf gespeichert.

`issued_at` ist das auf dem Dokument gedruckte Datum: beim Entwurf der
Anlagezeitpunkt, beim Finalisieren der Ausgabezeitpunkt. `finalized_at` ist
identisch mit dem Ausgabezeitpunkt.

## Finalisieren

### Angebot ohne Vorlage (BKP017.1)

`POST /api/v1/documents/blank-offer` verlangt `eventId` und `contactId` als
mandantengebundene UUIDs sowie die vorhandene Anmeldung/Administratorberechtigung
und CSRF-Prüfung. Es entsteht ausschließlich ein Angebotsentwurf: `templateId`
ist `null`, Betreff „Angebot“, Einleitung/Schluss leer, Gültigkeit 14 Tage,
Version 1, keine Positionen und Summen 0 Cent. Keine Geschäftsnummer, PDF oder
Vorlage wird angelegt. Der bisherige Vorlagen-POST bleibt unverändert.

In Event → Dateien → Neues Angebot steht „Ohne Vorlage“ zur Wahl, auch wenn es
keine aktive Angebotsvorlage gibt. Ein zugeordneter Kontakt bleibt Voraussetzung.
Nach der Blankoanlage öffnet der vorhandene Editor mit neutralem Leerhinweis.
Freie Positionen und Katalogprodukte verwenden denselben Ablauf wie andere
Angebotsentwürfe. Vor dem Speichern, der PDF-Vorschau und der Finalisierung muss
mindestens eine gültige Position vorhanden sein; leere Entwürfe verbrauchen keine
Nummer. Nach dem Speichern sind eigene Texte und Positionen unabhängig von
Vorlagen vorhanden. Finale PDFs bleiben unveränderbar.

Migration `0035_blank_offer_drafts` erlaubt eine nullable Vorlagenreferenz und
behält den zusammengesetzten Mandanten-Fremdschlüssel. Ein neuer Check erlaubt
Vorlagenlosigkeit nur bei Angeboten mit Event, Kontakt und vollständigen eigenen
Inhaltsfeldern. Alte vorlagengebundene Dokumente werden nicht verändert. Es gibt
keinen neuen dauerhaften Idempotenzschlüssel für die Anlage: Eine verlorene oder
unplausible Erfolgsantwort sperrt das direkte erneute Anlegen im UI. Zuerst
„Angebote aktualisieren“ und den Bestand prüfen; ein Browserneustart ersetzt
keine serverseitige Wiederholungsgarantie.

### Eigene Entwurfstexte (BKP016.1)

Neue Dokumententwürfe kopieren Betreff, Einleitungs-/Schlusstext und
`validityDays` aus der Vorlage. Spätere Vorlagenänderungen verändern diese Werte
nicht. Die Positionen sind ebenfalls eigene Kopien. Der Editor bearbeitet Texte,
Gültigkeit und Positionen von Angebotsentwürfen.

`PUT /api/v1/documents/:id/draft` ersetzt die vier Inhaltsfelder mit der
erwarteten `version`. Seit BKP016.3 kann optional `lines` mitgesendet werden:
eine vollständige Liste von 1 bis 1000 Positionen. Beschreibung, Menge, Einheit,
Bruttopreis in Cent, Steuer und Rabatt werden validiert; Produktbezüge müssen
zum Mandanten gehören (ein bestehender archivierter Bezug bleibt erlaubt). Texte,
Positionen und neu berechnete Summen werden atomar gespeichert. Ohne `lines`
bleiben Positionen und Summen unverändert, auch ihre IDs. Ein mitgesendeter
Positionssatz erhält neue Zeilen-IDs; diese sind keine externen Belegreferenzen. Veraltete Versionen liefern `409 conflict`, abgeschlossene
Dokumente `409 invalid_state`. Eine bestätigte Speicherung erhöht die Version
und erzeugt genau einen `document.updated`-Audit-Eintrag. Nach einer verlorenen
Antwort ist der Ausgang unklar: zuerst neu laden, statt den Schreibauftrag
blind zu wiederholen. Ein Retry mit alter Version kann keine zweite Änderung
auslösen. Betreff und Texte erlauben dieselben Platzhalter wie Vorlagen;
unbekannte Platzhalter sind ungültiger Inhalt.

Migration `0034_document_draft_content` ergänzt nullable Inhaltsfelder mit
Längen-/Gültigkeitsprüfung. Bereits bestehende Dokumente werden nicht mit
vermeintlich historischen Texten nachbefüllt. Bei älteren Entwürfen erklärt der
Editor die fehlende Textkopie; eine ausdrückliche Speicherung übernimmt die
angezeigte aktuelle Vorlage. Bis dahin bleibt die bisherige Vorlagenauflösung
erhalten. Bereits finale PDFs werden weder neu gerendert noch verändert.

`GET /api/v1/documents/:id/preview` rendert ausschließlich den gespeicherten
Entwurf als PDF mit der Kennzeichnung „VORSCHAU“. Es wird keine Geschäftsnummer
vergeben, kein Artefakt abgelegt und kein Geschäfts-/Auditdatensatz verändert.
Vorschau und Finalisierung verwenden dieselbe Renderaufbereitung. Bei Angeboten
ergibt sich „Gültig bis“ aus dem jeweiligen Ausgabedatum und der gespeicherten
Tageszahl in der Mandantenzeitzone. Die Vorschau ist keine Finalisierung und
kann bei späterem tatsächlichem Ausgabedatum eine andere Frist zeigen.

Eine Vorschau ungespeicherter Eingaben wird nicht behauptet: zuerst speichern,
dann die Vorschau der gespeicherten Fassung öffnen. `POST
/api/v1/documents/:id/finalize` akzeptiert zusätzlich optional die erwartete
`version`; die vorhandenen Aufrufe ohne Body bleiben kompatibel. Der neue
Editor verwendet die geprüfte Version. Authentifizierung, Mandantentrennung,
CSRF für Schreibzugriffe und unveränderliche finale Artefakte bleiben erhalten.

`POST /api/v1/documents/:id/finalize` arbeitet in genau einer
Datenbanktransaktion:

1. Zeile sperren und den Übergang `draft → final` prüfen,
2. Nummer aus dem Nummernkreis der Dokumentart ziehen,
3. Snapshot aus eigenen Entwurfstexten (bei alten Entwürfen ohne Textkopie aus
   der Vorlage), Layout, Empfänger, Event und Positionen bauen,
4. PDF über Chromium rendern,
5. PDF inhaltsadressiert ablegen,
6. Zeile auf `final` setzen und `document.finalized` protokollieren.

Scheitert Schritt 4 oder 5, wird die Transaktion zurückgerollt: Das Dokument
bleibt Entwurf, die Nummer bleibt unverbraucht. Ein zweites Finalisieren wird
mit `409 invalid_state` abgewiesen; die Zeile bleibt unverändert.

Der Empfänger kommt aus dem verknüpften Kontakt, die Platzhalter `{{contact}}`,
`{{event}}`, `{{date}}`, `{{location}}` (wirksamer Ort: Freitext bei
`venueOverride=true`, sonst der Bestandsname; ein bewusst geleerter Ort lässt den
Platzhalter leer und die Erstellung mit `invalid_content` scheitern),
`{{eventType}}`, `{{package}}`,
`{{total}}` und `{{documentLink}}` aus Kontakt, Event und Summen. Fehlt ein
verwendeter Wert, schlägt das Finalisieren mit `400 invalid_content` fehl statt
ein unvollständiges Dokument zu erzeugen.

### Produkte im Angebotsentwurf (BKP016.4)

Neben „Freie Position hinzufügen“ öffnet „Produkt hinzufügen“ eine kleine
Katalogauswahl. Erst dann wird der Katalog geladen. Die Auswahl zeigt nur aktive
Produkte und deren Preisbasis/Steuer; „Als Position hinzufügen“ hängt die
gewählte Leistung als neue Position an. Das bloße Auswählen ändert den Entwurf
noch nicht. Vorhandene Eingaben werden nicht überschrieben, auch wenn die
Katalogantwort verzögert eintrifft. Schließen der Auswahl verwirft keine Position.

Die neue Position kopiert Produkt-ID, Namen als bearbeitbare Beschreibung,
Einheit, Steuer und den exakt umgerechneten Brutto-Einzelpreis; Menge beginnt
bei 1, Rabatt bei 0. Spätere Änderungen im Katalog verändern den gespeicherten
Snapshot nicht. Abweichende Beschreibungen/Preise bleiben dokumentbezogen.
Bestehende archivierte Produktbezüge bleiben beim Speichern erhalten; archivierte
Produkte werden lediglich nicht neu angeboten. Der Katalog wird nie geschrieben.

Ladefehler bieten „Katalog erneut laden“, ein leerer Katalog wird ausdrücklich
benannt. Freie Positionen und bereits vorhandene Eingaben bleiben dabei nutzbar.
Eine unmögliche Preisumrechnung fügt nichts hinzu. Katalogmeldungen stehen
getrennt von Speicher-/Konfliktmeldungen. Speichern, Vorschau und Finalisieren
verwenden unverändert den versionsgesicherten Ablauf; ungespeicherte Positionen
müssen vor der Vorschau gespeichert werden. Keine neue API oder Migration.

## Exakte Summen (BKP016.2)

Positionspreise bleiben Bruttobeträge in Cent. Rabatt wird zuerst auf den
Bruttobetrag angewendet; anschließend wird die enthaltene Steuer je Position
ermittelt. Zwischenprodukte und Summen verwenden Ganzzahlarithmetik mit
kaufmännischer Rundung auf volle Cent. Die API liefert weiterhin sichere
Integer-Centwerte; ein Ergebnis über `Number.MAX_SAFE_INTEGER` wird abgewiesen.
Damit verlieren auch große zulässige Beträge keine Cent durch Float-Zwischenwerte.
Bereits gespeicherte Dokumente werden nicht pauschal neu berechnet: finale PDFs
bleiben unverändert, Finalisieren eines Entwurfs übernimmt die neu berechneten
Snapshot-Summen atomar in den Datensatz. Bei früheren extrem hohen Entwürfen
können deshalb gespeicherte Altsummen bis zur Finalisierung von der neu
berechneten Vorschau abweichen. Ein Netto-Eingabemodus gehört nicht dazu.

### Produktpreise ausdrücklich übernehmen (BKP015.1)

Bei der Produktauswahl für eine Dokumentvorlage bezeichnet der Positionspreis
immer Brutto. Ein Nettopreis im Produktkatalog wird dafür anhand des
Produktsteuersatzes exakt auf den Brutto-Einzelpreis umgerechnet (100,00 Euro
netto mit 19 Prozent ergeben 119,00 Euro brutto); ein Brutto-Katalogpreis bleibt
unverändert. Ein Überlauf oder ungültiger Katalogwert verhindert die Übernahme
und erhält die bisherigen Positionseingaben. Der Produktdatensatz selbst wird
nicht geschrieben. Bereits gespeicherte Vorlagenpositionen, Entwürfe und finale
Dokumente werden nicht rückwirkend geändert. Bei früher falsch übernommenen
Netto-Produkten ist eine ausdrückliche Neuübernahme/Prüfung der Vorlage nötig.
Dies ist keine Netto-Eingabefunktion für Dokumentpositionen.

## Ablage

PDFs liegen außerhalb der Datenbank unter `AK_DOCUMENT_STORAGE`
(Standard `/data`, im Container ein Volume). Der Dateiname ist der
sha256-Hash der PDF-Bytes mit Endung `.pdf`; derselbe Inhalt überschreibt sich
also nie mit einem anderen. `snapshot_hash` ist der Hash des erzeugten HTML,
`pdf_hash` benennt das Artefakt. Dateien werden mit Rechten `0600` geschrieben.

Im Testbetrieb hängt `ak-test-documents.volume` am API-Container; im
Compose-Betrieb das Volume `documents`. Das Image legt `/data` bereits dem
Containerbenutzer gehörend an, damit ein frisches Volume nicht root gehört.

## API

| Route | Erfolg | Fehler |
|---|---|---|
| `POST /api/v1/documents` | `201` Dokument | `400` ungültige Positionen/Vorlage, `404` fremde Referenz |
| `PUT /api/v1/documents/:id/draft` | `200` aktualisierter Angebotsentwurf | `400` Inhalt/Version, `404`, `409` Konflikt oder falscher Zustand |
| `GET /api/v1/documents/:id/preview` | `200` Vorschau-PDF, `no-store` | `400` fehlender Inhalt, `404`, `409` falscher Zustand, `500` Renderfehler |
| `POST /api/v1/documents/:id/finalize` | `200` finales Dokument | `400` fehlende Nummer/Inhalt, `404`, `409` bereits final, `500` Render-/Ablagefehler |
| `GET /api/v1/documents` | `200` Liste (Filter `eventId`, `kind`, `state`, optional `from`/`to`, `limit`, `offset`, `include=metadata`) | `400` ungültiger Filter |
| `GET /api/v1/documents/:id` | `200` Dokument | `404` |
| `GET /api/v1/documents/:id/pdf` | `200` PDF (`application/pdf`) | `404` Entwurf, fremdes Dokument oder fehlendes Artefakt, `500` Ablagefehler |
| `GET /api/v1/document-layout` | `200` gespeichertes Layout | `404` noch nicht eingerichtet |
| `POST /api/v1/document-layout` | `201` bewusst angelegtes Layout | `400` ungültige Felder, `409` bereits vorhanden |
| `PUT /api/v1/document-layout` | `200` aktualisiertes Layout | `400` ungültige Felder/Version, `404`, `409` Versionskonflikt |
| `POST /api/v1/document-layout/preview` | `200` fiktive PDF-Vorschau der übergebenen Werte, `no-store` | `400` ungültige Felder, `403` fehlende Berechtigung, `404` fehlendes referenziertes Logo, `500` neutrale Speicher-/Renderfehler |
| `PUT /api/v1/document-layout/logo` | `200` Layout mit Logo | `400` falsche Bildbytes, `404` kein Layout, `413` zu groß, `415` fremder Typ |

Alle Routen verlangen eine angemeldete Betreiberberechtigung, die
CSRF-Prüfung gilt wie bei den übrigen schreibenden Endpunkten. Jede Abfrage ist
auf den Mandanten begrenzt; fremde IDs liefern `404`.

## Dokumentlayout in Einstellungen (BKP018.1)

„Dokumentlayout“ zeigt den gespeicherten Absender und die vorhandene Gestaltung.
Erst „Bearbeiten“ öffnet die Felder; eine noch fehlende Konfiguration wird über
„Layout einrichten“ ausdrücklich begonnen und gespeichert. Absenderdaten werden
nicht erfunden oder automatisch aus Kunden-/Eventdaten übernommen. Schrift,
Farben und Nummernoptionen stehen in einer aufklappbaren Darstellungsgruppe.
Die Administrationsfarben bleiben davon unabhängig. Im gespeicherten Layout
öffnet „Logo hinzufügen“ beziehungsweise „Logo ersetzen“ die Dateiauswahl.
Auswahl allein schreibt nichts; erst die gesonderte Uploadaktion übernimmt
die PNG-/JPEG-Datei bis 512KiB. Während der Inhaltsbearbeitung steht kein
Logo-Upload zur Verfügung. Die PDF-Vorschau zeigt das gespeicherte Logo; eine
separate Thumbnail- oder Löschfunktion gehört nicht zu diesem Ablauf.

Upload und Layoutbearbeitung laufen nacheinander. Die bestätigte vollständige
Antwort aktualisiert die Layoutversion, eine alte Vorschau wird verworfen.
Nach Netzwerk-/Serverfehler oder unplausibler Antwort ist der Ausgang unklar:
kein automatisches Wiederholen, sondern ausdrücklich den Bestand laden. Ein
fehlgeschlagener Abgleich kann erneut geladen werden, ohne nochmals hochzuladen.
Die Auswahl bleibt bis zur bestätigten Übernahme beziehungsweise zum Abgleich
erhalten. Andere autorisierte Tabs können das Logo weiterhin ersetzen; der
bestehende Logo-Endpunkt besitzt keine erwartete Versionsnummer.

Erstanlage nutzt POST, Änderungen nutzen PUT mit der geladenen Version. Eine
bestätigte gültige Speicherantwort wird direkt übernommen. Nach Konflikt oder
unklarem Speicherausgang bleiben die Eingaben erhalten; vor erneutem Speichern
muss der tatsächliche Bestand bewusst geladen werden. Ein Ladefehler gilt nie
als Beleg für ein fehlendes Layout. Vorhandene Home-/Dateien-/Suchnavigation
berücksichtigt den registrierten Änderungszustand; dies ist keine Behauptung,
dass sämtliche historischen Navigationswege der gesamten App bereits schützen.

Die Vorschau verwendet die aktuellen, auch ungespeicherten neun Layoutfelder.
`POST /api/v1/document-layout/preview` akzeptiert keine Versions-/Tenant-/Logo-
Schlüssel aus dem Request. Die API prüft aktive Mandantenberechtigung und nutzt
nur den eigenen gespeicherten Logoverweis. Empfänger, Leistungen und Nummer
„VORSCHAU“ sind fiktiv; keine Geschäftsnummer wird vergeben, kein Layout,
Kontakt, Event, Dokument, Artefakt oder Audit geschrieben. Die Antwort ist eine
PDF mit `Cache-Control: no-store`; bei fehlenden Logobytes/Renderfehlern wird
kein vermeintlich erfolgreiches Ergebnis geliefert. Die Oberfläche bietet nach
Prüfung der PDF eine ausdrücklich angeklickte Vorschau/Download-Verknüpfung,
keine automatische Popupöffnung oder eingebetteten aktiven Fremdinhalte.
Änderungen an den Feldern machen eine ältere Vorschau ungültig; Blob-URLs werden
bei Ersatz und beim Verlassen der Komponente widerrufen.

## PDF-Seitenzählung (BKP018.0b)

Wenn `showPageNumbers` aktiv ist, erzeugt der vorhandene HTML-Renderer eine
native Chromium-`@page`-Marginbox rechts unten mit „Seite X von Y“.
`counter(page)` und `counter(pages)` folgen den tatsächlichen Druckseiten;
ein fester Absatz am Dokumentende wird nicht mehr verwendet. Bei deaktivierter
Option fehlt diese Marginbox vollständig. Farbe und Schrift folgen dem
Dokumentlayout. Der Testcontainer verwendet Chromium 156; die Referenzprüfung
mit dem echten Renderer umfasst ein- und mehrseitige synthetische Dokumente.
Bereits final gespeicherte HTML-/PDF-Artefakte werden nicht neu gerendert oder
verändert; die Korrektur gilt nur für neu erzeugte Vorschauen und Finalisierungen.
Die Browserprüfung legt PDF-Smoke-Artefakte ab, seitenweise Text-/Bildprüfung ist
zusätzliche lokale QA ohne neue Laufzeit- oder Parserabhängigkeit.

## Logo

Das Layout kann genau ein Logo tragen. `PUT /api/v1/document-layout/logo`
nimmt einen rohen PNG- oder JPEG-Körper bis 512KiB (524.288 Bytes) an. Geprüft werden
die magische Signatur gegen den angegebenen Inhaltstyp und die Größe; ein
umbenanntes Fremdformat wird abgewiesen. Die Bytes liegen außerhalb der
Datenbank. Neue Uploads erhalten einen eindeutigen Schlüssel
`logo-<mandant>-<upload-uuid>.png|jpg`; bereits gespeicherte Legacy-Schlüssel
`logo-<mandant>.png|jpg` bleiben gültig. Migration 0036 erhält diese Referenzen,
bindet neue Schlüssel an den Mandanten und prüft die Zuordnung von Endung
und Medientyp. Unter der Mandantensperre wird zuerst
die Administratorberechtigung geprüft, erst danach eine neue Datei geschrieben.
Zeiger, Version und `document_layout.updated` werden gemeinsam transaktional
geändert. Ein abgewiesener oder fehlgeschlagener Upload überschreibt niemals
die aktive Datei. Alte Logodateien bleiben für Sicherungsreferenzen und bereits
laufende Vorschauen erhalten; dieser Slice führt keine automatische Bereinigung
ein. Bei unklarem Datenbank-Commit wird eine möglicherweise unreferenzierte neue
Datei gegenüber dem Risiko bevorzugt, aktive Bytes zu löschen. Speicher und
Datenbank müssen gemeinsam gesichert werden; ein DB-Dump enthält keine Bilder.
Der bestehende Uploadvertrag bleibt unverändert: keine erwartete Version im
Request, bei konkurrierenden autorisierten Uploads gewinnt der zuletzt erfolgreich
unter der Mandantensperre gespeicherte Zeiger.
Beim Finalisieren liest der Dokumentdienst das Logo und
bettet es als `data:`-URI in das HTML ein, damit die PDF ohne externe Quelle
deterministisch bleibt. Fehlt ein eingetragenes Logo, bricht das Finalisieren
mit `missing_reference` ab, statt still ohne Marke zu drucken.

## Liste: Filter, Seiten und Metadaten (H035)

Alle neuen Parameter sind optional. Ohne `limit`, `offset` und `include` bleibt
der Abruf unverändert: ein Array mit genau den bisherigen Feldern, ohne
Pagination, neueste zuerst (`issued_at` absteigend, dann `id` absteigend).

- `from`/`to` (`YYYY-MM-DD`, echte Kalendertage) filtern `issued_at` über
  inklusive Tage in der Zeitzone des Mandanten. Die Obergrenze ist der nächste
  lokale Mitternachtspunkt (halboffen), damit 23- und 25-Stunden-Tage der
  Zeitumstellung exakt bleiben. `from > to` ist `400`.
- `limit` ist eine Obergrenze von 1 bis 100 und liefert höchstens genau so
  viele Zeilen; `offset` ist ≥ 0. Beide sind Integer, sonst `400`. Ohne `limit`
  wird nichts abgeschnitten. Eine Gesamtzahl gibt es bewusst nicht; einen
  „es gibt mehr“-Hinweis leitet die Oberfläche aus einer zusätzlich
  angeforderten Zeile ab.
- `include=metadata` ergänzt je Zeile `eventName` (mandantengebundener
  Left Join, nie eine Abfrage pro Zeile), `issuedDate` (dasselbe `issued_at`
  als lokales `YYYY-MM-DD`) und `pdfAvailable`. `pdfAvailable` folgt exakt der
  PDF-Route: `final` **und** Nummer **und** pdf-Hash. Hashes, Snapshot-HTML und
  Ablageschlüssel verlassen den Server nicht.
- `issued_at` ist das Dokumentdatum (Entwurf: Anlagezeitpunkt, final:
  Ausgabezeitpunkt). Ein `created_at` existiert nicht, deshalb filtern und
  sortieren Liste und Oberfläche ausschließlich über dieses Feld.

Die Oberfläche unter „Dateien“ (`#files`) nutzt die Projektion, zeigt Art und
Nummer, Datum, Eventname, Status und den exakten Bruttobetrag. Eine PDF wird
nur für `pdfAvailable` verlinkt und erst beim Klick geladen; Entwürfe verweisen
auf ihr Event. Es gibt keinen Upload, keinen Portalstatus und keine
Gesamtsumme. Hochgeladene Dateien, Standarddateien und Eventdateien bleiben
offen und brauchen eine eigene Ablage samt Prüfung.

## Oberfläche

In der Eventakte steht unter „Dateien“ der Abschnitt „Angebote“. Er listet
Nummer, Zustand, Datum und Bruttobetrag der Dokumente dieses Events und legt aus
einer aktiven Angebotsvorlage einen Entwurf mit dem Hauptkontakt an.
„Bearbeiten“ öffnet genau einen Angebotseditor mit Betreff, Einleitung,
Schlusstext und Gültigkeit in Tagen. Vorhandene Positionen lassen sich mit
Beschreibung, Menge, Einheit, Brutto-Einzelpreis, Steuer und Rabatt bearbeiten;
freie Positionen können ergänzt oder entfernt werden. Die vorhandenen exakten
Dezimalhelfer übersetzen Euro/Prozent in Cent/Basispunkte, ohne Float-Konvertierung.
Die angezeigte Gesamtsumme bezeichnet ausdrücklich den gespeicherten Stand;
aktuelle Eingaben werden erst beim Speichern serverseitig berechnet. Ein
Dokumentpreis verändert weder Vorlage noch Produkt. Die Auswahl neuer Positionen
aus dem Produktkatalog folgt separat. Ungespeicherte Änderungen sperren Vorschau und Finalisierung;
Versionskonflikte und unklarer Speicherstatus erhalten die Eingaben und bieten
einen ausdrücklichen Neuabruf an. Nach bestätigtem Speichern ist die Vorschau
der gespeicherten Fassung verfügbar. Finalisieren erzeugt die nummerierte PDF;
der fertige Download bleibt in der Liste. Fehlt eine aktive Vorlage oder ein
Hauptkontakt, erklärt der Abschnitt das und deaktiviert die Anlage. Nach einer
bestätigten Anlage (mit oder ohne Vorlage) bleibt der gespeicherte Entwurf in
der Liste sichtbar und bedienbar, auch wenn der anschließende Listenabruf
scheitert; das Neuladen wird dann ausdrücklich als reine GET-Wiederholung
angeboten und nie blind erneut gesendet.

## Dokumentvorlagen verwalten (BKP015.4)

Unter Einstellungen → Dokumentvorlagen erscheinen zuerst die Liste und
„Vorlage anlegen“. Anlegen, Bearbeiten und Duplizieren öffnen genau einen
Inline-Editor mit dem bestehenden Feld-/Positionsmodell. Platzhalter lassen
sich in Betreff, Einleitungstext und Schlusstext über kompakte Einfügewerkzeuge
wählen (Umschalter mit Klartextbeschreibung je Platzhalter und „Einfügen“ an
der Cursorposition; die Auswahl allein verändert weder Text noch Vorschau,
das Einfügen verwirft eine gültige Vorschau genau einmal). Passt ein
vollständiger Platzhalter nicht mehr ins Feld, wird nichts eingefügt und der
Feldwert bleibt erhalten. Die Werkzeuge werden erst im Editor angezeigt. Abbrechen und erfolgreich abgeschlossener Speicherablauf
führen zurück zur Liste. Ungespeicherte Texte und Positionen werden vor
Abbrechen oder Wechsel auf eine andere Vorlage mit einer Rückfrage geschützt;
ein bestätigter Wechsel auf dieselbe Vorlage lädt ihre gespeicherten Werte neu.
Die vorhandene appweite Dirty-Abfrage berücksichtigt diesen Entwurf. Das ist
kein neuer Schutz für bisher ungesicherte Browser-Zurück-/Schließen-Abläufe.

Der Fokus beginnt in Bezeichnung und kehrt nach Schließen zur auslösenden
Aktion zurück. Ein asynchroner Speicherabschluss übersteuert keinen inzwischen
anderweitig gesetzten Fokus. Die Liste bleibt auch bei offenem Editor erreichbar,
damit Archivierung und Bestandsabgleich offene Eingaben weiterhin erhalten.

### Liste nach Dokumentart (BKP015.6)

Vorhandene Vorlagen stehen in benannten Gruppen nach Dokumentart. Nur befüllte
Gruppen erscheinen; ein leerer Gesamtbestand zeigt einen Hinweis. Unbekannte
Dokumentarten bleiben unter „Weitere Dokumentarten“ sichtbar. Alle bisherigen
Zustände einschließlich archivierter Vorlagen bleiben enthalten. Vorlagenzeilen
richten Zusammenfassung und Aktionen aus; auf schmalen Ansichten stehen die
Aktionen umbrechend unter der Zusammenfassung. Speichern, Archivierung und
Dirtyschutz bleiben gleich. Ein Wechsel der Dokumentart erhält die Fokus-Rückkehr
zur passenden Zeile. (Das Aktionsmenü und die Vorschau sind zwischenzeitlich mit
BKP015.7/.8 umgesetzt; die Filter siehe unten.)

### Filter (BKP015.9, ausdrücklicher Nutzerwunsch)

Eine kompakte Werkzeugleiste über den Gruppen bietet Suche über den
Vorlagennamen, eine Art-Auswahl („Alle Dokumentarten“, die fünf Gruppenlabels
und „Weitere Dokumentarten“) sowie eine Zustandsauswahl
(Alle/Aktiv/Inaktiv/Archiviert). Die Gruppierung entsteht aus der gefilterten
Menge; nur befüllte Gruppen erscheinen, unbekannte Arten bleiben über ihren
Bucket auffindbar. Ohne Bestand und ohne Filtertreffer werden getrennte
Hinweise gezeigt („Keine Treffer“ bietet „Filter zurücksetzen“); der Zeilentext
nennt inaktive Vorlagen additiv. Filter bleiben über Editieren, Vorschau und
Archivieren erhalten und überleben keinen Reload. Diese Filter sind ein
ausdrücklicher Nutzerwunsch und keine belegte Bookitup-Funktion: auf der
konkret untersuchten Bookitup-Desktopansicht (B35) waren keine Filter sichtbar.

### Speicherung und Bestandsabgleich (BKP015.5b)

Eine vollständige, passende POST-/PUT-Antwort bestätigt die Speicherung unabhängig
vom anschließenden Listenabruf. Der Editor schließt und die bestätigte Zeile bleibt
sichtbar. Scheitert das Neuladen oder enthält es einen älteren, leeren oder
widersprüchlichen Stand, erklärt die Oberfläche: gespeichert, Liste noch nicht
aktuell. „Vorlagen neu laden“ wiederholt ausschließlich den GET. Eine tatsächlich
neuere Serverversion kann als aktueller Stand übernommen werden.

Bei verlorener, fehlerhafter oder unplausibler Anlageantwort bleiben Eingaben und
der eingefrorene Auftrag erhalten; weitere Änderungen sind gesperrt.
„Speicherauftrag wiederholen“ sendet dieselben JSON-Daten mit derselben UUID.
Auch eine zwischenzeitlich abgelaufene Anmeldung oder fehlende Berechtigung darf
diese Vorgangsidentität nicht löschen. Es erfolgt keine automatische Wiederholung.
Die Zuordnung beruht auf der serverseitigen Quittung aus BKP015.5a und nicht auf
einer ähnlich aussehenden Listenzeile. Dieser Wiederholungszustand lebt im geöffneten
Editor; eine browserübergreifende Entwurfs-/Vorgangswiederherstellung ist nicht
implementiert. Beim Wechsel innerhalb der App greift die bestehende Dirty-Abfrage;
Browser-Neuladen oder -Schließen speichert diesen Wiederholungszustand nicht.

Bei unklarem PUT oder Versionskonflikt lädt die Abgleichaktion nur den aktuellen
Bestand; sie ersetzt weder den getippten Entwurf noch dessen Versionsnummer.
Die aktuelle Vorlage kann danach bewusst erneut geöffnet werden. Eine bekannte
Ablehnung wegen Eingaben, Anmeldung oder Berechtigung erklärt den Grund und erhält
die Eingaben. Fokus und Dirtyschutz bleiben erhalten; ein inzwischen anderweitig
gesetzter Fokus wird nicht zurückgerissen.

## Wiederholbare Vorlagenanlage: API-Vorbereitung (BKP015.5a)

`POST /api/v1/document-templates` akzeptiert optional `requestId` als UUID.
Für denselben Tenant, Schlüssel und normalisierten Eingabeinhalt liefert ein
Retry wieder HTTP201 mit dem ursprünglichen Ergebnis einschließlich Vorlagen-
und Positions-IDs. Es entstehen weder eine zweite Vorlage noch weitere
Audit-Einträge. Ein anderer Inhalt mit bereits verwendetem Schlüssel ergibt409.
Die Normalisierung entspricht den gespeicherten Textfeldern: Name, Positions-
beschreibung und Einheit werden getrimmt; Reihenfolge und übrige Werte bleiben
Bestandteil des Hashs. Clients sollen dieselbe UUID und denselben eingefrorenen
Auftrag wiederholen, nicht den Schlüssel mit veränderten Eingaben wiederverwenden.

Migration0037 ergänzt `document_template_create_operations` additiv. Tenantlock,
Adminprüfung und Transaktion schützen Anlage und persistente Antwort gemeinsam.
Auch nach Neustart oder späterem Bearbeiten/Archivieren wird nur das ursprüngliche
Ergebnis wiedergegeben; der aktuelle Datensatz wird dabei nicht zurückgesetzt.
Diese Antwort ist eine Auftragsquittung und kein aktueller Bestandsabruf.

Ohne Schlüssel bleibt das bisherige POST-Verhalten erhalten. PUT verwendet
weiterhin die Versionsprüfung und weist `requestId` zurück. Die Oberfläche nutzt
diese Vorbereitung erst mit BKP015.5b; die oben beschriebene UI-Speicherlücke ist
mit dieser API-Erweiterung allein noch nicht geschlossen. Keine öffentliche
Quittungsliste oder automatische Löschung/Aufbewahrungsfrist wird eingeführt.
Vor Schemaänderungen gilt der bestehende verifizierte Update-Checkpoint;
nach Migration keine alte App automatisch gegen das neue Schema zurückstarten.

## Dokumentvorlagen archivieren (BKP015.2)

„Archivieren“ sendet den gespeicherten Vorlagenstand einschließlich Version und
aller Positionen; ein gleichzeitig offener, ungespeicherter Entwurf wird dafür
nicht verwendet. Auch Referenzen auf inzwischen archivierte Produkte bleiben
erhalten. Während des Auftrags sind weitere Änderungen gesperrt.

Eine bestätigte Archivierung bleibt sichtbar, wenn das anschließende Laden der
Liste fehlschlägt. „Vorlagen neu laden“ wiederholt ausschließlich den GET, nie
den Schreibauftrag. Bei Versionskonflikt, nicht mehr vorhandener Vorlage oder
unklarem Ausgang (Verbindungsfehler, Serverfehler, unplausible Erfolgsantwort)
bleiben weitere Änderungen bis zu einem ausdrücklichen, gültigen Listenabruf
gesperrt. Bekannte Ablehnungen weisen auf Anmeldung, Berechtigung oder Angaben
hin. Eine tatsächlich neuere Serverversion wird als aktueller Stand übernommen;
ein widersprüchlicher älterer Stand hebt einen bestätigten Erfolg nicht auf.
Der Listenabgleich erhält getippte Texte und Positionen des offenen Entwurfs.

Der Listenendpunkt liest Vorlagen und ihre Positionen gemeinsam in einer
lesenden Repeatable-Read-Transaktion (BKP015.3). Eine parallel gespeicherte
Änderung kann dadurch keine neue Versionsnummer mit alten Positionen koppeln.
Ein nachfolgender Schreibversuch aus einem älteren Snapshot wird weiterhin
über die vorhandene Versionsprüfung abgewiesen; API und Sortierung bleiben gleich.

## Fiktive Inhaltsvorschau einer Vorlage (BKP015.8)

Im geöffneten Vorlageneditor erstellt „Inhaltsvorschau erstellen“ eine PDF aus
den aktuellen, auch ungespeicherten Texten und Positionen. Ein eigener Link lädt
das geprüfte PDF bewusst herunter. Die Vorschau speichert die Vorlage nicht und
setzt ihren Änderungszustand nicht zurück. Nach Eingabeänderungen oder Wechsel
des Entwurfs wird sie ungültig; verspätete Antworten werden verworfen und lokale
Blob-URLs wieder freigegeben. Fehler erhalten sämtliche Eingaben.

`POST /api/v1/document-templates/preview` verlangt den Vorlageninhalt mit
`kind`, `name`, `subject`, `introText`, `outroText`, `validityDays`, `state` und
`positions` nach denselben Feldgrenzen wie die Vorlagenverwaltung. Positionen
tragen Beschreibung, Menge, Einheit, Brutto-Centpreis, Steuer-/Rabattbasispunkte
und optional eine Produkt-UUID; diese UUID wird nicht nachgeschlagen. Zusätzliche
Felder wie `requestId`, Version, Kontakt-/Event-/Mandantenbezug sowie zusätzliche
Positionsfelder und numerische Strings werden zurückgewiesen. Bestehende
Speicherendpunkte behalten ihren Vertrag. Anmeldung, Administratorberechtigung
und CSRF-Schutz sind erforderlich.

Es wird nur die Berechtigung gelesen. Keine Dokumentnummer, kein Dokument, keine
Vorlage, kein Audit-Eintrag und keine gespeicherte Datei entstehen. Der bestehende
HTML-/PDF-Renderer verwendet feste fiktive Empfänger-/Eventwerte, Beispieldatum
26.10.2030, `VORSCHAU` als Nummer und neutrales fiktives Briefpapier ohne Logo.
Die Inhaltsvorschau zeigt damit ausdrücklich nicht das betriebliche Briefpapier;
dieses wird separat unter Dokumentlayout geprüft. Alle acht unterstützten
Platzhalter werden ersetzt, `{{total}}` stammt aus der exakten Bruttosumme der
Positionen, `{{documentLink}}` verweist auf `example.invalid`. Angebotsgültigkeit
verwendet dieselbe Datumsregel wie echte Angebote. Texte werden wie bei echten
Dokumenten escaped; unbekannte Platzhalter und unsichere Summen werden abgelehnt.
Gleiche Eingaben ergeben gleiche Beispielinhalte/HTML; zeitabhängige PDF-Metadaten
sind keine zugesicherte bytegleiche Ausgabe.

Erfolg: `application/pdf`, `Cache-Control: no-store`,
`Content-Disposition: inline; filename="VORSCHAU.pdf"`. Ungültige Rohstruktur oder
unsichere Summen ergeben400 `invalid_template`, unbekannte Platzhalter400
`unknown_placeholder`, Renderfehler500 `preview_failed`. Sonstige Schemafehler
verwenden die vorhandene API-Validierungsantwort. Die Oberfläche prüft Medientyp,
PDF-Signatur und höchstens10MiB Antwortgröße, bevor sie einen Download anbietet.

Suche/Art-/Archivfilter und auswählbare Platzhalter-Einfügewerkzeuge bleiben offen;
das übergeordnete Paritätsticket BKP015 bleibt offen.

## Protokoll

`document.created` beim Anlegen des Entwurfs, `document.updated` beim Speichern
seiner Texte/Gültigkeit und `document.finalized` beim
Finalisieren, jeweils mit Dokument-ID als `record_id`.

## Noch offen

- Neue Positionen aus dem Produktkatalog auswählen; Blankoanlage ohne Vorlage.
- Netto-Preiseingabe mit eigenem explizitem Preismodell (kein stiller Wechsel bestehender Bruttowerte).
- Status `sent`, `expired`, `accepted` und der Zurückziehen-Endpunkt.
- Rechnungen, Anzahlungen und Korrekturen (C054).
