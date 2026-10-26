# Tickets: Website-Optionen, Stammdaten und Eventablauf

**Status (26.10.2026, maßgeblich [Implementierungsplan](../../IMPLEMENTATION_PLAN.md) und [Statusmatrix](delivery-workflow.md)):** BKP002, BKP003 und BKP004 (004.1/.2) sind implementiert (Stand `eef40bd`, Auslieferung siehe Statusmatrix); **BKP009–BKP012 sind am 26.10.2026 in nummerierten Unter-Slices abgeschlossen** (BKP009.1 `5e6f7a8`, BKP009.2 `99e9eac`, BKP010.1 `442d19c`, BKP010.2 `f576235`, BKP011.1 `57183a4`, BKP012.1 `8192229`, BKP012.2 `999354f`; Abnahmen im Implementierungsplan). **BKP013.1 und BKP014.1 sind bereits am 23.10.2026 abgeschlossen und live ausgeliefert** (Plan:882/:917; ältere Texte, die sie als „nächsten“ Slice führen, sind veraltet), BKP013.2 wurde am 26.10.2026 ergänzt; **BKP014.2 (Ressourcen in der Eventzusammenfassung) ist der aktuelle Unter-Slice**; offen sind weitere Unter-Slices nach Bedarf sowie alle weiteren Pakete. Optionale/abhängige Folgeslices: BKP010.3 (Backend-Auftragsbeleg für unklare Speicherausgänge; aktuell wird erneutes Speichern gesperrt, keine Idempotenz behauptet), eigener Slice für `registerUnsavedChanges` des Event-Editors (heute verwirft „Event abbrechen“ weiter still), BKP011-Editor-Politur (Landauswahl) nach Bedarf. Keine vollständige Parität. [Ausführungsregeln](agent-playbook.md) und [Zielvertrag](design-contract.md) sind Teil jedes Tickets. FK-/Versions-/Mandanten-/Konfliktschutz immer erhalten. Abhängigkeiten sind verbindlich.

## BKP002 — Gültige Website-Eingänge auch ohne Kontakt als Option anlegen

**P1.** Beleg S; ausdrücklicher neuer Auftrag ersetzt hier den bisherigen AN-02-Zwang „Kontakt und Event zusammen“. Lesen `packages/core/src/website-inquiries.ts`, `website-inquiry-deliveries.ts`, `schema.ts`, bestehende Migration `0023` (nicht editieren), Events-/Kontaktzuordnungsmodelle und Rückgabeschemas aller Aufrufer. `rg` nach `contact_review`, `contactId`, `receiveWebsiteInquiry`, `receiveWebsiteOption`.

**Gewünschter Ablauf:** validierte/authentische Nachricht dauerhaft annehmen → ein Option-Event mit Originaldaten/Herkunft anlegen → eindeutig passenden aktiven Kontakt zuordnen oder zulässigen vollständig bekannten Kontakt anlegen → bei Unsicherheit Event ohne Kontakt. Kontaktunsicherheit und fehlendes Land sind Anreicherungsbedarf, kein Grund, das Event zu verweigern. DE darf bei wirklich fehlendem Land für neue Website-Kontakte vorbelegt werden; bekannte abweichende Länder aus bestehenden Kontakten oder vertrauenswürdiger Betreiberangabe erhalten. Das strikte öffentliche v1-Eingabeschema hat derzeit kein Landfeld und verbietet zusätzliche Felder; es wird in diesem Slice nicht beiläufig erweitert. Unklare Firmen-/Personenidentität niemals raten oder automatisch zusammenführen. Kein leerer Dummy-Kontakt, keine globale Lockerung der Kontaktvalidierung.

**Datenänderung:** neue vorwärtsgerichtete Migration für nullable `website_inquiries.contact_id`; FK/Mandantenbezug/Unique-/Hash-/Idempotenzregeln erhalten. Event-Hauptkontakt ist schon optional; das vorhandene Modell nutzen. Receipt/API-Typen müssen null explizit tragen und alle Aufrufer damit umgehen. Für Bestandsdatensätze nichts löschen/neu nummerieren. Originalmeldung und ursprüngliches Receipt unverändert speichern. Ein anfänglich null gesetztes Receipt-`contactId` muss nach späterer Kontaktzuordnung nicht rückwirkend geändert werden; aktueller Kontakt kommt aus der Eventbeziehung. Rückgabe-/Replayvertrag dafür ausdrücklich dokumentieren. Bei Retry auf vorhandenes Event verweisen, dessen inzwischen manuell geänderten Status/Kontakt nicht auf Option zurücksetzen. Option ist keine Ressourcenbestätigung.

