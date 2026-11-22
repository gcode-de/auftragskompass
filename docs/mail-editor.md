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

| Kandidat | Lizenz | Wartung (npm-Stand 21.11.2026) | Bundle (min+gzip, gemessen) | Barrierefreiheit (offizielle Doku) | Sanitizing-Zusammenspiel |
| --- | --- | --- | --- | --- | --- |
| **TipTap 3** (ProseMirror) | MIT (alle genutzten Pakete; Pro-Cloud-Features sind bezahlt und nicht genutzt) | sehr aktiv, `@tiptap/*` 3.35.0 am 20.11.2026 veröffentlicht | 129 KB (schlanke Extensions) / 133 KB (StarterKit) | eigener offizieller Leitfaden „How to make your editor accessible“ (Headless: Werkzeugleiste liegt bei uns) | Ausgabe ist semantisches HTML `p/br/strong/em/u/ul/ol/li/a` und deckt sich 1:1 mit der Mail-Allowlist |
| **Lexical 0.53** (Meta) | MIT | aktiv, Veröffentlichung 28.10.2026 | 136 KB | in der aktuellen Doku keine auffindbare eigene Barrierefreiheitsseite (Stand 21.11.2026, zwei Dokumentationspfade geprüft) | HTML-Export über `$generateHtmlFromNodes`, zusätzliche Attribute/Rahmen, mehr Verdrahtungsaufwand |
| **Plate 53** (Slate) | MIT | aktiv, 30.10.2026 | 178 KB | keine eigene a11y-Doku; Dokumentation setzt eine eigene Komponentenschicht (Leafs, Kit-Registry) voraus | Ausgabe Slate-spezifisch, Kit-Aufbau nötig |
| **Quill 2.0.3** | BSD-3-Clause | zuletzt 30.11.2024, seitdem kein Release | **65 KB** (plus 4 KB CSS, Pflicht-Stylesheet) | keine offizielle a11y-Doku | eigene Blot-Ausgabe, semantisch nach Konfiguration, CSS-Klassen nötig |
| vorhandener `contentEditable`-Bau (Event-Notizen, `document.execCommand`) | – | – | 0 KB neu | – | `document.execCommand` ist veraltet (MDN), Eigenentwicklung für Auswahl/Links |

**Auswahl: TipTap 3 mit schmaler Extension-Liste** (Document, Paragraph, Text,
Bold, Italic, Underline, BulletList, OrderedList, ListItem, Link, History – kein
StarterKit). Begründung: die einzige Wahl, die zugleich aktiv gewartet, MIT-
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

| Platzhalter | Bedeutung | Auflösung |
| --- | --- | --- |
| `{{contact}}` | Kontaktname | `contacts.name` |
| `{{contactFirstName}}` | **Kontakt-Vorname** (Kontakt_Vorname) | ausschließlich das eigene Feld `contacts.first_name` (Migration 0073) |
| `{{event}}` | Eventname | `events.name` |
| `{{date}}` | Eventdatum | `events.event_date`, formatiert in der Mandantenzeitzone |
| `{{location}}` | wirksamer Ort | Freitext bei `venue_override`, sonst der Bestandsname |
| `{{eventType}}` | Eventart | Stammdaten |
| `{{package}}` | Paket | Stammdaten |
| `{{total}}` | Bruttosumme des Dokuments | exakte Positionsensumme, `formatMinorUnits` |
| `{{documentLink}}` | Dokumentlink | Admin-Origin + `/#document-<id>` |

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

## Sicherheit und Verträge

- **Serverseitiges Sanitizing:** das eingehende Body-HTML wird immer durch
  `sanitize-html` bereinigt, bevor es gespeichert oder versendet wird. Erlaubt
  sind ausschließlich `p`, `br`, `strong`, `em`, `u`, `ul`, `ol`, `li`, `a`;
  an `a` nur `href` mit den Schemata `https`, `http`, `mailto`; keine Bilder,
  kein `style`, keine Skripte, keine Protokoll-relativen Links. Angriffsfälle
  (Skript-Tags, Event-Handler, `javascript:`-Links, iframe, verschachteltes
  HTML) sind als Unit-Tests belegt; gespeichertes Body-HTML ist in der
  Integration stets bereinigt.
- **Textalternative:** `body_text` wird serverseitig aus dem bereinigten HTML
  erzeugt (Absätze als Leerzeile, `<br>` als Zeilenumbruch, Listen mit
  Aufzählungspunkt, Links als `Text (URL)`), nie vom Client übernommen.
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
