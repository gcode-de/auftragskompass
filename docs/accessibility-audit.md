# Technische Oberflächenprüfung des internen MVP

Stand: 17.10.2026, E005.16; ausschließlich die vorhandene Admin-App.
Öffentliches Widget, Postfach, Geschäftsdokumente und spätere Module sind nicht
Bestandteil dieser vorgezogenen C082-Teilprüfung. Die grüne Operate-Gestaltung,
Systemschrift, bestehenden Bedienelemente und Hell-/Dunkelumschaltung bleiben.

## Befund und Korrektur

**P2 – übersprungene Überschriftenebene der Eventakte:** Die Listenüberschrift
wird beim Öffnen der Akte ausgeblendet, die Akte beginnt jedoch mit `h3`.
Axe meldet `heading-order` in der mobilen Übersicht und Ressourcenansicht.
Dies ist ein Best-Practice-Befund zur verständlichen Überschriftennavigation,
kein eigenständiger Nachweis eines WCAG-AA-Verstoßes. Die gemeinsame Ursache
liegt in `EventDetails.tsx`; Unterbereiche und Ressourcenzuweisung verwenden `h4`.
Die Akte beginnt nun auf Ebene 2, ihre Unterbereiche auf Ebene 3. Sichtbare Größen,
Abstände und der Fokus-/Scrollbezug bleiben im bestehenden System erhalten.
Beide Strukturfehler sind mit der bestehenden Impeccable-Harden-Arbeitsweise
behoben. Die abschließende Prüfung bewahrt die vorhandene Gestaltung.

**P2 – Kalenderlegende ohne benannte Gruppenrolle:** Ein `aria-label` auf dem
nativen Absatz wird von Screenreadern nicht zuverlässig als Gruppenname angeboten.
Der Absatz erhält die passende Gruppenrolle; Inhalt und Darstellung bleiben.
Ein eigener Komponententest prüft den zugänglichen Gruppennamen.

## Prüfverfahren und Grenzen

Der vollständige synthetische Chromium-Ablauf verwendet `@axe-core/playwright`
als reine Testabhängigkeit. Geprüft werden Regeln für WCAG 2.0/2.1 A/AA,
WCAG 2.2 AA und Axe-Best-Practices. Anmeldung, aktive Arbeitsbereiche,
Eventakte, Exportbereich und geöffnetes mobiles Menü werden geprüft;
Hell-/Dunkelzustände und 320/390/1280 CSS-Pixel ergänzen die vorhandenen
Geschäfts-, Überlauf- und Tastaturtests. Die CSP bleibt dabei aktiv.

Automatische Prüfung erkennt nicht alle Barrieren. Eine vollständige
Screenreader-Abnahme, physische Touch-/Smartphone-Probe, sämtliche Kombinationen
von Zoom/Schriftvergrößerung und eine Prüfung aller möglichen Inhalte stehen aus.
Die bestehenden Such-/Menü-/Akten-Fokusfälle und Escape-Bedienung werden weiterhin
in echtem Chromium mit synthetischen Daten geprüft. Emulierte Viewports sind kein
Nachweis für eine getestete physische Touchbedienung.

## Technische Einordnung

Die Punktwerte sind eine begrenzte Arbeitseinschätzung, keine Zertifizierung.

| Dimension | Punkte | Belegte Einordnung |
|---|---:|---|
| Barrierearmut | 3/4 nach Korrektur | Gemeinsame Überschriftenursache adressiert; automatische Regeln und bestehende Fokusfälle geprüft, Screenreader-Abnahme offen |
| Performance | 2/4 | Kleine lokale Oberfläche; Mengenprobe mit 500 Kontakten/Events bisher auf Repository-Ebene, keine vollständige Browser-Lastabnahme |
| Theming | 3/4 | Bestehende Farbvariablen, überprüfte Hell-/Dunkelzustände und Kalenderkontraste; keine neue Palette |
| Responsive | 3/4 | 320/390/1280 CSS-Pixel, Überlauf-, Menü- und Fokusfälle; physisches Gerät und sämtliche Textvergrößerungen offen |
| Implementierungsintegrität | 3/4 | Konsistentes dokumentiertes Operate-System, native Dialogbedienung und einheitliche SVG-Icons |
| Gesamt | 14/20 | Gute Grundlage mit klar begrenzter Abnahme |

Der Impeccable-Quelldetektor lief einmal auf EventDetails, ResourceAssignments
und styles.css; der zusätzliche Kalender-Rollenfix wird per DOM-/Browsertest geprüft:
keine primären Funde, 16 reine Schriftgrößen-Hinweise. 15 betreffen unveränderte
Bestandsstellen; diese Dokumentationsabweichungen werden hier nicht beiläufig
bereinigt. Der Hinweis im geänderten Bereich betrifft `1rem` für Unterüberschriften:
dies erhält die vorherige native h4-Größe nach dem semantischen Wechsel zu h3.
Es wurde keine neue visuelle Typografiestufe eingeführt. Der Vorschlag wird in
Kontext und Abschlussreview geprüft, nicht durch eine globale Ausnahme verborgen.

Positiv bleiben die bestehenden Farbvariablen, sichtbaren Tastaturrahmen,
benannten Formulare, native Menü-Fokussperre, erhaltenen Eingaben beim
Bereichswechsel und das Fehlen externer Schrift-/Bilddienste. Es gibt zwei
bestätigte P2-Ursachenbefunde; keine in dieser Probe belegten
P0-/P1-Funde. Ein leerer Axe-Bericht schließt unbekannte Barrieren nicht aus.