**Tests zuerst:** in `tests/integration/website-inquiries.test.ts` Fälle F (mehrdeutig) und J (ohne Land) gezielt auf neues Soll ändern, nicht entfernen; zusätzlich kein geeigneter Kontakt, inaktiver Kontakt, Firma/Privat-Mismatch, DE-Default und ausdrücklich anderes Land, null-Rückgabe, paralleler Replay, Absturz/Rollback, fremder Tenant, Hashkonflikt, ungültige Signatur/Schema. `website-inquiry-sync`/`ack`/Restoretests für nullable Beziehung ergänzen. Kontaktdatenbank weiterhin Landpflicht. Bestehender direkter Legacy-Inquiry-Aufruf darf sein ausdrücklich abweichendes Verhalten behalten, falls andere Verträge ihn benötigen; automatischer Optionpfad muss das neue Soll erfüllen.

**Done:** normale Option existiert genau einmal vor vollständiger Kontaktnacharbeit; Original/Herkunft/Audit erhalten, keine erfundene Buchung. Keine echten Alt-Eingänge im Rahmen von Tests übernehmen. Vor Deployment muss die Aktivierungsgrenze aus BKP004 stehen; ein bereits automatisch startender Worker darf die neue Semantik nicht ungeprüft auf echte Rückstände anwenden. Commit `feat: create website options without requiring a resolved contact`.

## BKP003 — Vorhandenen Option-Worker fair und wiederholbar machen

**P1, separat testbar; Endabnahme mit BKP002.** Lesen `website-option-worker.ts:71–136`, `apps/worker/src/worker-start.ts`, Konfiguration, `tests/unit/website-option-config.test.ts` und vorhandene DB-/Workerintegration. Es gibt bereits `startWebsiteOptionDrain()` mit Batchgröße zehn; keinen zweiten Worker bauen.

**Fehler:** älteste zehn laden, danach prozesslang bereits versuchte IDs wegfiltern. Zehn alte blockierte Einträge halten neuere dauerhaft fern. Das Set verhindert Retry nach einem vorübergehenden Fehler ohne Neustart.

**Scope:** begrenzter sequentieller Drain mit fairer Pagination/Keyset-Fortsetzung und nachvollziehbarer Wiederholung; Fehler eines Eintrags darf andere nicht blockieren. Cursor/Retryzustand darf nicht so aussehen, als sei ein unübernommener Eingang erfolgreich erledigt. Dauerhafte echte Fehler nicht in Hotloop wiederholen, Infrastrukturfehler im nächsten zulässigen Takt erneut versuchen. Vorhandene Status-/Readinesskonventionen beachten, „ready“ nicht als erledigten Geschäftseingang ausgeben. Bei komplexerer Persistenz neue Migration und Test im selben Slice; kein Redis oder extra Scheduler.

**Tests zuerst:** elf Eingänge, älteste zehn scheitern, elfter wird trotzdem erreicht; erster temporärer Fehler wird ohne Prozessneustart erneut versucht; Listenfehler erholt sich; Neustart/Replays erzeugen keine Doppel-Events; kein gleichzeitiger Takt/Shutdown-Race; Abbruch hinterlässt wiederaufnehmbaren Zustand. Bestehenden Test „nur einmal pro Prozess“ bewusst auf neues Soll ändern; nicht nur am Testtimeout drehen. Signatur-/Quittierungs-/Ablaufsemantik beibehalten.

**Done:** spätere gültige Eingänge werden nicht verdrängt und temporäre Fehler sind ohne Neustart behebbar. Keine echten Kundenimporte zur Demonstration. Commit `fix: retry website options fairly without starving later entries`.

## BKP004 — Ausnahme-Posteingang aus Events entfernen

**P1, erst nach BKP002 und BKP003.** Lesen `EventPanel.tsx:501`, `WebsiteInbox.tsx`, `EventDetails.tsx`, `WebsiteInquiry.tsx`, zugehörige Styles, Komponenten-/E2E-Tests und ursprüngliche Eingangsansicht. Entfernen der UI allein erfüllt den Auftrag nicht.

