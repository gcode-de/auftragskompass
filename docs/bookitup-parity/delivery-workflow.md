# Lieferworkflow und Statusmatrix

Stand 24.10.2026. Dieses Dokument fasst zusammen, **wie** ein geprüfter Stand in den
Home-Lab-Testbetrieb gelangt und **in welchem Zustand** jedes sichtbare Ergebnis
gerade steht. Es ersetzt keine Einzelbefunde; es ist die kompakte Matrix statt
weiterer Chronik. Drei Zustände sind streng getrennt und nie gleichbedeutend:

| Zustand | Bedeutung | Nachweis |
| --- | --- | --- |
| **IMPLEMENTIERT** | Geprüfter Quellstand auf der jeweiligen Implementierungsbranch mit Tests, Gates und grünem CI-Lauf | Commit-SHA + CI-Run |
| **VISUELL ABGENOMMEN** | Im gebauten/ausgelieferten Build bei 320/390/768/1280(1440) in beiden Themes angesehen; Kriterien des jeweiligen Auftrags erfüllt | Build-SHA + Datum + knappe Belege (Screenshots nur in privater Ablage) |
| **IM TESTBETRIEB AUSGELIEFERT** | Läuft im bestehenden Testbetrieb (ak-test-\* auf CT114) mit geprüfter Checkpoint-Sicherung | Ausgelieferter SHA (OCI-Label + sichtbare Buildkennung) + Datum + Beleg |

Ein grüner `quality`-Lauf ist **kein** Image- und kein Deploynachweis. Erst die
Dreizustandskette gilt als geliefert.

## Genau ein Auslieferungsweg (Testbetrieb)

Der Testbetrieb folgt der freigegebenen Branch `codex/ux-event-simplification`
(Konfiguration `/etc/auftragskompass-update.json`); die Veröffentlichung der
Images ist auf `main`, `codex/local-runtime-ci` und `codex/ux-event-simplification`
beschränkt (Allowlist in `.github/workflows/quality.yml`). Der einzige
Auslieferungsweg ist der automatische, koordinierte Updater `ak-test-update.timer`
auf dem Proxmox-Host (Dokumentation: [automatic-updates.md](../automatic-updates.md)):

1. Ab H045 direkt auf der bestehenden freigegebenen Branch
   `codex/ux-event-simplification` arbeiten: ein nummerierter Slice, lokale Gates,
   vollständiger Review, explizites Staging und sofortiger Push je Commit.
2. Der Übergang von `codex/bkp-wave1` erfolgt einmalig nur nach erneut geprüfter
   Fast-forward-Beziehung und sauberem Arbeitsbaum. Historie erhalten, kein
   Force-Push, `main` unangetastet. Frühere Source-/Release-Doppelprüfungen sind
   historische Belege; neue Slices benötigen nur die eine vollständige Branch-CI.
3. **Vollständig grüne CI einschließlich `images` exakt zum freigegebenen SHA**
   auf der UX-Branch abwarten (`runtime-<sha>` und `admin-<sha>` werden gepusht).
4. Der Updater zieht digest-gepinnte Images, prüft die OCI-Revision, sichert
   Quadlets und `needs-attention`-Marker, pausiert die App-Dienste, erstellt und
   verifiziert einen Datenbank-Checkpoint (Dump im CT **zusätzliche Hostkopie**
   mit identischem SHA-256), ersetzt die Quadlets atomar und startet die
   Administration mit ihren Abhängigkeiten. Erst bei drei gesunden Containern
   mit exakt der Zielrevision entsteht `last-success.json`; ein Fehler nach dem
   Marker sperrt weitere automatische Updates dauerhaft.
5. Der Betreiberausgleich zur Hostkopie (identischer SHA-256 auf den
   Betreiberrechner) wird im Lieferbeleg notiert. Genau ein Updateweg: keine
   parallelen manuellen/automatischen Updates; beide nutzen
   `/run/lock/auftragskompass-update.lock`. Bei manueller Koordination gilt:
   Timerzustand bewahren, laufenden Service abwarten, nie gewaltsam stoppen.
6. Nach dem Update: alle drei Container gesund, exakte OCI-Revision, sichtbare
   Buildkennung, Browser neu laden (ohne ungespeicherte Eingaben zu verwerfen),
   Assets/Filterposition/Theme prüfen, Desktop- und Mobilansicht direkt ansehen.

**Randbedingungen jeder Auslieferung:** kein Produktiv-Cutover; keine echten
Datenimporte/Mails/Passwörter; der automatische Website-Option-Drain bleibt
ausdrücklich **off** (Variable `AK_INQUIRY_OPTION_DRAIN` nicht gesetzt bzw.
`off`; der Worker meldet dann `website_option_drain_inactive` und bleibt bereit —
der Gateway-Empfang läuft weiter); keine Massenübernahme echter Rückstände.
Echte Referenzdaten, Rohscreenshots und Kundenbezüge bleiben ausschließlich in
privater Ablage und kommen nie ins Repository.

## Statusmatrix

