# Tickets: Dokumente, Dateibibliothek und Kommunikation

Alle Pakete **offen**. [Ausführungsanleitung](agent-playbook.md) und [Designvertrag](design-contract.md) gelten. Die größeren Pakete vor Start in kleine vertikale Unter-Slices im Hauptplan zerlegen. Kein „alles mit einem Commit“. Referenzen B05–B06/B09–B10/B15–B20/B23–B25/B31–B32; Quellbasis cf68f1e.

## BKP015 — Dokumentvorlagen als Liste mit fokussiertem Editor und Vorschau

**P2.** Lesen `apps/admin/src/DocumentTemplatesPanel.tsx`, `packages/core/src/document-templates.ts`, `document-rendering`-/Snapshot-/Totals-Dateien über `rg`, Tests `tests/component/document-templates.test.tsx`, `tests/integration/document-templates.test.ts` und passende Unit-Tests. C047/C048 bereits teilweise umgesetzt, nicht neu anfangen.

**Erster Slice:** Vorlagen nach Art/Zustand suchen/anzeigen; Plus/Bearbeiten öffnet vorhandenes Feldmodell im fokussierten Editor. Name (≤120), Betreff (≤200), Einleitungs-/Schlusstext (je ≤4000), Gültigkeit 1–365 (Default14), Zustand und bestehende Positionsdaten unverändert. Klare Einteilung Inhalt/Positionen/Weitere Einstellungen. Produktwahl und freie Positionen erhalten. Archivierung muss HTTP-Ergebnis prüfen, Fehler behandeln und nach 409 keine falsche Erfolgsmeldung liefern. Eine erfolgreiche Mutation mit fehlerhaftem GET bleibt als gespeichert erkennbar.

**Zweiter Slice:** deterministische Vorschau mit **fiktiven** Beispielkontakten/-event, identischem Renderer wie echte Dokumente, ohne Nummernverbrauch oder gespeicherte Kundendokumente. Platzhalter verständlich auswählbar; #-Schnellzugriff optional, keine neue Pflichtsyntax. Unterstützt bleiben `{{contact}}`, `{{event}}`, `{{date}}`, `{{location}}`, `{{eventType}}`, `{{package}}`, `{{total}}`, `{{documentLink}}`; unbekannte Tokens dürfen nicht still falsche Inhalte liefern.

**Tests zuerst:** Vorlagenart-/Archivfilter, Dirty-/Fokus-/409, Produktübernahme kopiert exakte Preise/Steuer, freie Position bleibt erhalten, Vorschau escaping und unbekannte Tokens, Vorschau verbraucht keine Nummer/ändert keine Vorlage. Mobile Positionsfelder als lesbare Gruppen statt zusammengedrückte Achtspaltentabelle. **Nicht dabei:** Mailvorlagen oder allgemeiner Layoutbuilder. Commit erster Slice `feat: edit document templates through a focused workflow`.

## BKP016 — Dokumententwürfe vollständig und unabhängig bearbeiten

**P1 für alltagstaugliche Angebote, nach bestehender C051-Basis.** Lesen `EventDocuments.tsx`, `documents.ts`, `document-templates.ts`, `document-snapshot.ts`, `document-totals.ts`, `document-pdf.ts`, `document-artifacts.ts`, `schema.ts`, Migrationen 0026–0031 (unverändert lassen), Dokumentkomponenten-/Integrationstests und Rendering-/Geldtests.

**Scope konkretisieren:** Ein aus Vorlage angelegter Entwurf erhält einen eigenen Datenstand für Texte, Positionen, Steuer/Rabatt, Gültigkeit und Empfängerbezug; UI erlaubt Änderung und Vorschau vor Finalisierung. Spätere Vorlageänderung darf vorhandenen Entwurf nicht still verändern. Heute kopierte Positionen plus später neu gelesene Vorlagentexte müssen durch bewusstes Snapshot-Verhalten ersetzt werden. Neue Felder/Versionierung mit additiver Migration und kompatibler Behandlung bestehender Entwürfe planen; keine historischen Texte behaupten, wenn sie nie gespeichert wurden.