**Scope:** normale Eventliste enthält automatisch erzeugte Optionen. Import/Quelle als ruhiges Badge; „Kontakt noch offen“ bei fehlender Verknüpfung. Unveränderten Originaleingang innerhalb des Events hinter „Website-Anfrage“ aufklappbar lesen; späteren Kontakt über normale bewusste Eventbearbeitung zuordnen. Keine neue prominente Ersatzqueue unter anderem Namen. Diagnostik technischer Zustellfehler gehört in Betrieb/gezielte Einstellungen, nicht als verpflichtender Arbeitsablauf vor Eventanlage. Aufbewahrungs-/Quittierungsdaten nicht löschen, nur weil die alte Komponente entfällt.

**Tests zuerst:** `website-inbox.test.tsx` passend ersetzen, `events.test.tsx`/`event-details.test.tsx`/`website-inquiry.test.tsx`: kein Ausnahmen-Summary unter Events, Option ohne Kontakt sichtbar/auffindbar/öffnungsfähig, Original lesbar und escaped, Kontakt nachträglich zuordenbar, Version und Status bleiben. E2E um den vollständigen synthetischen Weg vom öffentlichen Eingang bis normaler Option erweitern; bisherige reine Transportprüfung reicht nicht.

**Datenbetrieb/Aktivierungsgrenze vor Deployment:** Der vorhandene Worker startet bei gültiger Konfiguration selbst, und der automatische Updater kann neue Builds übernehmen. Deshalb den automatischen Drain vor dem Rollout der geänderten Semantik kontrolliert pausieren beziehungsweise mit expliziter Aktivierungsgrenze absichern; dauerhaften Gateway-Empfang möglichst weiterlaufen lassen. Zuerst eine lesende Mengen-/Fehlerübersicht vorhandener Eingänge außerhalb Git erstellen, dann nach Betreiberprüfung den Drain bewusst fortsetzen. Diese Grenze muss vor BKP002-Rollout wirksam sein, nicht erst nach Entfernen der UI. Die UI-Änderung autorisiert keine unbeaufsichtigte Massenübernahme echter Rückstände. **Done:** keine gültige Anfrage braucht die alte Ausnahmeoberfläche; keine versteckten Originale/Fehler. Commit `refactor: handle website inquiries through normal option events`.

## BKP009 — Ressourcenverwaltung: Liste zuerst, Editor auf Aufruf

**P2, UI-Slice ohne Domainänderung.** Lesen `ResourcePanel.tsx`, `ResourceBlocks.tsx`, `resources.ts`, vorhandenes Kontakt-Dialogmuster und Ressourcen-/Sperr-/E2E-Tests. Bookitup-Anlage selbst ist Trial-gesperrt (B26–B28); keinen unbekannten Set-/Case-Editor behaupten.

**Scope:** kompakte Suche/Archiv-/Kategorieauswahl über Ressourcenliste; Plus öffnet Anlage, Zeilenaktion Bearbeiten. Zeitweise Sperren bewusst öffnen, vorhandene Sperrübersicht erreichbar lassen. Datenfeldvertrag unverändert: Name 1–120, Code 1–40, Kategorie 1–120 nichtleer, Beschreibung bis 2000, Bestand ganzzahlig 0–10000, Puffer je 0–365 Tage, Sortierung 0–9999, active/inactive/archived, blocked; Update mit Version ≥1. Defaults Bestand 1, Puffer 2/2 erhalten. `Fotobox` ist nicht bloß dekorative Kategorie.

**Tests zuerst:** Formular initial nicht im Tabpfad, Anlage/Bearbeiten/Abbruch/Fehler/409, geänderte Werte nicht durch Reload ersetzen, Fokus zurück, Doppelklickschutz, gefilterte Treffer und leerer Bestand/keine Treffer getrennt. Archive zeigen historische Zuweisung weiter. Vorhandene Sperrzeit-/DST-Tests unverändert, keine gespeicherte Sperre still in neues Formular übernehmen. 320/390/1280-Layoutprüfung.

**Nicht dabei:** neue Sets/Bedarfsautomatik, neue Einheiten-Erzeugungslogik oder bestehende Kategorien migrieren. Vorhandene server-/datenbankseitige Synchronisation physischer Einheiten bei Anlage und Bestandsänderung unverändert erhalten. **Done:** normale Liste sofort sichtbar und ganze bestehende Verwaltung weiterhin möglich. Commit `feat: make resource management list-first with explicit editing`.

