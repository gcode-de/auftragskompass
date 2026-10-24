# Projektübergabe AuftragsKompass

Stand der Fortsetzung: **24.10.2026**. Aktuelle Abschnitte stehen oben; frühere datierte Berichte bleiben historische Nachweise. Einstieg für eine neue Arbeitssession und kompakter Funktionsüberblick. Dieses Dokument ersetzt weder den aktuellen Git-/CI-/Betriebsabgleich noch das Lastenheft. Bei Fortsetzung aktualisieren; keine alten Kontingentwerte oder Chat-Automationen ungeprüft wiederverwenden.

## Dokumentlayout BKP018.1: 24.10.2026

Einstellungen→Dokumentlayout (`#settings-document-layout`) zeigt Zusammenfassung,
explizites Bearbeiten und Ersteinrichtung bei bestätigtem GET404. Absender und
neun vorhandene Layoutfelder sind editierbar, Darstellungsoptionen aufklappbar.
POST-Erstanlage und versionsgesichertes PUT; bestätigte Antwort muss zu
übermittelten Werten/erwarteter Version passen. Konflikt, verschwundenes Layout
und unklarer Speicherausgang erhalten Eingaben und verlangen ausdrückliches
Verwerfen/Neuladen. PUT legt eine verschwundene Konfiguration nicht neu an.

Neuer POST `/api/v1/document-layout/preview` prüft genau neun Felder ohne fremde
Schlüssel, Auth/CSRF und aktive Mandantenberechtigung. Read-only-Snapshot aus
Mandantenzeitzone und eigenem Logoverweis; anschließend Storage lesen und echte
PDF rendern. Ausschließlich fiktive Beispieldaten, keine Geschäftsnummer,
Persistenz oder Audit. Die aktuellen ungespeicherten Werte werden verwendet.
PDF-Typ/Signatur werden vor Blob-Link geprüft, alte URLs nach Änderungen und
Unmount widerrufen; keine iframe-/CSP-Ausnahme. In Headless Chrome kann der
Öffnenlink als Download enden; tatsächliche PDF-Bytes sind geprüft.

16 neue Komponentenfälle und 12 Layout-Integrationen grün, vollständige
Coverage-Suite 1033 Tests (97,06 Prozent Zeilen/93,29 Prozent Branches),
Changed-Code 215/234 Zeilen und 201/236 Branches. Schnelle Gates/Build grün;
synthetischer realer PG-/HTTPS-/Chromiumablauf mit acht Zuständen bei
320/390/768/1280 in beiden Themes, axe, Persistenz/Reload, echten Fehler-/409-
Zuständen und tatsächlicher PDF grün. Unabhängige UI-/Backend-Reviews ohne
Blocker; Impeccable-Detector keine Befunde in geändertem Code, 61 Bestandshinweise
in gemeinsamer CSS-Datei bleiben separat. Rohbelege ausschließlich privat.

**Offen:** Logo-Uploadoberfläche BKP018.2; längere Beschriftungen in der bestehenden
mobilen Einstellungsnavigation brechen bei 320px unschön innerhalb von Wörtern.
Diese Navigation soll anschließend als eigener kleiner Slice kompakter und
lesbarer werden, nicht durch zusätzliche Dekoration. Keine vollständige
Bookitup-Parität behaupten. CI+Images, automatischen Updater, Sicherung und
Live-Assets dieses neuen Funktionsstands vor Auslieferungsaussage prüfen;
letzter vollständig belegter Betrieb oben/unten historisch 132ace1.

## PDF-Seitenzählung BKP018.0b: 24.10.2026

Neu erzeugte Dokumente nutzen bei aktivierter Option echte Chromium-Seitenzähler
„Seite X von Y“ in einer nativen Marginbox; deaktiviert erscheint keine Nummer.
Farbe/Schrift aus dem Layout, rechte Kante zur vorhandenen Tabelle ausgerichtet.
Der feste Endabsatz „Seite 1“ entfällt. Bestehende finale Bytes und Hashes bleiben
unverändert; keine neue Dependency oder Renderer-Signatur. Unit- und Browser-RED
beobachtet, 62 fokussierte Unit-/Integrationstests, 257 Unit-/459 Komponenten
gesamt, schnelle Gates/Build und echter Chromium-Smoke grün; Changed-Code-Zeile
und beide Branches vollständig gedeckt. Elf gerenderte Seiten visuell geprüft
und extrahiert: einseitig 1 von 1, mehrseitig 1–5 von 5, deaktiviert keine Nummer.
CI legt die drei synthetischen PDF-Smoke-Artefakte ab; seitenweise Textextraktion
ist lokale QA ohne Parserdependency. CT-Chromium 156 ist verifiziert. Nächster
Slice: sichtbare Dokumentlayout-Konfiguration und sichere Vorschau ungespeicherter
Werte; Uploadoberfläche separat. Auslieferung erst mit grüner CI+Images/Checkpoint
belegen, letzter abgeschlossener Laufzeitnachweis bleibt vorerst 132ace1.

## Logo-Integrität BKP018.0: 24.10.2026

Auf `codex/ux-event-simplification` implementiert: Upload prüft aktive
Mandantenberechtigung vor Storage-Schreiben, verwendet unveränderliche UUID-Keys
und aktualisiert Zeiger/Version/Audit unter derselben Mandantensperre.
Migration 0036 erhält Legacy-Zeilen; fremde Schlüssel und falsche
Endung-/MIME-Paare werden abgewiesen. Speicher-/DBfehler lassen bisherige Bytes
und DB-Zustand unverändert. Alte/unklare neue Dateien bleiben erhalten, kein GC
oder neues Rollen-/Versionsvertragsmodell. Echte REDs, 47 fokussierte
Integrationstests, vollständige Coverage-Suite 1016 Tests, schnelle Gates und
betroffener Chromiumablauf grün; unabhängiger Review ohne Blocker. CI und
Testauslieferung dieses neuen Stands erst nach Push verifizieren, zuletzt
nachgewiesener Testbetrieb bleibt 132ace1. Als Nächstes separate echte
Mehrseitenzählung, danach sichtbare Layoutkonfiguration mit sicherer Vorschau.

## Aktueller Abschluss H045 und Weiterarbeit: 24.10.2026

Die frühere Kontingentpause ist beendet; das tatsächlich neue Fenster wurde
geprüft, reguläre Nutzung verfügbar, Zusatzguthaben unverändert. Alte Werte unten
sind historische Momentaufnahmen. Weiterhin vor Erschöpfung geordnet abschließen,
kein Credit-/API-Key-Ausweichweg.

**Verifiziert ausgeliefert: `132ace1c2de570d3f48201f49244ac538f7ece7d`.**
Source-CI 40123365972 und Release-CI 40130269260 vollständig grün. Genau ein
automatischer Updater; drei Container gesund mit exakter OCI-Revision, kein
needs-attention, Website-Option-Drain weiterhin off. Checkpoint
`preupdate-132ace1c2de5-20261024T205402130540Z.dump` in CT, Host und privater
Betreiberablage identisch (2.366.356 Bytes; SHA-256
`3d09edb19709b93336b996b6ab2be8442a6700f786cc85335f39bcbc8959facc`).

Live-Assets zeigen Version132ace1. Produktwahl und Blankoangebot bis Reload,
Vorschau, Finalisierung und PDF-Download gegen ausschließlich fiktive lokale
API/DB geprüft. Zwölf Zustände bei 320/390/768/1280 in beiden Themes, axe und
natürlicher mobiler Fokus ohne Überdeckung grün. Drei mit dem echten
Chromium-Renderer erzeugte PDFs (Vorlagenvorschau, Blankovorschau, Blankofinale)
als PNG gerendert und visuell geprüft: jeweils eine lesbare A4-Seite, Positionen,
Summen und Texte ohne Abschneiden. Das ist kein Nachweis für Mehrseitenlayout,
Container-Schriftgleichheit, physische Geräte oder echte Geschäfts-API-Aufrufe.

**Arbeitsweg ab H045:** Die bestehende Branch
`codex/ux-event-simplification` nach sauberem H045-Abschluss per geprüftem
Fast-forward auf den vollständigen Stand bringen und dort die nächsten einzeln
geprüften Slices implementieren. Damit entfällt die doppelte Source-/Release-CI.
Keine Workflow-/Allowliständerung, kein Force-Push; lokale Tests und Review vor
jedem Push sowie vollständige grüne quality+images und Checkpoint vor jedem
Testupdate bleiben Pflicht. Arbeitskopie bleibt
`/Users/gp/Developer/GitHub/auftragskompass-bkp`; die andere Arbeitskopie nicht ändern.

Nächster sinnvoller Slice ist die Integritätsvoraussetzung für BKP018: bisher
schreibt der Logo-Upload vor der Administratorprüfung auf einen wiederverwendeten
Dateischlüssel. Erst mit roten Tests absichern, dann autorisieren und eindeutige
unveränderliche Schlüssel verwenden; alte Dateien für Sicherungs-/laufende
Vorschauverweise erhalten. Neue vorwärtsgerichtete Migration statt Änderung an
0028/0031. Separat vor einer fertigen Layoutkonfiguration prüfen: aktuelle Seitenzahl
ist fest „Seite 1“, echte Mehrseitenzählung bisher nicht belegt. Keine neue
UI oder vollständige Layout-Parität behaupten, bevor die jeweilige Strecke fertig ist.

## Geordnete Kontingentpause: 24.10.2026

Die Arbeit endet mit Abschlussreserve (zuletzt 88 Prozent), reguläre Nutzung
war noch verfügbar, Zusatzguthaben unverändert. Keine automatische Wiederaufnahme
und keine weiterarbeitenden Subagents. Bei Fortsetzung tatsächliche Limits und
`ordinaryUsageAllowed` erneut prüfen; kein Credit-/API-Key-Ausweichweg.

Alle Funktionscommits sofort auf `codex/bkp-wave1` gepusht:
`4ecd5f5` (Netto-Produktübernahme), `fce137b` (Angebots-Produktwahl),
`5740350ce53c37801e5c6760c41456d670a13320` (Blankoangebote). Arbeitsbaum
vor diesem Dokuabschluss sauber. Lokal alle erforderlichen Gates grün:
257 Unit-/459 Komponenten-/295 Integrationstests, 1011 Coverage-Tests,
16 Chromiumfälle im isolierten Nachlauf, zusätzlicher Blanko-Visualnachlauf,
Build, 38 Python-/zwei Node-Ops samt Compose-Sicherung/Restore. Keine
abgeschwächten Assertions oder übersprungenen Tests.

**Noch offen:** Blanko-Source-CI `40123216008` war beim Abschluss noch aktiv.
Dieser Doku-Push kann ihn regulär ersetzen: aktuellen neuesten HEAD/Lauf prüfen,
keine alte Run-ID als Freigabe verwenden. Release-CI `40122668313` für `fce137b`
war ebenfalls noch in quality; sein Image-/Deployabschluss ist nicht nachgewiesen.
Verifiziert laufend bleibt deshalb `0ddba5b` mit den unten dokumentierten
Checkpoint-Kopien und der Live-Asset-Abnahme. Der unabhängige automatische Timer
kann `fce137b` nach vollständig grünen Images später übernehmen; das ist dann
neu zu prüfen, nicht hier als bereits geschehen behauptet.

Nächster Schritt: CI-Fehler gegebenenfalls beheben; beim Testbetrieb tatsächlichen
SHA, drei gesunde Container, Drain off und Checkpoint CT/Host/Betreiber mit
identischer Prüfsumme prüfen. Für die Blankoanlage erst vollständig grüne
Source-CI, geprüften Fast-forward der UX-Branch und grüne quality+images genau
zum freigegebenen SHA abwarten. Migration 0035 braucht den bestehenden sicheren
Checkpoint-/Updaterweg; kein manueller Parallelupdate oder altes Image gegen
neues Schema. Dann neue Live-Asset-Abnahme und Liefermatrix aktualisieren.
Keine neue Funktionswelle beginnen, bevor diese Auslieferung abgeschlossen ist.

## Blankoangebote und Auslieferungsstand: 24.10.2026

**BKP017.1:** Event → Dateien → Neues Angebot bietet „Ohne Vorlage“ auch bei
leerem Vorlagenkatalog. Ein zugeordneter Kontakt bleibt erforderlich. Der neue
v1-Endpunkt `POST /api/v1/documents/blank-offer` legt einen reinen Angebotsentwurf
mit `templateId:null`, eigenen Texten, 14 Tagen Gültigkeit, 0 Positionen/0 Cent
und ohne Nummer/PDF an. Kein versteckter Vorlagendatensatz. Migration 0035
lockert ausschließlich die Vorlagen-Nullbarkeit, erhält den Mandanten-FK und
beschränkt Vorlagenlosigkeit per Check auf vollständigen Angebotskontext.

Der Editor öffnet nur nach bestätigter Blankoanlage automatisch. Leere Positionen
sind ein neutraler Anfangszustand; sie sperren Speichern/Vorschau/Finalisierung,
aber erzeugen keine falsche Verwerfrückfrage. Freie und Katalogpositionen sowie
Text-/Versions-/Konfliktschutz werden wiederverwendet. Renderer/Finalisierung
verwenden eigene Texte ohne Vorlagenfallback; finale Nummern, Hashes und Dateien
bleiben unveränderbar. Initiale Ladefehler sperren die Anlage und bieten Retry.
Unklare Antworten einschließlich 5xx verlangen zuerst Bestandsabgleich; dauerhafte
POST-Idempotenz über Browserneustarts ist weiterhin nicht vorhanden.

Echte REDs für fehlende Repository-Methode, unplausible Erfolgsantwort sowie
Ladefehler/503 beobachtet. Gesamte Unit-/Komponenten-/Integrations-/Coverage-
Prüfung grün (257/459/295, zusammen 1011; Changed-Code 61/65 Zeilen und 99/109
Branches). Der reale synthetische PostgreSQL-/HTTPS-Browserablauf prüft auch
Blanko-Reload, Vorschau, Finalisierung, Nummer/Hashes und PDF-Download; dessen
Renderer ist ausdrücklich ein deterministischer PDF-Stub. Kein Anspruch auf
vollständige PDF-Layoutabnahme. Impeccable-Detector beider UI-Dateien `[]`,
unabhängiger Review ohne Blocker. Abschließend alle 16 Chromiumfälle im isolierten Nachlauf grün; die vier neuen
Blanko-Breite-/Theme-Bilder plus mobile axe-Prüfungen ebenfalls. Build und
38 Python-/zwei Node-Betriebstests einschließlich Compose-Sicherung/Restore
grün. Keine Tests oder Assertions übersprungen.

**Verifiziert ausgeliefert:** `0ddba5b8f6d948244340b3e174d170a8ae365efb`
über Release-CI `40120899761` (quality+images grün). Drei Container gesund,
exakte OCI-Revision, kein `needs-attention`. Checkpoint vom 24.10.2026 18:48 UTC
in CT, Host und Betreiberablage mit identischem SHA-256 `1f21689e…886bf7`.
Browserprüfung mit tatsächlich geladenen Live-Assets und sichtbarer Version
0ddba5b grün; acht Theme-/Breitenbilder 320/390/768/1280 ohne visuellen Blocker.
Geschäfts-API/Datenbank waren dabei lokal und fiktiv, keine echte Anmeldung oder
Kundendatenänderung. Feste Navigation in langen Vollseitenbildern ist keine
vollständige Prüfung normaler mobiler Scroll-/Fokusfreiheit; Geräteprüfung offen.

BKP015.1/BKP016.4 liegen auf `fce137b`, Source-CI `40121471376` grün; die
UX-Branch wurde per geprüftem Fast-forward vorgezogen, Release-CI `40122668313`
ist abzuwarten. Bei Fortsetzung tatsächlichen Betriebsstand prüfen. Keine
pauschale Aussage, die neuesten Blanko-/Produktfunktionen seien bereits live.
Genau ein automatischer Updater; Website-Option-Drain weiterhin off belassen.

**Prüfdisziplin:** Gleichzeitige Playwright-Aufrufe dürfen nicht dasselbe
`outputDir` verwenden. Ein fokussierter Lauf löschte im Gesamtprüfungslauf
Trace-Dateien (ENOENT beim Passwort-Test). Der abschließende Nachlauf verwendet
ein eigenes `--output`; keine Produktänderung oder höhere Timeouts dafür.
PDF-Antwortbytes im Browsertest vor `route.fulfill` aus `route.fetch` lesen,
bevor Chromiums PDF-Navigation den Body unzugänglich macht. Keine Assertions,
Nummern-/Unverändert-Nachweise oder Auth-Prüfungen dafür entfernen.

## Angebotspositionen aus Produkten: BKP016.4 (24.10.2026)

Der Angebotseditor lädt den Katalog erst über „Produkt hinzufügen“. Auswahl und
„Als Position hinzufügen“ erzeugen eine neue bearbeitbare Snapshot-Position;
bestehende Positionen bleiben erhalten. Menge 1, Rabatt 0, Netto-Katalogpreise
werden exakt in Brutto umgerechnet. Gespeicherte archivierte Bezüge bleiben
bestehen, stehen aber nicht neu zur Auswahl. Katalogfehler/Retry/Leerzustand
blockieren keine freien Eingaben und verdrängen keine Speicher-/Konfliktmeldung.
Keine neue API/Migration, keine Produktänderung, keine Blankoanlage.

Echte RED-Regressionsfälle vor Umsetzung. Grün: 24 Editor-Komponententests,
1001 Tests in der gesamten Coverage-Suite; geänderte Zeilen 52/54, Branches 74/82;
Format/Lint/Typen/Workspace/Docs und Build. Ein realer Chromiumablauf gegen eine
wegwerfbare PostgreSQL-/Fastify-/HTTPS-Instanz belegt Netto/Brutto, Fokus,
Erhalt bei verzögertem Katalogfehler, Retry/Leerzustand, tatsächliche Persistenz,
Reload und unveränderte Katalogdatensätze. Acht lokale Breite-/Theme-Zustände
320/390/768/1280; axe bei 390 und im Leerzustand. Unabhängiger Code-Review ohne
kritischen Befund, Impeccable-Detector `[]`. Kein Nachweis für physische Geräte
oder vollständige Bookitup-Parität; Auslieferung erst nach CI/Imagefreigabe.

## Produktpreis-Korrektur: BKP015.1 (24.10.2026)

Die Produktwahl in Dokumentvorlagen kopierte bisher Netto-Katalogpreise
unverändert in Brutto-Positionen. Reproduziert: 100,00 Euro netto bei 19 Prozent
wurden als 100,00 statt 119,00 Euro brutto gespeichert. `grossProductPrice()`
rechnet bei ausdrücklicher Übernahme mit BigInt und Halbauf-Rundung in sicheren
Centbeträgen; Bruttopreise bleiben unverändert. Fehler erhalten sämtliche
Positionsfelder und zeigen eine korrigierbare Meldung. Beim Öffnen einer anderen
Vorlage verschwindet die alte Meldung. Keine automatische Änderung bereits
gespeicherter Vorlagen, Entwürfe, Produkte oder finaler Dokumente: alte aus
Nettoprodukten übernommene Positionen bei Bedarf ausdrücklich prüfen/korrigieren.
Die vorhandene Vorlage bleibt ein Snapshot; die Produktwahl im Angebotseditor
ist weiterhin ein eigener nächster Slice. Keine Migration oder neue Abhängigkeit.

