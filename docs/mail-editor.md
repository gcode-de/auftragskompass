# Formatierter Dokument-Mail-Editor (MAIL-EDITOR-01)

Vertrag und begründete Werkzeugwahl für die E-Mail, mit der ein finalisiertes
Dokument versendet wird (Zeilenaktion „Per E-Mail senden“, [MAIL-DOC-01](documents.md)).
Stand 21.11.2026. Diese Datei dokumentiert die Editorbibliotheks-Bewertung, die
Platzhaltersyntax, das Sanitizing und die Vorschau; die Kontofunktionen stehen
in [mail-accounts.md](mail-accounts.md), die Mailkerndaten im
[Implementierungsplan](../IMPLEMENTATION_PLAN.md).

## Editorbibliothek: Bewertung und Auswahl

Bewertet wurden die im Plan genannten Kandidaten anhand offizieller
Dokumentation, Lizenz, Barrierefreiheit, Wartung und gemessener Bundlegröße.
Die Bundlezahlen sind **selbst gemessen**, nicht übernommen: jeder Kandidat
wurde in einem eigenen Probe-Projekt mit einer äquivalenten Mindestauswahl
(Absätze, fett/kursiv/unterstrichen, Aufzählung, Nummerierung, Link,
Zurückgängig) über esbuild gebündelt und minifiziert, gemessen wird die
gzip-komprimierte JS-Ausgabe ohne React (das ohnehin im Admin-Bundle liegt),
Stand der Pakete 21.11.2026. Zusätzlich gilt der gemessene Wert von Quill
inklusive seiner Pflicht-Stylesheet-Datei.

| Kandidat                                                                  | Lizenz                                                                         | Wartung (npm-Stand 21.11.2026)                              | Bundle (min+gzip, gemessen)                        | Barrierefreiheit (offizielle Doku)                                                                                         | Sanitizing-Zusammenspiel                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **TipTap 3** (ProseMirror)                                                | MIT (alle genutzten Pakete; Pro-Cloud-Features sind bezahlt und nicht genutzt) | sehr aktiv, `@tiptap/*` 3.35.0 am 20.11.2026 veröffentlicht | 129 KB (schlanke Extensions) / 133 KB (StarterKit) | eigener offizieller Leitfaden „How to make your editor accessible“ (Headless: Werkzeugleiste liegt bei uns)                | Ausgabe ist semantisches HTML `p/br/strong/em/u/ul/ol/li/a` und deckt sich 1:1 mit der Mail-Allowlist |
| **Lexical 0.53** (Meta)                                                   | MIT                                                                            | aktiv, Veröffentlichung 28.10.2026                          | 136 KB                                             | in der aktuellen Doku keine auffindbare eigene Barrierefreiheitsseite (Stand 21.11.2026, zwei Dokumentationspfade geprüft) | HTML-Export über `$generateHtmlFromNodes`, zusätzliche Attribute/Rahmen, mehr Verdrahtungsaufwand     |
| **Plate 53** (Slate)                                                      | MIT                                                                            | aktiv, 30.10.2026                                           | 178 KB                                             | keine eigene a11y-Doku; Dokumentation setzt eine eigene Komponentenschicht (Leafs, Kit-Registry) voraus                    | Ausgabe Slate-spezifisch, Kit-Aufbau nötig                                                            |
| **Quill 2.0.3**                                                           | BSD-3-Clause                                                                   | zuletzt 30.11.2024, seitdem kein Release                    | **65 KB** (plus 4 KB CSS, Pflicht-Stylesheet)      | keine offizielle a11y-Doku                                                                                                 | eigene Blot-Ausgabe, semantisch nach Konfiguration, CSS-Klassen nötig                                 |
| vorhandener `contentEditable`-Bau (Event-Notizen, `document.execCommand`) | –                                                                              | –                                                           | 0 KB neu                                           | –                                                                                                                          | `document.execCommand` ist veraltet (MDN), Eigenentwicklung für Auswahl/Links                         |