## BKP010 — Produkte: kompakte Verwaltung und vollständige Positionsdaten

**P2.** Lesen `ProductPanel.tsx`, `products.ts`, `decimal.ts`, `DocumentTemplatesPanel.tsx`, Tests `products.test.tsx`/Integration/`decimal.test.ts`/E2E. Zuerst UI offenbaren, neue Preisfunktionen als getrennten Unter-Slice planen.

**UI-Scope:** Suche, Zustand, Liste, Plus/Bearbeiten/Duplizieren und Archivaktionen kompakt; Formular nicht immer vor Liste. Bestehender Vertrag: Name 1–120, Beschreibung ≤2000, Einheit 1–40, priceMinor ganzzahlig 0–MAX_SAFE_INTEGER, priceBasis net/gross, Steuer 0–10000 Basispunkte, Zustand, Position 0–9999, Updateversion. Deutscher Dezimaltext über `decimal.ts`, kein `parseFloat * 100`. Defaults Stück, 0, brutto, 1900bp erhalten. Preisbasis deutlich sichtbar, nicht nur eine Zahl ohne Netto/Brutto.

**Tests zuerst:** Suchzustand bei Editoröffnung erhalten, 0/19-%-Steuer, 0/maximaler exakter Betrag, ungültige Dezimalzahl, Duplizieren schreibt neuen Datensatz, Bearbeiten behält Version, Archiv ohne historische Dokumentänderung, Bestätigtes Speichern vs GET-Fehler. Beide Themes/mobile Ausrichtung.

**Folgeplanung:** Bookitup-Menge/Rabatt/Ressourcenverknüpfung sind beobachtet, aber nicht automatisch Produktstammfelder. Mengen/individuelle Rabatte zuerst im Dokumenteditor (BKP016), Ressourcenbedarf separat nach Referenzprüfung. Bestehende Produktpreise dürfen durch Dokumentänderung niemals verändert werden. Commit UI `feat: make product management compact and list-first`.

## BKP011 — Kontakt-Details statt bloßer Zeilenaktionen

**P2, UI/lesende API je nach aktuellem Vertrag.** Kontakt-Dialog existiert bereits. Lesen `ContactPanel.tsx`, `contacts.ts`, `events.ts`, Routing-/Such-/URL-Helfer, `contacts.test.tsx` und Kontaktintegration.

**Scope erster Slice:** normale Zeilen-/Namensverlinkung auf lesende Kontaktansicht mit Name/Firma, Ansprechpartner, Anschrift, Mail/Telefonlinks, zugeordneten Events, bewusster Bearbeiten-Aktion. Zurück erhält Suche/Scroll; bestehendes `#contact-<id>` respektieren, keine zweite widersprüchliche Route. Archivzustand deutlich. Nicht jede Adresse/Mail nochmals als großen Button darstellen. Unvollständige Anschrift ehrlich anzeigen.

**Editor-Politur:** Land als verständliche Auswahl/Bezeichnung mit gespeichertem ISO-Code; Anrede/Partner/Geburtstag/Gruppen erst mit eigenem Modellslice und neuen additiven Feldern. Keine Namen anhand Leerzeichen aufsplitten oder Firmen automatisch in Privatpersonen umwandeln. Dublettenvorschläge zeigen und bewusst auswählen; keine automatische Verschmelzung.

**Tests zuerst:** Kontakt ohne Event, mit mehreren Events, Firma mit Ansprechpartner, archiviert, fremder Tenant, lange fiktive Werte, leerer optionaler Wert; Back/Reload/Dirty/409, tel/mailto korrekt escaped. Keine Mail-/Datei-Tabs als funktionsfähige Module behaupten, solange BKP020/BKP022 fehlen. Commit erster Slice `feat: show contact details and related events`.

## BKP012 — Suchbaren Kontaktpicker und bewusste Inline-Anlage im Event anbieten

**P2, vorhandene Eventanlage erweitern.** Lesen `EventCreateDialog.tsx`, EventPanel-Editor, ContactPanel, gemeinsame Kontaktsuche/API. B30 zeigt Suchpicker „Kunde neu anlegen oder vorhandene auswählen“.