Komponentenregressionen waren für falschen Nettobetrag und alte Fehlermeldung
zuerst rot. Fokussiert grün: fünf Unit-, zwölf Vorlagen-Komponenten- und zwei
Chromiumfälle; sechs Breite-/Theme-Zustände 320/390/1280 mit axe und Screenshots.
Zusätzlich grün: gesamte Coverage-Suite 995 Tests, geänderte Zeilen/Branches
vollständig abgedeckt, Format/Lint/Typen/Workspace/Docs und Build.
Die Browserprüfung nutzt synthetische API-Antworten, keinen Persistenznachweis
gegen eine echte Datenbank. Unabhängiger Code-Review ohne Befund; Impeccable-
Detector der geänderten Oberfläche `[]`. Gestaltung bleibt unverändert; langer
Vorlageneditor ist weiterhin ein bekannter Bestand, kein überarbeiteter Flow.

## Wiederaufnahme und CI-Korrektur: 24.10.2026

Das tatsächliche Fünf-Stunden-Fenster ist zurückgesetzt, reguläre Nutzung
ist verfügbar. Vor neuer Arbeit erneut prüfen; kein Zusatzguthaben verwenden.
Der abschließende Lauf `40088360284` auf `d6c566a` war rot: nur das große
Passwort-Browserszenario überschritt sein 180-s-Gesamtbudget, 13 weitere
Chromiumfälle sowie alle vorangehenden Gates waren grün. Der synthetische
Trace belegt fortlaufende Arbeit bis zur H031-Navigation nach 75 axe-Berichten.
H043 erhöht ausschließlich dieses Gesamtbudget auf 240 s, lässt Google bei
180 s und Aktionen bei 10 s. Jede axe-Auswertung wird unmittelbar nach
Berichtablage geprüft; die frühere Sammelprüfung lag vor später ergänzten
Website-Zuständen. Kein Retry, Skip oder entfernter Prüfumfang. Beide Auth-
Abläufe lokal grün (Google 47,1 s, Passwort etwa 96 s), außerdem 252 Unit-,
441 Komponententests, Typen, Format, Lint, Workspace/Docs und Build.
Neue vollständige CI abwarten, bevor der bestehende Testbetrieb aktualisiert
wird. Der folgende Pausenbericht bleibt als datierter Zwischenstand erhalten.

## Fortsetzung nach Kontingentpause: 24.10.2026

Aktiver Checkout `/Users/gp/Developer/GitHub/auftragskompass-bkp`, Branch
`codex/bkp-wave1`. Funktionscommits: `1210a8f` (eigene Entwurfstexte/Vorschau),
`9f4b707` (exakte Summen), `7769be119ddb7654075435c381b2c444a08e3eb3`
(Positionseditor). Alle sofort gepusht. Gesamter lokaler `pnpm check` grün:
986 Tests im Coverage-Lauf, 14 Chromium-Abläufe, Build, 38 Python- und zwei
Node-Betriebstests samt Compose-Sicherung/Restore; letzte Typechecks und
18 Editortests ebenfalls grün. Vollständiger gestagter Diff unabhängig geprüft.

Bewusster Abschluss bei 89 Prozent des Fünf-Stunden-Fensters; Zusatzguthaben
laut Nutzungsanzeige unverändert. Keine automatische Wiederaufnahme geplant.
**Nicht ausgeliefert:** UX-Branch und Home Lab zuletzt weiter `605f75b`.
CI für `9f4b707` erfolgreich (40087191836); der neueste Funktionslauf
40088282268 war noch offen. Der Dokumentationsabschluss kann dessen
Branch-Lauf regulär ersetzen: bei Fortsetzung den tatsächlichen HEAD und
aktuellsten Lauf prüfen, keine alte Run-ID als Freigabe verwenden.

Zuerst aktuelle Nutzung prüfen und vollständig grüne CI abwarten; danach
freigegebene UX-Branch nur per geprüftem Fast-forward vorziehen, dort grüne
Quality **und Images** abwarten und einzigen koordinierten Updater verwenden.
Checkpoint, identische CT-/Host-/Betreiberkopie, drei gesunde Container mit
exakter OCI-Revision und ausgelieferte Oberfläche nachprüfen. Installierte
Updater-/Checkpoint-Skripte entsprachen zuletzt per SHA-256 dem Repository.
Kein paralleler manueller Updater, Website-Option-Drain bleibt aus.
Erst danach nächste konkrete Paritätsaufgabe auswählen (Produktwahl für
Angebotspositionen oder Blankoanlage nach Plan); kein weiterer Ausbau während
dieser Abschlussreserve. Luna-Agenten sind fertig und bearbeiten keine Dateien.

## Neuer verbindlicher Arbeitsauftrag und Prüfbasis: 22.10.2026

**Fortsetzung 24.10.2026:** Der Nutzer beauftragt jetzt die Umsetzung in diesem
Codex-Chat mit klar abgegrenzten **GPT-6-Luna-Subagents**; der Hauptagent
koordiniert, integriert und prüft. Der externe Hermes-Auftrag ist wegen seines
Anbieterlimits pausiert und darf nicht parallel dieselben Dateien bearbeiten.
Priorität hat ein tatsächlich nutzbarer Angebotsablauf; BKP016 wird in getestete
vertikale Unter-Slices zerlegt. Ponytail und Impeccable bleiben verbindlich;
Taste v2 gilt weiterhin nicht für Admin-Oberflächen, REA nur für passende
Referenzbeobachtungen. Vor größeren Schritten das echte Fünf-Stunden-Kontingent
prüfen: ab 80 Prozent keine großen neuen Slices, spätestens um 90 Prozent mit
Abschlussreserve stoppen; keine API-Key-/Credit-Ausweichlösung. Eine bloße
Software-Zusage ist keine kontoweite Credit-Sperre.

**BKP016.1 (24.10.2026):** Der Angebotsentwurf erhält eigene Texte/Gültigkeit
aus der Vorlage, einen versionsgesicherten Inline-Editor und eine gespeicherte
PDF-Vorschau ohne Nummern-/Artefaktverbrauch. Positionen bleiben in diesem Slice
lesend; Positionsbearbeitung ist der nächste eigene Unter-Slice, Blankoanlage
folgt BKP017. Alte Entwürfe werden nicht historisch nachbefüllt. Backend- und
Komponentenregressionen zuerst rot beobachtet; danach 244 Unit-, 436 Komponenten-
und 288 Integrationstests grün, gemeinsam 968 mit Coverage 97,19 % Zeilen /
93,68 % Zweige; Changed-Code 261/271 Zeilen und 278/325 Zweige. Browserprüfung
mit isoliertem PostgreSQL und synthetischen Daten: Speichern/Neuabruf,
Vorlagenunabhängigkeit, Vorschau ohne Mutation, acht Ansichten bei
320/390/768/1280 in beiden Themes, editorbezogenes axe bei 390. Die PDF im
Browserablauf nutzt einen deterministischen Rendererersatz; das echte PDF-Layout
ist damit nicht visuell abgenommen. Impeccable-Finish: alle acht Bilder geprüft;
einmaliger Quellscan nur Regex (keine DOM-Kontrastprüfung), einziger harter Fund
ist der unveränderte, ausdrücklich referenzbasierte Statusstrich der Eventkarte.
Die neuen Schriftgrößen 1rem/0,95rem verwenden bestehende Stufen und sind in
DESIGN.md dokumentiert. Keine vollständige Bookitup-Parität behaupten.
Der vollständige lokale `pnpm check` ist grün, einschließlich 14 Chromium-
Abläufen, Build und Compose-Sicherung/Restore (38 Python- und 2 Node-Betriebstests).
Der früher dokumentierte macOS-RLIMIT-Fehler trat in diesem Lauf nicht auf.
Commit-/CI-/Auslieferungsnachweis nach Abschluss in der Liefermatrix prüfen.

**BKP016.2 (24.10.2026):** Große zulässige Beträge verloren im bisherigen
Summendienst einen Cent. Regressionen zuerst rot beobachtet; Ganzzahl-
Zwischenwerte erhalten nun Rabatt-, Steuer- und Summengenauigkeit, API-
Centwerte und vorhandene Brutto-Bedeutung bleiben erhalten. 974 Tests im
gemeinsamen Coverage-Lauf grün, anschließend acht aktuelle fokussierte
Summenregressionen einschließlich ungeradem Steuerteiler und getrennten
Steuergruppen; Format/Lint/Typen/Workspace/Docs, Angebots-Chromiumablauf und
Build grün. Keine pauschale Änderung alter Dokumente oder finaler Artefakte.
Zusätzliche manuelle PDF-Prüfung zu BKP016.1: ein rein fiktives Angebot durch
den echten Chromium-PDF-Renderer erzeugt und mit Poppler als Seite angesehen;
Empfänger, Gültigkeit, Positionsspalten, Summen und Seitenzahl lesbar ohne
Überlappung. Dies prüft ein typisches einseitiges Beispiel, keine vollständige
Mehrseiten-/Langtext-Abnahme. Testartefakte außerhalb Git.

**BKP016.3 (24.10.2026):** Angebotspositionen sind im fokussierten Editor
bearbeitbar; freie Positionen lassen sich ergänzen/entfernen. Euro/Prozent
werden exakt übersetzt, alle Texte und Positionen mit einer Version atomar
gespeichert. Die Liste übernimmt bestätigte Summen direkt aus der Antwort;
auch ihre Centanzeige verwendet den exakten bestehenden Formatierer. Fehlende
`lines` im API-Aufruf erhalten die bisherigen Zeilen/IDs. Bestehende
Produktbezüge bleiben mandantengebunden, auch bei archivierten Produkten;
Produkte und Vorlagen werden nicht verändert. Neue Produktwahl, Blankoanlage
und Netto-Eingabemodus bleiben eigene Folge-Slices. Kein vollständiger
Angebots-/Rechnungs-/Mailprozess oder vollständige Bookitup-Parität.
Abschlussprüfung umfasst atomaren Rollback, zwei Bearbeiter und
Bearbeitung/Finalisierung gleichzeitig, Eingabeerhalt, gesperrte Felder während
Speichern, Fokus nach Hinzufügen/Entfernen und Vorschau nur des gespeicherten
Stands. Reine Testdaten in isolierten Datenbanken; keine echten Belege erzeugt.
Prüfstand: 986 Tests im gemeinsamen Coverage-Lauf (252 Unit, 441 Komponenten,
293 Integration), 97,20 % Zeilen / 93,67 % Zweige, Changed-Code 87/89 Zeilen
und 81/89 Zweige; 18 fokussierte Editortests nach den letzten Korrekturen
grün. Acht Ansichten 320/390/768/1280 in Hell/Dunkel und editorbezogenes axe
bei 390 geprüft. Keine neuen Skills oder Abhängigkeiten; Ponytail/Impeccable
und die bestehende Designwelt fortgeführt.

**Regionaler Betriebsrahmen (ausdrückliche Nutzerkorrektur 24.10.2026):**
Vermietungen finden in Südwestdeutschland und höchstens im Elsass statt.
Die Oberfläche arbeitet mit der bestehenden Betriebsortszeit Europe/Berlin;
keine zusätzlichen Zeitzonen-Auswahlen oder internationale Dispositionslogik
für diesen Ausbau bauen. Sommer-/Winterzeit, Kalendertage und Termine über
Mitternacht bleiben korrekt; vorhandene UTC-Speicherung und gemeinsame
Zeithelfer nicht entfernen.

Der Benutzer verlangt jetzt einen möglichst vollständigen funktionalen und in der Bedienlogik nahen Bookitup-Klon mit vorsichtiger Vereinfachung. Der ausführliche [Paritätsauftrag](bookitup-parity/README.md) mit [Beobachtungen](bookitup-parity/observations.md), [UI-Vertrag](bookitup-parity/design-contract.md), [Agentenanleitung](bookitup-parity/agent-playbook.md) und BKP001–BKP030 ist der neue Einstieg für diese Arbeiten. Alte M5/M6-Auslassungen beschreiben den früheren verkürzten Start, nicht mehr das vollständige Ausbauziel. Sie autorisieren weiterhin keinen ungeprüften Produktivwechsel oder echte Daten-/Mailaktionen.

Neu ausdrücklich: neutraleres Grün in beiden Themes, kompakte ausgerichtete Controls, Collapse-Schalter versetzen, Filter wie Bookitup positionieren, mobile Kalenderbedienung verbessern; jeder gültige Website-Eingang wird Option auch ohne Kontakt/Land, Ausnahmebereich unter Events entfällt erst nach abgesicherter Datenlogik. Die DE-Vorbelegung bleibt für fehlende Länder neuer Website-Kontakte erlaubt. Bekannte andere Länder bleiben; das öffentliche v1-Schema erhält nicht beiläufig ein zusätzliches Landfeld.

**Verifizierte Basis dieser Analyse:** Remote-Source `cf68f1e` auf `codex/ux-event-simplification` und gleiche Buildkennung im authentifizierten Chrome. Der ältere lokale Checkout `codex/local-runtime-ci` bei `414fa33` war nicht aktuell. Dokumentation auf `codex/bookitup-parity-audit`, eigener verwalteter Worktree. Die folgenden älteren „ohne Commit“-Notizen sind historische Zwischenstände; insbesondere H041 ist im geprüften Source bereits committed und im Browser vorhanden. Die Analyse hat CI, Containerhealth und Betreiber-Konfiguration nicht neu abgenommen und keinen App-Code/deployment verändert.

Bestätigte Korrekturpunkte: Monatsgrid hat Pads vor vollbreitem Wochentagskopf (falsche Spalte für Tag1), zu enge mobile Datumszellen, Zähler auf bereits serverseitig gefilterten Zeilen, Kontaktzwang bei Website-Optionen und unfairer Option-Worker (älteste zehn/attempted-Set). Zu jedem Befund gibt es konkrete Source-/Testpfade. Keine Aussage über einen tatsächlich eingetretenen Kundenausfall.