**Auswahl: TipTap 3 mit schmaler Extension-Liste** (Document, Paragraph, Text,
Bold, Italic, Underline, Strike, Heading 2/3, Blockquote, BulletList,
OrderedList, ListItem, HardBreak, Link, History – kein StarterKit).
Begründung: die einzige Wahl, die zugleich aktiv gewartet, MIT-
lizenziert, offiziell dokumentiert und deren HTML-Ausgabe deckungsgleich mit der
ohnehin erzwungenen Mail-Allowlist ist; Barrierefreiheit ist offiziell
dokumentiert und die Werkzeugleiste bleibt unter unserer Kontrolle (echte
Knöpfe, `aria-pressed`, Tastatur). Quill ist die kleinste Bibliothek (halbes
Bundle), scheidet aber wegen fehlender Wartung seit zwei Jahren und ohne
offizielle Barrierefreiheitsdokumentation aus; Lexical/Plate kosten mehr
Verdrahtung bei gleichem oder größerem Bundle. Der eigene `contentEditable`-Bau
ist genau die unnötige Eigenentwicklung, die vermieden werden soll
(`execCommand` veraltet). Falls die Bundlegröße je zur Leitgröße wird, ist Quill
die dokumentierte Ausweichwahl.

## Platzhalter

Verbindlich ist die vorhandene Projektsyntax der
[Dokumente und Vorlagen](documents.md): `{{name}}`, Buchstaben innen. Der Mail-Editor
unterstützt dieselben acht Namen und ergänzt **einen** neuen, klar benannten
Platzhalter:

| Platzhalter            | Bedeutung                             | Auflösung                                                             |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `{{contact}}`          | Kontaktname                           | `contacts.name`                                                       |
| `{{contactFirstName}}` | **Kontakt-Vorname** (Kontakt_Vorname) | ausschließlich das eigene Feld `contacts.first_name` (Migration 0073) |
| `{{event}}`            | Eventname                             | `events.name`                                                         |
| `{{date}}`             | Eventdatum                            | `events.event_date`, formatiert in der Mandantenzeitzone              |
| `{{location}}`         | wirksamer Ort                         | Freitext bei `venue_override`, sonst der Bestandsname                 |
| `{{eventType}}`        | Eventart                              | Stammdaten                                                            |
| `{{package}}`          | Paket                                 | Stammdaten                                                            |
| `{{total}}`            | Bruttosumme des Dokuments             | exakte Positionsensumme, `formatMinorUnits`                           |
| `{{documentLink}}`     | Dokumentlink                          | Admin-Origin + `/#document-<id>`                                      |

`{{contactFirstName}}` löst **nie** aus dem vollständigen Namen auf: fehlt das
eigene Feld, bleibt der Platzhalter stehen. Das Feld ist in Kontakt anlegen/
bearbeiten als „Vorname“ eingebbar (optional, ≤200 Zeichen).

**Umgang mit fehlenden und unbekannten Werten:** ein unbekannter Platzhalter
macht den Inhalt ungültig (`400 invalid_content`) – wie bei den Dokumenten
schlägt ein Tippfehler nicht still durch. Ein bekannter Platzhalter ohne Wert
wird **nicht ersetzt**; er bleibt als `{{…}}` sichtbar (transparent statt
leer), im Klartext wie im HTML. Die Vorschau zeigt das tatsächliche Ergebnis und
nennt die fehlenden Namen verständlich, damit die Stelle vor dem Versand
entfernt oder ergänzt werden kann.

## Werkzeuge und Zeilenumbrüche

