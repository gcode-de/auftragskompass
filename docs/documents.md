# Geschäftsdokumente: Entwurf, Nummer und finale PDF

Stand: 24.10.2026, einschließlich BKP016.3. Dokumente entstehen aus einer
Dokumentvorlage, tragen eigene Inhalte und Positionen als Snapshot und werden
beim Finalisieren mit einer Nummer aus dem Nummernkreis unveränderlich
festgeschrieben. Angebotsentwürfe lassen sich in der Eventakte bearbeiten und
vorab als PDF ansehen; finale PDFs können heruntergeladen werden.

## Lebenszyklus

| Zustand | Bedeutung | Nummer | Snapshot/PDF |
|---|---|---|---|
| `draft` | aus einer Vorlage erzeugt, Positionen und Summen stehen fest | keine | keiner |
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
| `PUT /api/v1/document-layout/logo` | `200` Layout mit Logo | `400` falsche Bildbytes, `404` kein Layout, `413` zu groß, `415` fremder Typ |

Alle Routen verlangen eine angemeldete Betreiberberechtigung, die
CSRF-Prüfung gilt wie bei den übrigen schreibenden Endpunkten. Jede Abfrage ist
auf den Mandanten begrenzt; fremde IDs liefern `404`.

## Logo

Das Layout kann genau ein Logo tragen. `PUT /api/v1/document-layout/logo`
nimmt einen rohen PNG- oder JPEG-Körper an (höchstens 512 KB). Geprüft werden
die magische Signatur gegen den angegebenen Inhaltstyp und die Größe; ein
umbenanntes Fremdformat wird abgewiesen. Die Bytes liegen außerhalb der
Datenbank, der Schlüssel `logo-<mandant>.png|jpg` steht mit dem Medientyp im
Layout. Ersetzen schreibt zuerst die neue Datei, aktualisiert die Zeile, erhöht
die Version und protokolliert `document_layout.updated`; erst danach wird die
alte Datei entfernt. Beim Finalisieren liest der Dokumentdienst das Logo und
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
Hauptkontakt, erklärt der Abschnitt das und deaktiviert die Anlage.

## Protokoll

`document.created` beim Anlegen des Entwurfs, `document.updated` beim Speichern
seiner Texte/Gültigkeit und `document.finalized` beim
Finalisieren, jeweils mit Dokument-ID als `record_id`.

## Noch offen

- Neue Positionen aus dem Produktkatalog auswählen; Blankoanlage ohne Vorlage.
- Netto-Preiseingabe mit eigenem explizitem Preismodell (kein stiller Wechsel bestehender Bruttowerte).
- Status `sent`, `expired`, `accepted` und der Zurückziehen-Endpunkt.
- Rechnungen, Anzahlungen und Korrekturen (C054).