**Scope:** Kontakte suchbar wählen, bei Bedarf bewusst Kontaktdialog öffnen, danach den wirklich gespeicherten Kontakt auswählen. Evententwurf inklusive Datum/Art/weiterer Angaben bleibt währenddessen erhalten. Nicht heimlich Event und Kontakt gemeinsam speichern, bevor der Benutzer den Eventabschluss bestätigt. Kein zweiter Kontaktvalidator. Kontaktloses Event bleibt möglich, insbesondere Website-Option. Vorhandene archivierte Zuordnung darf lesbar bleiben, nicht als neue Auswahl angeboten werden.

**Tests zuerst:** langsame Suchantworten kommen vertauscht, kein Treffer, abgebrochene Inline-Anlage, fehlgeschlagener Kontakt-POST, gespeicherter Kontakt mit fehlgeschlagenem Listen-GET, Fokusfalle bei verschachtelten Dialogen, Wiederöffnung und Auswahl ohne doppelte Erstellung. Wenn vorhandener Dialog nicht sauber verschachtelbar ist, eine einzige kontrollierte Dialogebene wechseln und Entwurf getrennt behalten. Konsequenten Fokus-/Dirty-Pfad testen. Commit `feat: select or create contacts within the event flow`.

## BKP013 — Eventkontext in Details, Ressourcen und Dateien gliedern

**P2, erste UI-Struktur unabhängig; echte Mailansicht nach BKP022.** Lesen `EventDetails.tsx`, `EventDocuments.tsx`, `ResourceAssignments.tsx`, `url-state.ts`, Navigation/Dirty-Helfer, zugehörige Komponenten-/E2E-Tests. Bestehende vier Bereiche nicht blind durch Attrappen ersetzen.

**Scope:** stabiler Eventkopf, klar gruppierte Details; Dokumentliste aus Allgemein in eigenen Dateien-/Dokumentbereich verschieben. Notizen/Logbuch weiterhin eindeutig erreichbar. Auf breiten Screens Kontakt-/Ort-Kontext kompakt daneben, mobil gezielt öffnen. Die Darstellung eines unvollständigen Website-Events ist ein normaler Zustand. Erst bei vorhandenem Mailmodul E-Mails ergänzen. Ein früher vorhandener Bereich darf durch Bookmark/Back erreichbar bleiben oder sauber kompatibel aufgelöst werden.

**Tests zuerst:** Bereichswechsel erhält schmutzige Status-/Ressourcen-/Notizentwürfe oder fragt bewusst, Hintergrundrefresh überschreibt nicht, Dokumenterfolg bleibt bei Neuladefehler sichtbar, Fokus auf gewähltem Bereich, Tastatur/320px/Zoom. Ressourcen-/Statusmutation bleibt dieselbe atomare API, keine separaten konkurrierenden Saves. Dokumentliste nach tatsächlicher Art beschriften; bestehende Angebote nicht verschwinden lassen. Commit `refactor: organize event details around focused work areas`.

## BKP014 — Eventliste mit tatsächlichen Ressourcen und konsistenten Zeilen ergänzen

**P2.** Lesen EventPanel, Eventlisten-API/DTO, Ressourcenzuordnung, Monatsgruppen; Beleg A03/S und EV-04/RE-12. Ersetzt die pauschale Aussage „Ressourcen in den Event-Details prüfen“ durch bekannte Daten, ohne Ressourcenverfügbarkeit vorzutäuschen.

**Scope:** zugewiesene physische Boxen/Einheiten und Reservierungsstatus in kompakter Zusammenfassung. Fehlend „Noch keine Ressource“, veraltete Auskunft kenntlich, Konflikt nur aus tatsächlicher fachlicher Information. Wenn API keine Zusammenfassung liefert, additive tenant-gesicherte Projektion im Listenabruf; kein N+1 pro Event. Hauptlink bleibt nativ, Edit/Duplicate daneben. Datum/Name/Ort in stabilen Spalten bei Desktop, mobil logisch gestapelt. Status zusätzlich textlich.

**Tests zuerst:** 0/1/mehrere Einheiten, historische archivierte Ressource, Option/vorgemerkt vs gebucht, unvollständiges Event, fremder Tenant, kein N+1, lange Titel/fehlender Ort, Monatsgruppen/Zähler bleiben. Kein bestätigtes Reservieren aus einem Listenbadge. Commit `feat: show assigned resources in event summaries`.
