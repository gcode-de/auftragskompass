# E-Mail-Vorlagen (MAIL-TPL-01)

Vertrag für wiederverwendbare E-Mail-Vorlagen. Stand 21.11.2026 (Teilslice
01a: Daten und Routen). Die Oberfläche (01b) und die Anwendung im
Dokument-Mail-Dialog (01c) folgen; die Platzhalter- und Formatierungsregeln
sind die des [Mail-Editors](mail-editor.md) und dort verbindlich dokumentiert.

## Daten und Verhalten

Eine Vorlage ist mandantengebunden und enthält:

| Feld       | Regeln                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | 1–120 Zeichen, ohne Steuerzeichen, getrimmt                                                                                                                                                                             |
| `subject`  | ≤998 Zeichen, **plainText** mit den neun bekannten Platzhaltern; Steuerzeichen werden abgelehnt (keine Header-Injection), Werte werden bei der Auflösung auf eine Zeile gebracht                                        |
| `bodyHtml` | ≤200000 Zeichen, wird **vor dem Speichern serverseitig bereinigt** (dieselbe Allowlist wie der Mail-Editor: p/br/strong/em/u/ul/ol/li/a, href nur http/https/mailto); unbekannte `{{…}}`-Stellen sind `invalid_content` |
| `state`    | `active` / `inactive` / `archived`; Archivieren ist ein sichtbarer Zustandswechsel, **kein Löschen** – es gibt keinen Löschendpunkt                                                                                     |
| `version`  | Optimistische Sperre; Änderungen ohne die aktuelle Version ergeben `409 conflict`                                                                                                                                       |

Änderungen sind vollständige Ersetzungen (Name, Betreff, Inhalt, Zustand) mit
der übermittelten `version`. Antworten enthalten nie Mandanten- oder
Vergleichsschlüssel; das Audit (`mail.template_saved`) trägt nur Aktion und
interne Referenz.

## API v1

Alle Routen benötigen die lokale Admin-Sitzung; schreibende Routen zusätzlich
Origin und CSRF-Token (bestehender globaler Schutz).

- `GET /api/v1/mail-templates`: Liste der Zusammenfassungen (ohne `bodyHtml`).
- `GET /api/v1/mail-templates/:id`: vollständige Vorlage inklusive `bodyHtml`.
- `POST /api/v1/mail-templates`: Anlage (`state` optional, Standard `active`).
- `PUT /api/v1/mail-templates/:id`: vollständige Änderung mit `version`.
- `POST /api/v1/mail-templates/preview`: **rein synthetische Vorschau** ohne
  jeden Schreibvorgang (keine Zeile, kein Audit).

Fremde oder fehlende IDs antworten `404`, Verluste der Versionskontrolle
`409`, inhaltliche Fehler `400` mit den geschlossenen Codes
`invalid_name` / `invalid_subject` / `invalid_body` / `invalid_state` /
`invalid_content` (Schemafehler antworten wie überall mit dem generischen
Validierungsfehler).

## Vorschau mit Beispielwerten

Die Vorschau löst Betreff und Inhalt mit **festen, offensichtlich fiktiven
Beispielwerten** auf – analog zur Dokumentlayout-Vorschau, niemals abgeleitet
aus echten Datensätzen (eine Vorlage gehört zu keinem Kunden):

| Platzhalter            | Beispielwert                       |
| ---------------------- | ---------------------------------- |
| `{{contact}}`          | `Alex Beispiel`                    |
| `{{contactFirstName}}` | `Alex`                             |
| `{{event}}`            | `Fiktives Sommerfest`              |
| `{{date}}`             | `26.10.2030`                       |
| `{{location}}`         | `Beispielsaal`                     |
| `{{eventType}}`        | `Feier`                            |
| `{{package}}`          | `Paket Beispiel`                   |
| `{{total}}`            | `119,00 €`                         |
| `{{documentLink}}`     | `https://example.invalid/vorschau` |

Die Antwort (`subject`, `bodyHtml`, `bodyText`, `missing`) hat dieselbe Form
wie die Dokument-Mail-Vorschau. Unbekannte Platzhalter werden abgelehnt – die
Vorschau erfindet für nichts einen Ersatz; `missing` bleibt bei den
Beispielwerten leer und zeigt nur, was die Werteabdeckung nicht kennt.

## Anwenden im Dokument-Mail-Dialog (01c)

Die Auswahl „Aus Vorlage“ im Dokument-Mail-Dialog bietet **nur aktive**
Vorlagen an; die Auswahl allein ändert nichts, „Übernehmen“ kopiert Betreff
und Inhalt **einmalig** in den danach voll editierbaren Entwurf – spätere
Änderungen an der Vorlage ändern weder den Entwurf noch gesendete Mails
(kein persistenter Bezug). Ein schmutziger Entwurf fragt per `window.confirm`
vor dem Ersetzen. Der Dialog hat ein sichtbares Betrefffeld (Standard
„Dokument <Nummer>“); gesendet wird der Betreff als `plainText` mit
Platzhaltern, serverseitig über `resolveMailSubject` aufgelöst.

## Standard-Dateianhänge (01d)