REA vom ausdrücklich genannten [Repository](https://github.com/morluto/rea/tree/main) installiert: `~/.codex/skills/reverse-engineer-anything/SKILL.md` (v45); npm-CLI beim Check 6.7.0. MCP war nicht aktiv/Registrierung abweichend, Chrome ohne bekannten CDP-Endpunkt. Kein erfolgreicher REA-Runtimecapture; UI-Belege stammen aus Chrome-Steuerung, AK-Verträge aus Source. Die genaue Bookitup-Mobilkalenderansicht und Trial-gesperrte Ressourcenbearbeitung bleiben offen. Diese Grenzen nicht als vollständige REA-Abdeckung ausgeben. Keine MCP-/Chrome-Konfiguration geändert.

Alle Rohbilder/AX-Bäume nur privat unter `~/Documents/AuftragsKompass-Sicherung/bookitup-audit-2026-10-22/`; niemals in das öffentliche Repo kopieren. Die ausführliche Doku enthält ausschließlich abstrahierte Beobachtungen und Anweisungen. R001 ist ein Dokumentationsslice, BKP-Tickets sind noch nicht umgesetzt. Nächster kleiner unabhängiger Fix: BKP001; Website-Semantik erst mit vorheriger Aktivierungsgrenze aus BKP004 ausrollen, da der bestehende Auto-Updater/Worker sonst echte Rückstände selbst verarbeitet.

### Hermes-Übergabe gestartet

Der Benutzer hat die Übermittlung eines Implementierungsauftrags per Computer Use in das offene Hermes-Fenster ausdrücklich beauftragt. Der [vollständige Prompt](bookitup-parity/hermes-handoff.md) verwendet MiMo als Koordinator und DeepSeek-Coding-Subagents mit getrenntem Dateibesitz, soweit diese in Hermes tatsächlich verfügbar sind. Erste Arbeitswelle BKP001–BKP008; keine automatische Fortsetzung des gesamten Backlogs. Die anfängliche Sperre des Mac wurde manuell aufgehoben. **Am 22.10.2026 um etwa 23:32 Europe/Berlin per Computer Use erfolgreich übergeben und gestartet:** neue Hermes-Session, `opencode-go: mimo-v2.6-pro` mit High; DeepSeek V4.1 Flash ist im Modellauswahlmenü vorhanden und als Coding-Modell im Auftrag genannt. Der vollständige Textanhang wurde nach dem Einfügen mit dem Ausgangstext verglichen (bis auf abschließenden Zeilenumbruch identisch), mit kurzer Startnachricht abgesendet. Hermes führte sichtbar `pwd` und weitere Stand-/Prozessprüfungen aus und meldete bestehende uncommittete H042-Arbeit in seinem Checkout. Der Startzusatz weist ausdrücklich an, diese Arbeit zuerst zu prüfen und weder zu verwerfen noch parallel zu überschreiben. Ein Screenshot liegt ausschließlich lokal unter `/tmp/auftragskompass-hermes-start-2026-10-22.png`. Nachgewiesen ist der Arbeitsbeginn des Koordinators; noch keine neue Implementierung oder tatsächlich gestartete DeepSeek-Delegation behaupten.

## In der nächsten Session zuerst

1. [AGENTS.md](../AGENTS.md) vollständig lesen; dann diese Übergabe, den relevanten Abschnitt des [Lastenhefts](../Lastenheft_Fotobox-Verwaltung_MVP.md) und den aktuellen Slice im [Implementierungsplan](../IMPLEMENTATION_PLAN.md). Für Auslieferung und den tatsächlichen Stand der sichtbaren Ergebnisse gilt der [Lieferworkflow mit Statusmatrix](bookitup-parity/delivery-workflow.md) (IMPLEMENTIERT / VISUELL ABGENOMMEN / IM TESTBETRIEB AUSGELIEFERT).
2. `git status`, Branch, Remote und letzte Commits prüfen. Arbeitsbranch seit H022: `codex/ux-event-simplification` (Basis `codex/local-runtime-ci`), Remote: [gcode-de/auftragskompass](https://github.com/gcode-de/auftragskompass). Nicht automatisch zu `main` wechseln oder gepushte Commits umschreiben.
3. Angeforderte Skills unten lokalisieren und vor ihrer Anwendung lesen. Der bestehende Entwurf ist eine Verwaltungs-App, keine neue Marketingseite.
4. Für Betriebsarbeit zusätzlich die private Betreiberübergabe lesen: außerhalb Git unter `AuftragsKompass-Sicherung/uebergabe-2026-10-19/README.md` im Dokumente-Verzeichnis des bisherigen Betreiberrechners. Auf einem anderen Rechner ist sie nicht automatisch verfügbar. Keine Secrets in den Chat oder Git übernehmen.
5. Genau einen passenden nummerierten Slice auswählen beziehungsweise im Plan konkretisieren. Tests zuerst bei Verhaltensänderungen; erforderliche Gates, explizites Staging, vollständiger staged Review, ein Conventional Commit, sofortiger Push. Kein automatischer Produktivwechsel.

## Ziel und aktuelle Priorität

AuftragsKompass soll Bookitup für einen Fotobox-Betrieb ersetzen, zunächst lokal im Home Lab. Spätere andere Dienstleister bleiben strukturell möglich; kein vorgezogener SaaS-Ausbau. TypeScript, React/Vite, Fastify, PostgreSQL/Drizzle und ein PostgreSQL-basierter Worker; der öffentliche Gateway bleibt von der lokalen Administration getrennt.

Für den früheren Bookitup-Ausstieg gilt die [verkürzte Lieferfolge](bookitup-exit.md). M5/M6 sind bewusst verschoben; M3/M4 dürfen zunächst über geprüfte externe Prozesse ersetzt werden. Der Benutzer möchte das Website-Anfrageformular jetzt vorziehen und interessiert sich anschließend für Angebote/Rechnungen. Die Empfehlung aus der letzten Session lautet: **Website-Anfrageweg anschließen, danach Geschäftsdokumente angehen**. Das ist keine Freigabe eines ungeprüften Cutovers und kein Auftrag, alle verschobenen Module automatisch zu bauen.

## Funktionsstand auf hoher Ebene

„Umgesetzt“ bedeutet vorhandene, getestete Funktion im Testbetrieb, nicht vollständige Produktivabnahme oder echte Datenmigration.

| Bereich                                     | Stand                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Noch offen                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anmeldung und Oberfläche                    | Eigener Login mit E-Mail oder Benutzername und Passwort, Passwortwechsel und kontrollierte Betreiber-Wiederherstellung; mobile Navigation, einklappbare Desktop-Icon-Leiste, globale Suche, unterteilte Arbeitsbereiche, Hell/Dunkel und eine kleine Build-Version in der Navigation                                                                                                                                                                  | Weitere lokale Passwortkonten nur bei konkretem Bedarf; Google-OIDC technisch optional, nicht als echter Betreiberlogin eingerichtet                                                                                                                                                  |
| Kontakte und Stammdaten                     | Privat-/Firmenkontakte, Orte, Produkte/Preise, Pakete, Eventarten, Ressourcen und Absagegründe; Suche, Archivierung und Versionsschutz                                                                                                                                                                                                                                                                                                                | Fachlicher Abgleich mit echtem Bestand                                                                                                                                                                                                                                                |
| Events und Aufträge                         | Anlage über kompakten Datum-zuerst-Dialog (H029), Bearbeiten/Duplizieren, Suche/Filter, Monatsgruppen, Event-Details, Status, Notizen und unveränderbares Logbuch; Terminzeiten werden ohne manuelle UTC-Versatzfelder eingegeben (H022)                                                                                                                                                                                                              | Gesamter kommerzieller Ablauf folgt separat                                                                                                                                                                                                                                           |
| Disposition und Kalender                    | Physische Boxen/Zubehör, Vormerkungen, feste Buchungen, Datenbank-Konfliktschutz, Puffer, interne Sperren, Tages-/Wochen-/Monatskalender und widerrufbare ICS-Abos                                                                                                                                                                                                                                                                                    | Echter Ressourcenabgleich vor Nutzung; Smartphone-Abnahme des Kalender-Abos                                                                                                                                                                                                           |
| Website-Anfragen                            | Achtfeldrige Definition, öffentliche API, verschlüsselter Gateway-Eingang, signierte/idempotente Übertragung, dauerhafte lokale Ablage, Quittierung, manuelle Prüfung/Übernahme und mobiles einbettbares Formular entwickelt und synthetisch getestet; seit C028 zusätzlich die Gateway-Laufzeit als eigener Prozess und der Pull-/Quittungstakt im Worker als Code vorhanden                                                                         | Gateway real starten (Kaltstart mit synthetischen Schlüsseln), Podman-Secrets anlegen, erlaubten Website-Origin festlegen, WordPress anschließen und gemeinsam abnehmen                                                                                                               |
| E-Mail/Kommunikation (M3)                   | Geplant                                                                                                                                                                                                                                                                                                                                                                                                                                               | IMAP/SMTP, Zuordnung zu Events/Kontakten, Postfach, Vorlagen, Anhänge, geplanter Versand und Erinnerungen                                                                                                                                                                             |
| Geschäftsdokumente/Finanzen (M4)            | Dokumentvorlagen für alle fünf Arten mit Positionen, Platzhaltern, Versionierung und Oberfläche (C047/C047.1); Marken-Layout und exakte Geldrechnung (C048), Logo über den Storage-Adapter (C048.1), Chromium-PDF (C049) mit Download (C049.1), Nummernkreise (C050/C050.1); seit C051 werden Dokumente als Entwurf gespeichert und mit Nummer, Snapshot und inhaltsadressierter PDF finalisiert; seit C051.3 sind sie in den Event-Details bedienbar | Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, Bearbeiten von Entwürfen, Logo-Upload in der Oberfläche, Annahmen, Auftragsbestätigungen, Rechnungen/Anzahlungen/Korrekturen und Zahlungen; LibreOffice bleibt gewählter externer Übergangsweg, Ablauf noch nicht abgenommen |
| Verträge/Fragebögen (M5)                    | Bewusst zurückgestellt                                                                                                                                                                                                                                                                                                                                                                                                                                | Vorlagen, Kundenlinks, Signaturen, Abschlussnachweise, Fragebögen und kontrollierte Übernahme                                                                                                                                                                                         |
| Aufgaben/Auswertungen (M6)                  | Bewusst zurückgestellt; Absagegründe-Stamm schon vorhanden                                                                                                                                                                                                                                                                                                                                                                                            | To-dos, relative Vorlagen/Fristen, Benachrichtigungen und Absageauswertungen                                                                                                                                                                                                          |
| Migration/Betrieb (M7 teilweise vorgezogen) | Minimalimport mit Vorschau/Dry-run/Mapping/Ressourcenprüfung; CSV-Exporte für Kontakte/Events/Produkte; Container, CI, Updates, verschlüsselte Sicherungswerkzeuge und Restore-Proben                                                                                                                                                                                                                                                                 | Reale Datenübernahme, unabhängiges Sicherungsziel, Aufbewahrung/Timeraktivierung, letzte Delta-Sicherung und fachliche Produktivfreigabe                                                                                                                                              |

C001–C026 sowie C076 sind implementiert; C027–C075 und C077–C085 nicht pauschal als fertig werten. E-/H-Slices ziehen gezielte Teile vor, ohne ganze Milestones als abgeschlossen zu erklären.

## Letzter geprüfter Laufzeitstand

### Arbeitsnachtrag 23.10.2026 (Abschluss Sequenz A+B: Testauslieferung und sichtbare Eventoberfläche)

Der Auftrag „delivery-and-visible-parity.txt“ (Sequenz A+B) ist abgeschlossen; Details und Belege je Ergebnis in der [Statusmatrix](bookitup-parity/delivery-workflow.md). **Jetzt tatsächlich sichtbar im Testbetrieb (getesteter SHA `605f75bd1a913feb6087b4b954de39c5e6420b46`):** neutrale Themes, korrekt ausgerichteter Monatskalender mit Tagesagenda, Website-Optionen ohne Kontaktzwang mit Diagnose in Einstellungen, mobile Filter mit kohärentem Entwurf, Eventliste als scannbare Karten (Datumsspalte/Status/Art/Titel/Ort) und die Eventakte als zusammenhängendes Dossier (stabiler Kopf, Details/Ressourcen/Dateien/Notizen/Logbuch, Dokumente nach Art). Drei koordinierte Auto-Update-Läufe (18:43 `f9adac7`, 20:41 `f8d19ea`, 22:09 `605f75b`) jeweils mit grüner CI inkl. images, genau einem Updateweg, verifizierten Checkpoint-Kopien (CT/Host/Betreiber identisch: `85a8cc79…`, `6b8b4fd9…`, `dcc63a56…`) und durchgehend inaktivem Website-Drain (`AK_INQUIRY_OPTION_DRAIN` nie gesetzt). **Bekannte Restlücken (nicht erledigt markiert):** Filterparität nur erste Unter-Slices (Monat/Jahr, Ansichten, Mehrfachwahl, Solo/Agentur, Statuszähler-Referenz); echte Ressourcenprojektion in der Liste (BKP014.2); Mail-/Aufgaben-/Vertragsmodule fehlen weiter (keine Attrappen); Kalender-Touchbreite 32,9 px bei 320; keine physischen Geräte-/echten Zoom-Abnahmen; keine echte angemeldete Sitzungsansicht in den Abnahmelaufen (Browserfenster waren geschlossen, kein gespeicherter Login, Real-Profil braucht ausdrückliche Freigabe) — alle visuellen Abnahmen liefen an den tatsächlich ausgelieferten live Assets mit fiktivem Bestand (Screenshots/Pixelstatistik privat). Kein Produktiv-Cutover, keine echten Datenimporte/Mails; `main` unangetastet (`9b5f913`). H042 bleibt als eigener Branch erhalten. BKP009–030 unberührt offen.

### Arbeitsnachtrag 23.10.2026 (BKP007.3: mobiler Filter-Entwurf, Korrektur-Slice)

Auf `codex/bkp-wave1` (Slice-Basis `836d627`, MiMo/DeepSeek-Schnitt; Bericht `scratch/bkp007-3-report.txt`, 60 API-Calls): Die von Codex unabhängig reproduzierte P1-Regression der mobilen Filter ist behoben. Der mobile Drawer hält jetzt EINEN kohärenten Entwurf für alle Bedienelemente (Suche/Status/Art/Datum/Sortierung/Presets/„Anfragen“/Zurücksetzen); nichts im Sheet schreibt die URL, das Formular remountet nicht mehr und der Eingabeentwurf geht bei keiner Kombination verloren. „Ergebnisse anzeigen“ schreibt atomar genau einen History-Eintrag und holt die Ergebnisse — Sortierung „Ohne Datum“ bleibt dabei bestehen und löscht die Datumsgrenzen (`undated` nie mehr pauschal leer, der dritte Fehler); „Filter schließen“/Escape verwerfen ALLE Entwurfsänderungen, erhalten die angewandte URL/Ergebnisse und geben den Fokus an den Filterzugang zurück. Desktop bleibt beim Sofortschreiber (bewusst laut Vorgabe). Der Vertragstest „both presentations read the same applied filter state“ ist sinnvoll korrigiert (Sheet-Sort = Entwurf ohne History-Eintrag, Abschluss = genau ein Eintrag), nicht durch Zusatztests ersetzt. Rot auf HEAD-Fassung beobachtet (8 failed), GREEN unabhängig wiederholt: component 402/402 (`event-filter-layout` 17/17), unit 243/243, integration 287/287, `test:coverage` (932 Tests), Changed-Code 44/47 Zeilen und 67/70 Zweige, Format/Lint/Typen/Build/Docs, E2E 13/13 (auth beide Modi: Mischbedienung ohne URL-Schreiben, Abbruch mit Fokusrückkehr, Abschluss mit genau einem Abruf, `goBack` trifft die vorherige URL; 390 hell+dunkel, Desktop-Kontrast). Grenzen: getippte Datumsgrenze hebt den Entwurfs-Sortierer weiterhin auf (alte Regel, auch Desktop-Submit), Popstate bei offenem Sheet lässt den Entwurf stehen, Desktop verliert getippte Suche beim Sofort-Preset (unverändert).

**Stand der Filterparität (klarstellend):** Von BKP007 sind die ersten Unter-Slices **BKP007.1 (Kontextspalte/Mobil-Drawer) und BKP007.2 (Zählbasis) umgesetzt**; dazu BKP007.3 als obiger Korrektur-Slice. Weitergehende Bookitup-Filterparität bleibt **offen**: Monat/Jahr-Bedienung, echte Ansichtwechsel (Liste/Kalender/Zeitleiste), Status-/Art-Mehrfachwahl (API kennt Einzelwerte), Solo/Agentur-Optionen sowie der Referenzabgleich zur Statusabhängigkeit des Anfragenzählers. **Es wird keine vollständige Produktparität behauptet.** Ebenfalls unverändert als Grenzen offen und nicht als erfüllt ausgewiesen: die Kalender-Touchbreite beträgt bei 320 px im 7-Spalten-Raster 32,9 px (Höhe 44 px, ganze Zelle ist Ziel — 44 × 44 ist dort geometrisch unmöglich) und es fehlen physische Geräte- sowie echte Browserzoom-Prüfungen.

### Arbeitsnachtrag 23.10.2026 (BKP008 und Abschluss der ersten Paritätswelle BKP001–BKP008)

Auf `codex/bkp-wave1` (Slice-Basis `84fbc32`, MiMo/DeepSeek-Schnitt; Bericht `scratch/bkp008-report.txt`, 141 API-Calls): Der mobile Monatskalender ist eine echte Arbeitsansicht — das Mo–So-Raster bleibt (BKP001-Ausrichtung unverändert), jede Tageszelle ist ein nativer Knopf mit einzeiliger Zahl, Ereignisanzahl ab zwei Events und gezeichneten SVG-Statusmarken; „heute“ (gestrichelt + Wort) und Auswahl (Kontur + Innenring) sind ohne Farbfläche unterscheidbar. Darunter die vollständige Tagesagenda (ganzer Titel, Zeit bzw. „Tagesbuchung, ohne Uhrzeit“, Status/Ort/Kontakt/Ressourcen, 44-px-Link, „Keine Events an diesem Tag.“), Tageswechsel ohne Neuladen, Raster mit einem Tab-Stopp plus Pfeiltasten. Rot beobachtet (10/10 neue Komponententests); zwei echte Funde der Prüfungen behoben (axe `label-content-name-mismatch` 41 → 0 Knoten, 2 px Grid-Überlauf bei 320). GREEN unabhängig wiederholt: unit 243/243, component 395/395, integration 287/287, `test:coverage` (925 Tests), Changed-Code 57/58 Zeilen und 87/93 Zweige, Format/Lint/Typen/Build/Docs, E2E 13/13 (alle Spec-Dateien, inklusive unveränderter BKP001-Geometrie 3/3) mit Browserabnahme 320/390/768/1280/1440 hell+dunkel. H042-Tageliste bewusst nicht übernommen (Zielvertrag §4). Dokumentierte Grenze: 44 px Zielbreite ist bei 320 px im 7-Spalten-Raster geometrisch unmöglich (Zelle 32,9 × 44 px, ganze Zelle ist Ziel; Pfeiltasten und Agenda als zweiter Weg); kein physischer Touch-Test (kein Gerät).

**Wellenabschluss:** BKP001–BKP008 sind implementiert, geprüft, reviewed und gepusht (siehe Plan-Einträge für Nachweise je Slice; Basis `16616a5`, Branch `codex/bkp-wave1`). Zusammenarbeit wie beauftragt: DeepSeek V4.1 Flash codierte klar abgegrenzte Slices (Berichte/Usage im Session-Scratch), MiMo aktivierte jeden Slice im Plan, prüfte jeden vollständigen Diff, wiederholte Gates und Browserabnahmen unabhängig, führte Git/Commit/Push und die Plan-/Handoff-Doku. Echte H042-Arbeit erhalten auf `codex/h042-mobile-geometry` (`68eee0f`). **Offene echte Punkte (nicht erledigt markiert):** kein Merge/Deploy der Website-Semantik ohne Betreiberentscheid (Aktivierungsgrenze `AK_INQUIRY_OPTION_DRAIN` steht, Rollout-Laufplan mit lesender Mengenübersicht dokumentiert); Referenzabgleich Statusabhängigkeit Anfragenzähler sowie BKP007-Folge (Monat/Jahr, Ansichtwechsel, Mehrfachwahl, Solo/Agentur) warten auf Bookitup-Beobachtung; Sidecar `.impeccable/design.json` driftet (Reparatur über `$impeccable doctor`); physische Touch-/Zoom-Geräteabnahme offen. BKP009–BKP030 bleiben unberührt offen.

### Arbeitsnachtrag 23.10.2026 (BKP007.2: korrekte Zählbasis der Eventfilter)

Auf `codex/bkp-wave1` (Slice-Basis `bb93093`, MiMo/DeepSeek-Schnitt; Bericht `scratch/bkp007-2-report.txt`, 83 API-Calls): Die Eventfilter-Zähler „Ohne Datum“ und „Anfragen“ kommen jetzt mandantensicher aus dem Server (`GET /api/v1/events` ergänzt additiv `filterCounts`) und zählen **datumsunabhängig** — undatierte Events und Anfragen außerhalb des gewählten Datums werden nicht mehr unterschlagen. Eine gemeinsame Filterliste (`q`/`status`/`eventTypeId`) schränkt Zeilen und Zähler gleichmäßig ein; `from`/`to` und Sortierung zählen nie hinein. Die Aggregation läuft als eine `count(*) filter (…)`-Abfrage in derselben Repeatable-Read-Transaktion wie die Liste (keine N+1-Abfragen, keine Gesamtliste in der Antwort; Testbeleg „genau 2 Lesezugriffe“), Abwärtskompatibilität ist getestet (alte Felder feldgleich, Antwortstruktur exakt). Die toten Clienthelfer sind entfernt, die Zählbasis in `docs/event-search.md` tabellarisch dokumentiert. Rot beobachtet (Integration/Component), GREEN unabhängig wiederholt: unit 242/242, component 382/382, integration 287/287, `test:coverage` (911 Tests), Changed-Code 15/15 Zeilen und 14/16 Zweige, Format/Lint/Typen/Build/Docs, E2E auth 2/2. Offene Referenzfrage: Statusabhängigkeit des Anfragenzählers bleibt wie bisher und ist vor Änderung an der Referenz abzugleichen.

### Arbeitsnachtrag 23.10.2026 (BKP007.1: Filter-Kontextspalte und mobiler Filter-Drawer)

Auf `codex/bkp-wave1` (Slice-Basis `b669612`, MiMo/DeepSeek-Schnitt; Bericht `scratch/bkp007-1-report.txt`, 142 API-Calls): Die Eventfilter stehen als Desktop-Kontextspalte (240–280 px, links der Ergebnisse) mit der Bookitup-Gruppenfolge und „Anfragen“ als Schnellfilter außerhalb der Sortier-Radiogruppe; mobil bleibt die Liste zuerst („Filter“ mit Kriterienzahl + „Zurücksetzen“), das Sheet führt dieselben Gruppen mit „Ergebnisse anzeigen“ (genau ein History-Eintrag), „Filter schließen“ verwirft nur den Entwurf, Escape/Fokussalle/Fokusrückkehr greifen. Eine gemeinsame Quelle (`filterPanel(mobile)`), ein Formular, ein URL-Schreiber; Presets/Tenant-Zone/`df_*`/Dirty-Schutz unverändert. Rot beobachtet (unit 1/242, neue Layout-Tests 10/10), GREEN unabhängig wiederholt: unit 242/242, component 381/381, integration 286/286, `test:coverage` (909 Tests), Changed-Code 128/132 Zeilen und 168/180 Zweige, Format/Lint/Typen/Build/Docs, E2E 5/5 mit Browserabnahme 1280/1024/768/390/320 hell+dunkel. Offen: Zählbasis (BKP007.2), Monat/Jahr, echte Ansichtwechsel, Mehrfachwahl ohne Referenzabgleich.

### Arbeitsnachtrag 23.10.2026 (BKP006: Collapse-Schalter in der Markenzeile)

Auf `codex/bkp-wave1` (Slice-Basis `f99e82b`, MiMo/DeepSeek-Schnitt; Bericht `scratch/bkp006-report.txt`): Der Desktop-Collapse-Schalter integriert sich in eine kompakte Marken-/Leistenzeile (`.sidebar-brand-row`) neben dem Heimlink statt als eigene Zeile darüber; eingeklappt stapelt dieselbe Zeile AK-Marke über Ausklapp-Schalter (beide 44×44, zentriert, selbe DOM-Position, Fokusziel überlebt Wechsel/Resize/Remount). Marke, Labels, `title`, `aria-expanded`, `ak-sidebar`-Präferenz und Storage-Sync bleiben unverändert; mobil bleibt ausschließlich Menü öffnen/schließen (genau ein „Menü öffnen“, Drawer ohne Collapse). Rot beobachtet (2/22 Navigations-Tests), GREEN unabhängig wiederholt: component 371/371, unit 241/241, integration 286/286, `test:coverage` (898 Tests), Format/Lint/Typen/Build/Docs, E2E 5/5 mit Bounding-Box-Prüfung (keine Überdeckung, kein Abbruch des Schriftzugs, kein Body-Overflow bei 320/390/640/768). Grenze: 200 %-Zoom als Layoutbreiten-Äquivalent geprüft (headless Chromium ohne echten Browser-Zoom). **CI-Nachtrag:** Run 39924234516 war rot (`name.clipped` unter breiteren Linux-Fonts); der Folge-Commit `style: keep the sidebar wordmark unclipped in the brand row` verbreitert die Markenzeile randlos (Marke ~176 px), setzt die Rail-Wortmarke auf dokumentierte `1rem` und hält die Layoutgarantie `brand.width >= 168` fest; `clipped === false` bleibt bestehen.

### Arbeitsnachtrag 23.10.2026 (BKP005: neutrale Theme-Flächen)

Auf `codex/bkp-wave1` (Slice-Basis `63efc4d`, MiMo/DeepSeek-Schnitt; Bericht `scratch/bkp005-report.txt` mit Vorher-/Nachher-Screenshots): Beide Themes sind neutral — Darkmode warmes Anthrazit (canvas #141312, surface #1e1d1b), Hellmode neutrales Offwhite (canvas #f5f4f1, surface #ffffff); alle festen Seitenleisten-/Backdrop-/Scrim-/Kalender-Farben sind Tokens (`--sidebar-*`, `--menu-close-border`, `--backdrop`, `--scrim`, `--calendar-ink`). Grün bleibt nur als kleiner entsättigter Akzent (Aktion/Fokus/aktive Navigationszeile). Disabled-Tiers nennen eigene Farben (`--disabled-surface`/`--disabled-ink`, 4,57:1 hell / 6,13:1 dunkel) statt 0,6-Deckkraft; H036-Tiers, 44-px-Ziele und Fokus 3px/3px bleiben. Kontraste beider Themes sind gemessen (Fließtext 16,2/13,3, Aktion 6,1/8,6, Fokus 6,5/10,0, Grenzen ≥3); die Chromium-Abnahme bei 390/1280 in Hell und Dunkel zeigt die Referenzfläche (Liste, Formular, Legende, Dialog) ohne Overflow, sichtbaren Fokusring und einen Grünstich-Pixelanteil von 96,2 % → 1,5 % (390) bzw. 0,6 % (1280) im Dunkelmodus. `apps/admin/DESIGN.md` dokumentiert exakt die ausgelieferten Werte. Rot beobachtet (4 Component-Tests, E2E „rail is anthracite“ 15 > 4), GREEN unabhängig wiederholt: component 366/366, unit 241/241 (bekannter `worker-main`-Timing-Flake im Sammellauf, standalone grün), integration 286/286, `test:coverage` (893 Tests), Format/Lint/Typen/Build/Docs, E2E 6/6 (Referenzfläche + beide Anmeldemodi). Offen dokumentiert: Sidecar `.impeccable/design.json` zeigt noch die alte Palette (Drift, Reparatur regelkonform nicht als Nebenwirkung — nächster Design-Pass `$impeccable doctor`); die kleinen Statuspastellen der Kalender-Chips (inkl. grün-pastell „frei“) blieben als belegungsbezogene Zustandsflächen bewusst unverändert.

### Arbeitsnachtrag 23.10.2026 (BKP004.2: Ausnahmequeue aus Events entfernt)

Auf `codex/bkp-wave1` (Slice-Basis `a79e6b2`, MiMo/DeepSeek-Schnitt; Bericht `scratch/bkp004-2-report.txt`, 129 API-Calls): Unter Events gibt es keine Ausnahmequeue mehr — `EventPanel` rendert `WebsiteInbox` nicht, website-erzeugte Optionen stehen als normale Zeilen mit ruhigem Quellenlabel „Website“ (`.event-source-quiet`, Quiet-Tokens; Herkunft, kein Status; Erkennung nur über das `Website:`-Präfix). Die technische Diagnose lebt als Einstellungsabschnitt „Website-Eingänge (Diagnose)“ (`#settings-website`, Unternavigation wie Ressourcen/Produkte) mit manueller Übernahme als autorisierter Wiederholung, Landfeld als Betreiberentscheid und dem Vermerk, dass ein Rückstand kein Pflichtschritt vor der Eventanlage ist; sie liest beim Mount (ein GET je Besuch der Einstellungsseite, nur bei `route==='website'`). Die Eventakte trägt die Offenlegung „Website-Anfrage“ mit escaped Original (auch für kontaktlose Optionen, `/api/v1/events/:id/website-inquiry` unverändert); die Kontaktkarte zeigt „Kontakt noch offen.“ als normalen offenen Zustand, spätere Zuordnung über die normale Eventbearbeitung (Status/Version geprüft). Keine Migration, keine Schema-/API-Änderung, keine gelöschten Aufbewahrungs-/Quittungsdaten. Rot beobachtet (16 failed in 6 Komponentendateien), GREEN unabhängig wiederholt: unit 241/241, component 362/362, integration 286/286, `test:coverage` (889 Tests), Changed-Code 6/7 Zeilen und 8/8 Zweige, Format/Lint/Typen/Build/Docs, E2E auth 2/2 mit vollständigem synthetischem Weg (Eingang → Diagnose → Übernahme → Badge-Option → Event → Original → Kontakt später, Version+1) und axe/Overflow bei 1280/390 in Hell und Dunkel. Ausgewiesen: `docs/website-inquiry-intake.md` (alt: alte Heimat). Damit ist BKP004 insgesamt fertig; die Aktivierungsgrenze aus 004.1 bleibt Voraussetzung jedes Rollouts — bis zum Betreiberentscheid kein Merge/Deploy der Website-Semantik.

### Arbeitsnachtrag 23.10.2026 (BKP004.1: Aktivierungsgrenze für den Option-Drain)

Auf `codex/bkp-wave1` (Slice-Basis `fcfcf26`): Der automatische Website-Option-Takt startet nur noch mit `AK_INQUIRY_OPTION_DRAIN=on`. Fehlt der Wert oder steht `off`, paussiert allein der Timer (einmalige Warnung `website_option_drain_inactive`, Worker bleibt bereit); jeder andere Wert (`1`, `true`, `ON`, Leerstring, `on `) ist ein sichtbarer Konfigurationsfehler (`website_option_config_invalid`, nicht bereit). Gateway-Empfang, Staging, Quittung, Sync und die manuelle Übernahme sind unberührt; Identitätsprüfung läuft vor der Aktivierungsprüfung. Damit kann ein Auto-Updater-Image die Semantik von BKP002/BKP003 nie ohne Betreiberentscheid auf echte Rückstände anwenden. Beide Deploymentvorlagen reichen die Grenze bewusst pausiert durch (`compose.yaml` mit `:-off`, Worker-Quadlet explizit `off`; Vertragstest `tests/ops/deployment-env.test.mjs`, `docker compose config` real geprüft). Rollout-Laufplan in `docs/website-inquiry-intake.md` („Aktivierungsgrenze und Rollout“): zuerst rein lesende Mengen-/Fehlerübersicht außerhalb Git, dann Betreiberprüfung, erst dann `on` — mit rein lesenden SQL-Beispielen. **Nicht geschehen und ausdrücklich festgehalten:** keine Mengenübersicht erstellt, keine Bestandsdaten ausgewertet, kein Drain aktiviert. Umgesetzt als MiMo/DeepSeek-Schnitt (DeepSeek V4.1 Flash, Bericht `scratch/bkp004-1-report.txt`; MiMo ergänzte den Deployment-Passthrough samt Vertragstest und zog die Doku nach). Grün: unit 241/241, component 360/360, integration 286/286, `test:coverage` (887 Tests), Changed-Code 14/15 Zeilen und 8/8 Zweige, Format/Lint/Typen/Build/Docs. BKP004.2 (Ausnahme-UI aus Events, Original im Event) folgt getrennt; bis zum ausdrücklichen Betreiberentscheid kein Merge/Deploy der Website-Semantik.

### Arbeitsnachtrag 22.10.2026 (BKP003: fairer Option-Drain)

Auf `codex/bkp-wave1` (Slice-Basis `20910b1`) im MiMo/DeepSeek-Schnitt umgesetzt (DeepSeek V4.1 Flash, 62 API-Calls, Bericht `scratch/bkp003-report.txt`; MiMo prüfte den vollständigen Diff und wiederholte die Gates). `startWebsiteOptionDrain()` arbeitet pro Takt den vollständigen Pending-Bestand in `(staged_at,id)`-Reihenfolge ab: `listPending` liefert Seiten von zehn und setzt über einen Keyset-Cursor fort bis zur leeren Seite — zehn dauerhaft fehlerhafte alte Eingänge verdrängen damit keinen späteren gültigen mehr (elfter Eingang in Unit- und Integrationstest nachgewiesen). Die prozessweite `attempted`-Blacklist ist ersetzt durch ein `held`-Set nur für dauerhafte Eingabefehler (`contact_review`/`expired`/`conflict`/`invalid`): genau einmal als `website_option_<reason>` gemeldet, danach im Prozess zurückgehalten statt heiß wiederholt; vorübergehende und Infrastrukturfehler werden ohne Neustart im nächsten Takt erneut versucht (im Test belegt: erstes Takt-Ready false, zweiter Takt desselben Prozesses importiert genau ein Event/Rezept). Fehler eines Eintrags blockieren keine Nachbarn; `pending`-Guard, `stop()`-Warte und Readiness-Konventionen unverändert („ready“ bleibt reine Laufgesundheit). Keine Migration, kein zweiter Worker, kein Redis, keine Persistenz. Der alte Test „nur einmal pro Prozess“ ist bewusst durch „dauerhafter Fehler einmal gemeldet + temporärer Fehler wird wiederholt“ ersetzt; `docs/website-inquiry-intake.md` beschreibt die neue Wiederholungssemantik. Grün: unit 234/234, integration 286/286, Format/Lint/Typen/Docs; vorher rot beobachtet (Kerndefekt „length 11 but got 10“, „retry called once, but got 0 times“). Offen benannte Risiken: ein Takt wächst linear mit dem Rückstand (kein Tick-Zeitbudget, Soll-bedingt), `held` lebt nur prozesslokal. Kein Merge/Deploy ohne Aktivierungsgrenze.

### Arbeitsnachtrag 22.10.2026 (BKP002: kontaktlose Website-Option)

Auf `codex/bkp-wave1` (Slice-Basis `1f68042`) umgesetzt, wieder im MiMo/DeepSeek-Schnitt: DeepSeek V4.1 Flash implementierte Tests zuerst und den Fix (100 API-Calls, Bericht `scratch/bkp002-report.txt`), MiMo prüfte den vollständigen Diff (inklusive der ausgewiesenen Außerhalb-Liste `tests/integration/identity.test.ts` und des neuen Migrationstests), zog die widersprüchliche Intake-Doku auf die neue Semantik und wiederholte alle Gates. **Verhalten:** Der Optionpfad (`status:'option'`, Drain und manuelle Wiederholung) legt für jede gültige authentische Nachricht genau ein Option-Event an — eindeutiger aktiver Exakttreffer wird zugeordnet (Felder/Land unangetastet), ohne Kandidaten entsteht ein neuer Kontakt nur mit Betreiber-/Deployment-Land (`newContactCountry`/`AK_INQUIRY_DEFAULT_CONTACT_COUNTRY`), sonst bleibt die Option ohne Kontakt („Kontakt noch offen“); mehrdeutige, archivierte, falsch klassifizierte oder kollidierende Identitäten werden nie geraten oder zusammengeführt. Der direkte Legacy-Aufruf (`status:'inquiry'`) bleibt streng (`contact_review`). Migration `0033_website_inquiry_optional_contact.sql` macht nur `website_inquiries.contact_id` nullable; FK/UNIQUE/Hash/Idempotenz und Bestand unverändert (eigener Migrationsvertragstest: Altzeile, FK 23503, UNIQUE 23505, CHECK 23514, doppeltes `migrate()`). Response-Schema erlaubt `contactId: null` explizit; Receipts mit `null` bleiben auch nach späterer manueller Zuordnung `null` (Rückgabe-/Replayvertrag in `docs/website-inquiries.md`); Replay setzt manuell geänderten Status/Kontakt nie zurück. Öffentliches v1-Schema unverändert. Grün: integration 284/284, unit 232/232, component 360/360, `test:coverage` vollständig (876 Tests, Schwellen erreicht), Changed-Code 10/10 Zeilen und 13/14 Zweige, Format/Lint/Typen/Build/Docs. **Nicht erfolgt und absichtlich offen:** kein Merge in den Auslieferungs-Branch, kein Deployment; die Aktivierungsgrenze aus BKP004 fehlt weiterhin, und ein Betreiberentscheid zur Übernahme echter Rückstände liegt nicht vor und wurde nicht aus dem Übergabeprompt abgeleitet. `tests/ops/restore_probe.mjs` blieb unverändert (nullable FK über Migrationsvertragstest abgedeckt); `contact_review` bleibt im Fehlercode-Mapping und im UI-Fehlerzweig des Legacy-Pfads. **CI-Nachtrag:** Der erste Lauf zu `20910b1` war rot, weil `tests/e2e/auth.spec.ts` im Website-Posteingang noch den `contact_review`-Alarm erwartete (Run 39871013436). Die Erwartungen folgen jetzt der neuen Semantik (kontaktloser Erfolg, Receipt-Kontakt auch beim Replay `null`), und der HTTPS-Testrahmen relayt statische Requests auf `AK_E2E_PORT` statt hartkodiert 14873; die beiden zuvor roten HTTPS-Sign-in-Läufe sind lokal 2/2 grün.

### Arbeitsnachtrag 22.10.2026 (BKP001: Monatskalender-Wochentage, erste Paritätswelle)

Erster Implementierungsslice der übergebenen Bookitup-Paritätswelle, auf Basis des Paritätsstands `16616a5` (`codex/bookitup-parity-audit`) als eigener Branch `codex/bkp-wave1` in einer getrennten Arbeitskopie `/Users/gp/Developer/GitHub/auftragskompass-bkp`; das bisherige Arbeits-Checkout `/Users/gp/Developer/GitHub/auftragskompass` mit der laufenden H042-Arbeit wurde weder umgeschaltet noch verändert. Zusammenarbeit wie beauftragt: der abgegrenzte Coding-Slice (Tests zuerst, Fix, Gates, Bericht) lief als `hermes -z`-Einzelaufruf mit DeepSeek V4.1 Flash über opencode-go (45 API-Calls, Usage-Beleg `scratch/bkp001-usage.json`, Bericht `scratch/bkp001-report.txt`); MiMo aktivierte den Plan-Slice, prüfte den vollständigen Diff, ergänzte die Transition-Regression (Vor/Zurück/Ansichtswechsel) und führte Gates und Chromium-Geometrielauf unabhängig erneut aus. Keine Provider-/Zugangsänderung.

Umgesetzt: `apps/admin/src/CalendarPanel.tsx` rendert den `.calendar-weekday-head` (Mo–So) vor den führenden Pads; dadurch startet Tag 1 in der Wochentagsspalte seines echten Datums (1.10.2026 = Donnerstag steht unter „Do“, vorher unter „Mo“). Offsetformel `(getUTCDay()+6)%7`, Tagesdaten, Eventzuordnung, Zeitzone und Backend-Datumsfenster unverändert, kein CSS-Kaschieren. Tests: DOM-Reihenfolge-Regression in `tests/component/calendar-overview.test.tsx` (rot beobachtet mit `expected '' to be 'calendar-weekday-head'`), Transition-Regression nach Vor/Zurück und Wochen-Rundlauf, sowie `tests/e2e/month-alignment.spec.ts` als echter Chromium-Geometrietest mit Stub-APIs und ausschließlich fiktiven Daten für Monatsstart Montag (Juni 2026), Donnerstag (Oktober 2026) und Sonntag (Februar 2026) bei 390/1440 in beiden Themes: Tag-1-x in der richtigen Kopfspalte, jede Zelle in Spalte und Reihe ihres Wochentags, Reihengrenze Sonntag→Montag, vollständige Monatslängen ohne Doppelzellen, erreichbarer Eventlink `#event-…`, kein Body-Overflow. Grün: unit 232/232, component 359/359, integration 274/274 (standalone), E2E 6/6, Format/Lint/Typen/Build/Workspace/Docs, Changed-Code-Coverage 1/1 Zeilen und 2/2 Zweige. Lokal nicht grün und ehrlich offen: der kombinierte `pnpm test:coverage`-Lauf fiel auf diesem Mac viermal allein an Testcontainer-Start-Hooks (120 s) unter Parallellast sowie einmal am lastempfindlichen `ui-language.test.tsx` aus (beide Kategorien standalone grün); Linux-CI bleibt maßgeblich. `tests/playwright.config.ts` akzeptiert seither `AK_E2E_PORT`, damit zwei Checkouts E2E getrennt laufen lassen können (Default 14873 unverändert).

**Abgleich der vorhandenen H042-Arbeit (Stand dieses Nachtrags):** Der Vorsession-Turn zu H042 arbeitet weiterhin im Arbeits-Checkout `/Users/gp/Developer/GitHub/auftragskompass` (uncommittet: `ContactPanel.tsx`, `styles.css`, neu `tests/e2e/mobile-geometry.spec.ts`, zwischenzeitlich generierte und bereinigte `h042-synthetic/`-Einträge); nichts davon wurde verworfen, überschrieben oder parallel geändert. Inhaltlich abgeglichen: H042s Sticky-Save-Footer im Anlegedialog und die 44-px-Mail-/Telefonziele passen zum Zielvertrag §5 und sind bei späterer Übernahme als eigener Commit geeignet; H042s mobiler Monat als einstufige Tageliste mit ausgeblendeten leeren Tagen widerspricht dagegen dem Zielvertrag §4 (Mo–So-Raster, kurze Tageszahlen, gewählter Tag mit Agenda, „keine freie Terminliste mit falscher Kalenderoptik“) und wird in BKP008 bewusst mit dem Vertrag vereint statt zusätzlich erhalten. Übernahme/Commits zu H042 bleiben beim dortigen Turn; vor BKP008 ist der Stand erneut zu prüfen.

### Arbeitsnachtrag 22.10.2026 (H041: Eventliste-Filter nach bookitup, unabhängige Prüfung eingearbeitet, ohne Commit)

Branch `codex/ux-event-simplification`, Ausgangspunkt `2772847`. Die Eventliste filtert wie die bookitup-Referenz (Abschnitte 3 und 9): Die nackten Datumsfelder liegen in einem zugeklappten „Eigener Zeitraum“, darüber stehen die Schnellknöpfe „Dieser Monat“, „Nächster Monat“ und „Nächste Events“. Die Bereiche sind tenant-lokale Kalendertage aus der geladenen Mandantenzeitzone (`Temporal.PlainDate`, nie Browserzone oder Browsersprache); ein Klick schreibt `q`/`from`/`to` in genau einem History-Eintrag, und ein Knopf gilt nur bei exakt passender URL als ausgewählt (`aria-pressed`, 2-px-Rand, Gewicht 700, Unterstreichung – nicht nur Farbe). Eine Radiogruppe „Sortieren“ ersetzt die Checkbox „Nur Events ohne Datum“ samt Erklärsatz und behält deren URL-Semantik: `undated=true` löscht `from`/`to`, Lesezeichen gelten weiter, die Undatiert-Ansicht filtert zusätzlich clientseitig. Zähler für „Ohne Datum“ und „Anfragen“ kommen ausschließlich aus der geladenen Liste, wenden `q`/`status`/`eventTypeId` an und blenden Sortierung sowie Datumsgrenzen aus, damit keine Option sich selbst zählt. „Anfragen“ ist `status === 'inquiry'` (es gibt keine eigene Statusart „Neue Anfrage“; Statusliste: inquiry/option/booked/unavailable/cancelled) und steht nach der unabhängigen Prüfung als eigene Schnellfilter-Zeile außerhalb der Radiogruppe „Sortieren“: Ein Klick setzt nur `status=inquiry` und behält `from`/`to`/`q`/`eventTypeId`; die Sortiergruppe enthält nur „Chronologisch“ und „Ohne Datum“. Der Beleg für Changed-Code läuft über `BASE_REVISION=<basis> node scripts/changed-coverage.mjs` (derselbe Befehl wie in CI); `COVERAGE_DIFF=worktree` prüft zusätzlich die Arbeitskopie samt untracked Datei. Jede Monatsüberschrift trägt grau „· N Event(s)“; die Gruppe „Ohne Datum“ bleibt am Ende. Keine API-, Datenbank- oder Migrationsänderung, keine neue Abhängigkeit; Anlegen, Kalender, Kontakte, Dateien, Einstellungen, Website-Optionen, Icon-Hierarchie, Suche, Favicon, Theme und die H025/H030-Entwurfsregeln bleiben unverändert.

Gemeinsame Helfer: `apps/admin/src/event-filters.ts` (`datePresetRange`, `activeDatePreset`, `filterRows`, `eventFilterCounts`, `monthGroups`). CSS: `.event-sorting`, `.event-count`, `.date-presets`/`.date-preset-active`, `.custom-range`, `.event-month-count` – alle auf vorhandenen Tokens (`--quiet-ink`, `--quiet-action-border`, `--border`, `--action`), 44-px-Zeilen, WCAG-AA-Kontrast in beiden Themes.

Lokal grün (Node 24.15.0, `pnpm --use-node-version`, seriell): 232 Unit-, 357 Komponenten- und 274 Integrationstests, Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung; alle sechs Chromium-Abläufe, darunter eigene Zeitraum-Details, Presets mit einem History-Eintrag, Zurück, Undatiert-Sortierung, Monatszähler und 1280/390/320 ohne Body-Überlauf mit 44-px-Zielen. Coverage `event-filters.ts` 39/39 Zeilen und Zweige, `EventPanel.tsx` 94,35 % Zeilen/88 % Zweige; Changed-Code 66/66 Zeilen und 97/97 Zweige (`BASE_REVISION=2772847`, gleiche Zahl im Worktree-Modus). **Kein Commit, kein Push, keine Auslieferung, kein Merge nach `main`**; unabhängige Prüfung offen. Grenze: der macOS-`RLIMIT_FSIZE`-Backuptest bleibt lokal rot, Linux-CI ist maßgeblich; der `worker-main`-Unit-Test war einmalig sporadisch (vorbestehend, Wiederholung grün).

### Arbeitsnachtrag 21.10.2026 (H035: Dateien, Phase 1 ohne Commit)

Branch `codex/ux-event-simplification`, Basis `c744fd7`. Neu ist ein eigener Bereich **Dateien** (`#files`) in der Hauptnavigation (Desktop-Icon-Leiste, mobiler Dialog, `aria-current`, Titel/Aria „Dateien“, Einstellungen bleibt eigenständig), der ausschließlich die bestehenden Geschäftsdokumente listet. Grundlage war die Feststellung, dass es **keine** Nutzer-Upload-Bibliothek gibt: `documents` kennt Art, Vorlage, Event, Kontakt, Nummer, Zustand, `issued_at`, `finalized_at`, Hashes und Beträge, aber keinen Dateinamen, keine Originaldatei und kein `created_at`. Die Oberfläche erfindet deshalb weder Dateinamen noch Uploads; die Lücke zu echten Uploads, Standard- und Eventdateien ist ausdrücklich offen.

API-Erweiterung rein additiv an `GET /api/v1/documents`: optionale `from`/`to` (inklusive, tenant-lokale `issued_at`-Tage, Obergrenze als nächster lokaler Mitternachtspunkt, damit DST-Tage exakt bleiben), `limit` 1–100 (Maximum, niemals `limit+1` serverseitig), `offset` und `include=metadata` mit `eventName` (mandantengebundener Left Join), `issuedDate` und `pdfAvailable` — exakt die Bedingung der PDF-Route (`final`, Nummer, pdf-Hash). Ohne diese Parameter bleibt der Abruf unverändert ungepaggt mit exakt den alten Feldern; kein Envelope, keine Gesamtzahl, keine Migration, keine neue Tabelle oder Route, keine Ablageänderung. `withdrawn` wird angezeigt, aber nicht erfunden; `sent`/`expired`/`accepted` bleiben unimplementiert.

Oberfläche: `FilesPanel` filtert serverseitig über Art/Status/Zeitraum im eigenen Query-Namensraum `df_kind`/`df_state`/`df_from`/`df_to`/`df_page` (globale Suche und Eventfilter bleiben erhalten), setzt bei Filterwechsel die Seite zurück, nutzt eine angeforderte Extrazeile nur als `hasMore`, behält bei Fehlern den letzten Stand samt ehrlichem Filterzustand und reinem GET-Retry, verwirft verspätete Antworten über einen Sequence-Guard und aktualisiert bei Rückkehr über den vorhandenen `useAutoRefresh` ohne Polling. Zeilen zeigen Art und Nummer, `issuedDate`, Eventname mit nativem `#event-<id>`-Link nur bei gültiger ID, Status, exakten Betrag und einen PDF-Link nur bei `pdfAvailable` (`noopener` über `rel=noreferrer`, `target=_blank`); es wird nie automatisch finalisiert, nummeriert, versendet oder eine PDF vorab geladen.

Aus der unabhängigen Prüfung und der Integrationsprüfung eingearbeitet: Der Bereich hat **keine** eigene H1 mehr; der Seitenkopf der Werkzeugleiste ist die einzige Seitenüberschrift, `FilesPanel` ist über `aria-label="Dateien"` adressiert. Beträge werden über `exactMinorUnits` aus den ganzzahligen Cent formatiert, weil `grossMinor/100` den größten gültigen Betrag (9007199254740991) um einen Cent auf „…,90“ rundete. Der Event-Link baut sein Ziel über `eventTargetHref`: nur der Event-Filter-Namensraum (`q`, `from`, `to`, `status`, `eventTypeId`, `undated`) wird entfernt, `df_*` und fremder Zustand bleiben, sodass die Details wirklich öffnen. Ein `withdrawn`-Dokument ohne Nummer heißt nicht mehr „Entwurf“, sondern trägt seinen echten Zustand. `updateUrlSearch` verwirft Schlüssel außerhalb eines übergebenen Namensraums, **bevor** es schreibt. Das Panel lädt nur, solange `#files` aktiv ist (`active`-Prop aus `AuthPanel`), sodass ein verborgenes Panel keinen Fokus-Abruf startet und die Rückkehr aus einem Event den aktuellen Stand lädt. Für den neuen Dateien-Eintrag gibt es einen gezielten Dirty-Schutz: Ein regulärer Klick bei registrierten ungespeicherten Eingaben fragt nach; Abbrechen hält Hash, Entwurf, Fokus und das mobile Menü, Strg-/Mittel-/Shift-Klick löst keinen Dialog aus und ändert die aktuelle Ansicht nicht. Die übrigen Navigationslinks bleiben unverändert ungeschützt.

Gefundener und behobener Fehler: Die erste Zeilenprüfung rief `String(entry.issuedDate)` vor der Typverengung auf, sodass eine einzelne fremde Zeilenform die ganze Liste mit einer Ausnahme statt mit einem ehrlichen Fehlerzustand beendete; jetzt werden alle Felder vor ihrer Verwendung geprüft. Ein weiterer Befund: Der DB-CHECK verbietet `final` ohne Nummer, `finalized_at`, Snapshot und pdf-Hash, ein „final ohne Artefakt“ kann also gar nicht existieren — die Bedingung ist trotzdem defensiv als `pdfAvailable` abgebildet und im Test über die Constraint belegt.

Lokal mit Node 24.15.0 (`pnpm --use-node-version=24.15.0`, Shell-Node ist v23.11.0) grün: Format, Lint, Typecheck, Build, Workspace- und Dokumentationsprüfung, 209 Unit-, 300 Komponenten- und 262 Integrationstests sowie 6/6 Chromium-Abläufe inklusive neuem Dateien-Schritt (Navigation, eine H1, Filter-Request mit `limit=26`, 44-px-Ziel, Tastaturfokus, PDF-Link ohne Vorabladen, kein Body-Überlauf bei 1280/390/320, axe-Audit). Coverage und Linux-CI folgen nach dem Commit; der macOS-`RLIMIT_FSIZE`-Backuptest bleibt unverändert lokal rot. **Kein Commit/Push/Deploy in Phase 1.**

### Arbeitsnachtrag 22.10.2026 (H036 Phase 2: Prüfbefunde eingearbeitet)

Die unabhängige Prüfung bestätigte Kontrast (0 Verstöße bei 840 gemessenen Bedienelementen, beide Themes), Fokus 3 px/3 px, 44 px, keine Layout-/Wortlaut-/Funktionsänderung und die H031-Icons. Sie fand eine echte Abdeckungslücke und zwei Testlücken; alle drei sind zuerst fehlschlagend, dann grün repariert:

- `PasswordPanel` hatte gar keine Stufe („Passwort ändern“ ohne Klasse) — jetzt `.primary-action`. Ausdrücklich zu H036 gehören als gewöhnliche Flächen außerdem Import (`ImportPanel`/`ImportOverview`/`ImportPromiseReview`), Dokumentvorlagen und Nummernkreise.
- Ein neuer Test rendert die **echte Hülle** (`AuthPanel`/`Navigation` mit den `[hidden]`-Workspace-Seiten) über alle 13 Routen und verlangt dort 0 oder 1 _sichtbare_ primäre Aktion. Er deckte drei gleichzeitige „Speichern“ auf der Einstellungsseite auf: `MasterDataPanel` hat dafür ein optionales `primary`, die Nummernkreise tragen die primary am gerade bearbeiteten Kreis, Zeilen- und Such-Icons sind `tier-quiet-icon`.
- Event-Details behält zwei primaries in getrennten Frames; geprüft wird je Frame ≤ 1 statt „genau 2 offene Frames“.
- Die Zahl der Komponententests wächst auf 346 (17 davon in `action-hierarchy`). Vorbestehend und **nicht** H036: fokussierbare Bedienelemente in `[hidden]`-Seiten und der doppelte „Bearbeiten“-Knopf in Ressourcen — beides als eigene Scheibe führen.

H037 ist mit `c744fd7` released (CI-Lauf 39569637148, quality und images success, CT114 per Auto-Updater auf gleicher Revision, alle drei Container healthy, öffentliche Seite 200). H032 (Website-Option) bleibt offen.

### Arbeitsnachtrag 21.10.2026 (H037: einfachere Kalenderübersicht, wahrheitsgetreue Datum-anzeige)

Branch `codex/ux-event-simplification`, Ausgangspunkt `1a8d805`. Frontend-only: Es gibt **kein** `hasTime`-Feld und keine Backend-/API-/DB-Änderung, weil `GET /api/v1/calendar` die ursprünglichen nullbaren `startsAt`/`endsAt` bereits liefert und `validateSchedule` Zeiten nur paarweise zulässt — fehlende Zeitstempel sind damit die einzige Wahrheitsquelle für „ohne Uhrzeit“.

Umgesetzt: Monatsdefault ohne ausdrückliche URL-Wahl (`calendarViewFromUrl`), eine ruhige Navigationszeile mit den bestehenden 44-px-Icon-Aktionen, sichtbarer Zeitraumspanne und den vorhandenen Ansicht-/Datumsfeldern; Ressourcenbelegung als **natives, unkontrolliertes** `<details>` (Inhalt dauerhaft eingehängt, vom Browser zugeklappt verborgen, kein React-Zustand, kein zusätzlicher Abruf, Fokus bleibt auf dem Summary); Ladefehler-, Bestandswarnung und Legende bleiben außerhalb. Eventchips und Liste entscheiden „Tagesbuchung, ohne Uhrzeit“ ausschließlich über die nullbaren Zeitstempel, behalten echte Mitternachtszeiten und zeigen bei mehrtägigen Buchungen den ursprünglichen Zeitraum in jeder belegten Tageszelle statt sie auf den sichtbaren Tag umzudatieren. Nach einem fehlgeschlagenen Ansichtswechsel bleibt der letzte Stand im eigenen Raster (`data.view` steuert Spalten, Wochentagskopf und Padding), während die Bedienelemente den angeforderten Zustand zeigen. Die Monatsübersicht passt jetzt in den Container (sieben Spalten, kompakter Wochentagskopf, gekürzte Chips mit vollem Titel und 44-px-Linkziel); Woche/Tag behalten ihre innere Scrollung.

Review-Nachtrag: Der statische Review-Befund „programmatisches `details.open` löst kein `toggle` aus, also zeigt der Inhalt nichts“ war für die frühere React-Zustandsvariante korrekt, ist mit dem nativen Element aber kein Fehler mehr — der Browser zeigt den Inhalt ohne Handler. Die Belegung ist deshalb bewusst unkontrolliert; der zugehörige Regressionstest setzt `open` direkt. Die zweite Review-Sorge (Warnung/Legende könnten in die Belegung wandern) ist im Quellstand bereits erfüllt und jetzt zusätzlich mit Alert-, Legenden- und „kein Frei“-Assertions vor und nach dem Aufklappen abgesichert.

Lokal mit Node 24.15.0 grün: 209 Unit-, 290 Komponenten- und 257 Integrationstests (756 gesamt), Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung, Coverage 97,40 % Zeilen und 93,82 % Zweige (`calendar-range.ts` 100 % Zeilen, `CalendarPanel.tsx` 98,6 % Zeilen) sowie alle sechs Chromium-Abläufe, darunter echte Summary-Interaktion per Klick und Enter, Fokuserhalt, Monatsraster ohne innere oder Body-Scrollung bei 1280/390/320 und 44-px-Navigationsziele. Bekannt und unverändert: Der macOS-`RLIMIT_FSIZE`-Backuptest bleibt lokal rot; Linux-CI ist maßgeblich. H032 (Website-Option) und H035 (Dateien) bleiben offen; H034 ist mit `1a8d805` freigegeben.

### Arbeitsnachtrag 21.10.2026 (H034: Ort/Adresse am Event, Abschluss der Quellumsetzung)

Branch `codex/ux-event-simplification`, Basis `74d636a`. Die unabhängigen Reviews sind eingearbeitet: Der Migrationstest leitet den Sollstand aus den vorhandenen Migrationsdateien ab und prüft zusätzlich Namen, Checksummen, die Spalten `venue`/`venue_override` samt Default und CHECK sowie wiederholtes `migrate`; der alte Hash `#locations` wird nicht nur beim Start, sondern auch bei späterem `hashchange`/`popstate` ohne neuen History-Eintrag, ohne Reload und ohne Query-Verlust auf `#events` normalisiert; ein Duplikat mit archiviertem Bestandsort sendet keine ungültige Fremdreferenz mehr, sondern übernimmt den sichtbaren Ort als Freitext (vorhandener Freitext oder bewusste Leerung bleiben erhalten), während die Serverprüfung für neue Buchungen streng bleibt. `venue` ist im Request-Schema eine Union aus `string`/`null`, damit ein explizites `null` nicht durch die Validierung zu `''` wird; Alt-PUTs ohne beide Eigenschaften, Status-/Ressourcen-Schreibvorgänge und Importe behalten den gespeicherten Stand. Die Oberfläche belegt das Feld mit dem vollständigen Bestandsort vor, sendet es aber nur nach tatsächlicher Bearbeitung, hydriert spät eintreffende Ortsdaten ausschließlich in unberührte Felder und zeigt Zeilenumbrüche auch in der Liste. CSV behält Spaltennamen und -reihenfolge (`locationName` wirksam, `locationId` bei Freitext leer), ICS escaped/faltet weiterhin, finale Dokument-Snapshots bleiben unverändert.

Lokal mit Node 24.15.0 grün: 201 Unit-, 277 Komponenten- und 257 Integrationstests (735 gesamt), Format, Lint, Typen, Workspace- und Dokumentationsprüfung, Build, Coverage 97,40 % Zeilen und 93,84 % Zweige sowie 6/6 Chromium-Abläufe inklusive neuem Ortsablauf, Alt-Hash, Einstellungen, Kontakten, Theme, Favicon, optionalen Zeiten und DST. Bekannt und unverändert: der macOS-`RLIMIT_FSIZE`-Backuptest (`test_child_file_limit_preserves_the_disk_reserve`) scheitert lokal; Linux-CI ist maßgeblich. Commit, Linux-CI, Changed-Code-Coverage und Testbetrieb werden nach dem Push im Scratch-Ergebnis belegt.

Nachtrag H033: Commit `74d636a` wurde am 21.10.2026 gepusht; GitHub-Quality-Lauf `39521013312` meldet success für Quality und Images, damit ist die frühere offene Push-/CI-Notiz zu H033 erledigt.

### Arbeitsnachtrag 21.10.2026 (H034: Ort/Adresse am Event, Phase 1)

Branch `codex/ux-event-simplification`, Ausgangspunkt `74d636a`. Die Nutzerentscheidung vom 21.10.2026 ersetzt die frühere Planannahme „H034 ohne Migration“: Der Ort ist eine optionale Freitextangabe der Buchung, Locations bleiben ausschließlich Bestand. Migration `0032_event_venue.sql` ergänzt additiv `events.venue` (bis 1.000 Zeichen, mehrzeilig) und `events.venue_override` (Default false) ohne Rückfüllung, ohne Destruktion und ohne neue Tabelle. `venue_override` entscheidet die wirksame Quelle: true zeigt nur den Freitext (auch leer = bewusst kein Ort), false die bisherige Bestandsanschrift. Alte Voll-PUTs ohne beide Eigenschaften erhalten den Stand; nur ein tatsächlich geänderter `locationId` setzt `venueOverride` auf false und behält den Freitext. Suche, Kalender, ICS, CSV und `{{location}}` nutzen die wirksame Quelle; die CSV behält Spaltennamen und -reihenfolge, `locationName` ist der wirksame Ort, `locationId` ist bei Freitext leer. Website-Anfragen übernehmen ihren freien Ort als `venue`/`venueOverride` und lassen nur die neue Doppelzeile in der generierten Beschreibung weg; bestehende Beschreibungen bleiben unberührt. Die Oberfläche ersetzt den Location-Select in Event und Anlegen-Dialog durch „Ort / Adresse“ (mehrzeilig, vorbelegt mit dem vollen Bestandsort, aber nur bei tatsächlicher Bearbeitung gesendet), zeigt in den Event-Details nur den wirksamen Ort, hat keinen Locations-Menüpunkt und keine Locations-Einstellungen mehr; `#locations` leitet ohne neuen History-Eintrag und ohne Query-Verlust auf Events um. Locations-API, -Tabelle und Integrationstests bleiben. Kein Commit/Push in Phase 1; die volle Chromium-/Coverage-/CI-Abnahme folgt im Review-Schritt.

### Arbeitsnachtrag 21.10.2026 (H033: Ressourcen und Produkte unter Einstellungen, Abschluss)

Branch `codex/ux-event-simplification`, Ausgangspunkt `065b6faece92eb3fea48da235a2d8d59e1f848fb`. Die Hauptnavigation enthält in der Desktop-Seitenleiste und im mobilen Menü weder „Ressourcen“ noch „Produkte“; beide Verwaltungen liegen als Einstellungsabschnitte `#settings-resources` und `#settings-products` unter dem einzigen Seiten-H1 „Einstellungen“. Die alten Deep Links `#resources` und `#products` bleiben unverändert gültig und werden ohne globalen Router-Umbau auf dieselben Routen abgebildet; Zurück/Vorwärts, Hash-Wechsel und Query bleiben erhalten, ohne Neuladen oder Auth-Reset. Hauptnavigation markiert „Einstellungen“ und die Unternavigation den passenden Abschnitt mit `aria-current` – auch bei den alten Hashes. Beide Panels bleiben wie zuvor dauerhaft eingehängt und werden nur verborgen, sodass Entwürfe beim Wechsel zwischen Ressourcen und Produkten erhalten bleiben und keine zusätzlichen Listenabrufe entstehen. Jeder Abschnitt trägt genau eine H2 („Ressourcen“/„Produkte“); die vorhandene H2 „Zeitweise Ressourcensperren“ bleibt darunter erhalten. Ressourcen-, Sperr-, Kalender-, Eventzuordnungs- und Produktfunktionen samt APIs, Berechtigungen und Deaktivierungszuständen sind unverändert; keine API-, Datenbank-, Migrations- oder Auth-Änderung.

Lokal grün: 190 Unit-, 265 Komponenten- und 237 Integrationstests, Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung, Coverage 97,40 % Zeilen und 93,80 % Zweige. Die vollständige Chromium-Suite ist mit 6/6 Abläufen grün, darunter beide Anmeldearten mit Ressourcen-, Sperr- und Produktpfaden, echter Zurück-/Vorwärts-Navigation zwischen `#settings-resources`/`#settings-products` und den alten Hashes `#resources`/`#products` ohne Neuladen oder Query-Verlust, erhaltenen Entwürfen und unveränderten Abrufzahlen, Tastatur-Enter/Fokus in der Einstellungs-Unternavigation auf Desktop und im mobilen Drawer sowie 1280/390/320 ohne horizontalen Überlauf; lange Untermenü-Labels brechen bei 320 px um. Die unabhängige Quellprüfung fand keine bestätigten funktionalen Defekte. Offen: Changed-Code-Coverage, Linux-CI und Testbetrieb nach Commit/Push (Scratch-Ergebnis, keine zweite Doku-Pushrunde) sowie H032 (Website-Option) und H034 (Locations).

### Arbeitsnachtrag 21.10.2026 (H039: Kontakte mit Suche und Liste zuerst, Formular hinter Plus, Phase 1)

Branch `codex/ux-event-simplification`, Ausgangspunkt `6f6c304df2578e035bb500e7447590400e904102`. Die Kontaktseite zeigt zuerst die Suchwerkzeugleiste (Suchfeld, Icon-Suche, CSV-Export, Plus) und unmittelbar darunter die Liste; das Anlegeformular ist initial nicht gerendert und nicht tabbar. „Kontakt anlegen“ ist eine 44-px-Plus-Aktion ohne sichtbaren Text mit `aria-label`/`title`; die Zeilenaktionen „Events anzeigen“ und „Kontakt bearbeiten“ sind ebenfalls ruhige, benannte 44-px-Icon-Aktionen, während E-Mail-, Telefon- und CSV-Links Text bleiben; Anlegen und Bearbeiten laufen in einem modalen Dialog mit eigenem Titel „Kontakt anlegen“ beziehungsweise „Kontakt bearbeiten“, `aria-modal`, `aria-labelledby`, initialem Fokus in der Kontaktart, Tab-Falle und Fokusrückkehr auf den Auslöser (Rückfall Plus). X, Escape und „Kontakt abbrechen“ fragen bei einem geänderten Entwurf ausdrücklich nach dem Verwerfen; ein unverändert geöffneter Dialog gilt nicht als schmutzig. Die Werte sind kontrolliert, sodass Neuanlage (Privatperson, aktiv, `country=DE`) und der Wechsel zwischen bestehenden Kontakten keine alten Werte weiterverwenden; Bearbeiten sendet weiterhin die gespeicherte `version`. Während eines laufenden POST sind Schließen, Escape und Abbrechen gesperrt, ein synchroner Ref-Guard verhindert doppelte Mutationen, und ein Fehlschlag behält Dialog und Eingaben. Ein bestätigtes Speichern schließt, leert den Entwurf und lädt die Liste neu; scheitert nur dieser GET, bleibt eine ehrliche Meldung mit reiner GET-Wiederholung sichtbar. Suchtext und Listeninhalt bleiben beim Öffnen und Schließen erhalten; `#contact-<id>` bleibt Route und die Liste vergibt Zeilenanker. Keine API-, Datenbank- oder Migrationsänderung, kein Auto-Refresh und kein Hintergrund-Confirm.

Die unabhängige Phase-1-Prüfung ist eingearbeitet: Ein erfolgreicher Listenabruf entfernt den Neuladehinweis samt Wiederholungsknopf (auch bei Such-/Filterneuladen), ein verspäteter älterer Abruf löscht keinen neueren Fehler, der Dialog hält den Fokus während eines laufenden POST/PUT (programmatisch fokussierbare Dialogwurzel, Tab/Shift+Tab auch bei vollständig deaktivierten Bedienelementen, `aria-busy`, Fehlerfokus nach Fehlschlag), und eine erfolgreiche Dublettenprüfung ist ein ruhiger `role=status` statt eines roten Alarms; echte Fehler bleiben Alarme, der Erfolg wird bei Eingabeänderung verworfen.

Lokal grün: 190 Unit- und 263 Komponententests (21 Kontakttests), Format, Lint, Typen, Build und Dokumentationsprüfung, Coverage 97,39 % Zeilen und 93,79 % Zweige, Changed-Code 164/170 Zeilen und 97/109 Zweige. Die vollständige Chromium-Suite ist mit sechs Abläufen grün, darunter beide Anmeldearten mit Kontakt anlegen/bearbeiten/suchen, Dirty-Abbruch (abgelehnt und bestätigt), tatsächlichem Mutationsfehler mit erhaltenen Eingaben und Fehlerfokus, anschließendem Neuladefehler samt verschwindendem GET-Retry sowie Dialog-/Toolbar-/Bereichsgeometrie bei 1280/390/320 ohne horizontalen Überlauf, 44-px-Plus und -Zeilenaktionen sowie Tab im Dialog. Commit, Linux-CI und Testbetrieb wurden nach dem Push geprüft; der lokale macOS-`RLIMIT_FSIZE`-Backuptest blieb unverändert. H033 folgte als eigener Commit; H032 (Website-Option) bleibt offen.

Release-Nachtrag H039: Commit `065b6faece92eb3fea48da235a2d8d59e1f848fb` wurde gepusht (Remote-Readback identisch); GitHub-Quality-Lauf `39514678870` meldet quality und images success. Der Auto-Updater auf pve1/CT114 hat dieselbe Revision ausgerollt: last-success `065b6fa`, ak-test-api/-worker/-admin healthy, Timer aktiv, kein needs-attention; https://auftragskompass.samuelgesang.de antwortet mit HTTP 200 und den Kontakt-Markern im Bundle. Damit ist H039 released; die frühere Phase-1-Notiz bleibt als zeitlicher Zwischenstand erhalten. H033 folgt als eigener Commit.

### Arbeitsnachtrag 20.10.2026 (H038: UI-Sprache, Seitenhierarchie, Favicon, Phase 1)

Branch `codex/ux-event-simplification`. Die eigene Oberfläche verwendet sichtbar nicht mehr „Eventakte“, sondern „Event“ beziehungsweise „Event-Details“: Bereichsname, Schließen-Aktion, Lade-/Fehler-/Neuladehinweise, Detailtitel („Event: Name“), Bereichsnavigation und Statusfeld. Interne Komponenten-, CSS-, URL-, API- und Datenbankbezeichnungen bleiben unverändert; historische Bookitup-Recherche und datierte Notizen behalten den Begriff als Beleg.

Der App-Ebenen-Hero „AuftragsKompass / Anfragen, Kontakte und Stammdaten verwalten.“ ist entfernt. Die Anmeldung hat genau einen H1 „Anmelden bei AuftragsKompass“ und den Theme-Umschalter; nach der Anmeldung sitzt derselbe Umschalter genau einmal in der Werkzeugleiste. Die Werkzeugleiste enthält den einzigen sichtbaren Seiten-H1 als echten `#events`-Link. Bereichsflächen (Events, Kontakte, Produkte, Ressourcen, Locations, Einstellungen) wiederholen ihn nicht mehr als sichtbares H2; auf der Suchroute bleiben „Events“ und „Kontakte“ als eigene Abschnitts-H2, der Kalender behält seine genauere H2, und „Zeitweise Ressourcensperren“ ist unter der Ressourcen-H1 ein H2. Der Importbericht verwendet H3. Bereichsnamen für Tests und Screenreader bleiben. Ein eigenes geometrisches Kompass-Favicon liegt unter `apps/admin/public/favicon.svg` mit 32px-PNG-Fallback und korrekten `link`-Deklarationen; der Dokumenttitel bleibt „AuftragsKompass“.

Lokal grün: 190 Unit- und 247 Komponententests, Format, Lint, Typen, Build, Dokumentation sowie fünf Chromium-Abläufe (Login-H1/Theme, Favicon-MIME und identische SVG-/PNG-Geometrie mit 16/32-Renderkontrast, Google- und Passwortanmeldung). Die Sichtprüfung der Titelstapel bei 1280/390 wurde im gebauten Bundle mit synthetischen Stub-Antworten durchgeführt; Linux-CI und Testbetrieb werden nach dem Push geprüft. Ebenfalls offen und nur im Plan notiert: H032 (Website-Option) bleibt wegen HTTP 429 vor jeder Quelländerung pausiert; H039 (Kontakte: Suche, Liste, Plus-Formular) und die H033-Erweiterung um Produkte sind nicht implementiert.

### Arbeitsnachtrag 20.10.2026 (H030: automatische Aktualisierung, Phase 1)

Branch `codex/ux-event-simplification`. Die sichtbaren Schaltflächen „Events aktualisieren“, „Eventakte aktualisieren“ und „Kalender aktualisieren“ sind entfernt. Ein gemeinsamer Hook `useAutoRefresh` aktualisiert Eventliste, Eventakte und Kalender beim Sichtbarwerden des Dokuments oder Fokusgewinn, jeweils dedupliziert für dieselbe Rückkehr; laufende Abrufe und verborgene Dokumente lösen keine zusätzliche Abfrage aus, Listener werden beim Unmount entfernt, und es gibt keinen Takt. Ein schmutziger Bearbeiten-/Anlegeentwurf sowie die Eventakte mit ungespeicherter Status- oder Ressourceneingabe bleiben erhalten; die Akte hält Hintergrundladungen zurück und zeigt einen ruhigen Hinweis mit ausdrücklicher Verwerfen-und-Neuladen-Aktion. Ladefehler behalten die letzten guten Daten und bieten eine reine Wiederholungsaktion. Keine Server-, API-, Datenbank- oder Migrationsänderung.

Lokal sind die neuen Regressionstests sowie 187 Unit- und 231 Komponententests, vier Chromium-Abläufe, Format, Lint, Typen, Build und Coverage (97,38 % Zeilen, 93,81 % Zweige; Changed-Code 65/65 Zeilen, 73/77 Zweige) grün. Die unabhängige Prüfung ist eingearbeitet: ein doppelter Aktenabruf bei gleichzeitiger Listenaktualisierung ist durch Id-/Revisions- und In-Flight-Schutz samt Kombinationstest behoben, der verzögerte Hinweis ist präzisiert und als Status angekündigt, der obsolete WebsiteInbox-Text sowie der Fokusverlust im Kalender sind korrigiert. Commit `b2100b4c7df0b05dec81ada119017e13f01ad424` ist gepusht; GitHub-Lauf 39477841511 ist mit Quality und beiden Images grün, der automatische Testupdater hat API, Worker und Admin gesund auf genau diesen SHA übernommen, `last-success.json` stimmt, der Timer ist aktiv und die öffentliche Adresse antwortet 200. Das Admin-Bundle enthält die drei alten Aktualisieren-Texte nicht mehr. Eine echte Tab-Rückkehr ist im headless Chromium nicht abbildbar; der E2E-Ablauf löst dieselbe Sichtbarkeits-/Fokusfolge im gebauten Bundle aus. Die manuelle Sichtprüfung eines echten Tab-Wechsels bleibt als Restrisiko offen. Der bekannte macOS-`RLIMIT_FSIZE`-Backuptest bleibt unverändert und ist nicht Teil dieses Slices.

### Arbeitsnachtrag 20.10.2026 (H031: Heimweg, einklappbare Navigation und ruhige Icon-Aktionen, Phase 2)

Branch `codex/ux-event-simplification`. Desktop-Markenname und mobiler Bereichstitel bleiben echte `#events`-Links; der aktive Heimweg erzeugt keinen zusätzlichen Historieneintrag und fragt nicht. Eventzeilen sind jetzt selbst native Links auf `#event-<id>` mit Fokus-Rückkehr zur Zeile; der separate „Eventakte öffnen“-Knopf ist entfernt. Die Zusammenfassung enthält keine verschachtelten interaktiven Elemente, Textauswahl öffnet nichts, Bearbeiten/Duplizieren bleiben unabhängige Geschwisteraktionen, und ein Klick öffnet die Akte genau einmal. Icon-only-Bedienelemente in Navigation, Kopf, Theme, Abmelden, Dialog, Event, Kalender und Kontaktsuche haben präzise `aria-label` und `title`; der Theme-Knopf beschreibt die nächste Aktion und behält `aria-pressed`.

Die Desktop-Seitenleiste klappt über einen benannten Knopf mit `aria-expanded` auf reine Icons ein und wieder aus. Marke/Home bleibt als „AK“-Link nutzbar, Links behalten `aria-label`, `title` und `aria-current`, Version/Untertitel/Kontozusatz werden kompakt ausgeblendet, die Präferenz liegt unter `ak-sidebar` samt Storage-Sync, und der mobile Dialog bleibt eine unveränderte Textnavigation. Event anlegen/bearbeiten/duplizieren, Kalender-Vor/Zurück/Heute und die Kontaktsuche sind 44-px-Icon-Schaltflächen ohne sichtbaren Text, mit unveränderten Namen, Disabled-/Busy-Regeln und sichtbarem Kalenderkontext.

Die globale Suche startet als Icon, öffnet ein fokussiertes Feld, behält einen nicht abgesendeten Entwurf über Schließen/erneutes Öffnen, schließt per Escape oder Knopf mit Fokusrückkehr und schreibt erst beim Absenden `q` plus `#search` in einem Historieneintrag; die bestehenden Ergebnislisten bleiben. Heim- und Suchwechsel verwenden den kleinen registrierten Dirty-Hook der Eventakte; Abbrechen hält Route und Eingabe, Bestätigen erlaubt den Wechsel. Andere Navigationslinks, „Eventakte schließen“, Browser-Zurück und nicht registrierte Formulare bleiben ungeschützt; keine universelle Dirty-Garantie. Keine API-, Datenbank- oder Migrationsänderung.

Lokal grün: 187 Unit- und 244 Komponententests, Format, Lint, Typen, Build, Dokumentationsprüfung und Changed-Code-Coverage (103/103 Zeilen, 84/87 Zweige). Die vollständige Chromium-Suite (vier Abläufe, Google und Passwort) lief mit synthetischen Daten grün: 1280/390 ohne horizontalen Überlauf, eingeklappte Leiste inklusive Reload-Persistenz und sichtbarem Logout-Fehlerstatus, Suche mit Escape/Entwurf, Tastatur-Enter auf Eventzeilen, 44-px-Ziele und Dirty-Dialoge. Die unabhängige Prüfung ist eingearbeitet (Kontostatus, Modifier-/Mittelklick, Resize-Fokus, Icon für Stammdaten, AK-Titel, zugänglicher Zeilenname ohne Label-Mismatch). Integrationstests und Linux-CI bleiben maßgeblich; Testbetrieb/Deployment folgen nach Commit und CI. **Kein Commit/Push in der Quellphase.**

### Arbeitsnachtrag 20.10.2026 (H029: leichtes Anlegen mit Datum zuerst)

Branch `codex/ux-event-simplification`. „Event anlegen“ öffnet einen modalen Dialog mit nativem Datumsfeld, Kundenauswahl und Eventart; Uhrzeiten, Ort, Notizen und weitere Felder liegen zugeklappt unter „Weitere Angaben“ und behalten ihre Eingaben. Der Name wird deterministisch aus Eventart und Kunde erzeugt, als Platzhalter gezeigt und ist unter „Weitere Angaben“ überschreibbar. Datum ohne Zeiten speichert `eventDate` ohne erfundene Mitternacht, undatiert bleibt möglich. Fokus startet im Datumsfeld, Tab bleibt im Dialog, Escape/Schließen schreiben nichts, und ein laufender POST sperrt Schließen und Escape. Ein offener Bearbeiten-Entwurf sperrt Anlegen/Duplizieren; nach Abbruch oder Speichern kehrt der Fokus auf einen überlebenden Auslöser zurück. Eigene `event-create-*`-IDs verhindern ID-Kollisionen mit dem Editor. Keine Server-, API-, Datenbank- oder Migrationsänderung.

Lokal grün: Format, Lint, Typen, Build, 187 Unit-, 210 Komponenten- und 237 Integrationstests sowie vier Chromium-Abläufe inklusive Desktop-/Mobilgeometrie und Tastaturprüfung des Dialogs; Coverage 97,37 % Zeilen und 93,75 % Zweige (`EventCreateDialog.tsx` 99,1 % Zeilen, 91,7 % Zweige). Der lokale `test:ops`-Lauf scheitert weiterhin nur am bekannten macOS-`RLIMIT_FSIZE`-Backuptest; Linux-CI bleibt maßgeblich. **Kein Merge nach `main`.**

### Arbeitsnachtrag 20.10.2026 (H026: Termin und Ressourcenzuweisung ohne manuelle Versätze)

Branch `codex/ux-event-simplification`. Die Eventakte zeigt Termin, Buchungsstatus und Einheiten in einem Formular mit einer ausdrücklichen Speicherung. Eventbeginn und Eventende werden nur noch lokal eingegeben; `EventTimeField`/`event-time.ts` lösen den Versatz in der Eventzeitzone auf. Doppelte Herbst-Uhrzeiten verlangen eine getrennte Auswahl für Beginn und Ende, Frühjahrslücken einen Feldfehler mit Fokus und ohne Mutation. Ein unveränderter gespeicherter Zeitpunkt bleibt exakt erhalten (auch doppelte Stunde, Sekunden, Millisekunden); eine bewusste andere Auswahl derselben Wanduhrzeit hat Vorrang. Nach einer Datumsänderung wird kein alter Versatz weiterverwendet (Sommer→Winter und Winter→Sommer geprüft). Das Eventdatum folgt dem lokalen Starttag, ist dann schreibgeschützt und nach dem Leeren des Beginns wieder eingebbar; Datum ohne Uhrzeiten und undatiertes Event bleiben möglich. Eigene Dispositionszeiträume je Einheit liegen unter „Erweitert“, nennen ihre gespeicherten Werte schon im zugeklappten Zustand, werden unverändert übernommen und bei einem verborgenen Fehler geöffnet und fokussiert. Speichern-Erfolg und Ladefehler bleiben getrennt, ungespeicherte Eingaben werden vor einem erneuten Laden nur nach Bestätigung verworfen. Keine Server-, API-, Datenbank- oder Migrationsänderung; Pflichtprüfungen zu Quelle, Prüfstatus, Fotobox und Belegung bleiben unverändert.

Ein Nachtrag nach der unabhängigen Prüfung behebt zwei Befunde: Ein korrigiertes Terminfeld löscht seinen Fehler und `aria-invalid` ohne erneutes Speichern; Partnerfehler von Beginn/Ende und je Einheit verschwinden mit der Korrektur des anderen Felds, während eine weiterhin unmögliche lokale Uhrzeit ihren aktuellen Feldfehler behält. Termin-Editor und Eventakte verwenden getrennte Fehler-IDs, sodass `aria-describedby` jeweils den eigenen Text nennt. Alle sechs Feldprüfungen der Akte sind mit Fokus belegt; die Prüfung hatte sie zuvor als unbelegt gemeldet.

Lokal grün: Format, Lint, Typen, Build, 187 Unit-, 197 Komponenten- und 237 Integrationstests, der Chromium-Passwort- und -Google-Ablauf, Coverage 97,68 % Zeilen und 94,57 % Zweige (`ResourceAssignments.tsx` 100 % Zeilen und 93,8 % Zweige, `EventTimeField.tsx` 100 % Zeilen und 89,7 % Zweige). Die tatsächliche DOM-Geometrie wurde mit dem gebauten Admin-Bundle und erfundenen Daten in Chromium gemessen: bei 1280 px stehen Datum, Beginn und Ende in einer Zeile, bei 390 px gestapelt, jeweils ohne horizontalen Überlauf; „Erweitert“ öffnet über den echten Summary-Klick. **Kein Testbetriebs-Update, kein Deployment, kein Merge nach `main`.**

Offen und bewusst nicht in diesem Slice: eine eigene Führung für gleichzeitige 409-Konflikte in der Akte. Die manuellen UTC-Versatzfelder der zeitweisen Ressourcensperren (`ResourceBlocks.tsx`) sind mit H040 erledigt: Der Bereich fragt nur lokale Sperrzeiten ab, löst den Versatz automatisch auf und behält gespeicherte Zeitpunkte exakt.

### Arbeitsnachtrag 20.10.2026 (H025: Härtung des Event-Editors nach der Prüfung)

Branch `codex/ux-event-simplification`. Der Slice behebt ausschließlich bestätigte Befunde der beiden unabhängigen Prüfungen zu H023/H024: „Weitere Angaben“ nutzt die volle Formularbreite mit einem responsiven Feldraster (im echten Chromium-DOM gemessen: 1238 px in einem 1280-px-Gitter, vier Spalten, 21 px Rand beidseitig; mobil 345,8 px, eine Spalte, kein horizontaler Überlauf; vorher 297,5 px in einer Spalte), ein aus dem Beginn abgeleitetes Datum ist schreibgeschützt und erklärt, dass es dem Starttag folgt, weitere Kontakte werden ohne den Hauptkontakt normalisiert statt mit einer unsichtbaren Blockade zu enden, ein erneutes Laden der Akte verlangt bei ungespeicherten Status- oder Ressourceneingaben eine Bestätigung und verwendet danach die frisch geladene Version, jeder erfolgreiche Listenabruf löscht einen alten Neuladehinweis, eine bestätigte Ressourcenspeicherung bleibt bei fehlgeschlagener Listenabfrage im stabilen Elternteil sichtbar, und Hinweistext und Schaltfläche sind getrennt. Keine Server-, API-, Datenbank- oder Migrationsänderung.

Lokal grün: Format, Lint, Typen, Build, 187 Unit-, 187 Komponenten- und 237 Integrationstests, alle vier Chromium-Abläufe, Coverage 97,64 % Zeilen und 94,66 % Zweige. Der Chromium-Ablauf prüft die Schreibsperre des Datums und den Datumswechsel 16.10.→16.11. über den Beginn. **Kein Testbetriebs-Update, kein Deployment, kein Merge nach `main`.**

Offen und bewusst nicht in diesem Slice: die UTC-Versatzfelder der Ressourcen- und Sperrdisposition, die H026/H040 inzwischen ohne Versatzfelder umgesetzt haben (Eventakte und zeitweise Sperren; done in H040), und eine eigene Führung für gleichzeitige 409-Konflikte in der Akte, die heute nur eine Meldung mit Aufforderung zum Neuladen erzeugt.

### Arbeitsnachtrag 20.10.2026 (H022: Zeitumstellung ohne UTC-Versatzfelder)

Branch `codex/ux-event-simplification` (abgezweigt von `origin/codex/local-runtime-ci`). Die Eventoberfläche fragt beim Anlegen, Bearbeiten und Duplizieren nur noch lokales Datum und lokale Uhrzeit ab. Eindeutige Zeiten löst `apps/admin/src/event-time.ts` in der Eventzeitzone auf; doppelte Herbststunden zeigen ausschließlich dort eine Auswahl Sommerzeit/Normalzeit, Frühjahrslücken einen Feldfehler. Unveränderte Zeiten behalten den gespeicherten Zeitpunkt (auch in der doppelten Stunde und mit Millisekunden); geänderte Datums-/Zeitwerte verwenden keinen alten Versatz mehr. Die Versatzfelder der Ressourcen- und Sperrdisposition sind bewusst unverändert. Keine Server-, API-, Datenbank- oder Migrationsänderung.

Lokal grün: Format, Lint, Typen, Build, 184 Unit-, 164 Komponenten-, 237 Integrationstests, Changed-Code-Coverage (`event-time.ts` 97,4 % Zeilen / 100 % Zweige, `EventTimeField.tsx` 100 % Zeilen / 92,9 % Zweige) und die vier Chromium-Abläufe inklusive echtem Datumswechsel 16.10.→16.11. und zurück. **Der Testbetrieb wurde in dieser Sitzung nicht aktualisiert und es wurde nichts ausgeliefert**; Containerstand und CI-Lauf dieses Commits sind beim Fortsetzen zu prüfen.

### Laufzeitnachtrag 20.10.2026 (C051.3: Angebote in der Eventakte)

Geprüfter Stand **`35fa588e6098184db126f37319e9dc1ccad17905`**, [CI-Lauf 39429748089](https://github.com/gcode-de/auftragskompass/actions/runs/39429748089) vollständig grün, einschließlich Changed-Code-Coverage und beiden Images. Die drei Testcontainer `ak-test-api`, `ak-test-worker` und `ak-test-admin` sind gesund auf genau dieser Revision. Im ausgelieferten Admin-Bundle stehen die neuen Texte „Angebote“ und „Entwurf anlegen“; der Abschnitt listet Dokumente des Events, legt Entwürfe aus einer aktiven Angebotsvorlage mit dem Hauptkontakt an, finalisiert und verlinkt die PDF.

Abgesichert durch 159 Komponententests (acht neue), 182 Unit- und 237 Integrationstests; die neue Datei liegt bei 94,3 % Zeilen und 89,7 % Zweigen. Eine echte Browser-/Screenshot- und axe-Abnahme des neuen Abschnitts fand in dieser textbasierten Sitzung nicht statt; Rollen, zugängliche Namen und Zustände sind über die Komponententests geprüft.

Offen: Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, Bearbeiten von Entwürfen, Logo-Upload in der Oberfläche, Rechnungsarten (C054).

### Laufzeitnachtrag 20.10.2026 (C049.1 und C048.1: PDF-Download und Logo)

Geprüfter Stand **`e7c336a249e81f399482be6c0289f6b8547cd432`**, [CI-Lauf 39418950570](https://github.com/gcode-de/auftragskompass/actions/runs/39418950570) vollständig grün, einschließlich Changed-Code-Coverage und beiden Images. Die drei Testcontainer `ak-test-api`, `ak-test-worker` und `ak-test-admin` sind gesund auf genau dieser Revision; der automatische Updater hat sie übernommen. In der Testdatenbank stehen die Anwendungsmigrationen `0030_documents` und `0031_document_logos` mit Prüfsumme (31 Anwendungsmigrationen; dazu kommen drei Gateway-Migrationen in derselben Tabelle). Das Volume `ak-test-documents` bleibt an `/data` gebunden und ist im Container beschreibbar.

Neu in dieser Revision: `GET /api/v1/documents/:id/pdf` liefert die finalisierte PDF über den gespeicherten Hash; `PUT /api/v1/document-layout/logo` nimmt PNG oder JPEG bis 512 KB an, prüft die Signatur gegen den deklarierten Typ, legt die Bytes im Storage-Adapter ab und referenziert sie im Layout; beim Finalisieren wird das Logo als `data:`-URI eingebettet.

Offen: Oberfläche für Angebote, Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, Rechnungsarten (C054).

### Laufzeitnachtrag 20.10.2026 (C051: Angebote persistieren und finalisieren)

Geprüfter Stand **`58469ee8235aafc4fa3b8500f3eb28a999843671`**, [CI-Lauf 39412962126](https://github.com/gcode-de/auftragskompass/actions/runs/39412962126) vollständig grün, einschließlich Changed-Code-Coverage und beiden Images. Die drei Testcontainer `ak-test-api`, `ak-test-worker` und `ak-test-admin` sind gesund auf genau dieser Revision; der automatische Updater hat sie selbstständig übernommen.

Neu in dieser Revision: Migration `0030` (`documents`, `document_lines`), Entwurf und Finalisieren in einer Transaktion mit Nummernvergabe, Snapshot, Chromium-PDF und inhaltsadressierter Ablage, die drei Dokumentrouten sowie die Auditaktionen `document.created`/`document.finalized`. Betrieblich nachgewiesen: Das Host-Quadlet des API-Containers bindet `ak-test-documents.volume` an `/data` (neue Quadlet-Datei `ak-test-documents.volume`), der Container bleibt healthy, und im laufenden Container als Benutzer 1000 schreibt, liest und löscht der Storage-Adapter unter `/data`; Chromium erzeugt dort eine PDF mit `%PDF-`-Kopf und 7.113 Bytes. Ohne das Volume wäre die Ablage im Container-Dateisystem gelandet und bei jedem Update verloren gegangen.

Lokal: 181 Unit-, 231 Integrations- und 151 Komponententests sowie vier Chromium-Abläufe grün, Format, Lint, Typen und Build grün. Der lokale `test:ops`-Lauf meldet auf macOS einen Fehlschlag im Backup-Phasentest, der unverändert schon auf dem Basiscommit auftritt; die Linux-CI ist vollständig grün.

Offen: Oberfläche für Angebote, Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, PDF-Download (C049.1), Logo (C048.1) und die Rechnungsarten (C054).

### Laufzeitnachtrag 19.10.2026 (M4-Grundlagen und Betreiberkorrekturen)

Geprüfter Stand **`cbbb8551e9f2aecf90df3f9ed41c0700abf8b3fe`**, CI-Lauf 39384215640 vollständig grün (Qualität und Images). Darin neu: C049 — Chromium rendert PDFs. Im Container nachgewiesen: eine Probe in `ak-test-api` erzeugt ein PDF mit 13.455 Bytes und korrektem `%PDF-`-Kopf. Preis dafür: das Runtime-Image wächst von 572 MB auf 1,3 GB, weil API und Worker sich ein Image teilen und die öffentlich erreichbare API Chromium damit mitführt, aber nie nutzt. Sinnvolle Abhilfe wäre ein eigenes Worker-Image; das verlangt einen dritten Zielpfad im privaten Updater (`scripts/auto_update.py` kennt bisher nur `runtime` und `admin`). Auf dem Podman-Testhost laufen `ak-test-api`, `ak-test-worker` und `ak-test-admin` gesund auf genau dieser Revision; der automatische Updater hat sie selbstständig übernommen. In dieser Revision enthalten: Vorbelegung `DE` für neue Website-Kontakte, sichtbare Build-Version in der Navigation, Migrationen `0026` (Dokumentvorlagen), `0027` (Nummernkreise), `0028` (Dokumentlayout) und `0029` (Kalender-Abos ohne Ablauf), dazu die Betreiberkorrekturen H021: Kalender-Abos laufen nicht mehr ab, Termine sind echte Ganztagstermine, und „Menü schließen"/„Abmelden"/„Dunkelmodus" sind Icon-Schaltflächen. Betrieblich nachgewiesen: `expires_at` ist in der Testdatenbank nullable ohne Default, der Text „läuft nicht ab" und das `aria-label` „Menü schließen" stehen im ausgelieferten Admin-Bundle, und im Runtime-Image erzeugt `ics.js` einen Ganztagstermin mit `ALLDAY`-Kennzeichen ohne `DURATION`-Eigenschaft. Offen bleiben die PDF-Erzeugung (C048.1 Logo, C049) und die eigentlichen Angebote/Rechnungen (C051/C054).

### Betriebsnachtrag H020 (19.10.2026)

Auf ausdrücklichen Nutzerwunsch wurde das GitHub-Repository öffentlich geschaltet.
Der [automatische Update-Dienst](automatic-updates.md) ist auf dem Proxmox-Host
aktiviert: fünf Minuten nach dem letzten Lauf, nur grüner aktueller Branch-Head,
koordinierte Digest-Pins, pausierter Checkpoint und geprüfte CT-/Hostkopie vor dem
Wechsel. Gemeinsames Schloss mit dem privaten manuellen Updater, dauerhafte
Fehlersperre statt automatischem Schema-Rollback. Kein GitHub-Token installiert.
Der erste echte Lauf aktualisierte auf den grünen Planungscommit
`906a3e0a6eb8298e4193a4fc6c63b3d68d377160`; alle drei App-Container gesund mit exakt
dieser Revision. Gateway und andere Dienste bleiben außerhalb dieses Updaters.
Die folgenden Angaben zu H018 bleiben dessen historischer Feature-Nachweis.

- Feature-Commit **`5281c9d41ffa8db99e10d37c7669fa856d47f8b0`**, `fix: keep authenticated sessions valid for 90 days` (H018), auf `codex/local-runtime-ci` gepusht.
- [GitHub-Lauf 39210100093](https://github.com/gcode-de/auftragskompass/actions/runs/39210100093) vollständig erfolgreich, einschließlich Qualität und Images.
- Lokal: Format, Lint, Typen, Workspace-/Dokumentationsprüfungen, Coverage mit **443 Tests**, **vier Chromium-Abläufe** und Build grün. CI führte zusätzlich ihre vollständigen Gates einschließlich Betriebsproben aus.
- Testinstallation auf genau diesem Commit aktualisiert. API, Worker und Admin waren gesund; alle drei OCI-Revisionslabels stimmten exakt überein. Im gestarteten Runtime-Image waren `7776000` Sekunden Sitzungsdauer geprüft; anonymer `/auth/me`-Abruf blieb 401.
- Vor Update wurden App-Dienste pausiert und eine Sicherung erzeugt; Host- und Betreiberrechner-Kopie hatten verifizierte identische Prüfsummen. Echte Buchungen und Inhaberpasswort wurden nicht geändert.
- Spätere reine Dokumentationscommits können Git-HEAD vor diesen Laufzeitstand setzen. Daraus nicht automatisch ein fehlendes Feature-Deployment ableiten; tatsächlichen Stand neu prüfen.

### Anmeldung seit H018

Neue Passwort- und Google-Sitzungen gelten **90 Tage absolut ab Anmeldung**, Cookie und Datenbank mit gemeinsamer Dauer. Zugriffe verlängern die Frist nicht. Bestehende Sitzungen behalten ihre alte Frist; der Benutzer muss einmal neu anmelden, um 90 Tage zu erhalten. Logout, Passwortwechsel, Betreiber-Reset und Kontosperre widerrufen weiter sofort. Cookies löschen/Privatmodus kann frühere Neuanmeldung verursachen. Details: [Authentifizierung](authentication.md).

## Verbindlich weiterzuverwendende Skills

Die Nutzeranforderung zur Weiterverwendung steht zusätzlich in [AGENTS.md](../AGENTS.md), damit sie beim Sessionstart geladen wird. Vor erster Anwendung die tatsächliche installierte Version lesen und Skill-Einsatz ankündigen; diese Tabelle allein lädt oder installiert keinen Skill. Bei fehlendem Skill Verfügbarkeit klären und nicht behaupten, er sei genutzt worden.

Lokale Basis auf dem bisherigen Rechner: `~/.codex/skills/`.

| Skill                                                   | Einsatz und bisheriger Kontext                                                                                                                                                                                                                                                                                 | Lokaler Einstieg           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Ponytail**, full                                      | Alle Codeaufgaben, Fixes, Refactorings und Reviews. Kleinste vollständige Lösung; vorhandene Muster/Abhängigkeiten bevorzugen. Keine Abstraktionen auf Vorrat, niemals Sicherheit/Tests/Zugänglichkeit kürzen. Vom Nutzer ausdrücklich verlangt. [Genannte Quelle](https://github.com/DietrichGebert/ponytail) | `ponytail/SKILL.md`        |
| **Impeccable** von Paul Bakaus                          | Frontend-Entwurf, Review, responsive Zustände, Kontrast, Fokus, UX-Texte und Designsystem. Aktuellen Workflow einschließlich erforderlichem unabhängigen Finish-Review und Dokumentation vollständig beachten. [Genannte Quelle](https://github.com/pbakaus/impeccable)                                        | `impeccable/SKILL.md`      |
| **emil-design-eng**                                     | Emil-Kowalski-Prinzipien für UI-Politur und Bewegung: Zweck, Unterbrechbarkeit, Tastatur und reduzierte Bewegung. Entspricht dem angeforderten Emil-/Motion-Kontext; nicht als zusätzlich installiertes Paket namens „motion“ ausgeben.                                                                        | `emil-design-eng/SKILL.md` |
| **animate**                                             | Passender lokaler Skill für konkrete neue Animationen/Übergänge, wenn die Aufgabe sie erfordert. Bisherige Bewegungsregeln nicht allein wegen Skill-Verfügbarkeit ausweiten.                                                                                                                                   | `animate/SKILL.md`         |
| **design-taste-frontend** (Taste, Leon Lin; aktuell v2) | Für unterstützte öffentliche Seiten und passende Komponenten. Aktuelle Fassung schließt Dashboards/App-Screens aus; bei schmalen Komponentenänderungen bestehende Richtung und Komponenten-Ausnahme beachten. Kein Marketing-Redesign der Verwaltungs-App erzwingen.                                           | `taste-skill/SKILL.md`     |
| **design-taste-frontend-v1**                            | Lokal vorhandene Altversion, kein pauschaler Standard. Nur bei begründetem Bedarf an genau dieser Fassung.                                                                                                                                                                                                     | `taste-skill-v1/SKILL.md`  |

Keine Skill-Texte unkontrolliert ins Repo kopieren. Auf anderem Rechner müssen diese Installationen gesondert verfügbar gemacht werden. Spezialisierte Review-/Documenter-Rollen waren zuletzt nicht verfügbar; Impeccable-Rollen wurden durch frische generische Ersatzagenten erfüllt und als solche dokumentiert. Agenten nicht grundsätzlich parallel starten, sondern nur gemäß aktuellen Benutzer-/Skill-/Agentenregeln.

### Arbeitsnachtrag 22.10.2026 (H036: eine primäre Aktion je Fläche, Phase 1 ohne Commit)

Branch `codex/ux-event-simplification`, Basis `c52e4ca`. Reine Darstellungs-Hierarchie im Admin-Bundle: kein Layout-, kein Positions-, kein Wortlaut- und kein Funktionswechsel, keine API-/Datenbank-/Auth-Änderung.

`apps/admin/src/styles.css` hat jetzt einen kleinen gemeinsamen Satz statt „alle Knöpfe grün": `--action`/`--action-hover`/`--action-border` für die eine gefüllte Primäraktion, `--quiet-ink`/`--quiet-action-border` für Sekundär und Tertiär, dazu `.primary-action`, `.secondary-action`, `.tertiary-action`, `.nav-action` sowie die Icon-Modifikatoren `.tier-primary-icon` (einziges anlegenden Icon je Bereich) und `.tier-quiet-icon`. Die Stufen unterscheiden sich in Füllung, Rand **und** Schriftgewicht, nie nur in der Farbe; deaktivierte Aktionen haben Deckkraft plus gestrichelten Rand; `:focus-visible` bleibt 3 px bei 3 px Offset, und alle Stufen halten 44 px, auch die ruhigste.

Angewendet auf Anmeldung/Abmelden/Theme, Events-Liste, -Filter und -Editor, Anlegen-Dialog, Event-Details, Ressourcenzuweisung, Sperren, Kalender, Kontakte inkl. Dialog, Dateien, Website-Eingänge, Angebote, Stammdaten, Ressourcen, Produkte, Kalender-Abos und Konto/Zugriff. H031s Icon-Aktionen bleiben unverändert benannt und ruhig; sie werden nur in denselben Satz einsortiert. Die Event-Detailflächen (Übersicht, Angebote, Ressourcen) behalten je eine eigene primäre Aktion, weil sie eigenständige Bereiche sind.

Fail-first belegt: `tests/component/action-hierarchy.test.tsx` (12 Tests) lief zuerst komplett rot und prüft je Fläche genau eine primäre Aktion, benannte Stufen für jede sichtbare Aktion, Icon-Stufen, den Stylesheet-Vertrag (Tokenpaare, 44 px, Fokus, deaktiviert) und WCAG-AA-Kontrast in Hell und Dunkel. `tests/component/ui-language.test.tsx` bekam eine Mount-Reihenfolge-Härtung, weil die Grundlinie der Abrufzähler den abgeschlossenen Erstaufbau voraussetzt — ohne sie war der Test sporadisch rot, auf dem Basisstand nicht.

Lokal mit Node 24.15.0 (`pnpm --use-node-version=24.15.0`, seriell): 227 Unit-, 341 Komponenten- (achtmal hintereinander stabil), Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung sowie alle sechs Chromium-Abläufe grün. Zusätzlich im echten Chromium gegen das gebaute Bundle mit synthetischen Antworten: 246 sichtbare Aktionen auf sechs angemeldeten Flächen in beiden Themen bei 1280/390/320 px ohne Kontrast- und ohne 44-px-Verstoß, ohne Body-Überlauf; die Anmeldeseite ebenso; Fokusrahmen 3 px/Offset 3 px in beiden Themen. Coverage, Linux-CI und Testbetrieb folgen nach dem Commit; der macOS-`RLIMIT_FSIZE`-Backuptest bleibt unverändert lokal rot. **Kein Commit/Push/Deploy in Phase 1.**

### Bestehende Gestaltungsgrundlage und Prüfgrenzen

- [Admin-DESIGN.md](../apps/admin/DESIGN.md) und [Design-Sidecar](../apps/admin/.impeccable/design.json) sind maßgebliche lokale Gestaltungskontexte: ruhige grüne Farbrollen, Systemschrift, mobile Bereiche statt alles gleichzeitig, mindestens 44px Bedienflächen, sichtbarer Fokus, Hell/Dunkel.
- [Widget-Surface-Brief](../apps/widget/.impeccable/surfaces/inquiry-form.md) dokumentiert die schmale Erweiterung der bestehenden Formularsprache. Keine neue Markenwelt, Rasterbilder oder neue Schriftbibliothek nötig.
- E004.18: unabhängiger Finish-Review `ship`, acht Widget-axe-Prüfungen ohne Befund; Hell/Dunkel bei 390/768/1440px sowie Fehler/Erfolg visuell geprüft. Impeccable-Detector `[]`, Taste-Quelllint 0 FAIL/0 WARN.
- Der Taste-Browserinspektor sah nur die Vorschauhülle außerhalb des Shadow DOM. Das ist **kein** automatischer Komponenten-Prüfnachweis. Separate Captures und Chromium/axe decken die Komponente ab. Physische iOS-/Android-Geräte und echte WordPress-Einbettung bleiben offen.
- Der Impeccable-Launcher war nicht direkt ausführbar; Kontext wurde direkt gelesen, spätere Launcher-Aufrufe über `sh` funktionierten. Tatsächlichen Zustand neu prüfen; keinen erfolgreichen automatischen Kontextlauf behaupten. Details im [Formularvertrag](website-inquiry-intake.md).

### Arbeitsstand 22.10.2026 (H032 Website-Eingänge als Option, Code uncommittet)

Arbeitskopie auf `codex/ux-event-simplification`, Basis-HEAD `9984cbf`. Nicht
committet, nicht gepusht, nicht deployt. Die unabhängige Prüfung bestätigte
genau einen deployment-kritischen Defekt (Bereitschaft hing an einer optionalen
Einstellung); er ist behoben, siehe „Optionale Konfiguration“ unten.

- Gesicherte Website-Eingänge werden automatisch als unverbindliche Option
  angelegt: `receiveWebsiteInquiry` hat einen optionalen Status (Standard
  `inquiry` für bestehende Aufrufe), Automatikpfad und autorisierte manuelle
  Wiederholung erzeugen `option`. Keine Uhrzeiten, keine Reservierung, keine Mail,
  kein Paket; Herkunft, Original-Payload und Logbuch `website_received` bleiben.
- Der Worker startet den Lauf `startWebsiteOptionDrain` über
  `apps/worker/src/worker-start.ts`; fachliche Ausnahmen bleiben sichtbar, nur
  Infrastrukturfehler machen den Worker „nicht bereit“.
- **Optionale Konfiguration:** `AK_INQUIRY_TENANT_ID` und
  `AK_INQUIRY_OPERATOR_ID` sind optional. Fehlen beide, startet kein Takt, der
  Worker protokolliert einmal `website_option_drain_unconfigured` als Warnung
  und bleibt gesund; alle Eingänge bleiben als Ausnahmen sichtbar. Genau eine
  der Kennungen oder eine Nicht-UUID gilt weiterhin als Fehler
  (`website_option_config_invalid`, nicht bereit). Eine kaputte
  Sync-Konfiguration bricht den Start nicht mehr ab
  (`inquiry_sync_config_invalid`, Transport bleibt aus). Bereitschaft:
  `expiry && (!drain || drain.ready()) && (!sync || sync.ready())`.
- **Vor dem nächsten Deployment:** Das Quadlet
  `infrastructure/podman/ak-test-worker.container` setzt Platzhalterwerte für
  Mandant und Betreiber. Die Betreiber-ID ist die Benutzer-ID des
  Bootstrap-Kontos dieser Installation und ändert sich bei Neuinstallation oder
  Wiederherstellung. Der Betreiber muss echte Werte eintragen oder beide Zeilen
  entfernen (dann nur Ausnahmen, Worker bleibt gesund).
- Land für neue Kontakte ist eine Deployment-Einstellung
  (`AK_INQUIRY_DEFAULT_CONTACT_COUNTRY`), kein Domänenwert. Ohne sie bleibt ein
  Eingang mit neuem Kontakt als `contact_review`-Ausnahme stehen. Die
  Vorbelegung DE aus der Entscheidung vom 19.10.2026 wird nur gesetzt, wenn die
  Umgebung sie vorgibt; in `.env.example` ist sie auskommentiert dokumentiert.
- Die Oberfläche heißt „Website-Eingänge (Ausnahmen)“ und listet nur noch nicht
  automatisch angelegte Eingänge.
- Lokal grün: 226 Unit-, 315 Komponenten-, 274 Integrationstests (39 davon
  Website-Eingänge), Chromium-Passwortablauf, Format, Lint, Typen, Build und
  Dokumentationsprüfung. Coverage, vollständige Chromium-Suite, CI und
  Testbetrieb werden nach dem Push belegt; H036 bleibt offen, H035 ist bereits
  released.
- Der Linux-CI-Befund zum lokalen macOS-`RLIMIT_FSIZE`-Backuptest bleibt
  unverändert bestehen; diese Sitzung hat ihn nicht angefasst.

## Wichtige Benutzerentscheidungen

- Eigener Login mit E-Mail/Benutzername und Passwort. Authentik oder Google nicht ungefragt aktivieren; Google-OIDC bleibt optional. Kein Ändern des echten Inhaberpassworts im Rahmen normaler Entwicklungsarbeit.
- Mobile Bedienung priorisieren; Menü, getrennte Arbeitsbereiche und Eventakten-Unterbereiche sowie Hell-/Dunkelumschalter beibehalten. Bookitup-Screenshots waren Strukturreferenz, kein Auftrag zur pixelgleichen Kopie.
- Das Formular von `fotobox-bw.de` zunächst vollständig mit seinen **acht bisherigen Feldern** übernehmen. Später Inhalte konfigurierbar machen und mehrere Formulare ermöglichen. Aktueller Vertrag, Paketwerte und Datenschutztext stehen versioniert in der gemeinsamen Definition; keine Werte neu erfinden.
- Ein Anfrageeingang ist keine feste Buchung. Unklarer Empfang wird mit unverändertem Inhalt und gleicher ID wiederholt. Neue Entscheidung vom 19.10.2026: Deutschland darf für neue Website-Kontakte ausdrücklich vorbelegt werden; bestehende Kontakte nicht ändern. Das ist umgesetzt: das Prüffeld startet mit `DE`, bleibt änderbar, und der Server verlangt das Land weiterhin explizit — wer das Feld leert, erhält wie bisher den Prüf-Fehler.
- Fünf bestätigte Eventarten: Hochzeit, Geburtstag, Firmenfeier, Weihnachtsfeier, sonstiges. Eine ältere Angabe „sieben“ ist kein Anlass, zwei weitere zu erfinden.
- LibreOffice ist als Übergang für Angebote/Rechnungen gewählt, aber Nummernfortführung, offene Posten und vollständiger Ersatzablauf sind nicht abgenommen.
- Bookitup: historische Auftragsübersichten reichen; keine weiteren historischen Detailakten sichern. Zukünftige Aufträge sind relevant. Zusätzlich Vorlagen, Standarddateien, erreichbare Finanzstände, Nummernkreise und Stammdaten erhalten. Relevante versandte Angebote/Rechnungen liegen nach Betreiberangabe im eigenen Mailbestand; keine redundanten Belegdownloads ohne Anlass.
- Bestehende Sicherung ist noch nicht gleich fachlich abgenommen oder unabhängig gesichert. Kunden-/Bankdaten nicht aus Bildschirmtexten erraten. [Bestand und offene Abnahme](bookitup-exit.md), [Normalisierung](bookitup-normalization.md), [Minimalimport](minimal-import.md).
- Jeden fertigen Commit sofort pushen, keine Force-Pushes/Amends gepushter Commits. Docker-Hub-Veröffentlichung automatisiert nach grüner CI. Neue Nutzerentscheidung vom 19.10.2026: [koordinierte automatische Testupdates](automatic-updates.md) mit Sicherung und Digest-Pins aktivieren (H020); nicht durch unabhängige Watchdog-/Registry-Neustarts ersetzen.

## Nächste sinnvolle Arbeit

Noch keine neue E004.19-Implementierung allein durch diese Übergabe beauftragt. Vor Codeänderung den tatsächlichen Einstieg in `apps/gateway` und `apps/worker` lesen; Bibliotheks-/Contract-Tests sind kein Nachweis einer betriebenen Verbindung.

1. ~~Slice für die öffentliche Gateway-Laufzeit festlegen~~ **erledigt als C028** (`2543107`): `apps/gateway` startet als eigener Fastify-Prozess mit validierter Konfiguration, eigenen Migrationen und Opt-in-Compose-Profil; keine neue öffentliche Admin-API.
2. ~~Dauerhaften Abhol-/Quittierungslauf in den Worker einbinden~~ **erledigt als C028** (`7107edb`): `startWebsiteInquirySync` fährt den vorhandenen signierten Transport mit Signaturprüfung und Wiederholschutz und verlangt eine aktive Betreiberberechtigung als handelnde Identität; ohne `AK_GATEWAY_ORIGIN` bleibt der Takt inert, der laufende Testbetrieb ist nicht betroffen.
   2a. **Als Nächstes C028.1:** Gateway mit synthetischen Schlüsseln real kalt starten und den Worker dagegen laufen lassen, statt Pull-Antworten im Test zu stubben. Podman-Secrets `ak-test-gateway-storage`/`ak-test-gateway-sync` anlegen und die Platzhalter im Quadlet ersetzen. Der automatische Testupdater fasst nur `api`, `worker` und `admin` an; Gateway bleibt bewusst außerhalb.
3. Gateway-Hosting, öffentliche Zieladresse, WordPress-Einbettung/CSP und tatsächlichen Anfrageweg mit synthetischen Daten abnehmen. Erst danach kontrollierte Website-Umschaltung; bis dahin das alte Formular nicht entfernen.
4. Angebot/Rechnung als gezielt priorisierten M4-Ausbau weiterführen: C051 (Persistenz und Finalisieren) ist umgesetzt, als Nächstes bieten sich Oberfläche, PDF-Download, Logo oder die Rechnungsarten an. Den LibreOffice-Ersatzablauf konkret abnehmen; nicht automatisch den gesamten M3/M5/M6-Umfang vorziehen.
5. Parallel nötige Betreiberentscheidungen: unabhängiges Backupziel und Aufbewahrung, private Importkorrekturen, Länder-/Kontaktzuordnung, reale Zukunftsaufträge und tatsächliche Boxzuweisungen. Erst mit fachlicher Freigabe übernehmen.

## Betrieb und Datenschutz

- Testbetrieb auf Podman/Proxmox hinter bestehendem Reverse Proxy und Cloudflare-Tunnel; genaue Host-/Kontodaten und private Werkzeuge stehen ausschließlich in der privaten Betreiberübergabe. Architektur `linux/amd64`; andere Architekturen nicht als geprüft behaupten.
- [Home-Lab-Anleitung](homelab.md), [Betrieb](operations.md), [Störungen](incidents.md), [verschlüsselte Sicherung](backup-encryption.md), [Backupzeitplan](scheduled-backup.md) und [Kalender-Abos](calendar-feeds.md) lesen, wenn betroffen.
- Nur vollständig grüne CI samt beiden Images deployen. Privater manueller Updater nutzt `scripts/update_checkpoint.py`: App-Dienste vor konsistentem Dump pausieren, vor Image-/Schemaänderung Sicherung prüfen. Host-/Betreiberkopie mit gleicher Prüfsumme bestätigen, danach drei gesunde App-Container und exakte OCI-Revision prüfen. Keine parallelen manuellen Updates.
- Bei Checkpointfehler nicht fortfahren. Nach Migration niemals automatisch alte App gegen neues Schema starten; erforderlichen Restore bewusst und geprüft durchführen.
- Reale Kunden, E-Mails, Adressen, Dateien, Tokens, Exporte, Sicherungen und Zugangsdaten bleiben außerhalb Git. Root-Allowlist nicht erweitern, nie pauschal stagen; in Tests nur sichtbar fiktive Daten.
- Keine echte Buchungsübernahme, Kündigung, Kundennachricht oder Produktivumschaltung ohne entsprechenden konkreten Auftrag/Abnahme.
- Die einmalige Wiederaufnahme-Automation `auftragskompass-nach-reset-fortsetzen` wurde nach Abschluss gelöscht. Nicht erneut anlegen oder alte Kontingentschwellen als aktuellen Dauerauftrag übernehmen. Bei neuer ausdrücklich kontingentgesteuerter Arbeit tatsächliche Fünf-Stunden-/Wochenlimits prüfen; keine manuellen Resets oder Credits-Ausweichlösung aus früheren Anweisungen ableiten.

## Orientierung im Code und in den Dokumenten

| Thema                         | Einstieg                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geschäftsmodell/Anforderungen | [Lastenheft](../Lastenheft_Fotobox-Verwaltung_MVP.md), [Entscheidungen](decisions.md), [Plan](../IMPLEMENTATION_PLAN.md)                                                                            |
| Authentifizierung/Sitzungen   | [Anmeldung](authentication.md), `packages/core/src/auth-config.ts`, `auth.ts`, `access.ts`, `password-access.ts`                                                                                    |
| Website-Pipeline              | [Formular-/Übergabevertrag](website-inquiry-intake.md), [Gateway](inquiry-gateway.md), [Gateway-Inbox](inquiry-inbox.md), [lokale Anfragen](website-inquiries.md), [Protokoll](gateway-protocol.md) |
| Öffentliche Komponente        | `apps/widget/src/InquiryForm.tsx`, `mount.tsx`, `inquiry-client.ts`, `inquiry-form.css`; gemeinsame Definition `packages/core/src/inquiry-form-definition.ts`                                       |
| Echte Übernahme/Exporte       | [Minimalimport](minimal-import.md), [Ressourcenprüfung](import-resource-review.md), [CSV-Exporte](data-exports.md)                                                                                  |
| Qualität                      | [Testanleitung](testing.md), [Zugänglichkeit](accessibility-audit.md); `pnpm check` führt die vollständige Suite aus                                                                                |

Node 24 LTS und pnpm 10.2.0 wurden zuletzt verwendet. Wenn der normale Shell-Node abweicht, funktioniert auf dem bisherigen Rechner `npm exec --yes --package=node@24 --call 'pnpm …'`. Für Integration/E2E/Restore werden Docker und Chromium benötigt. Keine gleichzeitig schreibenden Coverage-Läufe starten; bei Docker-Testfehlern nicht pauschal fremde Container oder den gesamten Docker-Dienst neu starten.

## Starttext für eine neue Session

> Arbeite im Repository AuftragsKompass weiter. Lies zuerst AGENTS.md und docs/handoff.md vollständig, danach den aktuellen Implementierungsplan und den relevanten Lastenheft-Abschnitt. Prüfe Git, CI und den tatsächlichen Deploymentstand. Verwende die dort festgehaltenen Skills, insbesondere Ponytail für Code und Impeccable für UI, jeweils mit ihrem aktuellen SKILL.md. Halte dich an einen nummerierten Slice, Tests und sofortigen Push. Der öffentliche Anfrageweg ist noch nicht mit der echten Website verbunden; prüfe die Übergabe, bevor du nächste Schritte auswählst. Keine echten Daten oder Zugangsdaten in Git und kein ungeprüfter Produktivwechsel.
