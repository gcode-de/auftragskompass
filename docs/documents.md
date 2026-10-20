# Geschäftsdokumente: Entwurf, Nummer und finale PDF

Stand: 20.10.2026, Slice C051. Dokumente entstehen aus einer Dokumentvorlage
(C047), tragen Positionen als Snapshot und werden beim Finalisieren mit einer
Nummer aus dem Nummernkreis (C050) unveränderlich festgeschrieben. Die
Bedienoberfläche und der PDF-Download folgen in eigenen Slices.

## Lebenszyklus

| Zustand | Bedeutung | Nummer | Snapshot/PDF |
|---|---|---|---|
| `draft` | aus einer Vorlage erzeugt, Positionen und Summen stehen fest | keine | keiner |
| `final` | finalisiert, unveränderbar | eindeutig je Mandant | HTML-Hash und PDF-Hash gesetzt |
| `withdrawn` | zurückgezogen (Domänenregel vorhanden, noch kein Endpunkt) | keine | keiner |

Ein `POST /api/v1/documents` kopiert ohne eigene `lines` die Positionen der
Vorlage. Die Dokumentart stammt immer aus der Vorlage, damit Art und Vorlage
nicht auseinanderlaufen. Summen werden aus den Bruttopreisen in Cent berechnet
und schon im Entwurf gespeichert.

`issued_at` ist das auf dem Dokument gedruckte Datum: beim Entwurf der
Anlagezeitpunkt, beim Finalisieren der Ausgabezeitpunkt. `finalized_at` ist
identisch mit dem Ausgabezeitpunkt.

## Finalisieren

`POST /api/v1/documents/:id/finalize` arbeitet in genau einer
Datenbanktransaktion:

1. Zeile sperren und den Übergang `draft → final` prüfen,
2. Nummer aus dem Nummernkreis der Dokumentart ziehen,
3. Snapshot aus Vorlage, Layout, Empfänger, Event und Positionen bauen,
4. PDF über Chromium rendern,
5. PDF inhaltsadressiert ablegen,
6. Zeile auf `final` setzen und `document.finalized` protokollieren.

Scheitert Schritt 4 oder 5, wird die Transaktion zurückgerollt: Das Dokument
bleibt Entwurf, die Nummer bleibt unverbraucht. Ein zweites Finalisieren wird
mit `409 invalid_state` abgewiesen; die Zeile bleibt unverändert.

Der Empfänger kommt aus dem verknüpften Kontakt, die Platzhalter `{{contact}}`,
`{{event}}`, `{{date}}`, `{{location}}`, `{{eventType}}`, `{{package}}`,
`{{total}}` und `{{documentLink}}` aus Kontakt, Event und Summen. Fehlt ein
verwendeter Wert, schlägt das Finalisieren mit `400 invalid_content` fehl statt
ein unvollständiges Dokument zu erzeugen.

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
| `POST /api/v1/documents/:id/finalize` | `200` finales Dokument | `400` fehlende Nummer/Inhalt, `404`, `409` bereits final, `500` Render-/Ablagefehler |
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

## Protokoll

`document.created` beim Anlegen des Entwurfs, `document.finalized` beim
Finalisieren, jeweils mit Dokument-ID als `record_id`.

## Noch offen

- Bedienoberfläche für Entwürfe, Finalisieren und Download.
- Bearbeiten von Entwürfen, Gültigkeitsdatum, Status `sent`, `expired`,
  `accepted` und der Zurückziehen-Endpunkt.
- Rechnungen, Anzahlungen und Korrekturen (C054).