**Soll-Ablauf nach BKP013:** Event→Dateien→Dokument öffnen→Entwurf bearbeiten→Änderungen speichern→Vorschau→bewusst finalisieren. Position hinzufügen aus Produkt oder frei; Menge/Einheit/Preis/Preisgrundlage/Steuer/Rabatt/individuelle Beschreibung bearbeiten; Dokumentpreis ändert nie Produkt. Der erste reine Entwurfs-Slice darf in der heutigen Übersicht bleiben und zieht BKP013 nicht still vor. Bestehende gespeicherte Positionspreise bedeuten **Bruttopreise**; Rabatte werden auf brutto gerechnet, Steuer daraus extrahiert. Ein Netto-Eingabemodus braucht einen eigenen ausdrücklich modellierten Slice mit Preisgrundlage/Migration und exakten Konvertierungstests; kein bloßer UI-Schalter, kein stiller Bedeutungswechsel alter Werte. Keine direkte Finalisierung allein durch Vorschau. Beim Finalisieren serverseitig Version, erforderliche Daten, Nummer und unveränderliches Artefakt konsistent prüfen; einmal vergebene Nummer nicht wiederverwenden.

**Tests zuerst:** Vorlage ändern nach Draftanlage, Draft bleibt identisch; individuelle Texte/Gültigkeit/Positionen nach Reload; 0-/19-%-Steuer, Netto/Brutto, Rundung, Rabatte, negativer/ungültiger Betrag, große exakte Werte; zwei Editoren/Finalisierungen parallel; Tenantzugriff; Final unveränderbar; PDF-/Hash-/Transaktionsfehler; bestätigtes POST mit fehlgeschlagenem GET nicht wiederholen. Verlorene Mutationantwort braucht belastbaren Wiederholschutz, nicht nur einen Frontend-Ref.

**Done:** ein Angebot kann vor Finalisierung vollständig angepasst werden und nachher nicht mehr überschrieben werden. Neue kommerzielle Dokumentarten noch nicht als vollständig fertig markieren. Commit nach Unter-Slice konkret benennen, z.B. `feat: snapshot and edit offer draft content`.

## BKP017 — Dokument ohne bestehende Vorlage beginnen

**P2, nach BKP016. Benutzeranforderung; Bookitup-Blanko-Speicherung nicht lesend bestätigt.** Lesen dieselben Dienste, Erstellungs-DTO/Response und bestehenden Erstellungsaufruf in `apps/admin/src/EventDocuments.tsx` und lesenden Dokumentindex `apps/admin/src/FilesPanel.tsx`. FilesPanel erstellt heute keine Dokumente; eine zusätzliche globale Anlage nur nach ausdrücklicher Festlegung im aktiven Unter-Slice. Heute ist `templateId` Pflicht. Kein globales Dummy-Template „leer“ heimlich anlegen.

**Scope:** Erstellungsdialog bietet klar „Ohne Vorlage“ oder vorhandene passende Vorlage; Typ und Eventkontext bleiben. Blanko startet mit ausdrücklich leeren eigenen Texten/Positionen und normalen Standardwerten, nicht mit Originaldaten eines anderen Kunden. Draftmodell aus BKP016 unterstützt fehlenden Vorlagenbezug; Quelltyp (blank/template) nachvollziehbar, keine fremde Tenant-Vorlage wählbar. Entwurf ggf. ohne vollständigen Kontakt möglich, Finalisierung verlangt fachlich nötige Empfänger-/Rechnungsdaten separat. Kein Pflicht-Bookitup-Portal.

**Tests zuerst:** kein einziges Template vorhanden und Blanko trotzdem anlegbar; Vorlage gewählt vs blank; fremde/archivierte Vorlage; Reload/Weiterbearbeiten; leere ungültige Finalisierung wird mit fokussiertem Feldfehler abgefangen, ohne Nummer/PDF; spätere Vorlageanlage ändert Blanko nicht. Ein einziger Erstellungsauftrag bei Doppelklick/Retry. UI zeigt Art und Zustand korrekt statt alles „Angebote“ zu nennen.

