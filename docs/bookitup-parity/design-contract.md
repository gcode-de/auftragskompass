# Zielvertrag für Oberfläche und Interaktionen

**Spezifikation, noch nicht umgesetzt.** Ausgangspunkt cf68f1e; Belege und Unsicherheiten in [observations.md](observations.md). Dieser Vertrag ersetzt nicht die Tests und den aktuellen Source-Abgleich. Die neue ausdrückliche Benutzeranweisung gestattet eine behutsame Neutralisierung der bisherigen Waldgrün-Richtung. `apps/admin/DESIGN.md` erst zusammen mit tatsächlich ausgelieferten Tokens aktualisieren, nicht vorab als Ist-Stand umschreiben.

## 1. Informationsarchitektur und progressive Offenlegung

Auf Desktop: globale Navigation, kontextuelle Navigation/Filter, Arbeitsbereich. Event-Kontext bleibt beim Wechsel Details/Ressourcen/Dateien/E-Mails erhalten. Zusatzinformationen stehen kontextuell daneben oder auf kleinem Bildschirm hinter Mehr. Eine Arbeitsfläche hat genau eine Hauptüberschrift; Dialoge haben eigene zugängliche Titel. Keine zweite große App-Begrüßung über jeder Liste.

Mobil: Kopf mit Menü, kurzem Bereichs-/Eventtitel, wenigen benannten Aktionen. Drawer mit Textlabels; aktive Route kenntlich, Escape/Schließen, Fokusfalle, Fokusrückkehr. Eventbezogene Hauptbereiche Details/Ressourcen/Dateien/Mails müssen erreichbar bleiben; mehr als fünf Hauptziele hinter Mehr. Keine permanente zweite Seitenleiste im 390-px-Arbeitsbereich. Eine untere Navigation darf keine Formularaktionen, Safe-Area oder Tastatur überdecken. Erst nach fertigen Modulrouten einbauen.

Liste zuerst: Titel, Suche/Filterzugang, eine Anlageaktion, Ergebnisse. Neuanlage/Bearbeiten öffnet den vorhandenen Dialogtyp. Optionales liegt unter „Weitere Angaben“, seltene Aktionen im Zeilenmenü. Keine unsichtbaren Pflichtfelder: Fehler öffnen den betreffenden Abschnitt und fokussieren die Eingabe. Gespeicherte Zusatzwerte werden als kurze Zusammenfassung sichtbar, auch wenn der Editor zu ist. Keine Informationsvernichtung durch CSS `display:none` ohne alternative Erreichbarkeit.

## 2. Eventfilter: Anordnung wie Bookitup

### Desktop

Kontextspalte direkt links von der Eventliste, nach der globalen Navigation. Richtwert ca. 240–280 px, aber vorhandene Breakpoints und echte 1024-/1280-Geometrie entscheiden. Keine doppelte Filterkopie über den Ergebnissen. Reihenfolge:

1. Events durchsuchen, mit eindeutiger Beschriftung und ruhiger Clear-Aktion.
2. **Ansicht:** Liste, Kalender, Zeitleiste. Vorhandene Kalenderroute verlinken; Zeitleiste nur anbieten, wenn die vorhandene Ressourcenbelegung sinnvoll als Ansicht erreichbar ist. Kein wirkungsloser Schalter.
3. **Sortieren / Eingang:** Chronologisch, Ohne Datum mit Zähler; Neue Anfragen als zugehörig platzierter Schnellfilter. Technisch bleiben Sortierwahl und Statusfilter unterschiedliche Controls, auch wenn sie visuell beisammen stehen.
4. **Datumsbereich:** Monat + Jahr, danach Dieser Monat, Nächste Events, Nächster Monat. Eigener Zeitraum zusätzlich gefaltet. Tenant-Zeitzone, inklusive Datumsschranken und URL-Logik aus `event-filters.ts` erhalten.
5. **Buchungsstatus:** kompakte benannte Zeilen, Statuspunkt/Strich plus Text und ausgewählter Zustand. AK `booked` heißt derzeit Gebucht; Bookitup nennt Filter Bestätigt. Kein beiläufiges Umbenennen der Domainwerte.
6. **Auftragsarten:** suchbare Auswahl vorhandener Eventarten. Nicht aus dem Firmen-/Kontakttyp ableiten.
7. **Optionen:** nur tatsächlich vorhandene sinnvolle Optionen. Solo/Agentur, private Kalender oder Aufgaben nicht als Attrappen nachbauen.

