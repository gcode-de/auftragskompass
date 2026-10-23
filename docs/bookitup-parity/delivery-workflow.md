# Lieferworkflow und Statusmatrix

Stand 23.10.2026. Dieses Dokument fasst zusammen, **wie** ein geprüfter Stand in den
Home-Lab-Testbetrieb gelangt und **in welchem Zustand** jedes sichtbare Ergebnis
gerade steht. Es ersetzt keine Einzelbefunde; es ist die kompakte Matrix statt
weiterer Chronik. Drei Zustände sind streng getrennt und nie gleichbedeutend:

| Zustand | Bedeutung | Nachweis |
| --- | --- | --- |
| **IMPLEMENTIERT** | Quellstand auf `codex/bkp-wave1` mit Tests, Gates und grünem CI-Lauf | Commit-SHA + CI-Run |
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

1. Geprüfter Stand liegt auf `codex/bkp-wave1` vor (Tests, Review, CI).
2. Die freigegebene UX-Branch wird **nur nach erneut geprüfter
   Fast-forward-Beziehung** auf den geprüften Stand vorgezogen (Historie erhalten,
   kein Force-Push, `main` bleibt unangetastet).
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
| Paritätswelle BKP001–BKP008 inkl. BKP007.3 (Kalender, Website-Optionen, Themes, Filter, mobiler Kalender) | Ja — `eef40bd` (CI 39981521693); Liefer-Doku `f9adac7` (CI inkl. images 39986484891), 23.10.2026 | Ja — `f9adac7`, 23.10.2026: live ausgelieferte Assets bei 1280/390 in Hell und Dunkel direkt gerendert/geprüft (Overflow 0, 7 Events ohne Filterwand sichtbar, Kontextspalte 280 px bzw. mobiler „Filter 0“-Zugang, Theme-Flächen `#f5f4f1`/`#141312`, Grünstich-Anteil 0,25–0,81 %, sichtbare Buildkennung „Version f9adac7“); Screenshots + Pixelstatistik ausschließlich privat unter `AuftragsKompass-Sicherung/delivery-2026-10-23/` | Ja — `f9adac75fe08e5f9cfa41690159c63d61d937809`, ausgeliefert 23.10.2026 18:43 über `ak-test-update.timer` (genau ein Updateweg): OCI-Revision ×3 identisch + gesund, `last-success.json`, Checkpoint-Dump + Hostkopie + Betreiberkopie mit identischem SHA-256 `85a8cc79…`, kein `needs-attention`, Drain ausdrücklich inaktiv (`website_option_drain_inactive`, 1 unübernommener Eingang bleibt liegen), Gateway-Empfang unverändert | Filterparität nur erste Unter-Slices; Monat/Jahr, Ansichten, Mehrfachwahl, Solo/Agentur offen; Kalender-Touchbreite 32,9 px bei 320; keine physischen Geräte-/echten Zoom-Abnahme; keine echte angemeldete Sitzungsansicht in diesem Lauf (Browserfenster geschlossen, kein gespeicherter Login, Real-Profil braucht ausdrückliche Freigabe) — Abnahme lief auf den live ausgelieferten Assets mit fiktivem Bestand; Zeilen sind weiter flache Strings (BKP014.1-Ziel) |
| BKP014.1 — lesbare Eventübersicht (Datumsspalte/Status/Art/Ort, Monatskopf) | Ja — `c066663` (Karten) + `f8d19ea` (Test-Härtung), CI 40002841789 inkl. images | Ja — `f8d19ea`, 23.10.2026: acht Zustände 320/390/768/1280 × Hell/Dunkel am live ausgelieferten Build geprüft (Datum links 56 px/Status→Art→Titel→Ort per Bounding-Box 281<300<320<346, Titel nie gebrucht auch bei Langnamen, „· 3 Events“, 1 Link/Karte ohne Button, kein Ressourcenhinweis, Overflow 0 überall, Grünstich-Anteil 0,28–1,38 %); Leerzustand „Keine Events gefunden.“ und Fehlerzustand „Events konnten nicht geladen werden / Events erneut laden“ geprüft; Screenshots + Pixelstatistik privat `delivery-2026-10-23/` | Ja — `f8d19ea11486…`, ausgeliefert 23.10.2026 20:41 über `ak-test-update.timer` (CI 40002841789 quality+images grün; Container ×3 gesund, `last-success`, Checkpoint-Kopien ×3 identisch `6b8b4fd9…`, kein `needs-attention`, Drain weiter inaktiv) | echte Ressourcenanzahl/Paket-Symbole fehlen bewusst (BKP014.2, keine Listen-Datenquelle); Datumsspalte nutzt `eventDate`; „Start ohne Ende“ defensiv „ab HH:MM Uhr“; ICU-Kürzel; wie überall: keine echte angemeldete Sitzungsansicht, keine Geräte-/Zoom-Abnahme |
| BKP013.1 — zusammenhängende Eventakte (Kopf, Details/Ressourcen/Dateien) | — | — | — | Mailbereich ohne Mailfunktion bewusst ohne Reiter |

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