**Done:** brauchbarer eigener Dokumenteditor ohne Vorlagenpflicht, keine Scheinanwahl mit anschließendem Serverfehler. Commit `feat: create document drafts without a template`.

## BKP018 — Bestehendes Dokumentlayout und Logo über UI konfigurieren

**P2, nach Bedarf parallel zu Entwurfseditor.** `packages/core/src/document-layouts.ts`, `document-pdf.ts`, `storage.ts`, Integration `document-layouts.test.ts`; API `GET/POST/PUT /api/v1/document-layout`, `PUT /api/v1/document-layout/logo` existiert. Nicht zweiten Layoutspeicher erfinden.

**Scope:** Einstellungen→Dokument-Layout mit Logo, Absender/Anschrift, vorhandenen Farben/Schrift-/Seitenpositionsoptionen, Vorschau. Vorhandene Versionsprüfung und Logo-Validierung (PNG/JPEG, Signatur, ≤512KiB) unverändert respektieren. Vorschau keine Geschäftsnummer und keine echte Rechnung. PDF-Dokumentfarbe nicht mit Admin-Theme verwechseln. Ungültiges Logo lässt letzte gültige Fassung bestehen. Bereits finale Dokumente bleiben identische gespeicherte Artefakte trotz Layoutänderung.

**Tests zuerst:** zugelassene/gefälschte MIME- und Dateisignaturen, Übergröße, fremder Tenant, Versionkonflikt, Storagefehler, Reload, Vorschau vs tatsächliches Rendering, finaler PDF-Hash bleibt nach Änderung. Uploadregeln nicht aus allgemeinen UI-Dateiendungen ableiten. **Done:** bestehende Layout-API tatsächlich bedienbar und in beiden Themes lesbar. Commit `feat: configure document branding with a safe preview`.

### Nächster kleiner UI-Slice nach BKP018.1: mobile Einstellungsnavigation

**Befund 24.10.2026, lokal gebauter e9ca99d-Code:** Bei 320px nimmt die bestehende
zweispaltige Einstellungsnavigation viel Platz vor dem Formular ein. Lange
Beschriftungen wie „Dokumentlayout“ und „Nummernkreise“ brechen mitten im Wort.
Nichts ist abgeschnitten, die Anordnung entspricht aber noch nicht dem Ziel
„nur das Nötigste zuerst“. Dies ist ein eigener nächster Slice, keine bereits
umgesetzte Verbesserung und keine neue Bookitup-Runtime-Beobachtung.

**Vorgeschlagener Scope BKP018.1b, vor Coding im Hauptplan aktivieren:**
`SettingsNavigation` in `apps/admin/src/Navigation.tsx` und ausschließlich seine
responsiven Regeln in `styles.css`. Bei der bestehenden mobilen Grenze bis
900px einen beschrifteten nativen Select „Einstellungsbereich“ mit dem aktuellen
Bereich anzeigen, statt zwölf dauerhaft sichtbarer Linkflächen. Oberhalb 900px
die bestehende Linknavigation erhalten. Dieselbe `settingsLinks`-/Hash-Zuordnung
verwenden, keine zweite Liste oder neue Routingbibliothek. Auswahl ändert den
Hash wie ein vorhandener Link; bestehende `hashchange`-/`popstate`-Logik muss
direkte Links und Browser-Zurück weiter abbilden. Keine Panels unmounten oder
vorhandene Eingaben bei einem bloßen Bereichswechsel verwerfen. Keine neuen
Dialoge/Overlays, Animationen, Farben, Abhängigkeiten oder Filteränderungen.