Die Werkzeugleiste ist eine Icon-Leiste im Strichstil der Navigation
(24×24, `currentColor`, Lucide-Geometrie, ISC): Fett, Kursiv, Unterstrichen,
Durchgestrichen, Überschrift 2, Überschrift 3, Zitat, Aufzählung,
Nummerierung, Link, Rückgängig, Wiederholen – jeder Knopf trägt
`aria-label`/`title` und Schaltflächen mit Zustand zusätzlich
`aria-pressed` (Zustand nie nur über Farbe). Enter beginnt einen neuen
Absatz (mit dem gewohnten Abstand), Shift+Enter erzeugt einen
Zeilenumbruch im selben Absatz ohne Abstand (`<br>`); beides ist im
E2E gegen die echte Textalternative belegt.

## TinyMCE-Prüfung (23.11.2026, kein Tausch)

TinyMCE 8.10.2 wurde geprüft und **nicht** übernommen: die Lizenz ist
GPLv2+ **oder** die proprietäre Tiny-Self-Hosted-Lizenz – für dieses
öffentliche Repository ein Lizenz-/Copyleft-Wechsel (TipTap bleibt MIT).
Gemessene Runtime-Assets (min., unkomprimiert): Kern 489 KB, Theme 450 KB,
Icons 113 KB, Skin-CSS 190 KB – zusammen rund 1,24 MB gegen 129 KB gzip
des schlanken TipTap-Satzes. Dazu emittiert TinyMCE Inline-Styles und
Klassen, die das serverseitige Sanitizing ohnehin entfernt, während TipTaps
semantisches HTML 1:1 zur Allowlist passt. Die gewünschten Ziele
(Icon-Buttons, mehr Werkzeuge, Enter/Shift-Enter) sind direkt in TipTap
umgesetzt; Quill bleibt die dokumentierte Ausweichwahl.

## Sicherheit und Verträge

- **Serverseitiges Sanitizing:** das eingehende Body-HTML wird immer durch
  `sanitize-html` bereinigt, bevor es gespeichert oder versendet wird. Erlaubt
  sind ausschließlich `p`, `br`, `strong`, `em`, `u`, `s`, `h2`, `h3`,
  `blockquote`, `ul`, `ol`, `li`, `a`; an `a` nur `href` mit den Schemata
  `https`, `http`, `mailto`; keine Bilder, kein `style`, keine Skripte,
  keine Protokoll-relativen Links. Angriffsfälle (Skript-Tags, Event-Handler,
  `javascript:`-Links, iframe, verschachteltes HTML) sind als Unit-Tests
  belegt; gespeichertes Body-HTML ist in der Integration stets bereinigt.
- **Textalternative:** `body_text` wird serverseitig aus dem bereinigten HTML
  erzeugt (Absätze und Überschriften als Blöcke mit Leerzeile, `<br>` als
  Zeilenumbruch, Listen mit Aufzählungspunkt, Zitate mit „> “-Marke je
  Zeile, Links als `Text (URL)`), nie vom Client übernommen.
- **Keine Header-Injection:** der Betreff ist `plainText` (≤998 Zeichen, keine
  Steuerzeichen) und wird serverseitig über `resolveMailSubject` aufgelöst,
  dessen Werte auf eine Zeile gebracht werden – ein Wert mit Zeilenumbruch
  kann nie eine zweite Headerzeile erzeugen (mit MAIL-TPL-01c testiert). Ein
  leerer oder fehlender Betreff behält den automatischen Dokumentbetreff
  `Dokument <Nummer>`; Empfängerfelder laufen durch die bestehende
  Adressvalidierung ohne Steuerzeichen.
- **Versandweg unverändert:** ausschließlich Outbox/Worker, idempotente Geste
  `document-send:<doc>:<requestId>`, Anhang = eingefrorenes PDF-Artefakt; die
  bestehenden MAIL-DOC-01- und Outbox-Verträge bleiben unverändert. Es gibt
  **keinen automatischen Kundenversand**; jede Mail ist eine ausdrückliche
  Senden-Aktion.
- **Vorschau ohne Nebenwirkung:** `POST /api/v1/mail/document-send/preview`
  löst Betreff/Body für ein Dokument genau wie der Versand auf und speichert
  nichts (kein Auftrag, kein Audit, kein Outboxeintrag). Antwort: bereinigtes
  und aufgelöstes `bodyHtml`, abgeleitetes `bodyText` und die Namen fehlender
  Platzhalter. Autorisierung und Mandantenisolation wie beim Versand.