Vor Implementierung Mehrfachauswahl von Status/Arten in Bookitup beobachten. Derzeitige AK-API nimmt einzelne Werte; eine Mehrfachauswahl erfordert einen gesonderten kompatiblen API-Schritt mit Tests, keine still andere Filterbedeutung.

### Mobil

Über der Liste nur „Filter“ mit Zahl aktiver Kriterien und gegebenenfalls „Zurücksetzen“, dazu die Anlageaktion. Filter öffnet voll bedienbaren Drawer/Sheet mit denselben Gruppen und Bedeutungen. Expliziter Abschluss „Ergebnisse anzeigen“, kein horizontaler riesiger Formularstreifen. Bestehender angewandter Zustand bleibt beim Abbruch erhalten; lokale Entwürfe dürfen keine URL-History pro Tastendruck erzeugen. Zurück/Vorwärts stellt angewandte Filter wieder her. Die genaue Mobilreferenz vor BKP007/BKP030 mit aktueller Bookitup-Ansicht abgleichen; keine Annahme, dass Desktop-Gruppen automatisch dasselbe Mobilverhalten beweisen.

## 3. Eventkarten und Event-Details

Monatsüberschrift mit echter Ergebnisanzahl. Zeile/Karte: Statusmarkierung, klarer Tagesblock, Art/Name, Ort; zugewiesene Boxen kompakt im Kontext. Zeiten bei Bedarf, keine erfundene Mitternacht bei Tagesbuchungen. Undatierte Events separat. Ein primärer nativer Eventlink, sekundäre Aktionen daneben, keine verschachtelten Buttons im Link. Bearbeiten/Duplizieren versteckt keine kritische Information.

Event-Details: stabiler Eventkopf mit Datum, Titel, Status; Navigation Details, Ressourcen, Dateien, später E-Mails. Notizen/Logbuch können unter Mehr/Details liegen, bleiben direkt erreichbar. Karten Allgemein, Zeitplan, Kontakte/Ort, zusätzliche Angaben. Angebote gehören zu Dateien/Dokumente statt dauerhaft unter Stammdaten. Keine komplette Modulnavigation in jeder Karte wiederholen. Ressourcenstatus und Konflikte textlich erklären; „verfügbar“ ist eine aktuelle Auskunft, die Speicherung prüft erneut serverseitig.

Website-Herkunft ist normale Eventinformation: kleines Quellenlabel, Originaleingang hinter aufklappbaren Details, „Kontakt noch offen“ statt blockierender Vorstufe. Kontakt später bewusst zuordnen. Das Event bleibt Option, bis der Betreiber den tatsächlichen nächsten Schritt macht. Fehlende Rechnungsanschrift darf ein finales Dokument blockieren, aber nicht die Existenz des Option-Events.

## 4. Mobiler Kalender

Monatsraster: Mo–So mit korrekt versetzten Tageszahlen, einzeilige Tageszahl statt vollem „Do., 01.10.“ in jeder 40-px-Zelle. Heute und ausgewählter Tag klar unterscheidbar, ohne eine große grüne Fläche. Keine freie Terminliste mit falscher Kalenderoptik. Tageswahl zeigt darunter eine lesbare Agenda mit vollständigem Titel, Zeit bzw. Tagesbuchung, Ort/Status und Link. Bei mehreren Events sichtbare Anzahl; kein Event darf nur über Hover oder abgeschnittenen Text auffindbar sein.

Kalenderkopf: Monat/Jahr, kompakte Vor/Heute/Zurück-Aktionen und Tag/Woche/Monat. Datum und seltene Dispositionsoptionen gefaltet. Legende kontextuell und kurz; nicht ein halber Bildschirm technischer Erklärung vor dem Kalender. Lokaler Scroll für echte Zeit-/Ressourcenraster erlaubt, nie Body-Overflow. Kein Swipe als einziger Zugang; Buttons/Tastatur müssen vollständig bleiben. Renderbreite beweist keine Touchgeste.

## 5. Visuelle Maße und neutrale Themes

Dies sind **vorgeschlagene Abnahmewerte**, keine aus Bookitup gemessenen Design-Tokens:

| Element | Regel |
| --- | --- |
| Icon | ca. 18–20 px, konsistente Strichstärke, mittig |
| Interaktive Fläche | mindestens 44×44 CSS-px gemäß bestehender Projektpolitik; sichtbare Füllung/Icon darf kleiner sein |
| Controls einer Toolbar | gleiche äußere Höhe; 8-px-Abstände; Textbaseline ausgerichtet |
| Editor | sichtbare Inputs in einem sinnvollen Raster, mobil eine Spalte; keine feste 300-px-Spalte mitten in breiter Fläche |
| Karten | gemeinsame Innenabstände, Kanten und Überschrift-/Aktionszeile; Höhe nur bei vergleichbarem Inhalt angleichen, keine leeren Platzhalterflächen erzwingen |
| Primäraktion | eine gefüllte pro Handlungskontext; H036-Tiers weiterverwenden |
| Typografie | vorhandene Schriftfamilie, wenige dokumentierte Größen; kein neues Fontpaket für diese Korrektur |
| Fokus | gut sichtbarer eigener Ring, nicht allein Farbänderung; keine abgeschnittenen Ringe |

Darkmode: überwiegend neutrales Anthrazit statt grüner Canvas/Paneele. Hellmodus: neutrales Offwhite und klare Flächenstufen. Grün nur gedämpft für einzelne Marken-/Erfolgsakzente und belegungsbezogene Zustände. Warning/Error/Booked/Hold/Sperre semantisch getrennt; Aktivität nicht ausschließlich farblich codieren. Status braucht Label/Icon/Muster. Keine neue gesättigte Ersatzfarbe überall verteilen. Alle tatsächlichen Farben über gemeinsame Tokens in `styles.css`; berechneten Kontrast prüfen (Text AA, Fokus/Bedienelemente erkennbar), nicht nur „sieht dezent aus“.

Collapse-Schalter: in kompakte Marken-/Leistenzeile integrieren, ohne eigene dominante Zeile oberhalb des Markennamens. Eingeklappt bleibt Expand am selben logischen Ort erreichbar, Label und Tastaturfokus erhalten. Mobil kein zusätzlicher Desktop-Collapse-Knopf neben dem Hamburger.

## 6. Fehler, Speichern und Zustände

Alle neuen Listen/Editoren behandeln: erstes Laden, leerer Bestand, keine Filtertreffer, Netzwerkfehler, veraltete Antwort, 409-Version, 401/403, Busy, bestätigtes Speichern mit fehlgeschlagenem GET, verlorene Mutation-Antwort. Letzten guten Zustand ehrlich kennzeichnen; keine echte Mutation durch „Neu laden“ wiederholen. Nach Fehler Eingaben behalten; Erfolg schließt einen Editor nur nach bestätigter Mutation. Konflikt bietet bewussten Vergleich/Neuladen, keine unbemerkte Überschreibung.

Dirty-Schutz bei Route, Dialogschließen, Escape und Hintergrundrefresh beachten. Kein unbedingtes `window.confirm` beim bloßen Tab-Fokus. Während speichernder Mutation Dialog nicht schließen und keine Doppelanfrage zulassen. Stabile `id`/Label/Fokusbezüge. Finale Dokumente/gesendete Mails sind keine frei überschreibbaren Entwürfe.

## 7. Motion und Abnahme

Für reine Verwaltungswechsel genügt oft keine Animation. Bei notwendiger Drawer-/Dialogbewegung Emil/animate lesen: kurz, unterbrechbar, `transform`/`opacity`, kein federnder Sprung bei Formularfehlern, reduzierte Bewegung mit erhaltener Zustandsrückmeldung. Keine neue Motion-Abhängigkeit nur für ein Fade. Kein Scroll-Jacking.

Jede Frontendaufgabe prüft 320, 390, 768 und 1280/1440 CSS-px, beide Themes, Tastatur und 200-%-Zoom. Mobile volle Namen, leere Zustände, lange fiktive Namen, fehlender Kontakt, viele Einträge und offener Fehler müssen bedienbar bleiben. Browsergeometrie und Screenshots mit synthetischen Daten sichern. Bestehende 44-px-Tests nicht abschwächen, um optisch kleinere Buttons zu erzwingen. Abnahme enthält Before / After / Why für die tatsächlich veränderte Stelle; Design-Dokumentation und Impeccable-Finishreview nach geltendem Skill durchführen.