**Abnahme zuerst rot:** Bei 320/390/768 nur der kompakte Bereichswähler sichtbar
und bedienbar, bei 1280 unveränderte Linknavigation. Alle bisherigen zwölf
Bereiche einschließlich Dokumentlayout erreichbar; Auswahl und sichtbarer
Bereich stimmen nach Direktlink, Wechsel und Zurück überein. Zugänglicher Name,
native Tastaturbedienung, 44px Mindesthöhe, kein Body-Overflow, vollständige
Beschriftung ohne willkürlichen Wortbruch. Ein bereits schmutziger Layoutentwurf
bleibt nach Bereichswechsel/Rückkehr erhalten und registriert; bestehende
Home-/Dateien-/Suchschutzregeln nicht schwächen. Komponentenregression plus
Chromium bei 320/390/768/1280 in beiden Themes und axe. Vorher/Nachher direkt
ansehen und erklären, welche erste Arbeitsfläche dadurch früher sichtbar wird.
Ponytail/Impeccable; Taste v2 nicht auf die Verwaltungsfläche erzwingen. Ein
möglicher Commit ist `feat: keep mobile settings navigation compact`.

## BKP019 — Kommerziellen Dokumentablauf bis Zahlung vervollständigen

**Featurepaket, zwingend unterteilen, nach BKP016; C052–C056 wiederverwenden.** Enum-/Template-Unterstützung für fünf Typen ist noch kein fertiges Rechnungswesen. Lastenheft AG-/RG-/NK-Anforderungen, `documents.ts`, Number-/Totals-/Snapshot-/Artifactdienste lesen. Fachliche Pflichtangaben vor Rechnungsrelease gesondert prüfen; diese Auditdoku ist keine Rechts-/Steuerabnahme.

**Unterfolge:** (0) Angebotsgültigkeitsdatum und Status versendet/abgelaufen/angenommen/zurückgezogen einschließlich zulässiger Übergänge; Fachstatus von finalem unveränderlichem Inhalt trennen. `withdrawn` existiert heute als Enum, aber nicht als vollständiger ausführbarer Rückzugsablauf. (a) Angebotsannahme mit Zeitpunkt, Kanal E-Mail/Telefon/PDF/Sonstiges und Notiz, optional sicherer Anhang; (b) Auftragsbestätigung aus angenommenem Angebot ohne Positionsneueingabe; (c) Rechnung/Anzahlung/Schlussrechnung/Korrektur mit eigenen Entwürfen und unveränderlicher Finalisierung; (d) Zahlungen/Teilzahlungen/offener Saldo; (e) verständliche Fristen-/Statusfilter und Export. Kein automatisches „angenommen“ aus E-Mail-Eingang, kein „bezahlt“ aus Rechnungsdruck. Quelle/Zielbeleg dauerhaft verknüpfen; Kopie ist neuer Datensatz.

**Tests pro Unter-Slice:** tenant-/versionsgesicherte Zustandsübergänge, ungültiger Kanal/Zeitpunkt, gleiche Positions-/Summenübernahme, parallele Nummernvergabe und Rollback, exakte Steuer/Anzahlungen/Korrekturen, Über-/Teilzahlung, ungültige Datums-/Betragskombination, keine Doppelverrechnung, finale Originale unverändert, CSV-Formelinjektion. Ablaufgrenze in Mandantenzeitzone und identische PDF-Bytes über Versenden/Annehmen/Zurückziehen prüfen. E2E vollständiger synthetischer Angebot→Annahme→Anzahlung→Schlussrechnung→Zahlung.

**Nicht dabei:** Buchhaltungscloud, automatische Bankabbuchung, echte Rechnungen neu ausstellen. **Done je Unter-Slice:** fachlich vollständig bedienbar mit negativer Fallabdeckung; Gesamtticket erst nach letztem Ablauf abhaken. An bestehende C052–C056-Commitvorschläge anschließen.

## BKP020 — Sichere wiederverwendbare Datei- und Eventbibliothek

**Featurepaket, vor Mailanhängen; C038 für Bibliothek und C039 für Anhangintegration.** Lesen `storage.ts`, `FilesPanel.tsx`, `documents.ts`, vorhandene Storage-/Artefakttests und Lastenheft DA-01–07. Globaler Geschäftsbelegindex bleibt erhalten und wird erweitert, nicht ersetzt.