- **Jede Ablehnung benennt ihre Ursache (MAIL-UX-02):** Vorschau und Versand
  bilden jeden Code des Servers in eine eigene, handlungsweisende Meldung ab
  (Betreff, Konto, Berechtigung, Konflikt …); ein **unbekannter Code wird
  wörtlich zitiert** statt irreführend als Eingabefehler zu erscheinen, und
  ein unerwarteter Serverfehler antwortet mit dem stabilen Code `internal`
  (Vollfehler nur im Serverlog, nie in der Antwort). Die frühere
  Allerweltsmeldung „Der Auftrag wurde nicht angelegt“ ist damit
  abgeschafft; die Ursache eines Fehlers ist ohne Log-Lesung benennbar.

## Freie Mail aus dem Event (MAIL-EVENT-01/02)

„Neue Mail schreiben“ in der Eventakte nutzt denselben Editor und dieselben
Bausteine wie der Dokumentversand: „Aus Vorlage“ (übernimmt Betreff, Text und
Standardanhänge einmal), Datei-Upload per Auswahl oder Drop auf den Text,
finale Event-Dokumente und Bibliotheksdateien. Alle Anhänge stehen in einer
Liste und lassen sich vor dem Versand entfernen; ein eigenes Hauptdokument
hat die freie Mail nicht.

`POST /api/v1/mail/compose` nimmt dafür `documentIds` (höchstens 10, nur
finale Dokumente des Mandanten) und `fileIds` (höchstens 20, nur verfügbare
Bibliotheksdateien). Eine nicht verfügbare Quelle lehnt den ganzen Auftrag
mit `attachment_unavailable` ab. Platzhalter aus einer Vorlage werden aus
dem verknüpften Kontakt und Event aufgelöst. Bleibt einer ohne Wert,
antwortet die Route `400 missing_placeholder`: `{{total}}` und
`{{documentLink}}` gibt es nur beim Dokumentversand, Kontakt- und
Eventwerte nur mit zugeordnetem Kontakt bzw. Event.

## Versandstatus (MAIL-STATUS-01)

Ein Dialog bestätigt nur, dass der Auftrag in `mail_outbox` liegt; versendet
wird später im Worker. Deshalb meldet er „Mail in der Warteschlange“ und nie
„gesendet“. Den Ausgang zeigt die Eventakte im Bereich „E-Mails“ (seit UI-PARITY-02
ein eigener Aktenbereich mit den Ordnern Alle, Geplant, Fehlgeschlagen und
Gesendet): jede ausgehende Mail des Events mit Status in Worten (In der
Warteschlange, Wird gesendet, Gesendet, Nicht gesendet, Zustellung unklar).
Solange eine Mail unterwegs ist, liest die Liste alle 3 Sekunden neu,
höchstens etwa zwei Minuten lang, und meldet das Ergebnis einmal.

`GET /api/v1/mail/messages` und `GET /api/v1/mail/messages/:id` antworten
dafür zusätzlich `sendErrorCode`, den Fehlercode des jüngsten
Versandauftrags (`null` ohne Fehler). Jeder Worker-Code hat eine eigene
Meldung, ein unbekannter wird wörtlich genannt. „Erneut senden“ gibt es nur
bei `failed`: es ruft `POST /api/v1/mail/messages/:id/send` mit einem neuen
Idempotenzschlüssel. Bei `uncertain` ist offen, ob die Mail ankam; ein
Ein-Klick-Neuversand könnte sie verdoppeln und fehlt deshalb bewusst.

Über allen Bereichen nennt ein Hinweis jede nicht zugestellte Mail
(`failed`/`uncertain`) mit Link zu ihrem Event. Er liest beim Laden und bei
jeder Rückkehr in die Anwendung neu.

