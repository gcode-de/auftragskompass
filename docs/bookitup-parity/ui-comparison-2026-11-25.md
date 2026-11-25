# UI-Abgleich mit Bookitup (25.11.2026)

Auftrag des Betreibers vom 24.11.2026: Layout, Design, Menüstruktur und
Bedienung weiter an Bookitup angleichen, das Backend möglichst unverändert
lassen. Grundlage sind die Bookitup-Screenshots des Betreibers (Eventakte,
Einstellungen, Signaturen, Aufgaben, Dokument- und Rechnungserstellung,
Ressourcen; Stand 31.10. bis 24.11.2026).

## Beweisgrenzen

- **Bild- und Browserbeobachtung, keine REA-Evidence.** Der REA-Skill
  (`reverse-engineer-anything`, v45) ist für Claude Code unter
  `~/.claude/skills/` installiert und gelesen. REA-MCP-Werkzeuge waren in der
  Sitzung nicht verfügbar; der lesende Diagnoseaufruf (`rea-agents doctor`)
  wurde von der Rechteprüfung des Agenten abgelehnt und nicht umgangen. Eine
  MCP-Registrierung braucht die Zustimmung des Betreibers und einen Neustart.
- Die Screenshots enthalten echte Kunden- und Geschäftsdaten. Sie liegen
  ausschließlich privat beim Betreiber und wurden weder kopiert noch in Tests,
  Fixtures oder CI-Artefakte übernommen. Die Exporte (PDFs, CSVs) wurden für
  den UI-Abgleich nicht geöffnet.
- Bookitup-Fachmodule ohne Gegenstück werden nicht als Attrappen nachgebaut
  (keine toten Menüpunkte oder Scheinknöpfe).

## Umgesetzt (nur Oberfläche)

| Ticket       | Bookitup-Beobachtung                                                                                                                               | Umsetzung                                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-PARITY-01 | Einstellungen in Gruppen: E-Mail (Vorlagen, Ein- & Ausgangsserver, Signatur), Dokumente (Vorlagen, Produkte, Layout, Nummernkreise), Integrationen | Gleiche Reihenfolge und Gruppen, Bookitup-Bezeichnungen wo zutreffend, Signatur als eigene Seite; Gruppen dauerhaft offen statt einklappbar (kein Extraklick); mobil Bereichswähler mit `<optgroup>` |
| UI-PARITY-02 | Eventakte: Details, Ressourcen, Dateien, E-Mails mit Ordnern                                                                                       | Genau diese vier Bereiche; Notizen und Logbuch unter Details; E-Mails mit „Neue Mail schreiben“ und Ordnern Alle/Geplant/Fehlgeschlagen/Gesendet aus dem Versandstatus                               |
| UI-PARITY-03 | „Dokument bereitstellen“: an Buchhaltung senden, E-Mail an Kunden, Herunterladen, Drucken, Online freigeben                                        | Zeilenaktion „Bereitstellen“ mit Vorschau (neuer Tab, dort Drucken), Buchhaltung, Kunde, Download; Online-Freigabe ehrlich als nicht verfügbar benannt                                               |
| UI-PARITY-04 | Notizen und Logbuch in der Mittelspalte, Kontakte/Location rechts                                                                                  | Notizen und Logbuch als Karten in der Hauptspalte, Kontakt und Ort daneben                                                                                                                           |
| UI-PARITY-05 | Logbuch als Zeitleiste, neuester Eintrag oben                                                                                                      | Zeitleiste mit neutralen Marken, neuester Eintrag zuerst, Datum gedämpft darunter                                                                                                                    |
| MAIL-SIG-01  | E-Mail-Signatur mit Logo                                                                                                                           | Mehrere Signaturen, Standard, Auswahl in jedem Mail-Dialog, Logo als eingebettetes Bild (enthält Backend, eigener Auftrag vom 24.11.)                                                                |

## Bewusst anders als Bookitup

- **Eingebettete PDF-Vorschau:** Die Admin-Sicherheitsrichtlinie verbietet
  Framing (`frame-ancestors 'none'`, `X-Frame-Options DENY`, `default-src
'none'` ohne `frame-src`). Die Vorschau öffnet deshalb im neuen Tab. Eine
  Lockerung nur für PDF-Antworten gleicher Herkunft wäre möglich, ist aber
  eine Sicherheitsentscheidung des Betreibers.
- **Einklappbare Einstellungsgruppen:** dauerhaft offen (behutsame
  Vereinfachung).
- **Blaue Akzentfarbe:** Die neutrale Palette mit zurückgenommenem Grün
  (BKP005) bleibt; keine neue Markenrichtung.

## Offen: nur mit Backend möglich (nicht Teil dieses Laufs)

| Bookitup                                                                  | Fehlt in AuftragsKompass              |
| ------------------------------------------------------------------------- | ------------------------------------- |
| E-Mails: Posteingang, Entwürfe, Papierkorb                                | IMAP-Abruf und Ordnerverwaltung       |
| Aktenbereiche „Freigaben“ und „Verdienst“                                 | Kundenportal (M5) und Ertragsrechnung |
| Zeitplan mit mehreren Zeiträumen                                          | Mehrere Zeitfenster je Event          |
| Eigene Felder, Vermittlungen, Workflows                                   | Datenmodelle fehlen                   |
| Aufgaben mit Datumsbereich und Gruppen                                    | Aufgabenmodul (M6)                    |
| Mehrere datierte Notizen mit Löschen                                      | Notizen sind ein einzelner Text       |
| Einstellungen: Team, Profil, Mehrwertsteuer, Fragebogen-/Vertragsvorlagen | Module fehlen                         |

## Offen: reine Oberfläche, noch nicht umgesetzt

- **Senkrechte Aktennavigation links** mit „Event am …“ wie in Bookitup. Sie
  kostet Breite; das Dreispaltenraster der Details müsste auf deutlich breitere
  Bildschirme rücken. Braucht eine eigene Layoutabnahme.
- **„Event duplizieren“** am unteren Ende der Aktennavigation (die Duplizieren-
  Funktion existiert in der Eventliste; Platzierung in der Akte offen).
- **Location-Karte mit „PRIMÄR“-Markierung** und **„Details anzeigen“** am
  Kontakt: kleine Angleichungen der rechten Spalte.