**Unterfolge:** (a) tenantgebundene Dateimetadaten + Adapterablage mit Uploadquarantäne/Scanstatus; (b) allgemeine Bibliothek als neuer ausdrücklich beschrifteter Teil der Dateienansicht; (c) Eventverknüpfung und Kategorie Upload/Standard/Mailanhang nach vorhandenen Beziehungen, keine binären Kopien pro Tab. Mindestens PDF/JPG/PNG/ZIP gemäß Lastenheft, mit echten Typ-/Größenlimits und serverseitiger Signaturprüfung. Namen als untrusted behandeln, keine Dateipfade aus Nutzername bauen. Download nur autorisiert, sicherer Content-Disposition/-Type, keine HTML-/SVG-Ausführung im App-Origin. ZIP nicht unkontrolliert extrahieren; Scan-/Bombenlimits im technischen Slice festlegen.

**Zustände:** hochgeladen/in Prüfung/verfügbar/abgewiesen/archiviert klar, nicht vor erfolgreicher Prüfung an Mails hängen. Ersetzen erzeugt neue Version/Artefakt; alte in finalen Dokumenten/versendeten Mails referenzierte Bytes bleiben unverändert. Löschen/Retention nicht pauschal aus Archivknopf ableiten.

**Tests zuerst:** fremder Tenant/IDs, Pfadtraversal, Unicode/langes Filename, MIME-Spoofing, Grenzgröße, Scanfehler/Timeout, Uploadabbruch/Storagefehler, keine verwaisten „verfügbar“-Metadaten, wiederholte Mutation, Downloadheaders, unveränderte alte Anhänge nach Ersetzen, Restore aller Referenzen. UI mit 0/vielen Dateien/kein Treffer. Keine echten Standarddateien in Fixtures/Git. **Done:** echte Uploadbibliothek zusätzlich zum existierenden Dokumentindex; erst dann Mailanhangpicker.

## BKP021 — Dauerhaften Mailkern und Providergrenzen implementieren

**Großes Fundament, nach Lastenheft EM und ursprünglichen C039–C042 unterteilen.** Es gibt noch kein Mailmodell. Nicht nur einen SMTP-Aufruf hinter einen Button setzen. TypeScript-Monolith/PostgreSQL-Worker behalten, Secrets außerhalb Git.

**Unterfolge:** (a) tenant-/accountgebundene Nachrichten-/Thread-/Ordnerdaten, Bearbeitungsstatus separat vom Versand-/Ordnerstatus, Kontakte-/Eventbeziehungen; (b) IMAP-Leseadapter mit UIDVALIDITY/UID-/Message-ID-/Antwortbezug und dauerhaften Checkpoints; (c) SMTP-Outbox für ausdrückliche Versandaufträge, stabile Idempotenz und Audit. Providerkonfiguration zunächst über sichere bestehende Betreibermechanismen; kein Passwort im API-GET/Log/UI-Fehler.

**Wichtige Regeln:** gleiche Mail kann bewusst Kontakt und Event zugeordnet sein; mehrdeutige Erkennung nur Vorschlag, keine falsche Kundenassoziation. Import beginnt ab vereinbartem Umschaltpunkt, historische Bookitup-Mails nicht massenhaft kopieren. HTML sanitizen, Remote-Bilder/Tracking standardmäßig nicht ungefragt laden. Anhänge nur nach BKP020-Prüfung verfügbar. SMTP „angenommen“ ist kein sicherer Zustellnachweis; unklarer Ausgang nach Verbindungsabbruch darf nicht blind neu gesendet werden.

**Tests zuerst:** fiktiver lokaler Provider, erneute UID-Seite/UIDVALIDITY-Wechsel, Wiederanlauf/Absturz, doppelte Providerdaten, Threadkollision/mehrdeutige Zuordnung, fremder Tenant, manipuliertes HTML/Anhang, Provider-Timeout, verlorene SMTP-Antwort mit angehaltenem unklaren Ausgang, Outboxdoubleclaim. Keine echten Kundenmails zum Test. **Done:** Maildaten dauerhaft und externe Wirkung fehlertolerant, ehe ein echter Senden-Knopf freigegeben wird.