Die begrenzten Harden- und Abschlussprüfungen sind erfolgt. Ein frischer,
unabhängiger Impeccable-Finish-Reviewer mit der dokumentierten Ersatzrubrik
gibt diesen Slice frei (`ship`); die Documenter-Ersatzrolle ergänzt ausschließlich
die neue Semantik im vorhandenen Designsystem. Die vier aktuellen Aktenansichten
(390/1280 Pixel, hell/dunkel) wurden visuell geprüft. Physische Smartphone-/
Screenreader- und vollständige C082-Abnahme bleiben vor Freigabe offen.

Axe meldet außerdem manuell zu prüfende Fälle: Das `aria-controls` des Menüknopfs
zeigt auf den vorhandenen, geschlossen jedoch verborgenen nativen Dialog; ein
expliziter DOM-Test prüft das Ziel weiterhin. Bei teilweise überlagerten
Kalenderzellen kann Axe den Hintergrund nicht vollständig bestimmen. Die
bestehende explizite Kontrastprobe prüft daher die tatsächlichen opaken
Zustandsflächen und ihre Schriftfarbe zusätzlich. Diese Hinweise werden nicht
per Regel-Ausnahme unterdrückt und bleiben im JSON-Bericht sichtbar.

## Ergebnis der automatischen Probe

Der vollständige lokale Lauf zu E005.16 enthält **60 Prüfungen über 27 Zustandsnamen**
mit beiden Anmeldeverfahren und null automatischen Verstößen. Die JSON-Belege liegen
als synthetische Testartefakte unter `tests/test-results`, nicht als echte
Kundendaten in Git. Die beiden Komponententests für Überschriftenebene und
Gruppenname waren vor der Korrektur rot. Menüfokus, Überlauf, unveränderte
Geschäftsabläufe und die weiterhin aktive CSP bestehen ebenfalls.
Die Hinweise zu geschlossenem Dialog und teilweise verdeckten Kalenderzellen
bleiben als manuell bewertete Unvollständigkeiten erhalten; sie werden nicht als
vollständig automatisiert geprüfte Fälle ausgegeben.

## CI-Belege (E005.19)

GitHub Actions bewahrt `tests/test-results/` als Artefakt `chromium-evidence`
sieben Tage auf, auch wenn der Testlauf fehlschlägt. Es enthält ausschließlich
synthetische Browser-Screenshots, Axe-Berichte, Mengenmesswerte und gegebenenfalls
Fehler-Traces aus den wegwerfbaren lokalen Testdiensten. Tests verwenden weder
echte Kundenbestände noch den Betreiber-Login oder die öffentliche Testinstallation.
Die Ausgabegrenze umfasst keine Sicherungen, Exporte oder privaten Verzeichnisse.
Vor dem Browserstart fehlgeschlagene Läufe können ohne dieses Artefakt enden.
Die Image-Veröffentlichung setzt weiterhin die gesamte erfolgreiche Qualitätssuite
voraus; der Artefakt-Upload hebt keine Schranke auf.

## Bewegungspräferenz (E005.20)

Chromium prüft die bestehenden Regeln zusätzlich mit expliziter Medienpräferenz:
Der Zeigeraufruf darf bei normaler Bewegung die vorhandene kurze Menütransition
nutzen. Der Tastaturaufruf erfolgt ohne Menübewegung. Mit
`prefers-reduced-motion: reduce` haben Menü und Schaltflächen keine Transition;
auch eine per Leertaste oder Zeiger gehaltene Schaltfläche skaliert nicht. Zeiger- und
Tastaturaufruf, Escape und Fokusrückgabe werden jeweils am nativen Dialog geprüft.
Die Gestaltung und ihre bestehenden Zeiten wurden nicht verändert.

## Kleine Desktophöhe (H017)

Bei 1280×420 CSS-Pixeln lässt sich die bestehende Seitenleiste in beiden
Darstellungen bis zum Konto/Abmelden und wieder zu den oberen Navigationslinks
scrollen. Chromium prüft Sichtbarkeit und tatsächliche Zeiger-Erreichbarkeit.
Die beiden aktuellen Aufnahmen wurden visuell geprüft; die vorhandene
`overflow-y: auto`-Regel funktioniert bereits. Es war keine Änderung der
Oberfläche oder des Designsystems erforderlich. Normale Desktopbreite und
mobiles Menü bleiben im vollständigen Browserablauf enthalten.

## Import-Fehlerhinweise (E003.5)

Vier zusätzliche Axe-Prüfungen und aktuelle Aufnahmen prüfen einen ungültigen
synthetischen Kontakt in der Importvorschau bei 390/1280 CSS-Pixeln, jeweils
hell/dunkel. Der bekannte Feldname ergänzt die vorhandene Fehlerzeile; Eingaben,
Navigation und bestehende Meldungsdarstellung bleiben erhalten. Unbekannte
Eigenschaftsnamen werden auch clientseitig nicht als Feldbezeichnung ausgegeben.

Die unabhängige Abschlussprüfung bewertet diese kleine Erweiterung mit `ship`.
Sie nutzte einen frischen allgemeinen Reviewer mit dem Impeccable-Ersatzrubrik
statt einer direkt auswählbaren Spezialrolle. Alle vier Aufnahmen wurden geprüft;
die Bewertung gilt für diese Feldhinweise, nicht als pauschale Freigabe der App.