## Später senden (QW5)

Beide Mail-Dialoge (Dokumentversand und freie Event-Mail) haben das optionale
Feld „Senden am“ (lokales Datum und Uhrzeit). Ist es gesetzt, heißt der Knopf
„Senden planen“; die Anfrage trägt `sendAt` als ISO-Zeitpunkt. Der Server
nimmt nur einen Zeitpunkt in der Zukunft und höchstens ein Jahr entfernt an
(sonst `400 invalid_send_at`) und setzt ihn als `next_attempt_at` des
Versandauftrags. Der Worker holt den Auftrag also nicht vorher ab. Es gibt
keine neue Spalte.

Die Liste der Event-Mails zeigt „Geplant für …“ (`scheduledFor` in Liste und
Detail, `null`, sobald fällig) und fragt für geplante Mails nicht im
3-Sekunden-Takt nach. „Planung aufheben“ ruft
`POST /api/v1/mail/messages/:id/unschedule`: Nur ein noch nicht abgeholter,
in der Zukunft geplanter Auftrag wird entfernt (`204`). Sonst kommt
`409 not_scheduled` oder `404`. Die Mail bleibt als „Nicht gesendet“ stehen
und lässt sich mit „Jetzt senden“ als gewöhnlicher Auftrag erneut einreihen.
Migration `0081_mail_send_later.sql` ergänzt nur die Audit-Aktion
`mail.send_cancelled`.

## Grenzen (ehrlich)

- Das Feld „Vorname“ ist (Stand dieses Slices) bewusst **nicht** Bestandteil des
  `contacts.csv`-Exports; der Exportvertrag bleibt unverändert. Nachtrag in
  einem Datenschnitt folgt.
- Der Editor bietet keine Überschriften, Zitate, Code, Bilder oder Tabellen –
  bewusst, entsprechend der Allowlist.
- Der Betreff ist seit MAIL-TPL-01c im Dialog sichtbar und editierbar
  (Platzhalter möglich); die Übernahme aus einer Vorlage kopiert Betreff und
  Inhalt einmalig in den Entwurf (Details in [mail-templates.md](mail-templates.md)).
- Listen sind eine Ebene tief; tiefere Verschachtelungen im Body-HTML bleiben
  deterministisch, sind aber nicht über die Werkzeugleiste erreichbar.

## Postfach

Der Hauptmenüpunkt **Mails** öffnet den Posteingang. Hier stehen tatsächliche
eingegangene Nachrichten und Website-Anfragen. Schon als Option angelegte
Anfragen verlinken auf ihr Event. Die Diagnose unter Einstellungen zeigt
weiterhin die Eingänge, deren automatische Anlage noch aussteht.

Neue Mails und Begleitmails zu Dokumenten können ohne Empfänger als Entwurf
gespeichert werden. Der Entwurf lässt sich im Postfach weiterbearbeiten.
Beim Speichern werden gewählte Anhänge und Kontextbezüge festgehalten.
Der Versand erfordert Empfänger und Betreff und läuft über den Outbox-Worker.
Geplante Aufträge können geändert oder aufgehoben werden, solange sie in der
Zukunft liegen und noch kein Worker sie beansprucht hat. Aufgehobene Aufträge
behalten ihren Wiederholschutz. Ein eindeutig fehlgeschlagener Versand kann
durch einen bearbeiteten Entwurf ersetzt werden. Bei unklarem Ausgang bleibt
die vorhandene Versandprüfung maßgeblich. Eingegangene, gesendete und
unversandte Mails können in den Papierkorb verschoben und wiederhergestellt
werden.

Die Postfachliste verwendet `GET /api/v1/mail/messages` mit `folder`,
`stateGroup` und `offset`. Website-Anfragen kommen über
`GET /api/v1/website-inquiries?view=mail`. Entwürfe verwenden beim
Bearbeiten die in der Detailantwort gelieferte Revision. Alle Änderungen
benötigen eine Administratorsitzung und CSRF.
