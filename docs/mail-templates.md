# E-Mail-Vorlagen (MAIL-TPL-01)

Vertrag für wiederverwendbare E-Mail-Vorlagen. Stand 21.11.2026 (Teilslice
01a: Daten und Routen). Die Oberfläche (01b) und die Anwendung im
Dokument-Mail-Dialog (01c) folgen; die Platzhalter- und Formatierungsregeln
sind die des [Mail-Editors](mail-editor.md) und dort verbindlich dokumentiert.

## Daten und Verhalten

Eine Vorlage ist mandantengebunden und enthält:

| Feld | Regeln |
| --- | --- |
| `name` | 1–120 Zeichen, ohne Steuerzeichen, getrimmt |
| `subject` | ≤998 Zeichen, **plainText** mit den neun bekannten Platzhaltern; Steuerzeichen werden abgelehnt (keine Header-Injection), Werte werden bei der Auflösung auf eine Zeile gebracht |
| `bodyHtml` | ≤200000 Zeichen, wird **vor dem Speichern serverseitig bereinigt** (dieselbe Allowlist wie der Mail-Editor: p/br/strong/em/u/ul/ol/li/a, href nur http/https/mailto); unbekannte `{{…}}`-Stellen sind `invalid_content` |
| `state` | `active` / `inactive` / `archived`; Archivieren ist ein sichtbarer Zustandswechsel, **kein Löschen** – es gibt keinen Löschendpunkt |
| `version` | Optimistische Sperre; Änderungen ohne die aktuelle Version ergeben `409 conflict` |

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

| Platzhalter | Beispielwert |
| --- | --- |
| `{{contact}}` | `Alex Beispiel` |
| `{{contactFirstName}}` | `Alex` |
| `{{event}}` | `Fiktives Sommerfest` |
| `{{date}}` | `26.10.2030` |
| `{{location}}` | `Beispielsaal` |
| `{{eventType}}` | `Feier` |
| `{{package}}` | `Paket Beispiel` |
| `{{total}}` | `119,00 €` |
| `{{documentLink}}` | `https://example.invalid/vorschau` |

Die Antwort (`subject`, `bodyHtml`, `bodyText`, `missing`) hat dieselbe Form
wie die Dokument-Mail-Vorschau. Unbekannte Platzhalter werden abgelehnt – die
Vorschau erfindet für nichts einen Ersatz; `missing` bleibt bei den
Beispielwerten leer und zeigt nur, was die Werteabdeckung nicht kennt.

## Ehrliche Grenzen (Teilslice 01a)

- Noch keine Oberfläche und keine Anwendung im Composer (01b/01c).
- Betreffzeilen-Auflösung mit echten Werten passiert erst beim Anwenden (01c);
  die Umsetzung dort muss `resolveMailSubject` verwenden (Werte einzeilig).
- Standard-Dateianhänge (Plan-Unterpunkt) sind Teil von 01c und erweitern den
  Anhangvertrag additiv.