Aktualisieren bei jedem Zustandswechsel; Datum und Beleg nennen, nichts ohne
Nachweis hochstufen. Offene Restlücken in der letzten Spalte ehrlich halten —
es wird keine vollständige Funktions- oder visuelle Parität behauptet.

| Ergebnis | IMPLEMENTIERT | VISUELL ABGENOMMEN | IM TESTBETRIEB AUSGELIEFERT | Offene Restlücken |
| --- | --- | --- | --- | --- |
| BKP018.0/BKP018.0b/BKP018.1 — Logo-Integrität, echte Seitenzähler, Layoutkonfiguration mit ungespeicherter Vorschau | Ja — `e9ca99d`, CI 40134505361 quality+images grün | 25.10.2026: ausgelieferte Assets mit sichtbarer Version e9ca99d, acht Zustände 320/390/768/1280 × Themes, axe, tatsächliche einseitige Chromium-PDF lesbar. APIs/DB/Renderer lokal fiktiv; zuvor elf Seiten für aktivierte/deaktivierte Mehrseitenzählung lokal geprüft | Ja — `e9ca99d04a858723140c9184efe7f38e11a39357`, drei Container gesund/exakte OCI, alleiniger Timer, kein needs-attention/Drain off; CT/Host/Betreiber-Checkpoint 2.384.655 Bytes, SHA-256 `bc5efc03…53164` identisch | Mobile Einstellungslabels brechen bei 320px mitten im Wort; kompakter Bereichswähler folgt. Logo-Uploadoberfläche offen. Keine echte Geschäfts-API-/Geräteabnahme oder vollständige Parität |
| BKP016.1–BKP016.3 — Angebotsentwurf, Vorschau, exakte Summen und Positionseditor | Ja — `0ddba5b`, Source-CI 40119671243 und Release-CI 40120899761 vollständig grün | 24.10.2026: acht Zustände 320/390/768/1280 × Hell/Dunkel an tatsächlich geladenen Live-Assets mit sichtbarer Version 0ddba5b; fiktive lokale API/DB, Speichern/Reload/Vorschau grün, keine visuellen Blocker. PDF-Renderer im Browserstub; echte einfache PDF separat früher geprüft | Ja — `0ddba5b8f6d948244340b3e174d170a8ae365efb`, automatischer Updater, 24.10.2026 18:48 UTC; drei gesunde Container/exakte OCI-Revision, kein needs-attention, Checkpoint CT/Host/Betreiber SHA-256 `1f21689e…886bf7` identisch | Keine echte angemeldete Geschäfts-API-/Geräteabnahme; Vollseitenbilder belegen keine normale mobile Fokus-/Scrollfreiheit. Produktwahl/Blankoanlage folgen separat; keine vollständige Bookitup-Parität |
| BKP015.1/BKP016.4/BKP017.1 — Produktübernahme, Katalogwahl und Blankoangebote | Ja — 132ace1, Source-CI 40123365972 und Release-CI 40130269260 vollständig grün | 24.10.2026: Live-Assets mit sichtbarer Version132ace1, zwölf Theme-/Breitenbilder, axe, natürliche 320px-Fokusgeometrie; fiktive lokale API/DB. Drei echte Chromium-PDFs jeweils eine A4-Seite gerendert und visuell geprüft | Ja — `132ace1c2de570d3f48201f49244ac538f7ece7d`, drei Container gesund/exakte OCI, kein needs-attention, Drain off; CT-/Host-/Betreiber-Checkpoint identisch `3d09edb1…9facc`, 2.366.356 Bytes | Alte falsch übernommene Nettopositionen manuell prüfen; kein Netto-Eingabemodus, keine physische Geräte-/echte Geschäfts-API-/Mehrseitenabnahme. Lokale Chromium-Schriften sind kein Nachweis identischer Containerschriften |
| Paritätswelle BKP001–BKP008 inkl. BKP007.3 (Kalender, Website-Optionen, Themes, Filter, mobiler Kalender) | Ja — `eef40bd` (CI 39981521693); Liefer-Doku `f9adac7` (CI inkl. images 39986484891), 23.10.2026 | Ja — `f9adac7`, 23.10.2026: live ausgelieferte Assets bei 1280/390 in Hell und Dunkel direkt gerendert/geprüft (Overflow 0, 7 Events ohne Filterwand sichtbar, Kontextspalte 280 px bzw. mobiler „Filter 0“-Zugang, Theme-Flächen `#f5f4f1`/`#141312`, Grünstich-Anteil 0,25–0,81 %, sichtbare Buildkennung „Version f9adac7“); Screenshots + Pixelstatistik ausschließlich privat unter `AuftragsKompass-Sicherung/delivery-2026-10-23/` | Ja — `f9adac75fe08e5f9cfa41690159c63d61d937809`, ausgeliefert 23.10.2026 18:43 über `ak-test-update.timer` (genau ein Updateweg): OCI-Revision ×3 identisch + gesund, `last-success.json`, Checkpoint-Dump + Hostkopie + Betreiberkopie mit identischem SHA-256 `85a8cc79…`, kein `needs-attention`, Drain ausdrücklich inaktiv (`website_option_drain_inactive`, 1 unübernommener Eingang bleibt liegen), Gateway-Empfang unverändert | Filterparität nur erste Unter-Slices; Monat/Jahr, Ansichten, Mehrfachwahl, Solo/Agentur offen; Kalender-Touchbreite 32,9 px bei 320; keine physischen Geräte-/echten Zoom-Abnahme; keine echte angemeldete Sitzungsansicht in diesem Lauf (Browserfenster geschlossen, kein gespeicherter Login, Real-Profil braucht ausdrückliche Freigabe) — Abnahme lief auf den live ausgelieferten Assets mit fiktivem Bestand; Zeilen sind weiter flache Strings (BKP014.1-Ziel) |
| BKP014.1 — lesbare Eventübersicht (Datumsspalte/Status/Art/Ort, Monatskopf) | Ja — `c066663` (Karten) + `f8d19ea` (Test-Härtung), CI 40002841789 inkl. images | Ja — `f8d19ea`, 23.10.2026: acht Zustände 320/390/768/1280 × Hell/Dunkel am live ausgelieferten Build geprüft (Datum links 56 px/Status→Art→Titel→Ort per Bounding-Box 281<300<320<346, Titel nie gebrucht auch bei Langnamen, „· 3 Events“, 1 Link/Karte ohne Button, kein Ressourcenhinweis, Overflow 0 überall, Grünstich-Anteil 0,28–1,38 %); Leerzustand „Keine Events gefunden.“ und Fehlerzustand „Events konnten nicht geladen werden / Events erneut laden“ geprüft; Screenshots + Pixelstatistik privat `delivery-2026-10-23/` | Ja — `f8d19ea11486…`, ausgeliefert 23.10.2026 20:41 über `ak-test-update.timer` (CI 40002841789 quality+images grün; Container ×3 gesund, `last-success`, Checkpoint-Kopien ×3 identisch `6b8b4fd9…`, kein `needs-attention`, Drain weiter inaktiv) | echte Ressourcenanzahl/Paket-Symbole fehlen bewusst (BKP014.2, keine Listen-Datenquelle); Datumsspalte nutzt `eventDate`; „Start ohne Ende“ defensiv „ab HH:MM Uhr“; ICU-Kürzel; wie überall: keine echte angemeldete Sitzungsansicht, keine Geräte-/Zoom-Abnahme |
| BKP013.1 — zusammenhängende Eventakte (Kopf, Details/Ressourcen/Dateien) | Ja — `605f75b` (CI 40014987242 inkl. images) | Ja — `605f75b`, 23.10.2026: Akte am live ausgelieferten Build in acht Zuständen 320/390/768/1280 × Hell/Dunkel geprüft (stabiler Kopf Datum/Zeit/Titel/Status/Art/Ort mit `data-status`+Marke, fünf Bereiche Details/Ressourcen/Dateien/Notizen/Logbuch, kein Mail-Reiter, Dokumente in Dateien nach Art „Angebote“/„Rechnungen“, „Kontakt noch offen.“ als normaler Zustand, Overflow 0 überall, Grünstich-Anteil 0,34–2,6 %); Screenshots + Pixelstatistik privat | Ja — `605f75bd1a91…`, ausgeliefert 23.10.2026 22:09 über `ak-test-update.timer` (Container ×3 gesund, `last-success`, Checkpoint-Kopien ×3 identisch `dcc63a56…`, kein `needs-attention`, Drain inaktiv) | Mailbereich bewusst ohne Reiter (keine Mailfunktion); echte Ressourcenprojektion in der Liste bleibt BKP014.2; Notizen read-only (Anzeige; Bearbeitung im Eventformular — unveränderter Vorstand); Zurück/„Schließen“ verwerfen schmutzige Entwürfe ohne Rückfrage (app-weiter dokumentierter Altzustand); Kopf nicht sticky; Kontakt/Ort-Disclosure unter 64rem; Bereichsnamen brechen bei 320 um (44 px Höhe bleibt); keine Geräte-/Zoom-Abnahme |

## Abnahme der sichtbaren Flächen

Vor Coding einer Fläche: Referenz **und** aktuelles gebautes Ergebnis direkt
betrachten. Vergleich bei identischen 320/390/768/1280(1440) CSS-Pixeln in beiden
Themes mit synthetischem Bestand (≥ 6 Events über 2 Monate, 0/1/mehrere
Ressourcen, Tagesbuchung und Zeitfenster, fehlender Kontakt/Ort, sehr lange
Namen, Leer-/Keine-Treffer-/Fehlerzustand). Geprüft wird: erste Events ohne
Filterwand sichtbar; Datum/Status/Name/Ort sofort scanbar; gleichartige Controls
ausgerichtet; kein Body-Overflow; vollständige Titel/Details erreichbar; klare
Hierarchie statt Dekoration. Vorher/Nachher/Warum knapp belegen und bestehende
Abweichungen benennen; ein Bericht mit vielen Tests ersetzt keine visuelle Abnahme.
Screenshots betreffen stets den fertigen Build-SHA des ausgelieferten Servers.