## BKP022 — Globales und kontextuelles Postfach bedienbar machen

**P2-UI-Funktionspaket nach BKP021.** Referenz B08/B12/B31. Lesen neue Maildienste, `Navigation.tsx`, `AuthPanel.tsx`, EventDetails/ContactPanel und vorhandene URL-/Dirty-Helfer. Bei fehlendem Mailkern erst lesenden Modellslice aktivieren, keine bloße Attrappe.

**Scope:** globaler Postfachbereich mit Eingang, Unerledigt, ohne Eventbezug, Gesendet, Entwürfe, Geplant, Fehlgeschlagen, Papierkorb; globaler Mailaccountfilter nur bei tatsächlicher Mehrkontofunktion. Event/Kontakt zeigt dieselben Daten mit engerem Bezug. Desktop Liste + Nachricht, mobil Liste→Nachricht mit Zurück. Absender/Betreff/Zeit/Bearbeitungsstatus kurz, Such-/Ordnerfilter kontextuell. Kontaktdaten nicht standardmäßig über dem gesamten Inhalt wiederholen.

**Interaktionen:** öffnen, zuordnen/lösen, Bearbeitungsstatus ändern, antworten/weiterleiten über BKP023; jeder tatsächliche Schreibschritt klar. Gelesen/unerledigt unabhängig, kein stilles Erledigen beim Öffnen. Bei Zuordnungsänderung Version/Resultat anzeigen. Back/Filter/Pagination erhalten, keine fremden Threads durch veraltete Antwort. Mails niemals als HTML direkt in Root rendern.

**Tests zuerst:** leere Ordner/kein Treffer/Fehler, lange Inhalte, verteilte Antworten, Event ohne Kontakt, Kontakt mit mehreren Events, fehlende Zuordnungsrechte, Sanitizing/Remoteinhalte, mobile Back-/Fokusfolge und Authverlust. **Done:** ein echter vollständiger Lese-/Zuordnungsworkflow, keine Scheinordner. Featureweiterungen einzeln committen.

## BKP023 — Mails ohne Vorlage verfassen, beantworten und weiterleiten

**Nach BKP021/BKP022, Anhänge nach BKP020.** B09 zeigt direkten Composer mit Absender, An/CC/BCC, Betreff, Text und Werkzeugen. Vorlagen sind zusätzliche Abkürzung, keine Pflicht.

**Scope erster Slice:** leerer eigener Entwurf, Empfänger bei Event/Kontakt passend vorschlagen und frei korrigierbar, Betreff/Text, sichere Signatur, Entwurf speichern/wiederaufnehmen/Abbrechen mit Dirty-Schutz. Antwort/Allen antworten/Weiterleiten im nächsten Unter-Slice mit korrekt getrennten Empfängerfeldern, Referenzen und nur bewusst übernommenen Anhängen. Entwurf darf ohne Empfänger gespeichert werden; Versandvalidierung streng serverseitig. Kein automatischer Versand beim Laden eines Templates oder beim Speichern.

**Sendeablauf:** ausdrückliche Senden-Aktion→dauerhafter Outboxauftrag→sichtbarer pending/sent/failed/uncertain-Status. Während der Mutation Doppelklickschutz; echter Wiederholschutz im Backend. BCC niemals in sichtbaren Mailheadern für andere Empfänger oder falschen UI-Kontexten ausgeben. Anhänge aus Rechner/Bibliothek/finalen Geschäftsdokumenten nur verfügbar/autorisiert auswählen.