Eine Vorlage kann **verfügbare** Dateien der Bibliothek als Standardanhänge
benennen (`attachmentFileIds`, höchstens 20; eine abwesende Liste behält die
gespeicherte, eine übermittelte ersetzt sie vollständig). Jede Datei wird vor
der Speicherung erneut geprüft (`state='available'`, Prüfstand wie in
`library_files` dokumentiert) und noch einmal durch einen Datenbank-Trigger –
eine nicht verfügbare Datei lehnt den gesamten Vorgang mit
`attachment_unavailable` ab und wird **nie** stillschweigend weggelassen.

Beim Versand zeigt der Dialog die Standardanhänge der übernommenen Vorlage mit
Namen; jede Datei kann einzeln entfernt werden. `scheduleDocumentSend`
akzeptiert `fileIds` und friert pro Datei den Speicherschlüssel, den Hash und
die Größe ein (`mail_file_attachments`); der Worker liest die Bytes bei jedem
Versuch neu und prüft den Hash – eine ersetzte oder beschädigte Datei ist
dann `attachment_unavailable` und nie die falschen Bytes. Der bisherige
Vertrag `mail_attachments` (nur finale Dokumente) bleibt unverändert.

## Anhänge wählen (01e)

In „E-Mail-Vorlagen“ wählt die Standard-Anhänge-Auswahl aus den
**verfügbaren** Dateien der Bibliothek (Name, Medientyp, Größe). Eine nicht
mehr verfügbare, aber noch gewählte Datei bleibt **benannt** und einzeln
entfernbar, statt stillschweigend zu verschwinden; ohne Dateien sagt die
Auswahl „Keine verfügbaren Dateien in der Bibliothek.“ Jede Speicherung
sendet die vollständige Auswahl (`attachmentFileIds`), und eine Ablehnung
wegen einer inzwischen unbrauchbaren Datei wird verständlich benannt.

## Ehrliche Grenzen

- Keine weiteren offenen Punkte der Anhangskette; der Versand zeigt die
  Dateien sichtbar/entfernbar (01d) und die Auswahl ist vollständig (01e).

## Signaturen (MAIL-SIG-01a)

Unter Einstellungen → E-Mail-Vorlagen stehen darunter die
„E-Mail-Signaturen“. Jede Signatur hat eine Bezeichnung, einen Text im
Mail-Editor und optional ein Logo (PNG oder JPEG, höchstens 512 KiB, geprüft
an den Bytes wie das Dokumentlogo) mit einem optionalen Link. Der Baustein
„Logo“ (`{{logo}}`) legt fest, wo das Logo im Text steht; andere Platzhalter
kennt eine Signatur nicht. Genau eine Signatur kann Standard sein; ein
neuer Standard löst den alten ab, die Datenbank erzwingt das über einen
partiellen Unique-Index.

| Route                                     | Erfolg                                                     | Fehler                                                       |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/mail-signatures`             | `200` Liste                                                | `403`                                                        |
| `POST /api/v1/mail-signatures`            | `201` Signatur                                             | `400 invalid_name/invalid_body/invalid_content/invalid_link` |
| `PUT /api/v1/mail-signatures/:id`         | `200` Signatur                                             | wie oben, `404`                                              |
| `DELETE /api/v1/mail-signatures/:id`      | `204`                                                      | `404`                                                        |
| `PUT /api/v1/mail-signatures/:id/logo`    | `200` Signatur (Body: rohes `image/png` oder `image/jpeg`) | `400 invalid_logo`, `413 logo_too_large`, `404`              |
| `DELETE /api/v1/mail-signatures/:id/logo` | `200` Signatur                                             | `404`                                                        |
| `GET /api/v1/mail-signatures/:id/logo`    | `200` Bild, `no-store`                                     | `404`                                                        |

Ein Logo-Upload legt immer einen neuen Speicherschlüssel an; alte Bytes
bleiben liegen, damit ein bereits beauftragter Versand sie noch lesen kann.

### Signatur im Versand (MAIL-SIG-01b)

Beide Mail-Dialoge wählen die Standardsignatur vor; das Feld „Signatur“
ersetzt sie durch eine andere oder „Keine Signatur“. Ohne gespeicherte
Signatur erscheint das Feld nicht. `POST /api/v1/mail/compose`,
`POST /api/v1/mail/document-send` und die Vorschau nehmen dafür
`signatureId`.

Der Server hängt die Signatur an den Text an. An der Stelle von `{{logo}}`
steht das Logo als `<img src="cid:signature-logo">`, mit Link, falls einer
hinterlegt ist. Die geprüften Logo-Bytes werden in `mail_inline_images`
(Schlüssel, Typ, Größe, SHA-256) am Auftrag eingefroren. Der Worker liest
sie bei jedem Versuch, prüft den Hash und versendet sie als Inline-Bild
(`multipart/related`). Ein späterer Logo-Wechsel oder eine gelöschte
Signatur ändert einen bereits beauftragten Versand nicht. Die Vorschau
zeigt das Logo über `GET /api/v1/mail-signatures/:id/logo`.

Ablehnungen: eine gelöschte oder fremde Signatur `400 invalid_link`,
nicht lesbare oder ersetzte Logo-Bytes `409 attachment_unavailable`.
