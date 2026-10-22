# Bookitup-Parität: Arbeitsauftrag und Einstieg

Stand **22.10.2026**, Analysebasis **cf68f1e** auf `codex/ux-event-simplification`, im geöffneten AuftragsKompass-Browser dieselbe Build-Kennung. Die Analyse liegt auf `codex/bookitup-parity-audit`. Ein alter Checkout auf `codex/local-runtime-ci` bei `414fa33` war nicht der ausgelieferte Stand und wurde ausdrücklich nicht als aktuelle UI bewertet. Vor einer Implementierung Remote, Quellstand und laufende Version neu prüfen.

## Verbindliches Ziel aus dem aktuellen Benutzerauftrag

AuftragsKompass soll ein **möglichst vollständiger funktionaler und in der Bedienung naher Bookitup-Klon** werden. Behutsame Verbesserungen sind erwünscht, wenn sie die Bedienung einfacher machen. Eine eigene, deutlich abweichende Informationsarchitektur ist kein Erfolgskriterium. Die bisherigen technischen Sicherheitsregeln bleiben verbindlich. Alte MVP-Ausschlüsse begrenzen die neue Vergleichs- und Ausbauplanung nicht; daraus folgt aber weder ein sofortiger Gesamtumbau noch ein ungeprüfter Produktivwechsel.

Explizite neue Vorgaben:

1. Mobil zuerst prüfen, besonders den Kalender. Desktop und Mobil dürfen unterschiedliche Anordnungen, aber keine verlorenen Funktionen haben.
2. Ressourcen, Produkte, Kontakte und Events vollständig anlegen und verwalten können; Vorlagen, Dokumente und Mails mit **und ohne** Vorlage bearbeiten können.
3. Zuerst nur Wesentliches anzeigen; weitere Angaben und seltene Aktionen auf bewussten Aufruf. Vorhandene Werte und Fehler dürfen dadurch nicht unsichtbar werden.
4. Elemente sauber ausrichten; vergleichbare Controls gleich hoch. Knöpfe optisch kompakt, Touch- und Tastaturbedienung erhalten.
5. Grün, besonders im Darkmode, deutlich zurücknehmen. Beide Themes und Umschalter bleiben.
6. Den störenden Desktop-Navigationsschalter versetzen, nicht ersatzlos entfernen.
7. **Jeder gültige Website-Eingang wird ein Event im Status Option, auch ohne zuordenbaren Kontakt oder Land.** Kein Sonder-Posteingang unter Events. Keine erfundenen Kontakte, keine automatische Buchung oder Ressourcenbestätigung.
8. Eventfilter in Gruppen und Position an Bookitup angleichen; vorhandene korrekte Zeit-/URL-Logik wiederverwenden.

„Alle Eingänge“ hebt Spam-, Schema-, Signatur- und Autorisierungsprüfung nicht auf. Eine kaputte oder nicht authentische HTTP-Anfrage wird kein Event. Ein gültiger Geschäftseingang darf dagegen nicht an fehlender Kontaktanreicherung scheitern.

## Lesereihenfolge für einen neuen Agenten

1. [AGENTS.md](../../AGENTS.md), [Projektübergabe](../handoff.md), relevante Anforderungen im [Lastenheft](../../Lastenheft_Fotobox-Verwaltung_MVP.md), aktuellen [Implementierungsplan](../../IMPLEMENTATION_PLAN.md).
2. [Beobachtungen und Funktionsvergleich](observations.md): Was wurde wirklich gesehen, was nur im Code festgestellt, was ist offen?
3. [UI- und Interaktionsvertrag](design-contract.md): Zielanordnung, mobile Regeln, Filter, Details, Themes und Fehlerzustände.
4. [Ausführungsanleitung für Agenten](agent-playbook.md): genau ein Ticket auswählen, Voraussetzungen prüfen, Tests zuerst, Review, Commit, Push.
5. Ticketgruppen: [Kalender, Oberfläche und Filter](tasks-ui.md), [Website, Stammdaten und Events](tasks-core.md), [Dokumente, Dateien und Mails](tasks-documents-mail.md), [weitere Parität und Abnahme](tasks-completion.md).

## Reihenfolge, Status und Bedeutung der Ticketnummern

**R001** ist ausschließlich diese Analyse/Dokumentation. **BKP001–BKP030 sind offene Arbeitspakete**, keine fertigen Features. Sie bilden keine zweite konkurrierende Commitfolge: vor Start wird genau ein BKP-Ticket mit seinem Scope und Abnahmetest im Implementierungsplan aktiviert. Ein Paket mit mehreren notwendigen vertikalen Schritten wird dort in Unter-Slices aufgeteilt; nicht als riesigen Sammelcommit umsetzen.