**Tests zuerst:** komplett ohne Vorlagen, ohne Event, ungültiger Empfänger/CRLF-Injektion, mehrere CC/BCC, Antwort-Referenzen, Fremdtenantanhang, Dirty/Reload/409, gespeicherter Entwurf+Listenfehler, doppelte Senden-Geste/Crash, unsicherer Providerzustand. **Done:** brauchbarer Blanko-Editor vor Vorlage-Abkürzungen, kein echter Testversand an Kunden.

## BKP024 — Mailvorlagen pflegen und frei veränderbar anwenden

**Nach BKP023, Standardanhänge nach BKP020.** Lesen ursprünglichen C043 (Vorlagen) und C044 (Composer), Lastenheft ET und neue Mail-/Template-/Placeholderdienste. Dokumentvorlagen sind keine Mailvorlagen; gemeinsamen Renderer nur übernehmen, wenn Semantik passt.

**Scope in Unter-Slices:** Liste nach Name/Gruppe, eigener fokussierter Editor für Name/Betreff/Text, erlaubte Platzhalter, optionale Standardanhänge und Dokumentanhang-Vorschläge; Duplizieren/Archivieren/Version. Im Composer separate Auswahl „Aus Vorlage“, danach normaler vollständig editierbarer Entwurf. Änderungen am geladenen Mailtext ändern nie die Vorlage. Spätere Vorlagenänderung ändert keinen gespeicherten Mailentwurf oder bereits versendeten Inhalt. Vorlagenwahl auf schmutzigem Entwurf fragt vor Ersetzen; kein Verlust durch versehentlichen Picker.

**Tests zuerst:** keine Vorlage vorhanden und Blanko weiterhin möglich; unbekannte/fehlende Platzhalter, Escaping, archivierte/fremde Vorlage, Vorlage ohne passenden finalen Dokumentanhang → ehrlicher Hinweis statt falscher Kundenbeleg; Standardanhangversion eingefroren, Vorlage geändert nach Draftanlage, Snapshot unverändert; kein Versand beim Anwenden. Fiktive Vorschau mit fehlendem Kontakt/Datum darf nichts erfinden.

**Nicht dabei:** elf echte Vorlagentexte aus privatem Export in Git kopieren oder automatisiert versenden. **Done:** Benutzer kann mit oder ohne Vorlage starten, beide Wege enden im gleichen sicheren Editor.

## BKP025 — Geplanten Versand und sichtbare Fehlerwiederholung ergänzen

**Nach BKP021/BKP023; Erinnerungen als eigenen Folge-Slice.** Postgres-Worker/Outbox wiederverwenden. Geplanter Zeitpunkt in Mandantenzeitzone eingeben, UTC speichern; DST-Lücke/Mehrdeutigkeit wie vorhandene EventTimeField-Muster behandeln.

**Scope:** Entwurf→geplant→sendend→gesendet/fehlgeschlagen/unklar, bewusste Änderung/Stornierung einer noch nicht beanspruchten Planung, nachvollziehbare Retryaktion bei sicher fehlgeschlagener Wirkung. Nach Serverbestätigung UI mit Jobstatus abgleichen. Fälliger Versand ist keine feste Buchungsbestätigung. Automatische Follow-ups zusätzlich nur mit ausdrücklich festgelegter Reaktions-/Stopregel, nicht jede erfolglose Anfrage mit beliebigen Mails füllen.

**Tests zuerst:** Neustart vor/nach claim, zwei Worker, Clock/DST, Planung bereits vergangen, gleichzeitiges Bearbeiten und claim, eindeutiger Fehler mit Retry, unklarer SMTP-Ausgang ohne automatischen Duplikatversand, gelöschter/archivierter Empfänger-/Anhangbezug, fremder Tenant, nach Stornierung kein Versand. Reaktionen stoppen Erinnerungen nur nach belastbarer Regel; manueller Versand und automatische Reaktion dürfen sich nicht doppeln.

**Done:** echte dauerhafte Planung mit ehrlichem Fehler-/Unklarstatus und Audit. Keine Demo-Scheduler im Browser, kein `setTimeout` als dauerhafter Versandplan. Mit synthetischem Provider abnehmen, echten Versand separat autorisieren.