| Reihenfolge | Tickets | Zweck / Abhängigkeit |
| --- | --- | --- |
| Sofortige Fehler | BKP001 | Falsche Wochentagszuordnung; unabhängig von neuem Design |
| Website-Verhalten | BKP002 → BKP003 → BKP004 | Kontaktlose Option, faire Wiederholung, danach Ausnahmebereich entfernen |
| Lesbarkeit / Bediennähe | BKP005, BKP006, BKP007 | Neutrale Tokens, Sidebar-Schalter, Filterspalte/Drawer |
| Mobiler Kalender | BKP008 | Nach BKP001; Grid + lesbare Tagesdetails, keine verlorenen Events |
| Verwaltungsabläufe | BKP009–BKP014 | Ressourcen, Produkte, Kontakte, Event-Details und Liste |
| Dokumente | BKP015–BKP019 | Vorlagenverwaltung, editierbarer Entwurf, freie Anlage, Layout, Lebenszyklus |
| Dateien und Kommunikation | BKP020–BKP025 | Sichere Bibliothek, Mail-Datenkern, Postfach, Editor, Vorlagen, Versandplanung |
| Weitere Parität | BKP026–BKP030 | Aufgaben, Verträge/Fragebögen, konfigurierbare Formulare, Auswertungen, Gesamtprüfung |

Die Reihenfolge innerhalb unabhängiger UI-Arbeiten darf ein Agent begründet wählen. Mailversand hängt zwingend von dauerhaftem Mailkern/Outbox und sicheren Anhängen ab. Keine toten Menüpunkte oder Scheinbuttons für erst geplante Funktionen einbauen. Ausstehende Ressourcenmodul-/Mobilbeobachtungen stehen in BKP030; sie sind keine erfundenen Bookitup-Verträge.

## Was bereits existiert und erhalten bleiben muss

- Eigener Passwortlogin, 90 Tage absolute Sitzungsdauer, Mandantentrennung, CSRF, Wiederherstellung und Audit.
- Mobile Navigation, Desktop-Kompaktleiste, Hell/Dunkel, Suchfunktion, Aktionsstufen, Dirty-Schutz.
- Reduzierter Event-Anlegedialog, Dialoge für Kontakte, Monatsgruppen, Such-/Status-/Artfilter und tenant-lokale Schnellzeiträume einschließlich URL/Zurück.
- Ressourcenstamm, physische Einheiten, Puffer, Vormerkungen, atomarer Konfliktschutz, Sperren, Kalender und ICS.
- Automatische Website-Option-Pipeline bereits vorhanden; sie braucht eine gezielte Korrektur, keine zweite Importstrecke.
- Geschäftsdokument-Vorlagen, exakte Geldrechnung, getrennte Nummernkreise, Entwurf/Finalisierung, unveränderbare PDF-Artefakte und globale Dateienübersicht für diese Dokumente.
- CSV/Minimalimport/Restore/Betriebswerkzeuge. Keine pauschale Freigabe echter Importe durch diesen Auftrag.

Insbesondere nicht erneut „globalen Dokumentindex“, „Kontaktformular hinter Plus“, „Schnellzeiträume“, „automatische Option-Anlage“ oder „sieben flexible Monatsspalten“ als gänzlich fehlend bauen. Der aktuelle Code ist der Ausgangspunkt.

## Beweisgrenzen und Datenschutz

Die Beobachtungs-IDs `B…` und `A…` sind **lokale Audit-Bezeichnungen, keine REA Evidence-IDs**. Rohbilder und AX-Bäume liegen ausschließlich privat unter `~/Documents/AuftragsKompass-Sicherung/bookitup-audit-2026-10-22/`. Sie enthalten reale Daten und dürfen nicht in dieses öffentliche Repository, Issues, Testfixtures oder CI-Artefakte kopiert werden. Auf anderen Rechnern ist dieser Ordner nicht automatisch vorhanden. Für Tests ausschließlich ausdrücklich fiktive Daten erzeugen.

REA-Skill aus [morluto/rea](https://github.com/morluto/rea/tree/main) installiert und gelesen (`reverse-engineer-anything`, Skill-Metadaten v45). Die npm-CLI `rea-agents` meldete 6.7.0, deren gebündelte Skill-Version ist nicht dieselbe. Der Doctor meldete Codex-Registrierungsabweichung; in dieser Session waren keine REA-MCP-Werkzeuge verfügbar. Chrome lief ohne bekannten lokalen CDP-Endpunkt. Ein nativer CLI-Beobachtungsversuch lieferte nur Validierungsfehler wegen fehlender exakter PID/Fensterkennung, **keine Runtime-Evidence**. Keine Chrome-Neustarts, Debug-Freigaben oder MCP-Konfigurationsänderungen wurden vorgenommen. Die tatsächlichen UI-Belege stammen aus der Chrome-Steuerung (AX/DOM/Screenshots), die AuftragsKompass-Implementierung aus lesbarem Quellcode. Nicht als REA-Decompilation oder vollständige Netzwerk-/Backendanalyse von Bookitup ausgeben.

Der Vergleich war lesend: keine Speichern-/Übernehmen-/Senden-/Löschen-/Freigeben-Aktionen, keine Trial-Aktivierung, keine echten Buchungen verändert. Leere Dialoge wurden geschlossen, keine Inhalte eingegeben. Das Öffnen von Listen/Formularen beweist keine Speicher-, Versand- oder Autosave-Semantik des fremden Servers. Diese bleibt unbekannt, wenn sie nicht sicher lesend erkennbar ist.
