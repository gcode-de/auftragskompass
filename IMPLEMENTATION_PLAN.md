# AuftragsKompass – commitgenauer Implementierungsplan

**Status:** geprüfter Bauplan; C001–C026 und vorgezogen C076 implementiert; übrige C027–C085 offen. Die CI prüft jeden Push.
**Produktgrundlage:** `Lastenheft_Fotobox-Verwaltung_MVP.md`
**Arbeitsweise:** Jeder nummerierte Eintrag ist ein eigenständiger, grüner Commit mit Tests und wird unmittelbar nach Fertigstellung gepusht.

**Neue Session:** Zuerst die [Projektübergabe mit Funktionsstand und Skill-Vorgaben](docs/handoff.md) lesen und den tatsächlichen Repository-/Betriebsstand verifizieren.

## Aktueller Nachtrag: Bookitup-Parität (22.10.2026)

- [x] **BKP019.d — `feat: record incoming payments against a finalized invoice`** (26.10.2026)

  Unter-Slice (d) von BKP019 nach rein lesender DeepSeek-Analyse zu `9d8e8a2`
  (RG-09 „Zahlungseingänge mit Datum, Betrag, Zahlweg und Notiz“). Staleness:
  (d) nicht begonnen (keine Tabelle/Route/UI); Zusatzbefunde: kein Zahlungsziel
  (RG-07 offen) und der c2-Über-Gutschrift-Guard kennt Zahlungen nicht. Neu:
  Migration `0044_document_payments` (append-only, keine Unique wegen
  Teilzahlungen, Audit `payment.recorded`); `document-payments.ts` mit
  Erfassung nur gegen **finale Rechnungen** (`POST /api/v1/documents/:id/
  payments`: Datum nicht in der Zukunft, Betrag ≥1, Zahlweg
  `bank_transfer|cash|card|other` = eigene dokumentierte Konvention, Notiz
  ≤2000), `lockTenant`/Admin/Audit in einer Transaktion; **Überzahlung 409
  `overpaid`** (Σ Zahlungen + neu ≤ offener Saldo); **erweiterter
  Kredit-Guard aus c2:** `Σ Gutschriften + Σ Zahlungen ≤ Brutto + Σ
  Lastschriften` – solange es keine Rückzahlungslogik gibt, darf nicht
  gutgeschrieben werden, was bezahlt wurde (dokumentierter Zwischenzustand).
  Abgeleitete Werte (nie gespeichert): Zahlungsstand `none|partial|paid` +
  offener Betrag (`Brutto + Σdebit − Σcredit − ΣZahlungen`; die fehlende
  Lastschriftensumme wird in der Projektion ergänzt); „überfällig“ bleibt
  offen (RG-07 = eigener Slice, nicht erfunden). UI: Zahlungsstand/„Offener
  Betrag“ auf der Rechnungszeile, kompakte Zahlungserfassung/-liste nur bei
  finalen Rechnungen, ehrlicher Hinweis „bezahlt“ nur aus erfassten
  Zahlungen (nie aus Druck), Zahlungen unveränderlich. Referenz ehrlich:
  RG-08/09 Lastenheft-Soll, Bookitup-Zahlungs-UI unbekannt, keine Rechts-/
  Steuerabnahme, keine Bank-/PSP-Anbindung. Tests zuerst rot (Negativfälle
  inkl. Zukunft/0/negativ, Überzahlung, Parallelität, kein PATCH/DELETE,
  erweiterter Kredit-Guard; `documents.test.ts:298–308` unantastbar).
  Coding-Subagent: DeepSeek V4.1 Flash (gleiche Delegationsform), MiMo
  besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (14/15 Integrationstests gegen entfernte
  Migration – echtes Produkt-RED; ehrlich getrennt: sechs Harness-/Testfehler
  wurden beim Rotlauf repariert und benannt), danach grün: `test:unit`
  274/274, `test:component` 729/729 (6 neu), `test:integration` 410/410
  (16 neu: Erfassung+Audit, Teilzahlung→bezahlt ohne Versionssprung,
  Überzahlung 409 ohne Zeile/Audit, Datums-/Betrags-/Zahlweg-/Notizgrenzen,
  Nicht-Rechnung/Entwurf/fremd, Administratorrecht, Parallelzahlung (genau
  eine), Routen inkl. kein PATCH/DELETE, erweiterter Kredit-Guard
  „50,00 € gezahlt → höchstens 223,10 € gutgeschrieben“, Projektion nur in
  `include=offer`, Mandantentrennung, DB-CHECKs/FK/kein Cascade),
  `test:coverage` 1413 vollständig (Changed 91,8%/80,7%),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inkl. Ablauf zweite Rechnung: offen →
  40,00 € → teilweise → 60,00 € bar → bezahlt/0,00 € → Überzahlung
  abgelehnt, DB-/Audit-/Projektionsnachweise, PDF/Hash unverändert,
  PATCH/DELETE 404. Notiert: „überfällig“ fehlt ehrlich (RG-07 =
  Zahlungsziel eigener Slice); keine Rückzahlungslogik (bezahlt wird nicht
  gutgeschrieben – dokumentierter Zwischenzustand); kein
  Idempotenzschlüssel (UI blockt Doppelklick, Netz-Retry theoretisch
  möglich – Kandidat für späteren Beleg-Mechanismus); Überzahlungsregel
  lebt unter `lockTenant`, nicht strukturell in der DB; AJV coerct
  numerische Strings; Zahlwegwerte sind eigene Konvention; ein
  vorbestehender Parallelitäts-Flake (testcontainers file-lock in
  worker-main.test.ts) fiel einmal aus, Wiederholungslauf grün.

- [x] **BKP019.c2 — `feat: correct a finalized invoice with a credit or debit correction`** (26.10.2026)

  Unter-Slice (c2) von BKP019 nach rein lesender DeepSeek-Analyse zu `c2e8ef2`
  (RG-02 „Rechnungskorrektur/Storno“). Zwei Befunde prägen den Slice: (1)
  Negieren ist mit der bestehenden `roundedRatio`-Rundung NICHT exakt
  (BigInt-Schnitt zur Null: 5/5/0 wird zu −4/−3/−1) – negative Beträge auf
  Zeilenebene wären also ungenau; (2) ein halbfertiger, fachlich falscher
  Pfad existiert (Vorlagenart `correction` erzeugt unbearbeitbare Entwürfe
  mit `KO-`-Nummer und positiven Beträgen). Gewähltes Modell B′:
  `correction_direction` (`credit|debit`) auf Belegebene, gespeicherte
  Summen bleiben nicht-negative Magnituden, die signierte Summe ist
  `−1 ×` gespeichert (per Konstruktion exakt – `document-totals`/DB-CHECKs
  unangetastet). Migration `0043`: Richtungs-CHECK, Quellpflicht für
  `correction` (Quelle = finalisierte `invoice` ODER `order_confirmation`,
  keine Kettenkorrekturen in diesem Slice), Blanko-Regel nur additiv
  (`invoice`-Klausel wörtlich, `correction` ohne Quelle bleibt 23514),
  partieller Unique nur auf offene Entwürfe. Erzeugung
  `POST /api/v1/documents/:id/correction` (Pflicht-`version`, Richtung),
  bearbeitbarer Entwurf mit Positionen als Magnituden (Standard 1:1),
  Betreff „Rechnungskorrektur für {{contact}}“, Finalisierung mit `KO-`-Nummer;
  Über-Gutschrift-Guard beim Finalisieren (`credit`-Summe der Quelle +
  neue Bruttosumme ≤ Quellbrutto, `lockTenant`); Storno-Stand der Rechnung
  (`none|partial|full`) wird in der Projektion ABGELEITET (nie gespeichert,
  RG-08 „storniert“ ohne Unveränderlichkeitsbruch); UI zeigt Richtungswahl,
  verbleibende kreditierbare Summe und abgeleiteten Stand; Bezugszeile +
  Korrektur-Summenblock nur bei gesetztem Bezug (c1-Bytegleichheit bleibt).
  Halbfertiger Vorlagen-Korrekturpfad wird gesperrt (klarer Fehler).
  Saldenformel für (d) dokumentiert: `gross + Σdebit − Σcredit − ΣZahlungen`.
  Referenz ehrlich: RG-02/08/NK-01 sind Lastenheft-Soll, Bookitup-Korrektur-
  belege unbekannt, keine Rechts-/Steuerabnahme. Tests zuerst rot (18 Fälle
  inkl. Über-Gutschrift, bytegleiche Originale, Vorlagenpfad-Ablehnung;
  gepinnte Projektionsschlüssel bewusst um drei erweitert,
  `documents.test.ts:298–308` unantastbar). Coding-Subagent: DeepSeek
  V4.1 Flash (gleiche Delegationsform), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen (inkl. Nachtrag c2b „Korrektur-Entwurf in der UI bearbeitbar“):
  rot beobachtet (27 Fehlschläge gegen per `git stash` ausgeblendeten Kern –
  fehlende Methode/Spalte/Schlüssel/Route/Projektion; Nachtrag: fehlende
  Bearbeiten-Aktion), danach grün: `test:unit` 274/274, `test:component`
  722/722 (5+1 neu), `test:integration` 393/393 (14 neu: Quelltyp/Status,
  Doppelentwurf, Über-Gutschrift 409 `credit_exceeds_invoice`, `KO-`-Nummer/
  Parallelität/Rollback, bytegleiche Originale, Mandantentrennung,
  23514/23503, Projektion `correctionState`/`remainingCredit`, Route,
  Vorlagenpfad-Ablehnung 400 `invalid_kind`), `test:coverage` vollständig
  grün (Changed 93,3% Zeilen), `test:workspace`/`test:docs`/schnelle
  Gates/Build grün; E2E auth+template-product-price 16/16 inkl. Ablauf
  finale Rechnung → Gutschrift → `KO-JJJJ-NNNN` → abgeleiteter Stand
  „storniert“/0,00 € → bytegleiche Quell-PDFs → zweite Gutschrift 409, im
  Nachtrag: Korrektur-Entwurf öffnet den geteilten Editor (eigene
  Überschrift/Verwerfen-Text), Positionsänderung wird gespeichert und
  finalisiert, Original bleibt unverändert. Notiert: keine Kettenkorrekturen
  (Quelle `correction` = 400); Bezugsdaten reisen als reine Print-Option im
  Layout-Objekt (document-snapshot.ts nicht im Satz; ohne Bezug bleibt das
  HTML zeichengleich – Bedingung der c1-Bytegleichheit); Bytegleichheit über
  hash-adressierte Artefakte geprüft, nicht über zweiten Renderlauf;
  Vorlagenhinweis in der Verwaltung fehlt noch (DocumentTemplatesPanel nicht
  im Satz – Doku benennt es ehrlich); `debit` ist absichtlich unbegrenzt,
  E2E deckt nur `credit` (derselbe Editorpfad).

- [x] **BKP019.c1 — `feat: invoice a confirmed order with its own number`** (26.10.2026)

  Erster Unter-Slice von BKP019.(c) nach rein lesender DeepSeek-Analyse zu
  `87e5b99`. Staleness-Befund: (c) fehlt vollständig – die Rechnungsarten sind
  nur Enum/Vorlagenart/Nummernkreis; die eigentliche Blockade ist der
  Blanko-CHECK (`documents.test.ts:298–308`: vorlagenlose `invoice` = 23514).
  Neu: `POST /api/v1/documents/:id/invoice` erzeugt aus einer **finalen
  Auftragsbestätigung** einen bearbeitbaren Rechnungsentwurf (Positionen 1:1,
  Summen exakt = Quellendsummen, Betreff „Rechnung für {{contact}}“,
  Einleitung/Schluss kopiert, `PUT /draft`-Rechte für `invoice`), finalisiert
  mit eigener Nummer im Rechnungsnummernkreis (NK-01/NK-05 bestehende
  Verträge). Migration `0042` weitet die Quellmechanik aus 0041 auf
  `invoice` aus (CHECK/mandantengebundener FK/partieller Unique-Index =
  genau eine Rechnung je Quelle, Dublette 409 ohne Nummernverbrauch);
  Quellanzeige über die bestehende `include=offer`-Projektion (keine neuen
  Schlüssel in gepinnte Antwortformen). Keine Rechnung für zurückgezogene
  Quellen; die Blanko-Sperre bleibt unverändert (nur der Quellpfad ist neu).
  **Ersatzbeleg-Entscheidung (dokumentiert):** Dublettensperren bleiben
  endgültig; finalisierte Belege werden nie ersetzt, sondern nur durch
  Korrektur-/Storno-Folgedokumente ergänzt (c2 mit Vorzeichenmodell –
  negative Beträge sind heute auf vier Ebenen verboten). Nicht im Slice:
  Anzahlung/Schlussrechnung (brauchen Zahlungsaussage aus (d)),
  Korrektur/Storno, Pflichtangaben RG-04/RG-07 (eigener Slice) – die Lücken
  werden ehrlich benannt statt durch einen „vollständig“-Eindruck verdeckt.
  Referenz ehrlich: RG/NK sind Lastenheft-Soll, Bookitup-Rechnungs-UI
  unbekannt, keine Rechts-/Steuerbehauptung. Tests zuerst rot (≥16
  Negativfälle; `documents.test.ts:4692–4700` bewusst präzisieren,
  `documents.test.ts:298–308` unantastbar). Coding-Subagent: DeepSeek
  V4.1 Flash (gleiche Delegationsform), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (13 Integrationsfehler fehlender Methode,
  DB-Vertrag/Migrationserwartung, 7 Component-/E2E-Feeler), danach grün:
  `test:unit` 274/274, `test:component` 716/716 (9 neu),
  `test:integration` 379/379 (15 neu: Positions-/Summengleichheit, Art-/
  Statusvertrag, Dublette ohne Nummernverbrauch, Parallelität/Rollback,
  eigene `RE-`-Nummer, Unveränderlichkeit, Mandantentrennung, DB-CHECKs
  23514/23503/23505, Projektion, Routenvertrag; Quell-CHECK-Test bewusst
  präzisiert – `deposit_invoice` bleibt negativ, `:298–308` unantastbar),
  `test:coverage` 1369 vollständig (Changed 93,24% Zeilen/85,53% Zweige),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inkl. Ablauf finale Bestätigung →
  Rechnung mit kopierten Positionen → Dublette → Finalisierung
  `RE-JJJJ-NNNN` → PDF, Angebots-/Bestätigungs-PDF bytegleich. MiMo-
  Reviewfix: Editor-Überschrift/Verwerfen-Dialog auch für Rechnungen
  artabhängig. Notiert: Doppelverrechnung über den Vorlagenpfad bleibt
  möglich (Unique deckt nur den Quellpfad; bewusst, da der Vorlagenpfad
  unverändert bleiben soll); die DB erzwingt nicht „Quelle ist eine
  Bestätigung“ (Anwendung prüft `invalid_kind`); Pflichtangaben RG-04/RG-07,
  Anzahlung/Schlussrechnung/Korrektur/Zahlungen fehlen ehrlich (UI-Hinweis);
  „final“ heißt „eingefroren“, nicht „rechtlich vollständig“.

- [x] **BKP019.b — `feat: confirm an accepted offer without retyping positions`** (26.10.2026)

  Unter-Slice (b) von BKP019 nach rein lesender DeepSeek-Analyse zu `ef664b3`
  (Lastenheft AG-05: angenommenes Angebot ohne erneute Positionserfassung in
  eine Auftragsbestätigung übernehmen). Staleness-Befund: (b) fehlt vollständig
  – `order_confirmation` ist reiner Enumwert; zwei nicht offensichtliche
  Blockaden werden behoben (Blanko-CHECK erlaubt vorlagenlos nur Angebote;
  `PUT /draft` verweigert Nicht-Angebotsarten, sodass eine Bestätigung sonst
  den Angebotstext unkorrigierbar drucken würde). Neuer Erzeugungsweg
  `POST /api/v1/documents/:id/order-confirmation` mit Statusvertrag
  final+accepted und Pflicht-`version`; erzeugt einen BEARBEITBAREN
  Bestätigungsentwurf mit Positionen 1:1 aus dem Angebot (Bruttopreise,
  Steuer-/Rabatt-Basispunkte unverändert, keine Umrechnung; Summen serverseitig
  exakt = Angebotsendsummen), Texten aus dem Angebot (Betreff „Auftrags-
  bestätigung für {{contact}}“, Einleitung/Schluss korrigierbar) und
  Quellverknüpfung `source_document_id` (Migration `0041` mit
  mandantengebundenem FK, CHECK nur für Bestätigungen, partiellem
  Unique-Index = genau eine Bestätigung je Angebot, endgültig; Dublette → 409
  ohne Nummernverbrauch). Spätere Änderungen an Angebot oder Bestätigung
  beeinflussen sich nie gegenseitig (Pflichttest beide Richtungen); die
  Bestätigung finalisiert art-agnostisch mit eigener Nummer. UI-Aktion nur
  bei `accepted`-Angeboten; Quellnummer sichtbar. Referenz ehrlich: AG-05
  ist Lastenheft-Soll, Bookitup-UI unbekannt, die Bestätigung ist KEIN
  Rechnungsbeleg. Tests zuerst rot (17 Fälle inkl. Übernahme-Gleichheit,
  Dublette, Rollback/Parallelität, DB-CHECKs; `documents.test.ts:298–308`
  bleibt unantastbar). Coding-Subagent: DeepSeek V4.1 Flash (gleiche
  Delegationsform), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen (inkl. Nachtrag BKP019.b2 „Bestätigungsentwurf in der UI
  bearbeitbar“): rot beobachtet (13 Integrationsfehler fehlender Methode,
  fehlende Route/UI-Aktion, Migrationserwartung; Nachtrag: fehlende
  Bearbeiten-Aktion), danach grün: `test:unit` 274/274, `test:component`
  707/707, `test:integration` 364/364 (16 neue Pflichttests: Positions-/
  Summen-/Steuer-/Rabatt-/Preisbasisgleichheit, Status-/Artvertrag,
  Fremdmandant, Dublette 409 ohne Nummernverbrauch, Parallelität/Rollback,
  Unabhängigkeit beide Richtungen, eigene Nummer/PDF, fehlender
  Nummernkreis, DB-CHECKs 23514/23503/23505, Projektion, HTTP-Route),
  `test:coverage` 1343 vollständig (Changed ≥85/80),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inkl. Ablauf angenommenes Angebot →
  Bestätigung mit kopierten Positionen (kein Editor geöffnet) →
  Dublettenerklärung → Finalisierung mit eigener Nummer → Quellhinweis,
  Angebots-PDF bytegleich; im Nachtrag: Bestätigungsentwurf öffnet den
  geteilten Editor mit eigener Überschrift, geänderte Texte werden
  gespeichert und finalisiert. MiMo-Reviewfix: auch der Verwerfen-Dialog des
  Editors ist jetzt artabhängig („Änderungen an der Auftragsbestätigung“).
  Notiert: Dublettensperre ist endgültig (Ersatzbeleg = Entscheidung in (c));
  `validity_days` wird aus Vorlagengründen kopiert, fachlich inert für
  Bestätigungen; Angebot ohne Kontakt/Event wird mit `missing_reference`
  abgelehnt statt mit erfundenem Inhalt bestätigt; die Erzeugung antwortet in
  der alten Zeilenform, die Quelle erscheint über `include=offer`.

- [x] **BKP019.a — `feat: record how an offer was accepted`** (26.10.2026)

  Unter-Slice (a) von BKP019 nach rein lesender DeepSeek-Analyse zu `44a055f`
  (Lastenheft AG-06/AG-08). Zwei zentrale Befunde werden behoben: der
  Annahmezeitpunkt darf NICHT `status_changed_at` sein (beim Rückzug
  überschrieben – eigene Spalte `accepted_at`), und der Idempotenz-No-op darf
  abweichende Angaben nicht still verschlucken (identische Wiederholung =
  No-op, abweichende = 409 `acceptance_conflict`). Migration `0040`:
  `accepted_at`, `acceptance_channel` (email|phone|pdf|other aus AG-06),
  `acceptance_note` (≤2000), `acceptance_file_id` (FK auf `library_files`,
  zusammengesetzt mandantengebunden), vier benannte CHECKs, kein Backfill,
  `schema.ts` unverändert. „Angenommen“ öffnet eine kompakte Eingabe
  (Kanal Pflicht, Zeitpunkt optional mit Default jetzt – Zukunft verboten,
  Notiz optional, Anhang optional als Verweis auf eine eigene nicht
  archivierte `available`-Datei; „unverprüft“ bleibt sichtbar, kein
  Scan-Versprechen, ohne Eventverknüpfung alle eigenen Dateien). Rückzug
  erhält die Annahmedaten unverändert lesbar (Regressionstest). Erweiterung
  der bestehenden Route/Prozedur (genau ein Lock/Version/Audit-Pfad),
  Projektion `include=offer` zeigt die Annahmedaten, Eventansicht zeigt
  Kanal/Zeitpunkt/Notiz/Anhang-Dateiname. Referenz ehrlich: Kanalwerte nur
  aus AG-06/08, Bookitup-Annahme-UI unbekannt, keine Rechtsaussage.
  Tests zuerst rot (≥16 Fälle inkl. Ungültigfällen, FK/CHECK 23514, Tenant,
  Version, unveränderte Übergangsmatrix/`state`-Verträge).
  Coding-Subagent: DeepSeek V4.1 Flash (gleiche Delegationsform), MiMo
  besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (Typfehler der fehlenden Details +
  Component-Suite 10/35 gegen den Altstand; ehrlich vermerkt: der
  Integrationslauf traf teilweise bereits gebauten Kern – als
  „Feature-fehlte“-Beleg dienen Typfehler und Component-Lauf), danach grün:
  `test:unit` 274/274, `test:component` 699/699 (7 neu), `test:integration`
  348/348 (12 neu: Kanal/Zeit/Notiz/Anhang, fünf ungültige Kanalwerte,
  Zukunfts-/Grenzzeitpunkte, Notizgrenzen, fremde/unbekannte/archivierte
  Anhang-ID, No-op vs. `acceptance_conflict`, Regression „Annahme → Rückzug →
  Daten bleiben lesbar“, vier DB-CHECKs + Fremdmandanten-FK, Routenverträge,
  Unveränderlichkeit von state/Nummer/Snapshot/PDF/Summen), `test:coverage`
  vollständig grün (Changed-Code 91,0% Zeilen/85,8% Zweige),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inkl. echter synthetischer
  Bibliotheksdatei (Anhang, Bytevergleich-Download), Annahmeformular ohne
  Schreibzugriff beim Öffnen, Rückzug lässt Annahme sichtbar. Impeccable-
  Finish-Detektor ohne Befund. Notiert: eine gespeicherte Annahme ist im UI
  nicht korrigierbar (409 bei Abweichung – ausdrücklicher Korrekturpfad als
  eigener späterer Slice); DB-CHECK erlaubt Annahmedaten auch bei
  `withdrawn` (Voraussetzung für den Regressionstest, Domäne unterscheidet);
  Anhang-Picker ohne Eventbezug listet alle eigenen Dateien (BKP020-Reste);
  `datetime-local` wird als Mandanten-Wandzeit gedeutet.

- [x] **BKP019.0 — `feat: track offer validity and status transitions`** (26.10.2026)

  Erster Unter-Slice von BKP019 (kommerzieller Dokumentablauf; Ticket verlangt
  zwingende Unterteilung) nach rein lesender DeepSeek-Analyse zu `27fb085`.
  Staleness-Befund: (0) ist nicht umgesetzt – `withdrawn` ist ein Enum ohne
  Schreiber, die Gültigkeit nur eine Tageszahl mit bei jedem Rendern neu
  berechneter Frist (gedruckte Frist verschiebt sich mit dem
  Finalisierungszeitpunkt, widerspricht AG-02). Neu: **zweite Statusachse**
  `offer_status` (sent/accepted/withdrawn) getrennt von `state`
  (Inhaltsreife draft|final|withdrawn); Migration `0039` mit `valid_until`
  (beim Finalisieren einmalig fixiert – heutige Drucksemantik eingefroren,
  danach bytegleiche PDFs über alle Statuswechsel), `status_changed_at`,
  Audit-CHECK-Erweiterung und datenerhaltendem Backfill (bestehende finale
  Angebote erhalten die heute gedruckte Frist, `offer_status` bleibt NULL =
  ehrlich „kein Anspruch“). „Abgelaufen“ wird in der Mandantenzeitzone
  abgeleitet (kein Worker, keine Schreibaktion). Explizite Übergänge:
  null→sent, null→withdrawn, sent→accepted, sent→withdrawn,
  accepted→withdrawn; `withdrawn` terminal (Kopie = neuer Datensatz);
  ungültige Übergänge 409, erneute identische Aktion idempotent ohne zweiten
  Audit, versioniert, nur für `kind='offer'`, Audit in derselben Transaktion.
  UI in EventDocuments: Statuszeile mit Fachstatus/„Gültig bis“/abgeleitetem
  „Abgelaufen“, Aktionen nur bei zulässigem Übergang, Bestätigung bei
  Zurückziehen. Der bestehende `state`-Vertrag bleibt unverändert
  (documents.test.ts:2396: `state=sent` bleibt 400). KEINE Automatik aus
  E-Mail/Druck, keine Annahme-/Versanddetails (kommen in (a)), keine
  Rechnungs-/Zahlungslogik, keine Rechts-/Steuerbehauptungen (Referenz: nur
  Spalten „Status“/„Frist“ belegt, Werte UNBEKANNT). Tests zuerst rot
  (Übergangsmatrix, DST-Grenze, bytegleiche PDF, CHECK-Verstoß, Backfill,
  UI). Coding-Subagent: DeepSeek V4.1 Flash (gleiche Delegationsform), MiMo
  besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (10/12 neue Integrationstests + 8/8
  Komponententests gegen per `git stash` zurückgesetzten Kern; ehrlich vermerkt:
  zwei reine DB-Tests waren migrationsabhängig schon grün, kein E2E-RED möglich
  ohne UI), danach grün: `test:unit` 274/274, `test:component` 692/692,
  `test:integration` 336/336 (vollständige Übergangsmatrix, verbotene
  Übergänge ohne Zustandsänderung, Idempotenz ohne zweiten Audit,
  Versionskonflikt, Tenant/Admin, `invalid_kind`, DB-CHECK 23514,
  DST-Grenze Europe/Berlin 2029-03-25, bytegleiche PDF über alle Wechsel,
  `state=sent` bleibt 400, Backfill gegen Vor-0039-Stand), `test:coverage`
  vollständig grün (1302 Tests; documents.ts 93,38% Statements,
  EventDocuments.tsx 95,95%; alle neuen Zeilen abgedeckt),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inkl. echtem Ablauf finalisieren →
  versendet → angenommen → zurückgezogen mit sichtbarer Frist und
  bytegleichem PDF. Notiert: `AuditAction`-Union ohne die neuen Aktionen –
  genau eine dokumentierte Typverengung an der Aufrufstelle,
  `appendAudit` bleibt einziger Audit-Schreibpfad (Folgeslice erweitert die
  Union); die neuen Spalten sind für Drizzle unsichtbar (schema.ts
  unverändert), die Achse erscheint nur über `include=offer`/die neue Route –
  bewusst, um alte Antwortformen schlüsselgleich zu halten; die globale
  Dateiliste zeigt weiterhin nur die Inhaltsreife (Frist-/Statusfilter folgen
  in BKP019-(e)); ein finales Angebot ohne Statusclaim liest nach Fristablauf
  „Abgelaufen“ (wortgetreue Regel); Bytegleichheit mit injiziertem Renderer
  belegt (nicht mit echtem Chromium-PDF).

- [x] **BKP020.1 — `feat: upload and download library files safely`** (26.10.2026)

  Erster vertikaler Unter-Slice von BKP020 (Datei- und Eventbibliothek) nach
  rein lesender DeepSeek-Analyse zu `3feceda`. Staleness-Befund: BKP016/017/018
  sind materiell über frühere Slices geliefert (Plan:941/:939/:937/:931,
  :929, :923–:842), BKP019/BKP020 sind unberührt; `FilesPanel` ist ein
  Dokumentindex über `documents`, keine Dateibibliothek. Neu: tenantgebundene
  Dateientität `library_files` (Migration `0038`): `display_name` nur als
  Daten (Schlüssel ausschließlich aus UUID + abgeleiteter Endung),
  `media_type` pdf/png/jpeg/zip mit serverseitiger Signaturprüfung
  (MIME-Spoofing → 415 ohne Zeile/Datei), `size_bytes`/`sha256`, einheitliche
  10-MiB-Grenze (exakt erlaubt, +1 → 413), `scan_state='not_scanned'`
  (KEIN Virenscan eingerichtet – ehrlich dokumentiert; Mail-Anhänge bleiben
  später davon abhängig), `state` available/archived/rejected (rejected wird
  nicht persistiert: abgewiesene Uploads = HTTP-Ergebnis + Audit). Upload
  transport über JSON+Base64 (strenge Validierung, Name bleibt aus URL/Logs),
  Download nur autorisiert mit `Content-Disposition: attachment`,
  `filename*`-Säuberung, `nosniff`, kein HTML/SVG im App-Origin; ZIP wird
  NIEMALS entpackt. UI `LibraryFiles.tsx` als EIGENE benannte Region neben
  `FilesPanel` im `#files`-Bereich (Testverträge auth.test.tsx:327 /
  auth.spec.ts:741 bleiben sonst rot; Listenantwort als Array wegen
  files.test.tsx:95 / auth-Stub), Upload-/Liste-/Download-/Archivweg mit
  getrennten Leer-/Lade-/Fehlerzuständen und sichtbarem „unverprüft“-Hinweis;
  `FilesPanel`-Untertitel künftig „Geschäftsdokumente“. Archivieren
  idempotent; KEINE Dedupe-Unique auf sha256. Nicht im Slice: Eventverknüpfung,
  Ersetzen/Versionierung, Kategorien, Mailanhangpicker, DA-07-Import,
  Retention, Virenscan. Referenz ehrlich: Bibliotheksaufbau unbekannt (B05
  belegt nur die Event-Kartengliederung). Tests zuerst rot (Ticketliste:
  Typen, Tenant/ID-Leak, MIME-Spoofing, Grenzgröße, ZIP nie entpackt,
  bösartige Namen, Storage-Fehler ohne available-Zeile, keine Doppelzeile,
  Downloadheader, idempotent-Archiv, UI-Zustände); Migration + Integrationstest
  im selben Slice. Coding-Subagent: DeepSeek V4.1 Flash (gleiche
  Delegationsform), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (Unit-/Component-Suites gegen fehlende Module;
  ehrlich vermerkt: der Integrationstest entstand zusammen mit dem Kern und
  wurde beim ersten echten Lauf von einem Testfehler bereinigt, kein
  Feature-Defekt), danach grün: `test:unit` 274/274 (9 neu),
  `test:component` 681/681 (12 neu; bestehende Verträge „genau ein Abruf“ /
  auth.test.tsx:327 unverändert grün), `test:integration` 324/324 (11 neu:
  vier Typen, Tenant/ID-Leak, MIME-Spoofing, exakt/+1 MiB, ZIP nie entpackt,
  bösartige Namen, Storage-Fehler ohne available-Zeile, requestId ohne
  Doppelzeile, Downloadheader, idempotent-Archiv, Auth/CSRF),
  `test:coverage` vollständig grün (library-files.ts 94,48% Zeilen/86,11%
  Zweige, LibraryFiles.tsx 99,23%/90,40% – Changed-Gate ≥85/80 erfüllt),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inkl. echtem Upload-/Download-/Archiv-
  Fluss mit Byte-Vergleich, Tastaturfokus, 320/1440 beiden Themes, axe
  0 Verstöße (ein anfänglicher `scrollable-region-focusable`-Befund der
  Tabelle wurde durch eine fokussierbare benannte Fläche behoben);
  Impeccable-Detektor ohne Befund. Notiert: Auditzeilen `file.*` werden
  direkt in der Transaktion geschrieben (Union in `appendAudit` ohne
  `file.*`, DB-CHECK sichert ab – späterer Refactor); Replay einer
  gespeicherten Upload-Antwort kann „available“ zeigen, obwohl die Datei
  später archiviert wurde (Idempotenzbeleg-Muster); Liste ohne
  Suche/Paginierung (Folgeslice bei Bedarf); eine notwendige Zusatzzeile in
  `tests/integration/identity.test.ts` (Migrationserwartung 0038) war als
  Überschreibung der Dateigrenze ehrlich gemeldet und reviewt.

- [x] **BKP014.2 — `feat: show assigned resources in event summaries`** (26.10.2026)

  Tatsächlicher offener Teil von BKP014 (BKP014.1 „scannbare Karten mit
  Datumsspalte“ ist bereits am 23.10.2026 erledigt – Plan:917; veraltete
  Statuszeilen werden bereinigt). Der Listenabruf `GET /api/v1/events` erhält
  eine **additive tenantgesicherte Projektion** (keine Migration): für alle
  gelisteten Event-IDs genau EINE Abfrage auf `reservations`
  (`hold`/`booked`-Zuordnungen; `blocked` hat immer `event_id null`) plus
  korreliertes `exists` für echte Konflikte (überschneidende `holds` derselben
  Einheit; `booked`/`blocked` sind per Exclusion-Constraint überlappungsfrei).
  Antwort-Schema wird erweitert (Zeilenschema hat `additionalProperties:false`),
  bestehende Felder bleiben unverändert. Kompakte Kartenzeile im Meta-Bereich
  (KEINE neue Desktop-Spalte): zugewiesene physische Boxen/Einheiten kompakt,
  ohne Zuordnung „Noch keine Ressource“, abgelaufene/archivierte Auskunft
  explizit markiert (kein stiller aktueller Schein), echte Konflikte nur mit
  textlicher Erklärung; Datum/Name/Ort, textlicher Status, nativer Hauptlink
  und Edit/Duplicate bleiben unverändert. KEINE Verfügbarkeitsaussage
  (Referenz unbekannt – EV-04/RE-12 sind Lastenheft-IDs, keine Beobachtung).
  Tests zuerst rot: 0/1/mehrere Einheiten, abgelaufener Hold, archivierte
  Einheit, echter Konflikt, Mandantentrennung, **genau eine Ressourcenabfrage
  je Listenabruf bei 1 und 50 Events** (kein N+1), bestehende Kartenverträge.
  Coding-Subagent: DeepSeek V4.1 Flash (gleiche Delegationsform), MiMo
  besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (4 Komponententests + Projektionsintegration +
  Ein-Statement-Nachweis + E2E-Erwartung gegen den Altstand; ehrlich vermerkt:
  Fixture-Aufbau brauchte Zwischenkorrekturen am echten App-Pfad, ein
  vorbestehend flaky `password.test.ts` (scrypt unter Last) fiel einmal aus
  und war isoliert/im Wiederholungslauf grün), danach grün: `test:component`
  669/669, `test:integration` 313/313 (Projektionsmatrix gegen echtes
  PostgreSQL inkl. Mandantentrennung/Drahtschema und GENAU einem
  `reservations`-Statement bei 1 und 50 Events), `test:unit` 265/265,
  `test:coverage` vollständig grün (events.ts 96,77% Statements/95,14%
  Zweige), `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inkl. Kartenzeilen „Noch keine Ressource“
  und echter Doppelzuweisung. Notiert: kein Index auf
  `(tenant_id, unit_id, starts_at, ends_at)` für die korrelierte
  Konfliktprüfung – bei gemessenen Größen unkritisch, bei sehr großen
  Beständen eigener migrationspflichtiger Slice; vom Worker gesweepte
  abgelaufene Vormerkungen erscheinen als „Noch keine Ressource“ (nie
  falsch-aktuell, aber ohne Historiehinweis); `.event-resources` erbt die
  Meta-Textgestaltung ohne eigene CSS-Regel (bewusst textlich).

- [x] **BKP013.2 — `fix: keep a created draft reachable when the files list cannot reload`** (26.10.2026)

  Tatsächlicher Rest von BKP013 (BKP013.1 ist bereits über `605f75b`
  abgeschlossen und live ausgeliefert – die älteren Statuszeilen in
  tasks-core/handoff waren veraltet). Das Ticketkriterium „Dokumenterfolg
  bleibt bei Neuladefehler sichtbar“ ist im Vorlagenpfad (Normalfall) nur
  halb erfüllt: `EventDocuments.tsx` setzt die bestätigte Zeile nur im Pfad
  „ohne Vorlage“ in die Liste ein; scheitert danach das Neuladen, verschwindet
  der gerade angelegte Entwurf aus der Ansicht. Behebung im bewährten
  Save-vs-GET-Muster: jede bestätigte Anlage (mit und ohne Vorlage) setzt die
  gespeicherte Zeile aus der Antwort lokal in die Liste; der GET-Fehler ist
  nur ein Reload-Problem mit GET-only-Wiederholung, kein blindes POST.
  Bestehende Vertragstests werden geschärft (GET-/POST-Mocks trennen, damit
  die Aussage echte Beweiskraft bekommt), E2E-Beweis im Dokumenten-Event-
  segment. Unverändert: atomare Status-/Ressourcenmutationen, die 13
  erfüllten BKP013-Kriterien, keine API-/Kernänderung. Bewusst offen und
  nicht in diesem Slice: Bereichs-Deep-Links (Referenz unbekannt),
  Notizbearbeitung in der Akte (dokumentierter Weg über das Eventformular),
  Kürzen der unteren Bereichsleiste. Coding-Subagent: DeepSeek V4.1 Flash
  (gleiche Delegationsform), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (5 Komponententests gegen den Altstand, darunter
  die Vorlagenanlage mit GET 500; zusätzlich beide E2E-Szenarien gegen den
  zurückgesetzten Stand gescheitert – echte Beweiskraft der zuvor blinden
  Mocks durch getrennte Fixtures hergestellt), danach grün: `test:component`
  665/665, `test:integration` 311/311, `test:unit` 265/265, `test:coverage`
  vollständig grün (EventDocuments 98,42% Zeilen/91,85% Zweige),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inklusive neuem Beweis (Vorlagenanlage →
  GET 503 → Entwurf „130,00 €“ sichtbar/bedienbar, genau ein POST, Retry nur
  GET, genau eine Zeile). Notiert: ersetzt ein erfolgreicher Reload die
  lokale Zeile nicht (z. B. Replikationsverzug), verschwindet sie wie zuvor –
  Altzustand, nicht neu; im Vorlagenpfad öffnet sich der Editor nach der
  Anlage nicht automatisch (bewusst unverändert).

- [x] **BKP015.10 — `feat: insert template placeholders from a picker`** (26.10.2026)

  Vorlagenrest II gemäß Übergabeprompt (Zusatzanforderung): verständlich
  auswählbare Platzhalter-Einfügewerkzeuge an den drei Textfeldern des
  Vorlagen-Editors (Betreff/Einleitung/Schluss). Zweistufiger Picker nach dem
  Hausmuster des Produktwählers (Umschalter mit `aria-expanded`, Auswahl mit
  Klartextbeschreibung je der acht AK-Tokens, Knopf „Einfügen“) – ausdrücklich
  **Nutzerwunsch**, keine belegte Bookitup-Funktion (Platzhalterwelt
  unbeobachtet). Einfügen an der Cursorposition (ohne Caret: ans Ende),
  Längenwächter gegen `maxLength`, Fokus zurück ins Feld; GENAU EINE
  Vorschau-Invalidierung pro Einfügen (Doppelfeuer leert die Warnung),
  bloße Auswahl im Picker verwirft keine gültige Vorschau, Dirty-Baseline
  bleibt DOM-basiert und wird nicht von Picker-Steuerung ausgelöst. Der
  statische Hilfsabsatz weicht den Pickern; die Aussage „nur in Betreff/
  Einleitung/Schluss“ bleibt. Drift-Schutz: die UI-Tokenliste wird exportiert
  und per Test gegen `templatePlaceholders` aus dem Kern geprüft (Test darf
  beide importieren). Markup außerhalb der Labels, damit `getByLabelText`-
  Verträge gültig bleiben; kein neues `role="status"`, Editor-Startfokus
  unverändert. Tests zuerst rot (zehn Fälle inkl. genau-einer-Invalidierung,
  Längenwächter, Zugänglichkeit/Escape, Drift), kompakter E2E-Beweis
  (Einfügen → Vorschau verworfen → Speichern mit Token). Nicht im Slice:
  Angebotsentwurfs-Editor, Positionsbeschreibungen (Tokens bleiben dort
  wörtlich), Fehlformen wie `{{contact-name}}`, Kern-/APIänderung.
  Coding-Subagent: DeepSeek V4.1 Flash (gleiche Delegationsform), MiMo
  besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (10 Tests gegen den Altstand; nach der
  Implementierung zusätzlich ein echter Vertragsbruch der statischen
  Tokenlisten-Assertion bewusst auf die neue Aussage umgestellt – „Editor
  erklärt die Platzhalter“ bleibt), danach grün: `test:component` 658/658
  (Vorlagendatei 95 Tests), `test:integration` 311/311, `test:unit` 265/265,
  `test:coverage` vollständig grün (DocumentTemplatesPanel 96,25% Zeilen),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 16/16 inklusive Chromium-Fall (Auswahl allein
  lässt Vorschau stehen, Einfügen verwirft sie genau einmal, Caret-/Fokus-
  verhalten, Tastaturpfad, PUT-Nutzlast mit Token, keine unerwarteten
  Schreibzugriffe). Drift-Test sichert die UI-Tokenliste gegen den Kern ab;
  eine additive CSS-Regel nutzt die Formularzeile des Feldes (explizit
  gemeldet). Notiert: Passt ein vollständiger Platzhalter nicht ins
  Restlimit, wird gar nicht eingefügt (kein halbes Token im Kunden-PDF),
  Feldwert bleibt erhalten – bewusste Lesart des Längenwächters.

- [x] **BKP015.9 — `feat: filter document templates by search, kind and archive`** (26.10.2026)

  Vorlagenrest I gemäß Übergabeprompt (Zusatzanforderung): kompakte
  Werkzeugleiste über den gruppierten Vorlagen mit Suche über den Vorlagennamen,
  Art-Auswahl („Alle Dokumentarten“ + fünf Gruppenlabels + „Weitere
  Dokumentarten“ als Bucket unbekannter Arten) und Zustandsauswahl
  (Alle/Aktiv/Inaktiv/Archiviert). Ausdrücklich **Nutzerwunsch**, keine belegte
  Bookitup-Funktion (B35 sah auf der untersuchten Desktopansicht keine Filter).
  Clientseitig über die geladene Liste, `GET` bleibt querylos; Gruppierung
  entsteht aus der gefilterten Menge (nur befüllte Gruppen, Bucket bleibt
  auffindbar); zwei getrennte Leerzustände („Noch keine Vorlagen“ vs.
  „Keine Treffer“ + „Filter zurücksetzen“); Zeilentext trägt additiv
  „ – Inaktiv“. Filtererhalt über Editieren/Vorschau/Archivieren ist Pflicht;
  Fokus-Fallback, wenn die bearbeitete Zeile weggefiltert wird. Unverändert:
  „Vorlage anlegen“ (inkl. Tier-Klasse), ruhige Aktionen (höchstens eine
  Offenlegung), Editor nur auf Aufruf, Vorschau mit Verwerfen alter Antworten,
  sichere Speicher-/Archiv-/Versionsverträge, UUID-Auftragsbeleg,
  eingefrorene Drafts. Tests zuerst rot (Toolbar/Filter/Leerzustände/
  Filtererhalt/Fokus-Fallback/„GET ohne Query“), bestehende Zeilentext- und
  Aktionsverträge bewusst mitgezogen. Kompakte E2E-Abnahme
  320/390/1280 × light/dark der gefilterten Liste mit axe.
  Nicht im Slice: Platzhalter-Einfügewerkzeuge (eigener Folgeslice),
  API-/Coreänderung. Coding-Subagent: DeepSeek V4.1 Flash (gleiche
  Delegationsform), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (11 Tests gegen den Altstand, Fehlertexte je
  fehlender Toolbar; ehrlich vermerkt: ein Vorschau-Test brauchte zusätzlich
  den vorhandenen `URL.createObjectURL`-Stub der jsdom-Lücke wegen, kein
  Produktfehler), danach grün: `test:component` 648/648 (Vorlagendatei 85/85),
  `test:integration` 311/311, `test:unit` 265/265, `test:coverage` vollständig
  grün (DocumentTemplatesPanel 96,76% Zeilen/89,80% Zweige),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 15/15 inklusive neuem Filtersegment mit
  320/390/1280 × light/dark (sechs Screenshots, Überlaufprüfungen, axe
  `#document-templates` 0 Verstöße, keine API-Schreibzugriffe). Bestehende
  Zeilen-/Aktions-/Fokusverträge blieben ohne Abschwächung grün. Notiert:
  Suche nur über `name` (kein Textinhalt), kein GET mit Query, keine
  Reload-Persistenz; `.resource-toolbar` genügte ohne CSS-Ergänzung.

- [x] **BKP012.2 — `feat: choose the main contact through the picker in the event editor`** (26.10.2026)

  Zweiter Unter-Slice von BKP012: der Hauptkontakt im Event-Editor (Bearbeiten)
  wird wie im Anlege-Dialog über den suchbaren Picker gewählt. Der Picker wird
  dafür aus `EventCreateDialog.tsx` in eine gemeinsame `ContactPicker.tsx`
  extrahiert (`useContactSearch()` mit Sequenzschutz, Trefferliste, 20er-Schnitt);
  der Anlege-Dialog wird umgestellt und muss verhaltenstreu bleiben. Label
  „Hauptkontakt“ bleibt, „Kunde entfernen“ setzt auf „Noch offen“
  (`primaryContactId: null`); archivierte historische Zuordnung bleibt lesbar
  und wird unverändert mitgesendet, ist aber nicht erneut wählbar; der
  Ausschlussvertrag Hauptkontakt ↔ „Weitere Kontakte“ bleibt unverändert
  (Weiterer Multi-Select, kein Picker). „Neuen Kunden anlegen“ wechselt
  INNERHALB des Editors auf die `inline`-Variante des gemeinsamen
  `ContactDialog` (keine zweite Dialogebene, kein zweiter Validator); das
  Event-Formular bleibt gemountet, Datum/Art/Angaben-Eingaben bleiben über den
  Ansichtswechsel erhalten; Auswahl aus der bestätigten POST-Antwort inkl.
  lokaler Zusammenführung in die Auswahlliste, Abbruch/POST-Fehler ohne
  Entwurfsverlust; Enter im Suchfeld speichert das Event nicht;
  `view`-Reset beim Öffnen/Schließen/Abbrechen. 409/`version`/Busy-/Fokus-
  Verträge des Editors unverändert. Tests zuerst rot (13 Fälle laut
  Auftrag: Suche+Entwurfserhalt, Enter, Ausschluss, Archiv lesbar/nicht
  wählbar, Abbruch, POST-Fehler, POST ok + GET-Fehler, keine Doppelanlage,
  409, kontaktlos, vertauschte Antworten, „Kunde entfernen“, keine zweite
  Dialogebene); geteilte Vertragstests (events.test.tsx ~:1099/:2632,
  auth.spec.ts ~:4032–4091) bewusst mitgezogen, Aussagen erhalten.
  Nicht im Slice: „Weitere Kontakte“ als Picker, Panel-Refresh nach Anlage,
  `registerUnsavedChanges`-Registrierung des Event-Editors (eigener
  Folgeslice), Datenmodell-/APIänderung. Referenz: nur B30 belegt; Editor-
  Picker-Details sind vorsichtige Vereinfachungen. Coding-Subagent: DeepSeek
  V4.1 Flash (gleiche Delegationsform), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (14 Tests gegen den Altstand; nach dem ersten
  Implementierungsschritt blieben drei Verhaltensnachweise rot, darunter ein
  echter Produktfehler – frisch angelegte Kontakte verschwanden nach einem
  Hauptkontaktwechsel aus „Weitere Kontakte“, behoben über eine eigene
  Sichtungsliste – sowie zwei Fixture-Korrekturen), danach grün:
  `test:component` 637/637 (Anlege-Dialog 29/29 verhaltenstreu),
  `test:integration` 311/311, `test:unit` 265/265, `test:coverage` vollständig
  grün (ContactPicker 91,48% Statements, EventPanel 94,83%),
  `test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E
  auth+template-product-price 14/14 mit zwei neuen axe-Audits der
  Editor-Kontaktansicht (0 Verstöße) und Nachtragsabnahme 320/390/1280 ×
  light/dark der geöffneten Inline-Kontaktansicht (sechs Screenshots,
  Überlauf-/Beschnittprüfungen aller Bedienelemente, axe bei 320 px 0
  Verstöße; ehrlich gemeldet: zwei axe-„incomplete“-Stellen der Shell bzw.
  ein Icon-Button-Label, keine Verstöße). Notiert: der Picker teilt `value`
  (zu sendende ID) und `selected` (aufgelöste Zeile), damit eine gespeicherte,
  nicht mehr gelistete Zuordnung beim Speichern nicht still auf `null` wird;
  der Editor registriert weiterhin keinen globalen Dirty-Check (eigener
  Folgeslice); Leerzustand nennt jetzt konsistent „Kein Kunde ausgewählt“.

- [x] **BKP012.1 — `feat: select or create contacts within the event flow`** (26.10.2026)

  Erster Unter-Slice von BKP012 (Kontaktpicker im Event) nach rein lesender
  DeepSeek-Quellanalyse zu `57183a4`. Nur der Event-Anlege-Dialog: die bisherige
  Volllisten-Auswahl `Kunde` wird ein suchbarer Picker gemäß B30
  („Kundensuche/neuen Kunden anbieten“) über die vorhandene Suche
  `GET /api/v1/contacts?q=…` mit Sequenzschutz (verspätete/vertauschte
  Antworten werden verworfen), Trefferliste mit Name und Firma/Ansprechpartner,
  begrenzte sichtbare Trefferzahl. Bewusste Inline-Anlage als Ansichtswechsel
  INNERHALB derselben Dialogbox (keine zweite Dialogebene): das Eventformular
  bleibt gemountet und damit Datum/Art/Angaben-Entwurf erhalten; das
  Kontaktanlageformular wird aus `ContactPanel` als gemeinsame `ContactDialog.tsx`
  extrahiert (idPrefix-Muster) und nutzt weiterhin den EINEN vorhandenen
  Validator (Client-Pflichtfelder/Längen + serverseitige `contactFields`;
  KEIN zweiter Validator). Erst der tatsächlich bestätigt gespeicherte Kontakt
  (Auswahl aus der POST-Antwort, nicht aus einem Listenrefresh) wird im Event
  ausgewählt; Abbruch/Fehler lassen den Evententwurf unberührt, kein heimliches
  Gemeinschaftsspeichern von Event und Kontakt. Kontaktlose Events bleiben
  möglich; historische archivierte Zuordnungen bleiben lesbar, werden aber nicht
  als neue Auswahl angeboten (bestehende Filterlogik unverändert). Tests zuerst
  rot: vertauschte langsame Suchantworten, kein Treffer, abgebrochene Anlage,
  Kontakt-POST-Fehler, bestätigter Kontakt mit anschließendem GET-Fehler
  (Auswahl bleibt), keine Doppelanlage, Fokus/Dirty/Zurück; dazu
  Vertragsanpassungen (event-create, action-hierarchy, ui-language, auth.spec).
  Nicht in diesem Slice: Editor/Hauptkontakt-Bearbeitung des Events (eigener
  Folgeslice BKP012.2), Dublettenblockade-Neuerungen, Datenmodelländerung.
  Referenzgrenzen: nur B30 ist belegt (Suche + Neuanlage-Auswahl); Picker-/
  Dialogdetails sind bewusste vorsichtige Vereinfachungen, keine Bookitup-
  Nachbauten. Coding-Subagent: DeepSeek V4.1 Flash (gleiche Delegationsform),
  MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (12 Tests gegen den Altstand, u. a. fehlende
  „Kunde suchen“-Oberfläche; ehrlich vermerkt: zwei Vertragstests in
  `events.test.tsx` mussten außerhalb der Freigabeliste mitgezogen werden, da
  sie die entfernte Volllisten-Auswahl bedienten – Aussagen unverändert),
  danach grün: `test:component` 624/624, `test:integration` 311/311,
  `test:unit` 265/265, `test:coverage` vollständig grün (ContactDialog 97,39%
  Zeilen, EventCreateDialog 97,14%), `test:workspace`/`test:docs`/schnelle
  Gates/Build grün; E2E auth+template-product-price 14/14 mit realen
  Picker-/Inline-Pfaden, „nur eine Dialogbox“-Prüfung, Entwurfserhalt und zwei
  neuen axe-Audits (0 Verstöße). Der neue Audit deckte wie schon in BKP011.1
  einen bestehenden `heading-order`-Befund in den Dialogtiteln auf (h3 unter
  Seiten-h1); Dialogtitel sind jetzt h2 samt angeglichenem CSS-Selektor.
  Notiert: Picker ohne Pfeiltasten-Listbox (normale Schaltflächen, vollständig
  tastaturbedienbar); nach Inline-Anlage lädt die Panelliste erst nach
  Eventspeichern neu (bewusst, GET-Fehlerpfad bleibt außerhalb der Auswahl);
  Panel-Texte des Kontakt-Dialogs unverändert.

- [x] **BKP011.1 — `feat: show contact details and related events`** (26.10.2026)

  Erster Unter-Slice von BKP011 (Kontakt-Details, rein lesende Akte) nach rein
  lesender DeepSeek-Quellanalyse zu `e2b5646`. Der Kontaktname wird ein nativer
  Link (`#contact-<id>`, bestehende Route bleibt der Vertrag) auf eine lesende
  Detailansicht, die inline in der Zeile aufklappt (Zeilenzusammenfassung solange
  verborgen): Kopf mit Typ (Privat/Firma), Name/Firma und deutlichem
  Archivzustand; Kontaktweg (Ansprechpartner, Mail, Telefon – sichtbarer Text
  bleibt der gespeicherte Wert, `mailto:`/`tel:` korrekt escaped); Anschrift
  vollständig mit Land als verständlicher Bezeichnung (`Intl.DisplayNames`,
  Fallback auf gespeicherten ISO-Code; gespeicherter Wert bleibt unverändert);
  zugehörige Events aus der vorhandenen tenantgesicherten Projektion
  `GET /api/v1/contacts/:id/events` (Name, Datum bzw. „Ohne Datum“, Status;
  kein N+1, keine alle-Kunden-Abfrage, keine Notizeninhalte). Fehlende Werte
  ehrlich leer statt erfunden; unvollständige Anschrift wird als solche
  gezeigt. Genau eine sekundäre Bearbeiten-Aktion (öffnet den vorhandenen
  Dialog mit dessen unveränderten Dirty-/409-/Fokusverträgen) und eine
  tertiäre Schließen-Aktion; Schließen gibt `#contacts` frei und stellt
  Suche/Scroll/Fokus wieder her (Suche bleibt lokaler Panel-Zustand). Der
  bisherige panelweite „Events anzeigen“-Pfad (Zeilenaktion + Block unter der
  Liste) wird ersetzt; keine funktionslosen Mail-/Datei-Tabs, keine
  Geburtstags-/Gruppen-/Partnerfelder, keine Namensaufspaltung, keine
  automatische Dublettenzusammenführung, keine API-/Migrationsänderung.
  Tests zuerst rot: kein Event/mehrere Events, Firma mit Ansprechpartner,
  archiviert, fremder Tenant (fehlender Projektionstest in
  `tests/integration/events.test.ts` ergänzen), lange fiktive Werte, fehlende
  Anschrift/leere optionale Werte, Back/Reload/Dirty/409 über den Dialog,
  Escape in mailto/tel-Attributen. Geteilte Vertragstests bewusst mitgezogen
  (contacts.test.tsx, action-hierarchy Kontaktvertrag, ui-language H1/H2,
  auth.spec.ts-Kontaktflüsse). Neu eigene Dateien: `contact-links.ts`,
  `ContactDetails.tsx`, `tests/unit/contact-links.test.ts`,
  `tests/component/contact-details.test.tsx`. Coding-Subagent: DeepSeek
  V4.1 Flash (gleiche Delegationsform), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (15 neue Akten-Tests + umgestellte Verträge, u. a.
  fehlender Name-Link und überencodiertes `mailto:`; ehrlich vermerkt: der
  Tenant-Isolationstest ist ein Regressionsbeweis bestehender Absicherung, sein
  erstes Rot kam aus der Fixture-Reihenfolge), danach grün: `test:component`
  614/614, `test:integration` 311/311, `test:unit` 265/265, `test:coverage`
  vollständig grün (contact-links 100% Zeilen, ContactDetails 97,43%,
  ContactPanel 97,33%), `test:workspace`/`test:docs`/schnelle Gates/Build grün;
  E2E auth+template-product-price 14/14 mit neuer Akten-Matrix 320/390/1280 ×
  light/dark (sechs Screenshots, Overflow-/Umbruch-/Kollisionsprüfungen) und
  axe je Kombination 0 Verstöße. Die Abnahme-Prüfung deckte einen echten
  a11y-Defekt auf (axe `heading-order`: Akte mit `h3` unter Seiten-`h1`);
  behoben auf `h2`/`h3` analog EventDetails, mit anschließend angeglichenen
  CSS-Selektoren und echten Stil-Nachweisen (Titel 19,2 px,
  `overflow-wrap: anywhere`, Scroll-Offset 96 px, gemessen in Chromium bei
  320/390/1280 in beiden Themes). Notiert: Langnamen-Umbruch ist im CI über die
  Component-Assertion mit angewandtem Stylesheet belegt, in Chromium über eine
  einmalige Messung (190 Zeichen); px-Werte der Typo-Skala sind bewusst in
  einer Test-Assertion verankert. Keine API-/Migrationsänderung.

- [x] **BKP010.2 — `feat: disclose rare product row actions and archive safely`** (26.10.2026)

  Zweiter Unter-Slice von BKP010: „Bearbeiten: <Name>“ bleibt direkt an der
  Produktzeile; „Duplizieren“ und die neue Archivaktion „Archivieren: <Name>“
  erscheinen hinter einer benannten kompakten Offenlegung pro Zeile (BKP015.7-
  Vertrag: höchstens eine offen, Escape/Tab/Outside schließen, sichtbare
  Fokusrückkehr an den Auslöser). Archivieren setzt über den vorhandenen
  PUT-Vertrag mit `version` den Zustand `archived`; Busy/Doppelklickschutz und
  Versionskonflikt verständlich, Reaktivierung weiter über Bearbeiten möglich.
  Kein Löschen, keine API-/Migrationsänderung. Nachweis im Slice: bestehende
  Dokumentpositionen/-summen bleiben durch Archivieren unverändert
  (Integrationstest) und die Zeile aktualisiert nur ihre Anzeige
  (Komponententest). Tests zuerst rot (Offenlegung zu/anfangs, höchstens eine
  offen, Fokus/Escape/Outside, Archivpfad inkl. 409/Busy/Doppelklick,
  Dokument-Unverändertheit, Regression Duplizieren = eigener Datensatz).
  Coding-Subagent: DeepSeek V4.1 Flash; MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: rot beobachtet (7 Tests, fehlender Auslöser „Weitere Aktionen
  für <Name>“; ehrlich vermerkt: Fokus-nach-Filter-Test erst nach Implementierung
  ergänzt, Dokument-Unverändertheit ist ein Charakterisierungsnachweis für
  bestehendes DB-Verhalten ohne künstliches Rot, E2E-Schritt nur grün verifiziert),
  danach grün: `test:component` 599/599, `test:integration` 310/310
  (inkl. neuem Nachweis: finalisierte Dokumentzeilen/-summen/Snapshot-Hash
  byte-identisch nach Produktarchivierung), `test:coverage` vollständig grün,
  `test:unit` 260, `test:workspace`/`test:docs`/schnelle Gates/Build grün;
  E2E auth+template-product-price 14/14 inklusive Overflow-/Theme-Zusagen.
  Notiert: die Aktionsgruppe ist ohne eigene CSS-Klasse inline umgesetzt
  (styles.css war nicht im Slice); Archivieren aktualisiert nur die Zeile aus
  der PUT-Antwort, unplausible Antworten werden als „Archivierungsstand
  unklar“ abgewiesen.

- [x] **BKP010.1 — `feat: make product management compact and list-first`** (26.10.2026)

  Erster Unter-Slice von BKP010 (Produkte, UI-Slice ohne Domainänderung) nach
  rein lesender DeepSeek-Quellanalyse zu `99e9eac`. Liste zuerst: Produktformular
  nur noch im Dialog (Anlegen/Bearbeiten/Duplikat – Duplizieren öffnet „… (Kopie)“-
  Entwurf als eigenen Datensatz, `state` wird 1:1 mitkopiert), kompakte
  Werkzeugleiste mit clientseitiger Suche über Name/Beschreibung/Einheit und
  Zustandsauswahl; `GET /api/v1/products` bleibt querylos (vorhandener
  Testvertrag), Sortierung unverändert servers. Zeile zeigt Preis mit deutlicher
  Preisbasis (Netto/Brutto), Steuer, Einheit und Zustand. Dialogverträge wie
  BKP009.1: Fokusfalle/Escape/Fokusrückkehr, Dirtyschutz über
  `unsaved-changes`, Doppelklick-Guard, Dialog bleibt während Busy offen,
  Filterzustand über Öffnen/Schließen/Speichern erhalten. Deutscher Dezimaltext
  ausschließlich über `decimal.ts`-Helper (Regex/BigInt), kein `parseFloat*100`;
  Feldvertrag und Defaults (Stück/0/brutto/1900 bp) unverändert. Ehrliche
  Save-vs-GET-Trennung (heutiger Defekt: bestätigtes Speichern mit
  fehlgeschlagenem Nachladen wird als Verbindungsfehler gemeldet und erneutes
  Speichern könnte duplizieren): Erfolg wird zuerst gemeldet, Nachladen nur per
  GET wiederholt; unklarer Ausgang sperrt erneutes Speichern mit verständlichem
  Hinweis, KEIN zweiter POST, keine Idempotenz behauptet (die ist möglicher
  vertikaler Folgeslice BKP010.3 mit Backend-Auftragsbeleg analog
  Vorlagen-Idempotenz). Ungültige Dezimalwerte feldbezogen getrennt
  (Nachkommastellen vs. zu groß) ohne POST; 409 behält Eingaben mit Fokus.
  Geteilte Vertragstests bewusst mitgezogen: Produktvertrag in
  `action-hierarchy.test.tsx`, Produktsegment in `ui-language.test.tsx` und
  Produktabläufe in `tests/e2e/auth.spec.ts` inklusive kompakter
  320/390/1280-×-Theme-Prüfung der Produktfläche. Nicht dabei (eigene
  Folgeslices): Archiv-Zeilenaktion mit Nachweis unveränderter historischer
  Dokumente (BKP010.2), Backend-Idempotenz (BKP010.3), Mengen/Rabatt/
  Ressourcenfelder, Format-Vereinheitlichung, API-/Migrationsänderung.
  Coding-Subagent: DeepSeek V4.1 Flash (gleiche Delegationsform), MiMo besitzt
  Plan/Docs und reviewt.
  Abgenommen: zuerst rot beobachtet (13 Tests gegen den Altstand, darunter
  Liste/Dialog/Suche/Filter/Leerzustand; ehrlich vermerkt: zwei Tests erst nach
  der ersten Grünrunde ergänzt, Vertragstest-Anpassungen nicht separat rot),
  danach grün: `test:component` 592/592, `test:coverage` vollständig grün
  (ProductPanel 98,19% Zeilen/90,90% Zweige), `test:unit` 260,
  `test:workspace`/`test:docs` grün, schnelle Gates/Build grün; E2E auth beide
  Modi plus template-product-price vollständig grün (14 Tests) mit
  320/390/1280-×-Theme-Matrix der Produktfläche (sechs Screenshots) und
  Entwurfserhalt über Hash-/History-Wechsel ohne API-Lesefläche. Nicht
  abgedeckte Zweige in ProductPanel (Antwort-JSON unlesbar, GET-Wiederholung
  nach unklarem Ausgang scheitert, Warnung bei gesperrtem Speichern mit
  geschlossenem Dialog) sind implementiert, aber nur review-belegt.

- [x] **BKP009.2 — `feat: open temporary resource blocks on demand`** (26.10.2026)

  Zweiter Unter-Slice von BKP009: die seltene Sperrverwaltung „Zeitweise
  Ressourcensperren“ wird bewusst geöffnet statt dauerhaft aufgeklappt. Benannte
  native Offenlegung (`<details>/<summary>`, sichtbares Zustandslabel „Sperrverwaltung
  öffnen/schließen“) um Erklärungsabsatz, Sperrformular, Leerhinweis und Sperrliste;
  `h2`, Statusmeldung, Reload-Warnung samt „Sperrliste erneut laden“, „Sperren
  aktualisieren“ und Ladehinweis bleiben außerhalb sichtbar. Inhalt wird nur im
  offenen Zustand gerendert (jsdom bildet geschlossene `<details>` nicht ab —
  bedingtes Rendern hält „nicht im Tabpfad“ ehrlich prüfbar). Unverändert: die
  komplette Sperrübersicht mit allen Zeilenaktionen (Zeiten übernehmen, Freigeben),
  Formular-/Entwurfs-/Idempotenzverträge (requestId, draftKey, prefill), DST-/Zeit-
  logik und alle API-/Datenbankverträge. Entwurf beim Zuklappen verlangt bewusstes
  Verwerfen, unberührtes Formular schließt ohne Rückfrage, während laufender Mutation
  kein Zuklappen; Schließen gibt den Fokus an das Summary, „Zeiten übernehmen“ öffnet
  die Offenlegung mit. Kein Refetch beim Öffnen/Schließen; der Offen-/Zustand überlebt
  Filter-, Dialog- und Hash-Wechsel (Panel bleibt gemountet), ohne Reload-Persistenz.
  Gleichzeitig wird die notierte Zählempfindlichkeit bereinigt: die Vertragstests
  liefern gültige fiktive Blockdaten statt eines kaputten Stubs, sodass „eine
  Primäraktion pro Rahmen“ strukturell gilt (zu = nur „Ressource anlegen“, offen =
  Sperrformular-Frame mit „Zeitraum sperren“). Tests zuerst rot (Disclosure-Haupttest
  plus zehn Negativfälle: Entwurf/Bestätigung, unberührt, busy, Wiederöffnung,
  Übernahme, Tastatur/kein Escape-Schließen, kein Refetch, Zustandswechsel,
  Fehlerpfad, leere Liste), E2E-Sperrablauf öffnet die Offenlegung, Overflow/Theme-
  Schleife läuft in beiden Zuständen, zusätzlicher axe-Lauf mit offener Sperrverwaltung.
  Keine Sperrenfilter/-zählung, kein Listenumbau, keine API-/Migrationsänderung,
  keine Persistenz über Reload. Coding-Subagent: DeepSeek V4.1 Flash (gleiche
  Delegationsform wie BKP009.1), MiMo besitzt Plan/Docs und reviewt.
  Abgenommen: zuerst rot beobachtet (35 Tests gegen den Altstand via
  `git stash`-Vergleich, darunter Haupttest und alle zehn Negativfälle sowie
  drei Rahmenvertragstests mit gültigen Blockdaten), danach grün:
  `test:component` 580/580, `test:coverage` vollständig grün (ResourceBlocks
  99,35% Statements/97,29% Zweige), `test:unit` 260, `test:workspace`/`test:docs`
  grün, schnelle Gates/Build grün; auth-E2E beide Modi komplett grün mit
  Tastaturbeweis (Enter/Space öffnen/schließen, kein Escape-Schließen),
  axe-Lauf mit offener Sperrverwaltung (0 Befunde) und Layout-/Theme-Matrix in
  beiden Offen-Zuständen (16 Screenshots). Bewusste Abweichung: das
  Disclosure-Element rendert erst mit geladenen Daten (kein toter Aufklapp-
  Punkt im Fehlerfall; Fehlerpfad bleibt ohne Öffnen sichtbar). Notiert:
  Übernahme gespeicherter Zeiten markiert den Entwurf als ungespeichert,
  bestätigtes Speichern löscht die Entwurfsmarkierung.

- [x] **BKP009.1 — `feat: make resource management list-first with explicit editing`** (26.10.2026)

  Erster vollständiger Unter-Slice von BKP009 (Ressourcen, UI-Slice ohne Domainänderung),
  geschnitten gemäß rein lesender DeepSeek-Quellanalyse zu `bc8f888` (Bericht privat im
  Scratch, keine Repo-Datei verändert). Liste zuerst: normale Bestandsliste sofort
  sichtbar, kompakte Werkzeugleiste mit Suche (Name/Code/Kategorie, clientseitig über
  die bereits vollständig geladene Liste), Kategorieauswahl aus tatsächlich
  vorkommenden Kategorien und Archiv-/Zustandsauswahl für aktive/inaktive/archivierte
  Einträge. Anlage über „Ressource anlegen“, Bearbeiten über die Zeile: beide öffnen
  bewusst denselben accessiblen Dialog (role=dialog/aria-modal, Fokusfalle, Escape/
  Abbruch, Fokusrückkehr auf den Auslöser, ersatzweise Plus wenn die Zeile verschwand).
  Formular initial nicht im Tabpfad. Dirtyschutz über vorhandenes
  `unsaved-changes`-Muster (unverändert schließt ohne Rückfrage, geänderter Entwurf
  verlangt bewusstes Verwerfen); Speichern hält den Dialog bis zur bestätigten
  Mutation, Doppelklick sendet genau eine Mutation. Fehlerverträge: 409 `conflict`
  behält Eingaben mit Fokussierung der Meldung, `code_exists` erhält eigenen Text
  (bisher generisch), `resource_in_use`/Netzwerkfehler unverändert verständlich;
  bestätigtes Speichern mit fehlgeschlagenem Nachladen wird ehrlich als gespeichert
  gemeldet mit GET-Wiederholung (Muster ResourceBlocks/contacts), kein blindes POST.
  Leerzustände „Noch keine Ressourcen“ und „Keine Treffer“ getrennt, Ladezustand.
  Filterzustand bleibt über Dialog-Öffnen/Schließen/Speichern erhalten.
  Unverändert: Feldvertrag (Name 1–120, Code 1–40, Kategorie 1–120 Freitext,
  Beschreibung ≤2000, Bestand 0–10000 Default 1, Puffer je 0–365 Default 2/2,
  Sortierung 0–9999, Zustand/Gesperrt, `version`), API/GET-POST-PUT, physische
  Einheiten und DB-Reservierungsschutz. Sperrverwaltung (`ResourceBlocks`) bleibt
  unverändert eingehängt erreichbar; ihr bewusstes Öffnen ist BKP009.2.
  Geteilte Vertragstests bewusst mitgezogen (ein Besitzer): Ressourcen-Primäraktions-
  vertrag in `action-hierarchy.test.tsx` und Ressourcensegment in `tests/e2e/auth.spec.ts`.
  Tests zuerst rot beobachtet (Liste-zuerst/Dialog/Dirty/Doppelklick/409/Filter/Leer),
  dann implementiert. Keine Sperrverwaltungs-Offenlegung, Sets/Bedarfsautomatik,
  Einheitenlogik, Kategoriemigration, Server-Defaults, API-Änderungen oder neues
  Designsystem. Coding-Subagent: DeepSeek V4.1 Flash über die Hermes-CLI
  (`hermes -z … -m deepseek-v4.1-flash --provider opencode-go`), getrennte
  Dateizuständigkeiten, MiMo reviewt vollständigen Diff und integriert.
  Abgenommen: zuerst rot beobachtet (13 neue/umgestellte Komponententests plus
  drei fremde Vertragsstellen), danach grün: `test:component` 568/568,
  `test:coverage` vollständig grün (1137 Tests; ResourcePanel 100% Zeilen/
  92,06% Zweige), `test:unit` 260, `test:workspace` 20, `test:docs` grün,
  schnelle Gates/Build grün; auth-E2E beide Modi komplett grün inklusive
  Ressourcenablauf und neuer 320/390/768/1280-×-Theme-Schleife mit acht
  Screenshots (tests/test-results, gitignored). Offen für BKP009.2:
  bewusstes Öffnen der Sperrverwaltung sowie die im A1-Vertragstest notierte
  Zählempfindlichkeit des Sperrformulars (Stub ohne gültige Blockdaten).

- [x] **H055 — `docs: prepare current Hermes parity goal`** (26.10.2026)

  Nach BKP015.7/.8 tatsächlichen Abschlussstand, Tests, offenen CI-/Liefernachweis
  und nächste priorisierte Ressourcen-/Produkt-/Kontaktwelle im dauerhaften Goal-
  Prompt aktualisieren. Alte BKP001-Einstiegsanweisung ersetzen. MiMo-Koordination,
  DeepSeek-Coding mit getrennten Dateien, Skills/Geltungsgrenzen, Referenzlücken,
  Abnahme und Datenschutz/Betriebsgrenzen eigenständig verständlich festhalten.
  Unabhängiger Luna-Dokumentenreview und Dokumentationsgates, expliziter Commit/
  sofortiger Push. Computer-Use-Übergabe/Modell-/Arbeitsstart anschließend wirklich
  prüfen; dieser vorbereitende Dokumentationscommit behauptet keinen Start.
  Einmalige Codex-Automation nach Übergabe oder dokumentiertem Blocker löschen.

- [x] **BKP015.8 — `feat: preview document templates with synthetic data`** (26.10.2026)

  Ein vertikaler Slice für eine ausdrücklich fiktive Inhaltsvorschau des offenen,
  ungespeicherten Vorlagenentwurfs. Bestehende Vorlagenvalidierung und exakten
  Preis-/Steuerregeln wiederverwenden; serverseitig acht unterstützte Platzhalter,
  feste Beispieldaten/-datum und neutrales fiktives Briefpapier ohne gespeichertes
  Logo durch denselben HTML-/PDF-Renderer wie echte Dokumente rendern. Gleiche
  Eingaben erzeugen gleiche Beispielinhalte/HTML; keine Garantie identischer
  PDF-Metadatenbytes. Authentifizierter, CSRF-geschützter strikter POST-Preview-
  Vertrag, PDF/no-store, neutrale Fehler; nur Autorisierung lesen, weder Nummern
  noch Dokumente, Vorlagen, Audit oder Dateien schreiben. Keine Migration.
  Im vorhandenen Inline-Editor eine sekundäre Vorschauaktion und nach Prüfung
  der PDF-Antwort ein bewusst betätigbarer Downloadlink. Kein Speichern, Öffnen
  eines Popups oder Dirty-Reset durch Vorschau. Veraltete/verspätete Vorschau nach
  Eingabeänderung, anderem Entwurf, Schließen oder Unmount verwerfen; Blob-URLs
  freigeben. Unbekannte Tokens/ungültige Beträge und Renderfehler verständlich
  melden, Entwurf und bestehende Wiederhol-/Archiv-/Fokusverträge erhalten.
  Keine Suchfilter, Platzhalter-Einfügewerkzeuge, Mailvorlagen oder Layoutbuilder
  hineinziehen. Tests zuerst: Escaping/alle Tokens/Geld/Gültigkeit, strikte
  Validierung/Auth/CSRF und nachweislich keine fachlichen Writes; Komponenten für
  ungespeicherten Inhalt, PDF-Prüfung, Fehler, Rennen/URL-Cleanup und Dirtyschutz.
  Chromium mit fiktiven APIs, beide Themes/Mobil/Desktop, axe und Screenshots;
  unabhängiger Review vor finalen Gates, Coverage, expliziter Commit/sofort Push.
  Abgenommen:1126 Tests/Coverage,74 Panelkomponenten, zwölf Vorlagen-Chromium-
  abläufe plus echter angemeldeter API-/PostgreSQL-/Chromium-PDF-Lauf im vorhandenen
  Layout-E2E. Geändert117/122 Zeilen und102/117 Branches; globale Coverage97,06%
  Zeilen/93,05% Branches. Fiktives einseitiges PDF visuell geprüft; 320/1280px,
  beide Themes, axe/Überlauf und44px-Downloadziel grün. Unabhängige Luna-Reviews,
  Impeccable ohne Panelbefund, Design-/API-Doku ergänzt. Schnelle Gates/Build grün.
  Lieferung/CI getrennt prüfen; kein echter Geschäftsvorgang wurde erzeugt.

- [x] **BKP015.7 — `feat: disclose secondary document template actions`** (26.10.2026)

  Auf B35 aufbauender fokussierter UI-Slice: Bearbeiten bleibt direkt erreichbar;
  Duplizieren und Archivieren erscheinen erst hinter einem benannten kompakten
  Aktionsschalter pro Zeile. Höchstens eine Auswahl offen. Bestehende Aktionen,
  Daten, Dirtyschutz und alle sicheren Speicher-/Archivverträge unverändert;
  keine Löschenfunktion, neue API, Abhängigkeit, Animation oder Filter/Vorschau.
  Native Buttons/benannte Offenlegung verwenden; keine falsche ARIA-Menürolle
  ohne vollständigen dazu passenden Tastaturvertrag. Enter/Space/Tab, Escape,
  außerhalb klicken und Fokus nach Auswahl/Abbruch/Fehler/Erfolg berücksichtigen.
  Kein Fokus auf versteckte/entfernte Aktionen, keine externen Fokuswechsel
  zurückreißen. Auch bei umgruppierter Zeile und archiviertem Eintrag sicher.
  Vorhandene Tokens/Touchziele, beide Themes, keine abgeschnittenen Overlay-Aktionen
  oder horizontaler Überlauf bei320px. Kein allgemeines Menüframework.
  Tests zuerst: anfangs seltene Aktionen verborgen, genau eine offen, Keyboard/
  Escape/Outside, bestehende Duplikat-/Archiv-/Fehler-/Dirty-/Fokusfälle erhalten.
  Komponenten, betroffene Chromiumabläufe mit fiktiven Daten, axe/Screenshots
  Mobil/Desktop beider Themes, unabhängiger Review vor finalen Gesamtläufen,
  Coverage, expliziter Commit und sofortiger Push. Lieferung getrennt verifizieren.
  Abgenommen:1114 Tests mit Coverage,63 Panelkomponenten, zehn Chromiumabläufe;
  geändert48/49 Zeilen und41/49 Branches, bestehende Gates erfüllt. Native
  Tastatur-/Außenwechsel und gesperrte Archivabgleich-Zustände geprüft; 320/1280px
  in beiden Themes mit axe/Überlauf/Aktionsgrenzen und Screenshots. Unabhängiger
  Luna-Review klar, Impeccable-Paneldetektor ohne Befund und DESIGN.md ergänzt.
  Keine Änderung von API, Datenbank oder sicheren Schreibverträgen.

- [x] **H054 — `docs: verify template delivery and resume handoff`** (26.10.2026)

  Vor Wiederaufnahme echtes neues Fenster mit regulärer Nutzung geprüft.
  H053-CI40228205140 zu c21330c komplett grün einschließlich Images; automatisches
  Update tatsächlich abgeschlossen. Drei gesunde Container mit identischer OCI-
  Revision, Timer aktiv/Service inaktiv, kein needs-attention, Option-Drain off.
  Checkpoint CT/Host/Betreiber identisch; neun Vorlagen-Chromiumabläufe gegen
  echte statische Auslieferung mit lokalen fiktiven APIs und Versionslabel grün.
  Keine Änderung echter Daten oder paralleles manuelles Update. Übergabe an
  Hermes/MiMo/DeepSeek ausdrücklich vor Ende dieses Fensters vorbereiten und
  tatsächlichen Start kontrollieren; keine weitere Codex-Wiederaufnahme.

- [x] **H053 — `test: await loaded event detail language`** (25.10.2026)

  CI40227220526 zu249aa47 scheitert in ui-language.test.tsx:88: Region ist
  bereits vorhanden, Detailinhalt aber noch aria-busy=true. Gleiches geladenes
  Überschriftenziel mit findByRole statt sofortigem getByRole abwarten. Kein
  höheres Zeitbudget, Skip, Retry oder geänderte Produktassertion. CI-Fehler ist
  der RED-Nachweis; schnelle Gates und gesamte Komponenten-/Unit-Suite prüfen.
  Separater Testcommit nach abgeschlossenem Darstellungsslice, sofort pushen.
  Schnelle Gates/Build, gesamte Unit-/Komponentensuite grün, unabhängiger
  Luna-Review klar. CI/Images und Lieferung separat neu prüfen.

- [x] **BKP015.6 — `feat: group document templates by document kind`** (25.10.2026)

  Kleiner lesender UI-Slice nach neuer Browserbeobachtung B35: Bookitup zeigt
  Vorlagen nach Dokumentart gruppiert und ruhige Zeilenaktionen; keine Such-/
  Archivfilter auf dieser untersuchten Ansicht beobachtet. Nur vorhandene Arten
  als benannte Gruppen, nur befüllte Gruppen; unbekannte Arten sichtbar erhalten.
  Leerbestand mit einem verständlichen Hinweis. Liste ohne Aufzählungspunkte,
  Metadaten und vorhandene Aktionen sauber ausrichten, mobil umbrechend, gleiche
  bestehenden Touchziele. Keine neue API/Migration, kein CSS außerhalb dieses
  Panels, keine neuen Farben/Animation/Abhängigkeiten. Bestehende Texte,
  Editieren/Duplizieren/Archivieren, Dirtyschutz, Fokus-Refs und Speichersicherheit
  unverändert; alle Zustände einschließlich Archiv sichtbar. Aktionsmenü und
  Such-/Archivfilter bleiben spätere eigene Entscheidungen/Slices.
  Tests zuerst: mehrere Arten, leerer Bestand, unbekannte Art bleibt sichtbar,
  alle bisherigen Aktionen/Fokusfälle; synthetisches Chromium mit Gruppen und
  ausgerichteten Zeilen bei320/1280px in beiden Themes, axe/Überlauf. Review vor
  finalen Gates, geänderte Coverage und Impeccable-Finish; explizit committen/pushen.
  Abgenommen:1113 Tests,62 Panelkomponenten, neun Chromiumabläufe; geändert
  26/26 Zeilen und34/34 Branches. Gruppierungszustand mit axe/Überlaufprüfung
  bei320/1280px und beiden Themes, Screenshots geprüft. Luna-Review klar;
  geänderte Art erhält Zeilenfokus auch nach DOM-Neuanlage. Impeccable ohne neue
  Befunde,61 bestehende Hinweise im unverändert gelassenen gemeinsamen CSS.

- [x] **BKP015.5b — `fix: reconcile document template saves safely`** (25.10.2026)

  Vorhandenen Editor-/Archiv-/Dirty-/Fokusvertrag erhalten, kein CSS-/Filter-
  oder Vorschauumbau. Tests zuerst. POST nutzt frische UUID pro logischer Anlage
  und eingefrorenen Auftrag; unklarer Ausgang sperrt Änderungen, explizite sichere
  Wiederholung nur mit derselben UUID und identischem Snapshot. GET-Neuladen
  bleibt ausschließlich lesend und gibt unklare Neuanlage nicht blind frei.
  POST/PUT-Ergebnis vollständig auf ID/Version, Inhalt, Status, Positionen und
  Servertrim prüfen. Bestätigtes Ergebnis sofort übernehmen und Editor schließen;
  anschließender Listenfehler darf Erfolg nicht widerrufen. GET-Retry entfernt
  bestätigten Datensatz weder bei leerer noch älterer Antwort; neuere gültige
  Version ehrlich übernehmen. Synchrone In-flight-Sperre; 400/401/403 erhalten
  Entwurf, 404/409 erfordern ausdrücklichen Abgleich ohne Entwurfüberschreibung.
  Unklarer PUT wird per GET abgeglichen, nie mit still neuer Version wiederholt.
  Tests: bestätigte201/200+GET503/leer/älter/neuer, Doppelclick, unplausible
  Erfolgsantwort/JSON, bekannte Ablehnungen, Konflikt, POST-Antwortverlust und
  sichere identische Wiederholung (genau eine Vorlage). Preise/Produktbezüge,
  Tastaturfokus und Dirtyschutz erhalten. Komponenten/Coverage, synthetischer
  Chromiumablauf in Mobil/Desktop und beiden Themes, Impeccable-Finish/Review.
  Abgenommen:1110 Tests, acht Chromiumabläufe, alle drei Wiederherstellungszustände
  mit axe/Überlaufprüfung bei320/1280px und beiden Themes. Geändert170/185 Zeilen
  und214/250 Branches; unabhängiger Luna-Review klar, Impeccable-Zielscan leer.
  Eingangs-GET-Rennen (Erfolg/Fehler), laufende unveränderte Kopie und gezielte
  Fokuswiederherstellung nach Abgleich zusätzlich abgesichert. Kein Browser-
  Neuladen-/Schließen-Entwurfsspeicher; bestehende SPA-Grenze ist dokumentiert.

- [x] **BKP015.5a — `feat: make document template creation retries idempotent`** (25.10.2026)

  Separat deploybare kompatible Vorbereitung für sichere Speicherrückmeldung:
  POST akzeptiert optional eine UUID requestId, alte Clients ohne Schlüssel
  unverändert. Neuer tenantgebundener Operationssatz mit Request-Hash und exakt
  ursprünglichem Ergebnis (einschließlich Positions-IDs). Gleicher Schlüssel und
  Inhalt liefert ursprüngliches Ergebnis ohne zweite Vorlage/Audit; anderer
  Inhalt409. Nach späterem Bearbeiten/Archivieren Originalreceipt wiedergeben,
  keine Rücksetzung aktueller Daten. Bestehenden Tenantlock/Adminprüfung/Transaktion
  verwenden; Vorlage, Positionen, Audit und Receipt atomar. Fremdtenant/Fremdrolle
  dürfen nichts lesen oder schreiben. PUT-CAS unverändert; requestId dort nicht
  zulassen. Keine öffentliche Receipt-Liste, kein Idempotenzframework oder Ablauf-
  /Löschprozess ohne gesonderte Anforderung. Migration0037 vorwärts und additiv,
  tenantgebundener FK/PK und Hash-/Objektconstraints. Receipt enthält nur bereits
  vorhandene Vorlagendaten; keine echten Daten in Git.
  Tests zuerst: doppelte/parallele POSTs, Inhaltkonflikt, anderer Tenant gleicher
  Schlüssel, verlorene Antwort+Retry, Neustart/Persistenz, später geänderte Vorlage,
  alte unkeyed POSTs, invalidUUID400/PUT-Abweisung, Auth/CSRF, Audit-/FK-Rollback,
  Migration/Constraints/Bestandsdaten. Echte PG-/API-Tests, schnelle Gates und
  Coverage/Review; expliziter Diff/Commit/sofortiger Push. UI folgt in BKP015.5b;
  diese optionale Protokollerweiterung ist allein kompatibel auslieferbar.
  RED: identischer Schlüssel erzeugte zuvor zwei Vorlagen. 1087 Tests grün,
  geänderte Zeilen21/22 und Branches22/22; unabhängiger Luna-Review ohne Blocker.

- [x] **H052 — `test: measure settled sidebar toggle geometry`** (25.10.2026)

  H051-CI40197576242 besteht Komponenten/Coverage, scheitert im Passwort-
  Chromiumablauf an expectSharedBrandRow: Togglebreite43,999130249 statt44.
  Echte Ursache anhand Styles/Transforms/Animation und Browsergeometrie prüfen.
  Zuerst reproduzierbarer Beleg, dann kleinste richtige Korrektur: keine pauschale
  Relaxierung aller Touchprüfungen, kein Skip/Retry oder größeres Zeitbudget.
  Bei laufender Transition tatsächlichen Endzustand abwarten; bei bloßer
  Gleitkommadarstellung Messung gegen echten44px-Layoutvertrag absichern.
  Betroffene Auth-Chromiumabläufe, schnelle Gates und unabhängiger Review;
  danach CI/Images/Lieferung abschließen. Kein Deploy bei roter CI.
  Abnahme: deterministischer Chromiumprobe mit echten Styles misst laufende
  transform-Transition43,9998627px, nach animation.finished exakt44×44.
  Nur betroffenen Toggle vor Messung abwarten, unveränderte strenge44px-
  Assertions. Beide HTTPS-Authmodi2/2, 519 Komponenten-/260 Unit-Tests und
  schnelle Gates/Build grün; unabhängiger Review ohne Blocker. Kein Produktcode.

- [x] **H051 — `test: await layout reload focus restoration`** (25.10.2026)

  CI40197096114 scheitert ausschließlich in der bestehenden Logo404-Recovery-
  Fokusprüfung: Status ist gerendert, document.activeElement noch body. Der
  Produktcode fokussiert in einem passiven React-Effekt nach loading/busy.
  Denselben exakten Fokusvertrag im Test mit vorhandenem waitFor und unverändertem
  Standardbudget prüfen, keine Produktänderung/entfernte Assertion/Testsperre.
  CI-RED als Ausgangsbeleg, 519 Komponenten-/260 Unit-Tests und schnelle Gates/Build grün,
  unabhängiger Review, expliziter Diff/Commit/Push. Kein Image/Deploy aus roter CI.

- [x] **BKP015.4 — `feat: open document template editors on demand`** (25.10.2026)

  Zunächst Vorlagenliste mit einer Anlegen-Aktion statt dauerhaft großem Formular.
  Anlegen/Bearbeiten/Duplizieren öffnet genau einen bestehenden Inline-Editor;
  Felder, exakte Produkt-/Positionspreise und API bleiben unverändert. Abbrechen
  und erfolgreicher bestehender Speicherablauf schließen ihn. Getippte Texte
  und Positionsänderungen vor Abbrechen/anderer Vorlage/Neuanlage ausdrücklich
  schützen; bestehende appweite Dirty-Registrierung nutzen. Beim Öffnen sinnvoll
  fokussieren, nach Schließen zum Auslöser zurück; kein Fokus auf hidden-Flächen.
  Liste bleibt für bestehenden Archiv-/GET-Abgleich erreichbar, Entwurf dabei
  erhalten. Nur eine dominante Hauptaktion je Frame. Kein Filter-/Vorschauprojekt,
  keine neue Abhängigkeit, API oder Migration. Der bisherige Speicherfehler bei
  bestätigtem PUT/POST plus fehlgeschlagenem Listen-GET ist ein gesonderter
  anschließender Korrekturslice, keine heimliche Ausweitung dieses UI-Auftrags.
  Tests zuerst für Liste ohne Formular, explizite Anlage, Fokus, Abbrechen mit
  Dirty-Entscheidung, Duplikat und bestehenden Preis-/Archiv-/Fehlerpfad. Alle
  bisherigen Tests über echte Öffnungsaktionen erhalten. Mobil/Desktop beider
  Themes im Chromium, axe/Overflow, Screenshots und unabhängiger Review. Ponytail,
  Impeccable, getrennte Luna-Dateizuständigkeiten; alle schnellen Gates, betroffene
  Coverage/E2E, ein Commit und sofort pushen. BKP015 insgesamt bleibt offen.

  Abnahme: echte RED-Fälle für initial offenes Formular, Verwerfen derselben
  Vorlage, fälschlich schmutzige deaktivierte Felder und Fokusverlust; danach
  36 fokussierte/519 gesamte Komponentenfälle, gesamte Coverage-Suite 1082 Tests,
  schnelle Gates/Build und alle 21 Chromiumabläufe grün. Panel 99,37 Prozent
  Zeilen/91,29 Prozent Zweige, Changed-Code 75/75 und 79/82. Acht Mobil-/Desktop-
  Bilder in beiden Themes geprüft, axe/Overflow sauber; Impeccable null neue
  Funde bei unveränderter gemeinsamer CSS-Baseline 61, unabhängiger Review klar.
  Erster paralleler Ops-Lauf scheiterte ohne vollständige Diagnose am erwarteten
  Fehlertext der leeren Restore-Datenbank; isolierter unveränderter Test mit
  Zusatzdiagnose danach grün, ursprüngliche Ursache nicht belegt. Vollständiger
  Ops-Abschluss anschließend vollständig grün (38 Python-/zwei Nodefälle samt
  realem Compose-Backup/Restore). CI/Images/Lieferung gesondert festhalten. Nächster
  fachlich nötiger Slice ist BKP015.5 für sichere Speicherrückmeldung, siehe
  detaillierte Paritätsanweisungen; Filter und Vorschau folgen danach.

- [x] **BKP015.3 — `fix: read document template lists from one snapshot`** (25.10.2026)

  Die bestehende Vorlagenliste liest Vorlagen und Positionen in zwei unabhängigen
  READ-COMMITTED-Abfragen. Deterministisch prüfen, ob ein paralleles Speichern
  neue Version plus alte Positionen liefert und eine spätere versionsgültige
  Archivierung dadurch neue Positionen zurückschreiben kann. Zuerst echter
  PostgreSQL-Interleavingtest: alte Position lesen, normale Änderung auf Version 2
  committen, dann verzögerte Vorlagenabfrage ausführen. Testbar getrennte Lese-
  und Schreibpools, begrenzte Gates mit garantiertem Cleanup, keine Sleeps oder
  produktiven Testhooks. Danach beide bestehenden Listenabfragen in genau einem
  lesenden Repeatable-Read-Snapshot; Tenantfilter, Sortierung, Preis-/Positions-
  modell und API-Vertrag erhalten. Keine Sperre, Migration oder UI-Erweiterung.
  Snapshot muss alte zusammengehörige Version/Position liefern, anschließende
  Archivierung mit alter Version muss 409 auslösen und neue Position erhalten.
  Ponytail/Luna mit getrenntem Code-/Testbesitz; betroffene echte Integration,
  schnelle Gates/Coverage, unabhängiger Review, explizit stagen und sofort pushen.

  Abnahme: echtes RED mit neuer Version 2/alten Positionen A und akzeptierter
  veralteter Archivierung; nach Fix zusammengehörige Version 1/A, alter Schreib-
  versuch abgewiesen und gespeicherte Version 2/B erhalten. Vier fokussierte
  Integrationsfälle, gesamte Coverage-Suite 1074 Tests und schnelle Gates/Build
  grün. Gesamtabdeckung 97,20 Prozent Zeilen/93,31 Prozent Zweige, geänderte
  Zeilen 4/4; unabhängiger Luna-Review ohne Blocker. Keine neue UI oder Migration.

- [x] **BKP015.2 — `fix: handle document template archive outcomes safely`** (25.10.2026)

  Genau den bestehenden Archivieren-Ablauf nach detailliertem Auftrag in
  docs/bookitup-parity/tasks-documents-mail.md korrigieren. Vorhandener kompletter
  DTO inklusive gespeicherter Produktpositionen/Version/CSRF bleibt unverändert.
  Bekannte Ablehnungen, 409/404-Bestandsabgleich, bestätigten 200-Erfolg und
  unklaren Netzwerk-/5xx-/unplausiblen Erfolg unterscheiden. Laufenden Auftrag
  gegen Doppelklick sperren. Bestätigte Archivierung lokal sichtbar/gesperrt
  halten, auch wenn anschließender GET fehlschlägt; nur GET wiederholen. Vor
  erneutem Archivieren nach unklarem Ausgang/Versionskonflikt aktuellen Bestand
  ausdrücklich laden. Gültige Antworten vor Verwendung prüfen. Offenen
  Vorlagenentwurf/unkontrollierte Felder/Positionen beim Listenabgleich erhalten.
  Kein neuer API-/Schema-/Migrationsvertrag, keine große Editor-/Filterarbeit.

  Tests zuerst: roter 409- und Netzwerkfall, 400/401/403/404/5xx, ungültige
  Erfolgsantwort, bestätigter PUT plus GET-Fehler/Retry ohne zweites PUT,
  Doppelklick, vollständige gespeicherte Positionen (auch alter Produktbezug),
  unveränderter getippter Entwurf, Fokus/Meldungen. Betroffene synthetische
  Chromiumstrecke 320/1280 × Themes mit axe, bestehende Preis-/Produktfälle
  erhalten. Ponytail/Impeccable, getrennte Luna-Dateizuständigkeiten; schnelle
  Gates/Komponenten-/Changed-Code-Coverage/betroffene E2E, unabhängiger Review,
  dokumentieren, explizit stagen/gesamten Diff prüfen, ein Commit und sofort
  auf UX pushen. Gesamtticket BKP015 bleibt für fokussierten Editor/Filter/
  deterministische Vorlagenvorschau offen.

  Abnahme: tatsächliches RED für 409/Netzwerk und neuere Serverversion sowie
  Fokusverlust im Chromium, danach 28 fokussierte/511 gesamte Komponentenfälle,
  260 Unit-Tests, schnelle Gates/Build und vier betroffene Chromiumabläufe grün.
  Panel-Coverage 99,24 Prozent Zeilen/90,19 Prozent Zweige; Changed-Code
  179/180 Zeilen und 172/190 Zweige. Vier Mobil-/Desktopbilder in beiden Themes
  und zwei zusätzliche Fehlerbilder geprüft, axe/Overflow ohne Befund.
  Impeccable: Panel null Detektorfunde, unveränderte gemeinsame CSS-Baseline 61;
  unabhängiger Luna-Review ohne Blocker. Kein neuer API-/Datenbankvertrag.
  Linux-CI/Images und Auslieferung nach Push gesondert nachweisen.

- [x] **H050 — `docs: record quota pause and pending branding delivery`** (25.10.2026)

  Bei beobachteten 92 Prozent mit Abschlussreserve sichern: Funktionsstand
  7ac0ba9 auf UX gepusht, CI 40172043659 noch aktiv, H048 offen. Tatsächlich
  verifizierten Runtime-Zwischenstand und lokale Prüfungen getrennt festhalten,
  genauen BKP015.2-Archivierungsauftrag für nächste Agenten dokumentieren.
  Nur Doku auf eigener Branch, um die laufende UX-Freigabe nicht abzubrechen.
  Keine Zusatzcredits, keine automatische Wiederaufnahme; vor Fortsetzung
  Limits/CI/Runtime prüfen und erst H048 abschließen. Dokumentationscheck,
  explizite Pfade, gesamter staged Diff und sofortiger Push.

- [x] **H049 — `fix: reconcile workspace routes when listeners mount`** (25.10.2026)

  CI 40171302012 scheitert im Sprach-/Navigationskomponentenfall an fehlender
  Suchüberschrift (lokal 494 Komponenten grün). Eng prüfen, ob ein Hashwechsel
  zwischen initialem Hook-Render und Listener-Effektinstallation verloren geht.
  Deterministische rote Regression mit URL-Wechsel vor passivem Hook-Effekt,
  dann nur bei bestätigter Lücke bestehendes useWorkspaceRoute nach Registrierung
  gegen die aktuelle URL abgleichen. Callers AuthPanel/Navigation/SettingsNavigation,
  Direkt-/Legacylinks, Query/History und keine doppelten Listener prüfen.
  Keine höhere globale Wartezeit, Retrys, Skips oder entfernten Assertions.
  CI-Ursache nur soweit durch Belege gestützt benennen. Ponytail/Impeccable,
  schnelle Gates plus betroffene Komponenten/Coverage/Auth-Chromium, unabhängiger
  Review, explizite Pfade, voller staged Diff, ein Commit und sofort pushen.
  H048 bleibt bis tatsächlicher freigegebener Auslieferung offen.
  Abnahme: deterministische Layout-Effekt-Regression ohne Fix rot, mit Fix
  grün; 28 fokussierte und 495 gesamte Komponententests, 260 Unit-Tests,
  schnelle Gates/Build und drei Auth-/Layout-Chromiumabläufe grün. Navigation
  100 Prozent Zeilen/95,55 Prozent Zweige; geänderte Zeile 1/1 gedeckt.
  Unabhängiger Review ohne Blocker. Der reale Hookfehler ist bewiesen;
  Zusammenhang mit genau diesem CI-Lauf bleibt plausible Inferenz.

- [x] **H048 — `docs: verify mobile settings and logo delivery`** (abgeschlossen, 25.10.2026)

  Nach H049 ausschließlich aktuellen Lieferstand abschließen: vollständige
  grüne quality+images-CI, alleinigen automatischen Updater abwarten, drei
  gesunde Container/exakte OCI, Checkpoint CT/Host/Betreiber mit identischen
  Bytes/Hash und privaten Rechten, kein needs-attention/Drain off. Live-Assets
  mit sichtbarer Buildkennung, vollständig fiktiven lokalen Geschäfts-APIs/
  PostgreSQL/Renderer prüfen: kompakte mobile Navigation, Logoauswahl/
  PNG-/JPEG-Upload/Reload/Versionierung, PDF mit sichtbarem Logo, responsive
  Themes/axe, keine Browseranfrage an echte Geschäfts-API. Gesamte lokale
  Chromium- und Betriebssuite mit Restore abschließen. Grenzen ausdrücklich
  dokumentieren, nächste Vorlagen-Archivkorrektur detailliert vorbereiten.
  Keine parallelen manuellen Updates oder echten Datenänderungen. Dokuabschluss
  erst nach tatsächlichen Belegen committen/pushen, laufende freigegebene Images
  bei Kontingentabschluss nicht durch unnötigen Releasebranch-Push abbrechen.
  Abnahme im neuen Fenster: CI 40172043659 quality+images grün; 7ac0ba9
  auf allen drei Containern gesund/exakte OCI, Timer aktiv/Service inaktiv,
  kein needs-attention/Drain off. Checkpoint CT/Host/Betreiber 2.587.194 Bytes,
  SHA-256 046e1466e204fa420731652d5da0d5fcb7566a66a344bf063c601e1044e44375
  identisch, private Rechte. Live-Assets sichtbare Version7ac0ba9, 16 Bilder
  plus axe und zwei echte Logo-PDFs grün; API/DB/Renderer lokal fiktiv,
  keine externen Browser-HTTP(S)-Requests. Abschließende gesamte lokale
  Chromiumfolge 18/18 (2,7 Minuten); vorherige unveränderte Betriebssuite
  38 Python-/zwei Node-Fälle samt realem Compose-Backup/Restore grün,
  vollständige neue Linux-CI ebenfalls. Unabhängiger Dokumentationsreview,
  getrennte Doku-Historie per geprüftem Fast-forward in UX zurückgeführt.

- [x] **H047 — `test: wait for worker readiness through startup probes`** (25.10.2026)

  Reale rote Linux-CI 40170018957 scheitert in worker-main.test.ts während
  Coverage: Datenbank up, Worker noch down, erste gültige HTTP-Antwort 503.
  Bestehender Testhelper wartet nur auf einen offenen Port statt Bereitschaft.
  Ausschließlich begrenzte Testabholung korrigieren: bis 200 pollend warten,
  auch bei 503 dieselbe kurze Pause; letzte nicht-bereite Antwort bei
  Erschöpfung zurückgeben, damit bestehender exakter Ready-Vertrag rot bleibt.
  Kein Produkt-Healthcheck, Timeoutbudget, Skip oder automatischer Testretry
  ändern. Kleine deterministische Regressionen für 503→200, dauerhafte503
  und vorübergehenden Verbindungsfehler; realen Worker mit/ohne Drain und
  geordnetes Shutdown weiterhin prüfen. Tests zuerst (rote CI als Reproduktion),
  erforderliche Gates, unabhängiger Review, explizite Pfade/gesamter Diff,
  ein Commit und sofort pushen. BKP015-Archivfehler danach separat offen lassen.
  Abnahme: fokussiert 5/5 einschließlich beider realer Workerstarts/Shutdowns,
  gesamte Unitfolge 260 Tests, Format/Lint/Typen/Workspace/Docs/Build grün.
  Unabhängiger Review ohne Blocker. Keine Produktdatei verändert, bestehende
  exakte Readiness-/Shutdown-Assertions erhalten; vollständige Linux-CI und
  finale Imagefreigabe bleiben erforderlich.

- [x] **BKP018.2 — `feat: upload document logos from layout settings`** (25.10.2026)

  Gespeichertes Dokumentlayout in der Zusammenfassung um eine progressive,
  beschriftete PNG-/JPEG-Auswahl und ausdrückliches Hochladen/Ersetzen ergänzen.
  Bestehende raw-PUT-API mit CSRF, Signatur- und 512KiB-Validierung verwenden;
  keine neue API, CAS, Migration, Abhängigkeit, Löschung oder Logo-Thumbnail.
  Auswahl allein schreibt nichts. Während Inhaltsbearbeitung kein Upload,
  während Upload keine Vorschau/Änderung/Reload parallel. Eindeutig bestätigte
  vollständige Antwort aktualisiert Layoutversion und Logoanzeige; alte
  Vorschau widerrufen. Abweichende/stale Antwort, Netzwerk-/5xx-/unlesbarer
  Erfolg sind unklar: Eingaben erhalten, Wiederholung sperren und expliziten
  GET-Abgleich anbieten, auch bei fehlgeschlagenem Abgleich in Zusammenfassung.
  Validierungsfehler lassen den letzten Stand bestehen. Logo-API bleibt ohne
  CAS: konkurrierende autorisierte Uploads zuletzt schreibend maßgeblich.

  Tests zuerst: keine Mutation bei Auswahl, rohe PNG/JPEG-Bytes+CSRF, Limit/
  Typ/Signatur, Ersetzen und aktuelle Version für folgende Layoutspeicherung,
  bekannte Fehler vs unklarer Ausgang ohne doppelte PUTs, GET-Fehler/Retry,
  fehlendes Layout, montierter Bereich/unmount, exklusiver Bearbeitungszustand,
  alte Blobvorschau ungültig. Vorhandene serverseitige Auth-/Tenantgrenzen
  weiter prüfen. Reale synthetische Chromiumstrecke mit tatsächlich gerenderter
  Logo-PDF, 320/390/768/1280 × Themes/axe; gespeichertes finales PDF bleibt
  nach Logowechsel byte-/hashidentisch (fokussierte Integration).
  Ponytail/Impeccable, getrennte Luna-Dateizuständigkeiten; schnelle Gates plus
  betroffene Integration/E2E/Coverage, unabhängiger Review, dokumentieren,
  explizit stagen, vollständigen Diff prüfen, ein Commit und sofort pushen.

  Abnahme: tatsächliche Komponenten- und Browser-REDs vor Umsetzung; 34
  fokussierte Layout-Komponenten- und 35 Dokumentintegrationstests grün.
  Gesamte Coverage-Suite 1051 Tests grün; finale Komponentenfolge mit zwei zusätzlichen Netzwerk-/JSON-Fehlerfällen 494 Tests,
  Panel 94,35 Prozent Zeilen/88,99 Prozent Zweige, Changed-Code 108/109 Zeilen
  und 105/116 Zweige. Schnelle Gates/Build und echter Chromiumablauf mit
  PNG/JPEG, Reload, folgender versionsgesicherter Layoutspeicherung und
  Signatur-/Größenfehlern grün. Acht Logo-Theme-/Breitenbilder plus axe und
  echte einseitige A4-PDF mit sichtbarem synthetischem Logo geprüft.
  Finalartefakt nach Logowechsel byte-/hashidentisch; alte Logobytes bleiben
  ausdrücklich erhalten. Reviewkorrekturen: keine versteckte Dateiauswahl,
  klare Verwerf-/GET-Beschriftung, Fokus nach Upload/Abbruch/Abgleich und
  keine Fokusübernahme aus verborgenem Bereich. Unabhängiger Review ohne
  Blocker; Impeccable ohne neue Befunde (61 Bestandshinweise). Kein neuer
  Backendvertrag, keine echte Buchung oder Kundendaten verändert.

- [x] **BKP018.1b — `feat: keep mobile settings navigation compact`** (25.10.2026)

  Scope: `SettingsNavigation` nutzt dieselben vorhandenen zwölf Bereichs-/Hashwerte
  für einen beschrifteten nativen Select „Einstellungsbereich“ bis einschließlich
  900px; darüber bisherige Links unverändert. Auswahl ändert den Hash, vorhandene
  Hook-/History-/Panelzustände erhalten, keine neue Routing-/UI-Abhängigkeit,
  keine Backend-/Logo-/Filteränderung. Bestehende Tokens, 44px Höhe und Impeccable
  Operate, kein Dashboard-Marketingstil. Anleitung im Dokument-/Mailticket.

  Tests zuerst: aktueller Bereich/Direktlinks/Legacy-Hashes, alle Optionen,
  Wechsel und Browser-Zurück, Query erhalten, schmutziger Layoutentwurf nach
  Wechsel/Rückkehr erhalten und Home-/Dateien-/Suchschutz unverändert. Bei
  320/390/768 Select sichtbar/Links verborgen, bei 1280 umgekehrt; auch 900/901
  Grenze, Tastatur und kein Overflow prüfen. Alle betroffenen mobilen
  Auth-Browserkonsumenten auf tatsächliche Bedienung anpassen, Desktopfälle
  unverändert. Acht Theme-/Breitenbilder plus axe, Vorher/Nachher und Fokus.

  Genau ein Slice; Komponenten-RED vor Umsetzung, erforderliche schnelle Gates,
  betroffene Chromium-/Coverage-Prüfung, unabhängiger Review, DESIGN/Handoff
  aktualisieren, explizites Staging und vollständiger Diff, Commit sofort pushen.

  Abnahme: echte rote Komponentenregression vor Umsetzung, 257 Unit- und
  476 Komponententests grün; Navigation 100 Prozent Zeilen/95,55 Prozent Zweige,
  Changed-Code 4/4 Zeilen und 4/4 Zweige. Format/Lint/Typen/Workspace/Docs/Build
  grün, drei betroffene Chromiumabläufe (beide Logins und Dokumentlayout) grün.
  Acht Theme-/Breitenbilder visuell geprüft, axe und 900/901px-Grenze grün;
  320px-Überschrift ungefähr y=226 statt y=535. Native Buchstabenauswahl,
  Fokus/History/Query und schmutziger Entwurf geprüft; Popup-Pfeilfolgen bleiben
  lokale Headless-Grenze ohne Produkt-Sonderlogik. Unabhängiger Review ohne
  Blocker, Impeccable-Detector ohne neue Befunde (61 Bestandshinweise).
  Kein Backend verändert, daher keine neue betroffene Integrationsstrecke;
  vollständige Linux-CI bleibt zwingende Auslieferungssperre.

- [x] **H046 — `docs: verify layout delivery and record the next mobile slice`** (24.10.2026): Den gepushten Funktionsstand e9ca99d nach vollständiger quality+images-CI und alleiniger automatischer Aktualisierung abschließen: exakte OCI ×3/gesund, Checkpoint CT/Host/Betreiber gleich, Drain off/kein needs-attention, Live-Assets mit sichtbarer Buildkennung plus vollständig fiktiver lokaler Geschäfts-API prüfen. Lokale abschließende gesamte Chromium-/Betriebssuite und tatsächliche Auslieferungsbeweise dokumentieren. Mobile Einstellungsnavigation als nächsten klar begrenzten Slice mit bestehender 320px-Wortbruch-Lücke notieren; Logooberfläche und übrige Parität offen lassen. Kontingent vor Erschöpfung mit Reserve beenden, keine Zusatzcredits oder automatische Wiederaufnahme. Ein Dokumentationscommit, explizites Staging/Review und sofortiger Push; dessen neue CI ist kein weiterer Funktionsdeploynachweis. Zwischenabschluss bei 95 Prozent: lokal alle 18 Chromiumabläufe und 38 Python-/zwei Node-Ops samt Restore grün; CI 40134505361 quality erfolgreich, images noch aktiv. Laufzeit bleibt zuletzt geprüft 132ace1. Doku separat auf codex/layout-delivery-handoff-20261024 pushen, damit laufende UX-Images nicht abgebrochen werden. H046 bleibt bis echtem Liefer-/Checkpoint-/Live-Asset-Nachweis offen. Abschluss am 25.10.2026: CI 40134505361 quality+images grün; e9ca99d auf drei gesunden Containern mit exakter OCI, Drain off/kein needs-attention. Checkpoint CT/Host/Betreiber identisch, 2.384.655 Bytes, SHA-256 `bc5efc03feccbde5ce8d11469e2ae721e9f0f60a6714428cdebbf0b6e4953164`. Live-Assets mit sichtbarer Version e9ca99d, acht Theme-/Breitenbildern, axe und tatsächlicher lokaler Chromium-PDF erfolgreich; APIs/DB/Renderer ausschließlich lokal fiktiv. Getrennte Doku-Historie per geprüftem Fast-forward in UX zurückgeführt, kein Force-Push. Mobiler Wortbruch bleibt nächster Slice.

- [x] **BKP018.1 — `feat: configure document layout with a safe unsaved preview`** (24.10.2026): Einstellungen→Dokumentlayout als kleiner vertikaler Slice auf vorhandener Layout-API. Zusammenfassung mit explizitem Bearbeiten, bei 404 bewusste Ersteinrichtung; keine automatischen Geschäftsdaten oder Speicherung. Absendername/-anschrift plus bestehende Farben/Schrift und Seiten-/Positionsnummern, Darstellung progressiv; sichtbare neutrale Darstellungsstartwerte vor ausdrücklichem Speichern zulässig. POST-Erstanlage/versionsgesichertes PUT, gültige bestätigte Antwort direkt übernehmen; Ladefehler von 404 trennen, Konflikt/unklarer Speicherausgang erhalten Eingaben und verlangen Bestandsabgleich, Dirty-Schutz vorhandener Navigation verwenden. Neuer authentifizierter/CSRF-geschützter POST /api/v1/document-layout/preview nimmt genau dieselben neun editierbaren Felder ohne Version und rendert ausschließlich fiktive Beispieldaten über vorhandenen Renderer; aktuelles gespeichertes Logo nur aus eigenem Mandanten. Keine Kontakte/Events/Nummern/Dokumente/Artefakte/Audits/Layouts verändern, no-store und neutrale Fehler bei fehlendem Logo/Renderer. Gemeinsamen Renderer/Storage im API-Prozess injizieren, keine neue Abhängigkeit. UI zeigt ausdrücklich erzeugte Vorschau über geprüftes PDF-Blob und bewusst geklickten neuen Tab/Download, alte URLs widerrufen; kein iframe/CSP-Aufweichen, Vorschau nicht mit Speichern verwechseln. Logo-Uploadoberfläche folgt separat. Tests zuerst für Setup/GET404vsFehler/POST/PUT/409/unklare Antwort/Reload/Dirty und unsaved Preview; API Auth/CSRF/Schema/Tenant/keine Nebenwirkung/Logo-/Rendererfehler; realer synthetischer PG-/HTTPS-Chromiumablauf, 320/390/768/1280 beide Themes, axe und echte Vorschau-PDF. Vorhandene finale Bytes/Hashes unverändert. Ponytail/Impeccable bestehende Designwelt, klar getrennte Luna-Dateizuständigkeiten, required Gates/Review, explizites Staging, ein Commit und sofortiger Push. Keine vollständige BKP018-Parität behaupten. Abnahme: echte REDs vor Umsetzung, 16 neue Komponentenregressionen und 12 Layout-Integrationstests; gesamte Coverage-Suite 1033 Tests grün (97,06 Prozent Zeilen/93,29 Prozent Branches), Changed-Code 215/234 Zeilen und 201/236 Branches. Format/Lint/Typen/Workspace/Docs/Build grün; realer PG-/HTTPS-/Chromiumablauf mit acht Theme-/Breitenbildern, axe und tatsächlicher einseitiger PDF grün. Unabhängige Backend-/UI-Reviews ohne Blocker; Detector ohne Befund im geänderten Code (61 Bestandshinweise). Headless Chrome lädt den PDF-Öffnenlink herunter, daher gültige Bytes statt interner Viewer-URL geprüft. Mobile Einstellungsnavigation bricht lange Wörter weiterhin unschön; kein Anspruch vollständiger mobiler Navigationsparität. Testauslieferung erst mit final grünen Images/Checkpoint belegen.

- [x] **BKP018.0b — `fix: number every page of generated document PDFs`** (24.10.2026): Bestätigte DV-04-Lücke: bei fünf Seiten erscheint bisher nur am Dokumentende „Seite 1“. Zuerst rote Renderingtests für bedingte echte Seitenzähler; im vorhandenen HTML-Renderer native Chromium-`@page`-Marginbox mit `counter(page)`/`counter(pages)` statt des festen Absatzes verwenden. Abschalten lässt die Marginbox vollständig weg. Schrift/Farbe aus bestehendem Layout; keine neue Abhängigkeit, Renderer-Signatur oder Nachbearbeitung gespeicherter finaler PDFs. Tatsächliches CT-Chromium 156 unterstützt den Pfad, lokale fünfseitige Diagnose belegt Ursache. Unit-/betroffene Integrationstests, echter Chromium-PDF-Smoke als CI-Artefakt und lokales seitenweises Text-/Bildreview bei ein/mehrseitig und ausgeschaltet; keine Parserdependency allein für QA. Vorhandene finale Bytes/Hashes unverändert, nur neue Vorschau/Finalisierung betroffen. Required Gates, Changed-Code-Coverage, unabhängiger Review, explizites Staging und sofortiger Push. Abnahme: Unit-/Chromium-RED vor Implementierung; 62 fokussierte Unit-/Integrationstests, 257 Unit-/459 Komponenten gesamt und echter Chromium-Smoke grün. Geänderte Zeile und beide Branches vollständig gedeckt, schnelle Gates/Build grün. Alle elf tatsächlich gerenderten Seiten visuell geprüft; Textauszug bestätigt 1–5 von 5, 1 von 1 und keine Nummer bei deaktiviert. Fußzeile an bestehende Inhaltskante ausgerichtet, Impeccable-Detector `[]`. Keine neue Runtime-/Parserabhängigkeit oder Änderung gespeicherter finaler Artefakte.

- [x] **BKP018.0 — `fix: preserve document logos across rejected and failed uploads`** (24.10.2026): Voraussetzung für die Layout-/Logooberfläche. Erst rote Integrationstests: Aufrufer ohne aktive Mandantenberechtigung darf bestehende Bytes/Zeiger/Version/Audit nicht ändern (kein neues Rollenmodell); Speicher-/DBfehler und konkurrierende Uploads dürfen das aktive Logo nicht beschädigen. Administratorprüfung unter bestehender Mandantensperre vor jedem Storage-Schreibzugriff; neue eindeutige unveränderliche Schlüssel je Upload, Zeigerwechsel/Version/Audit transaktional. Alte Schlüssel/Dateien für Sicherungsreferenzen und laufende Vorschauen erhalten; kein GC, keine neue Abhängigkeit, keine API-/CAS-Vertragsänderung oder UI in diesem Slice. Additive Migration 0036 akzeptiert unveränderte Legacy-Schlüssel und mandantengebundene UUID-Schlüssel, lehnt falsche Endung/fremden Tenant ab. Bestehende MIME-/Größen-/Tenant-/CSRF-Sperren erhalten. Kleine ungefährliche verwaiste neue Dateien bei unklarem Commit dürfen bleiben, niemals möglicherweise aktive Bytes löschen. Tests zuerst, erforderliche Gates/Changed-Code-Coverage, unabhängiger Review, explizite Pfade, vollständiger staged Diff, ein Commit und sofortiger Push auf die bestehende UX-Branch. Abnahme: echte REDs vor Implementierung, 47 fokussierte Integrationsfälle und 1016 Tests der vollständigen Coverage-Suite grün (97,22 Prozent Zeilen/93,65 Prozent Branches). 257 Unit-/459 Komponententests, schnelle Gates, Build und betroffener Chromium-Angebotsablauf grün; unabhängiger Review ohne Blocker. Neue Migration erhält vorhandene Legacy-Zeilen und erzwingt Schlüssel-/Tenant-/MIME-Paarung. Keine neue Oberfläche; erhaltene alte/unklare Dateien benötigen weiterhin gemeinsame Storage-/DB-Sicherung.

- [x] **H045 — `docs: verify delivery of blank offers and product positions`** (24.10.2026): Nach tatsächlichem Kontingentreset zuerst ausstehende Auslieferung abschließen: vollständig grüne Source-CI auf 132ace1 (40123365972), geprüfter UX-Fast-forward, grüne quality+images auf exakt diesem SHA, alleinigen automatischen Updater abwarten. Drei gesunde Container/exakte OCI, kein needs-attention, Drain off, Checkpoint CT/Host/Betreiber identisch; Live-Assets mit sichtbarer Version und fiktiver lokaler API/DB prüfen. Produktwahl und Blankoanlage bis Vorschau/Finalisierung sowie Mobil-/Desktop-Themes abnehmen; Grenzen echter API-/PDF-/Geräteabnahme offen dokumentieren. Liefermatrix/Handoff aktualisieren, Docs-Gates, explizites Staging und sofortiger Push. Keine neue Funktionswelle vor diesem Abschluss. Abgeschlossen: Source-CI 40123365972 und Release-CI 40130269260 vollständig grün; 132ace1 auf drei gesunden Containern, Drain off, kein needs-attention. Checkpoint CT/Host/Betreiber identisch SHA-256 `3d09edb19709b93336b996b6ab2be8442a6700f786cc85335f39bcbc8959facc`. Live-Assets mit sichtbarer Version, fiktiver lokaler API/DB, zwölf Theme-/Breitenbildern, axe und natürlicher 320px-Fokusgeometrie geprüft. Drei echte Chromium-PDFs (Vorlagenvorschau, Blankovorschau, Blankofinale) jeweils eine Seite gerendert und visuell geprüft. Keine echte Geschäfts-API-/Geräte- oder Mehrseitenabnahme. Weitere Implementierung direkt auf bestehender freigegebener UX-Branch nach geprüftem Fast-forward, um doppelte CI-Ketten zu vermeiden; sämtliche Gates, Imagefreigabe und Sicherung bleiben verbindlich.

- [x] **H044 — `docs: record quota pause and pending offer delivery`** (24.10.2026): Abschlussstand nach BKP015.1/BKP016.4/BKP017.1 mit exakten Commits, lokalen Gates, verifiziertem Testbetrieb und noch offenen CI-/Image-/Sicherungsnachweisen dokumentieren. Keine neue Funktion oder Auslieferungsfreigabe. Dokumentationscheck und gestagten Diff prüfen, sofort pushen; letzte Docs-CI kann den noch laufenden Feature-Branch-Lauf ersetzen, daher bei Fortsetzung immer tatsächlichen neuesten HEAD prüfen.

- [x] **BKP017.1 — `feat: create blank offer drafts without a template`** (24.10.2026): Vertikale Blankoanlage für ein Event mit bereits zugeordnetem Kontakt. Eigenständiger `POST /api/v1/documents/blank-offer` mit Event-/Kontaktbezug; vorhandener Vorlagen-POST bleibt unverändert. Kein verstecktes Vorlagenobjekt: additive nullable `template_id`-Migration, eigener Betreff „Angebot“, leere Einleitung/Schluss, Gültigkeit 14 Tage gemäß DV-05, 0 Positionen/0 Cent, keine Nummer/PDF. Nur Blankoangebote dürfen mit leerem Positionssatz beginnen; vor Speichern/Vorschau/Finalisierung mindestens eine gültige Position verlangen. Editor öffnet nach Anlage und bietet dieselbe freie/Katalog-Neuanlage; neutraler Leerhinweis, keine falsche Änderungsverwerfrückfrage nur wegen leerem Bestand. Texte/Positionen nach bestehender Versions-/Tenant-/CSRF-/Konfliktlogik speichern; Renderer verwendet eigene Inhalte ohne Vorlagenfallback, finale Dokumente bleiben unveränderlich. Fehlender Kontakt verhindert diese Anlage mit klarem Hinweis (Kontaktverwaltung bleibt bestehender Ablauf). Bestehende Vorlage-/Legacy-Angebote unverändert. Keine anderen Dokumentarten, E-Mail, Produktiv-Cutover oder Geschäftsdefaults erfinden. Tests zuerst für echte Migration, Blanko-API/0-Position-Sperre/Nummernverbrauch=0, Tenant/Autorisierung/CSRF, Texte+freie/Katalogposition speichern/Reload/Vorschau/Finalisierung, Komponenten und Chromium bei Desktop/Mobil/Hell/Dunkel. Ein Slice mit erforderlichen Gates, Review und sofortigem Push; vorhandene Anlage besitzt keine dauerhafte POST-Idempotenz, verlorene Antwort daher als unklar behandeln und Bestand prüfen statt blind erneut anlegen. Abnahme: echte REDs, 257 Unit-/459 Komponenten-/295 Integrationstests und 1011 Coverage-Tests grün; geänderte Zeilen 61/65, Branches 99/109. Alle 16 Chromiumfälle im isolierten Nachlauf grün; vier neue Blanko-Breite-/Theme-Bilder und mobile axe-Prüfungen ebenfalls grün. Build sowie 38 Python-/zwei Node-Betriebstests inklusive realer Compose-Sicherung/Restore grün. Anfangs Test-Body nach PDF-Navigation nicht lesbar und parallel gelöschte Trace-Artefakte: ausschließlich Testharness korrigiert/Output getrennt, gesamte E2E wiederholt. Unabhängiger Review ohne Blocker, Impeccable-Detector `[]`; normale mobile Scrollfreiheit/Geräteprüfung und echte PDF-Layoutabnahme bleiben offen.

- [x] **BKP016.4 — `feat: add catalog products to offer draft positions`** (24.10.2026): Im vorhandenen Angebotseditor genau eine progressive Produktwahl neben der freien Neuanlage. Erst „Produkt hinzufügen“ lädt den aktiven Katalog; beschriftete Auswahl und ausdrückliches „Als Position hinzufügen“ hängen eine neue, frei bearbeitbare Snapshot-Position an (Produkt-ID, Name, Einheit, Brutto-Einzelpreis über `grossProductPrice`, Steuer, Menge 1, Rabatt 0). Vorhandene oder während des Ladens bearbeitete Positionen werden nie ersetzt. Keine Produktschreibzugriffe, neue API/Migration, Netto-Umschaltung oder automatische Verknüpfung. Laden/Fehler mit Wiederholen/leer/ungültiger Preis erhalten alle Eingaben und freie Neuanlage; archivierte Produkte fehlen in der neuen Auswahl, gespeicherte alte Produktbezüge bleiben erhalten. Versionsgesichertes PUT, Dirty-/Konflikt-/Unklar-/Vorschau-/Finalisierungsschutz erhalten; Fokus in neue Beschreibung, Bedienung mit Tastatur und 320px. Tests zuerst: keine initiale Katalogabfrage, ausdrückliche append-Semantik, Netto/Brutto, Überlauf ohne Änderung, Fehler/Retry/leer, asynchrone Antwort ohne Überschreiben und atomarer Speichern/Reload-Nachweis; Chromium mit synthetischen Daten, beiden Themes und axe. Ein Slice, explizite Pfade, Review und sofortiger Push; CI-Freigaben nicht durch unnötige Pushes abbrechen. Abnahme: echte RED-Komponentenfälle einschließlich überschriebenem Konflikthinweis; 24 Editor-Komponententests, reale PostgreSQL-/Fastify-/HTTPS-Chromiumstrecke mit Persistenz-/Reload-/Katalog-Unverändert-Nachweis, acht Theme-/Breitenbilder und axe grün. Gesamte Coverage-Suite 1001 Tests grün; Changed-Code 52/54 Zeilen und 74/82 Branches, schnelle Gates und Build grün. Unabhängiger Review ohne kritischen Befund, Impeccable-Detector `[]`.

- [x] **BKP015.1 — `fix: respect product price basis when copying template positions`** (24.10.2026): Die vorhandene Produktwahl einer Dokumentvorlage kopiert bisher `priceMinor` ohne `priceBasis` und behandelt Netto-Produktpreise dadurch als Brutto. Zuerst rote Regression (100,00 Euro netto/19 Prozent muss 119,00 Euro Brutto-Positionspreis ergeben). Kleine exakt ganzzahlige Umrechnung für die ausdrückliche Produktübernahme, mit sicherem Centbereich/halbauf-Rundung, unveränderter Brutto-Kopie und Überlaufablehnung ohne Verlust bestehender Eingaben. Vorhandene Dezimalhelfer und UI-Stile verwenden; Positionslabel nennt Brutto. Keine Netto-Umschaltung, neue API/Migration oder automatische Änderung gespeicherter Vorlagen/Produkte/finaler Dokumente. Unit-/Komponenten-/Browsernachweis für Netto/Brutto, 0/19 Prozent, Halbcent und große Werte sowie erhaltene freie Eingaben. Hilfsfunktion nur für die konkrete Übernahme, spätere Angebots-Produktwahl verwendet denselben Pfad. Ein Commit, sofort pushen; H043-CI vor diesem Push abschließen lassen, damit die ausstehende Releasefreigabe nicht wieder abgebrochen wird. Abnahme: echte rote Komponentenregressionen, fünf Unit-/zwölf Vorlagen-Komponententests und zwei Chromiumfälle grün; gesamte Coverage-Suite 995 Tests, geänderte Zeilen/Branches vollständig abgedeckt, schnelle Gates und Build grün. Sechs Theme-/Breitenprüfungen mit axe; unabhängiger Review ohne Befund, Impeccable-Detector `[]`. Bestehende gespeicherte Nettoprodukt-Übernahmen bleiben ausdrücklich manuell zu prüfen.

- [x] **H043 — `test: budget and assert every authenticated browser audit`** (24.10.2026): CI 40088360284 scheitert nach fortlaufender normaler Browserarbeit am 180-s-Gesamtbudget des sehr großen Passwort-Szenarios; synthetischer Trace belegt 75 abgeschlossene axe-Berichte und die erreichte H031-Navigation, keinen nachgewiesenen Produkt-Deadlock. Ausschließlich dessen Gesamtbudget auf 240 s anheben, Google-Budget sowie 10-s-Aktions-/5-s-Erwartungsgrenzen erhalten. Jede axe-Auswertung nach Berichtablage unmittelbar mit Zustandsname prüfen, statt spätere Matrixprüfungen nach einem zu frühen Sammelassert unbemerkt zu lassen. Keine Assertion entfernen, kein Retry/Skip, keine App-/Auth-/Timeout-Konfiguration im Produkt ändern. Echter roter CI-Lauf ist die Reproduktion; beide Auth-Abläufe und schnelle Gates lokal grün; vollständige Linux-CI bleibt zwingende Auslieferungssperre. Eigener Commit und sofortiger Push, erst danach Auslieferungsfreigabe.

- [x] **BKP016.3 — `feat: edit offer draft positions atomically`** (24.10.2026): Im Angebotseditor bestehende Positionen und neue freie Positionen bearbeiten/entfernen/hinzufügen: Beschreibung, ganzzahlige Menge, Einheit, ausdrücklich Brutto-Einzelpreis, Steuer und Rabatt. Speichern ersetzt Texte und optional mitgesendete Positionen in einer versionsgesicherten Transaktion, berechnet Summen serverseitig exakt und erhöht Version/Audit genau einmal; alte Text-only-Aufrufe behalten Positionen. Vorlagen und Produktstammdaten bleiben unverändert, vorhandene Produktbezüge bleiben mandantengebunden; Produktkatalog-Auswahl für neue Positionen folgt separat. Mobile Feldgruppen statt breiter Tabelle, exakte Dezimaleingabe mit vorhandenen Helfern, klar gespeicherte Gesamtsumme, Dirty-/Konflikt-/Retry-/Finalisierungsschutz aus BKP016.1 erhalten. Tests zuerst für Reload, Summen/Steuer/Rabatt, leere/ungültige Positionen, falsche Referenz, finale Unveränderbarkeit, zwei konkurrierende Versionen und Vorschau ohne Mutation. Kein Netto-Schalter, keine neue Dokumentart/Blankoanlage, keine Migration. Ein vertikaler Slice mit Backend/UI/Browserprüfung, explizitem Staging und sofortigem Push.

- [x] **BKP016.2 — `fix: calculate offer totals with exact integer intermediates`** (24.10.2026): Vorbereitung der Positionsbearbeitung. Der bestehende Summendienst verliert bei zulässigen großen Centbeträgen durch Float-Zwischenprodukte einzelne Cent (z. B. MAX_SAFE_INTEGER ohne Rabatt). Reproduktion zuerst als roter Unit-Test; Bruttorabatt, Steuerextraktion, Summierung und Steuergruppen intern mit exakten Integer-Zwischenwerten und kaufmännischer Rundung berechnen, nach außen weiter sichere Number-Centwerte. Vorhandene Eingabegrenzen, Brutto-Bedeutung, Überlaufablehnung und finale gespeicherte Artefakte bleiben erhalten. Tests für 0/19 Prozent, Halbcent-Rundung, große Preise, Rabatt, Mengen, Überlauf und Gruppen/Summen. Keine Migration, keine Netto-Preiseingabe oder UI-Erweiterung; vorhandene Dokument-/Vorlagendienste und betroffene Integrationen prüfen. Eigener Commit und sofortiger Push.

- [x] **BKP016.1 — `feat: snapshot and edit offer draft content`** (24.10.2026): Angebote erhalten beim Anlegen eigene Texte (Betreff, Einleitung, Schluss) und Gültigkeit; spätere Vorlagenänderungen beeinflussen sie nicht. Ein fokussierter Editor speichert diese Felder versionsgesichert, zeigt die bestehenden Positionen nur lesend und öffnet eine mit demselben Renderer erzeugte PDF-Vorschau ohne Nummernverbrauch oder gespeichertes Artefakt. Finalisierung verwendet gespeicherte Entwurfstexte. Bestehende Entwürfe ohne historischen Textsnapshot bleiben als solche erkennbar; eine ausdrückliche Speicherung übernimmt aktuelle Vorlagenwerte, ohne historische Inhalte zu behaupten. Finale Dokumente und ihre gespeicherten Bytes bleiben unverändert. Neue additive Migration, Tenant-/Auth-/CSRF-/Versionsschutz, Konflikt-/Fehler-/Retryfälle, Vorschau ohne Nebenwirkung und Vorlagenänderung nach Anlage werden zuerst durch Regressionen belegt. Positionen bearbeiten und Blankoanlage sind ausdrücklich Folge-Slices, keine vollständige AG-02-Abnahme. Umsetzung durch abgegrenzte Luna-Subagents (Backend/UI), Integration und unabhängige Prüfung durch den Hauptagenten. Kein echter Dokumentversand oder Datenimport; Kontingentreserve und keine kostenpflichtige Ausweichnutzung.

Der neue Benutzerauftrag erweitert das Ziel auf möglichst vollständige Funktions-/Bedienparität mit Bookitup und vorsichtige Vereinfachung. [Spezifikation und Einstieg](docs/bookitup-parity/README.md), [konkrete Agentenanleitung](docs/bookitup-parity/agent-playbook.md). Die ältere verkürzte Lieferfolge bleibt Betriebs-/Historienkontext; neue Paritätstickets werden einzeln hier aktiviert. Sicherheits-/Daten-/Testregeln bleiben verbindlich. Keine pauschale Wiederaufnahme aller früher verschobenen Module und kein Produktions-Cutover.

- [x] **R001 — `docs: specify comprehensive Bookitup parity work for agents`**: rein lesender UI-/Source-Vergleich auf `cf68f1e`, anonymisierte Befunde, exakte Skill-/Beweisgrenzen, Interaktionsvertrag, BKP001–BKP030 mit Abhängigkeiten, Source-/Testpfaden und Akzeptanzfällen, discoverable Übergabe. Abnahme: bestehende Dokumentationsprüfungen, rekursive Links/Sourcepfade der neuen Doku, vollständiger explizit gestagter Diff ohne PII/Secrets; Commit und sofortiger Push. Keine App-Verhaltensänderung und kein Deployment. Lokal grün: Plan-/Link-/Anforderungsprüfung, 3 Dokumentationstests, rekursive Prüfung aller 8 neuen Auditdateien einschließlich Sourcepfaden und 30 eindeutiger Ticketüberschriften sowie `git diff --check`. Fachlicher Source-Gegencheck durch drei getrennte Leser eingearbeitet; Runtime-/Skillgrenzen explizit dokumentiert. Commit/Push im selben Dokumentationsabschluss, Remote-SHA separat prüfen.
- [x] **R002 — `docs: prepare Hermes implementation handoff`**: ausführlicher [Hermes-Übergabeprompt](docs/bookitup-parity/hermes-handoff.md) mit MiMo-Koordination, abgegrenzten DeepSeek-Aufgaben, Dateibesitz, erster Arbeitswelle BKP001–BKP008, Skill-/Test-/Gitregeln und Aktivierungsgrenze. Abnahme: Dokumentationstests, lokale Links, vollständiger staged Diff, Commit/Push. **Übergabe inzwischen verifiziert:** Nach manuellem Entsperren am 22.10.2026 wurde der vollständige Prompt per Computer Use in eine neue Hermes-Session mit `opencode-go: mimo-v2.6-pro` (High) übertragen und abgesendet. Inhalt des eingefügten Textanhangs vollständig abgeglichen; Hermes begann sichtbar mit Repository-/Prozessprüfung und erkannte bestehende uncommittete H042-Arbeit. Damit ist der Arbeitsbeginn, nicht die Umsetzung der BKP-Tickets, belegt. Für die Übergabe kein App-Code und keine Provider-/Zugangskonfiguration geändert; das Sessionmodell wurde bewusst ausgewählt.
- [x] **BKP001 — `fix: align month calendar days with weekday headings`** (22.10.2026): Wochentagskopf im DOM vor die führenden Pads gesetzt (`CalendarPanel.tsx`), Offsetberechnung und Backend-Datumsfenster unverändert, keine CSS-Kompensation. Erste Paritätswelle auf `codex/bkp-wave1` (Basis `16616a5`), eigene Arbeitskopie `/Users/gp/Developer/GitHub/auftragskompass-bkp`. Erster Slice nach dem MiMo/DeepSeek-Schnitt: Codetests und Fix durch DeepSeek V4.1 Flash (opencode-go, `hermes -z`-Einzelaufruf, 45 API-Calls, Beleg im Session-Scratch), MiMo prüfte den vollständigen Diff, ergänzte die Transition-Regression (Vor/Zurück/Ansichtswechsel) und führte Gates und Geometrielauf unabhängig aus. Abnahme: Komponentenregression DOM-Reihenfolge (rot beobachtet: `expected '' to be 'calendar-weekday-head'`, 2 fehlgeschlagen) plus echter Chromium-Geometrietest `tests/e2e/month-alignment.spec.ts` für Juni 2026 (Mo), Oktober 2026 (Do), Februar 2026 (So) bei 390/1440 in beiden Themes: Tag 1 in der richtigen Wochentagsspalte (x=33/174/316 bei 390, Spalten 1/4/7), jede Tageszelle in Spalte und Reihe ihres Wochentags, Reihengrenze Sonntag→Montag, 28/30/31 Tage ohne Doppelzellen, fiktiver Eventlink am Monatsanfang `#event-…` erreichbar, kein Body-Overflow in 12 Messungen. Grün: unit 232/232, component 359/359, integration 274/274 (standalone), E2E 6/6 (Port 14883), Format/Lint/Typen/Build/Workspace/Docs, Changed-Code-Coverage 1/1 Zeilen und 2/2 Zweige. Lokale Grenze ehrlich: der kombinierte `test:coverage`-Lauf scheiterte auf diesem Mac viermal allein an Testcontainer-Start-Hooks (120 s) unter Parallellast und einmal am lastempfindlichen `ui-language.test.tsx`; alle betroffenen Dateien standalone grün, Linux-CI maßgeblich. Vorbereitend eigener Commit: `tests/playwright.config.ts` akzeptiert `AK_E2E_PORT` für parallele E2E-Läufe mehrerer Checkouts.
- [x] **BKP002 — `feat: create website options without requiring a resolved contact`** (22.10.2026): gültige Website-Eingänge erzeugen auch ohne auflösbaren Kontakt/Land ein Option-Event. Festgelegte Slice-Entscheidungen (MiMo, aus Ticket/Zielvertrag abgeleitet): (a) die neue kontaktlose Soll-Semantik gilt für den **Optionpfad** (`status:'option'`, automatischer Drain und manuelle Wiederholung); der direkte Legacy-Aufruf (`status:'inquiry'`) behält sein ausdrücklich abweichendes Verhalten laut Ticket-Permissive samt Tests. (b) Kontaktzuordnung: eindeutiger aktiver Exakttreffer → zuordnen (Felder nie überschreiben); null Kandidaten bei klarer Identität → Kontakt nur mit bekanntem Land anlegen, wobei ausschließlich die Betreiber-/Deployment-Vorgabe (`newContactCountry`, `AK_INQUIRY_DEFAULT_CONTACT_COUNTRY`, z. B. DE) das Land liefert — nie öffentliche Eingabe, kein neuer Domänen-Default; Land fehlt oder Identität ist unsicher (mehrdeutig, nur archiviert, Firma/Privat-Mismatch, Namens-/Mail-Kollision) → Event **ohne** Kontakt, kein erfundener/Leerkontakt. (c) neue vorwärtsgerichtete Migration `0033_*` für nullable `website_inquiries.contact_id` (Bestand unverändert, FK/Unique/Hash/Idempotenz erhalten); Receipt-/Response-Typen tragen `null` explizit (`website-inbox-routes.ts` erlaubt `contactId: null`), alle Aufrufer gehen damit um. (d) Rückgabe-/Replayvertrag: ein anfänglich `null`-Receipt bleibt unverändert, aktueller Kontakt kommt aus der Eventbeziehung (in `docs/website-inquiries.md` dokumentieren); Retry/Replay auf vorhandenes Event liefert `duplicate` ohne Zurücksetzen von inzwischen manuell geändertem Status/Kontakt; Option bleibt ohne Reservierung. (e) Öffentliches v1-Schema bleibt unverändert (kein Landfeld). Tests zuerst in `tests/integration/website-inquiries.test.ts` (Fälle F/J auf neues Soll ändern, nicht entfernen; plus kein Treffer/inaktiv/Mismatch/DE-Default/ausdrücklich anderes Land/null-Rückgabe/paralleler Replay/Absturz-Rollback/fremder Tenant/Hashkonflikt/ungültige Signatur) sowie nullable Beziehung in `website-inquiry-sync`/`-ack`/Restoretests; Kontaktdatenbank behält Landpflicht. Aktivierungsgrenze: vor jedem Rollout von BKP002–BKP004 muss die explizite Aktivierungsgrenze aus BKP004 stehen; ein Betreiberentscheid zur Übernahme echter Rückstände fehlt bisher und wurde nicht aus dieser Übergabe abgeleitet — deshalb kein Merge in den Auslieferungs-Branch und kein Deployment dieser Semantik. Basis `16616a5`, Slice-Basis `1f68042`; Codetests/Implementierung delegiert an DeepSeek V4.1 Flash (100 API-Calls, Bericht/Usage im Session-Scratch), Review/Integration/Commit MiMo. **Abnahme:** RED beobachtet und zitiert (u. a. F/J `expected [ 'website_option_contact_review' ] to deeply equal []`, Inbox-API 409 statt 200, Migration `expected 'NO' to be 'YES'`, Komponente ohne „Kontakt noch offen“); GREEN unabhängig wiederholt: integration 284/284 (31 Dateien, inkl. neuem `tests/integration/website-inquiry-migration.test.ts`: Bestandszeile unverändert, FK 23503, UNIQUE 23505, Hash-CHECK 23514, doppeltes `migrate()` idempotent), unit 232/232, component 360/360, vollständiger `test:coverage` grün (876 Tests, alle globalen Schwellen), Changed-Code-Coverage 10/10 Zeilen und 13/14 Zweige, Format/Lint/Typen/Build/Docs grün. Semantik-Matrix und Rückgabe-/Replayvertrag in `docs/website-inquiries.md`; die Intake-Doku hat MiMo auf die neue Semantik nachgezogen (`docs/website-inquiry-intake.md`). Ausgewiesen und zwingend angepasst: `tests/integration/identity.test.ts` (letzte Migration 0033). `contact_review` bleibt ausschließlich für den Legacy-Modus und im Fehlercode-Mapping. **Kein Merge/Deploy:** die Aktivierungsgrenze aus BKP004 steht noch nicht, ein Betreiberentscheid zur Übernahme echter Rückstände ist offen und wurde nicht aus der Übergabe abgeleitet. **Nachtrag (CI-Nachprüfung):** Der erste CI-Lauf zu `20910b1` war rot in `tests/e2e/auth.spec.ts` (beide HTTPS-Sign-in-Läufe erwarteten noch den `contact_review`-Alarm von vor BKP002; Rot-Beleg Run 39871013436: `expect(inboxEntry.getByRole('alert')).toContainText` – „element(s) not found“). Die Browser-Erwartung folgt jetzt der ausgelieferten Semantik (kontaktloser Erfolg „Kontakt noch offen“, Eingang verlässt das Ausnahmefach, Receipt-Kontakt bleibt auch beim Replay `null`); außerdem relayt der HTTPS-Testrahmen statische Requests nun auf `AK_E2E_PORT` statt hartkodiert 14873 (Vervollständigung des Test-Port-Commits `bd69faa`). Lokal grün: genau die beiden zuvor roten Läufe 2/2 (32 s/58 s), Typen/Format/Lint sauber.
- [x] **BKP003 — `fix: retry website options fairly without starving later entries`** (22.10.2026): der vorhandene `startWebsiteOptionDrain()`-Lauf fair und wiederholbar machen (kein zweiter Worker). Defekt: älteste-zehn-Abfrage plus prozesslanges `attempted`-Set verdrängt neuere Eingänge dauerhaft und hält temporäre Fehler bis Neustart fest. Soll (MiMo festgelegt): begrenzter sequenzieller Drain mit fairer Keyset-Fortsetzung über den gesamten Pending-Bestand pro Takt (Reihenfolge `staged_at,id`), sodass spätere gültige Eingänge hinter alten Fehlern erreicht werden; per-entry Fehlerbehandlung ohne Prozess-Blacklist — vorübergehende/Infrastrukturfehler im nächsten zulässigen Takt erneut, dauerhafte Eingabefehler (expired/conflict/invalid) nicht in Hotloop wiederholt (in-memory Rückhalte bis Neustart genügt, keine neue Persistenz ohne Bedarf, kein Redis/kein zweiter Scheduler); Fehler eines Eintrags blockiert keine Nachbarn; genau ein Takt gleichzeitig (keine Parallelität, kein Shutdown-Race), Abbruch hinterlässt über den Pending-Bestand wiederaufnehmbaren Zustand; Readiness-Konventionen erhalten („ready“ heißt nicht erledigter Geschäftseingang); Signatur-/Quittierungs-/Ablaufsemantik unverändert. Tests zuerst: elf Eingänge, älteste zehn scheitern, elfter wird erreicht; erster temporärer Fehler ohne Neustart wiederholt; Listenfehler erholt sich; Neustart/Replay ohne Doppel-Events; kein gleichzeitiger Takt/Shutdown-Race; bestehender Test „nur einmal pro Prozess“ bewusst auf neues Soll ändern. Zusätzlich `docs/website-inquiry-intake.md` (Absatz „prozesslokaler Satz“) auf die neue Wiederholungssemantik ziehen. Basis `20910b1`; Codetests/Implementierung delegiert an DeepSeek V4.1 Flash (62 API-Calls), Review/Integration/Commit MiMo. **Abnahme:** RED beobachtet (Unit u. a. Kerndefekt „expected […] to have a length of 11 but got 10“ und „temporary failure … called once, but got 0 times“; Integration gegen die alte Worker-Version „11. Eingang nie erreicht, Retry nie“); GREEN unabhängig wiederholt: unit 234/234, integration 286/286 (je ein neuer Fairness- und Wiederholungstest; A–K/F/J unverändert grün), Format/Lint/Typen/Docs grün. Umgesetzt: `listPending` mit Keyset-Cursor `(staged_at,id)` und Seitenfortsetzung bis zur leeren Seite (voller Pending-Bestand pro Takt), `attempted`-Blacklist ersetzt durch prozesslokales `held`-Set nur für dauerhafte Eingabefehler (einmal gemeldet, keine Hotloop), temporäre/Infrastrukturfehler werden im nächsten Takt ohne Neustart erneut versucht, Fehler eines Eintrags blockiert keine Nachbarn, `pending`-Guard/`stop()`/Readiness-Konventionen unverändert, keine Migration, kein zweiter Worker, kein Redis. Bestehender Test „nur einmal pro Prozess“ bewusst ersetzt (Solländerung im Testkommentar dokumentiert); `docs/website-inquiry-intake.md` auf die neue Wiederholungssemantik gezogen. Bekanntes Risiko (im Bericht offen benannt): ein Takt arbeitet den kompletten Rückstand ab (Laufzeit linear zum Rückstand), kein Tick-Zeitbudget; `held` wächst prozesslokal mit dauerhaft fehlerhaften Eingängen. Endabnahme mit BKP002 erfüllt; kein Rollout ohne Aktivierungsgrenze.
- [x] **BKP004 — `refactor: handle website inquiries through normal option events`** (22./23.10.2026, in zwei Unter-Slices abgeschlossen). **BKP004.1 abgeschlossen (22.10.2026, `feat: gate the automatic website option drain behind explicit activation`):** explizite Aktivierungsgrenze `AK_INQUIRY_OPTION_DRAIN` (nur `on` startet den automatischen Takt; fehlend/`off` paussiert ihn mit einmaliger Warnung `website_option_drain_inactive` bei weiter bereitem Worker; jeder andere Wert `website_option_config_invalid`, nicht bereit; kein Trimmen, keine Kleinschreibung — Prüfreihenfolge: Identitäten zuerst, dann Aktivierung). Gateway-Empfang, Staging, Quittung, Sync und manuelle Übernahme unberührt. Deploymentvorlagen reichen die Grenze bewusst pausiert durch (compose.yaml `AK_INQUIRY_OPTION_DRAIN:-off` samt Identitäts-Optionalität, Quadlet `Environment=AK_INQUIRY_OPTION_DRAIN=off`; Vertragstest `tests/ops/deployment-env.test.mjs`, rot beobachtet und grün nachgereicht; `docker compose config` real geprüft). Doku: `.env.example` mit Warnung, `docs/website-inquiries.md` + `docs/website-inquiry-intake.md` „Aktivierungsgrenze und Rollout“ mit Wertetabelle, 3-Schritt-Rollout (zuerst rein lesende Mengen-/Fehlerübersicht außerhalb Git, dann Betreiberprüfung, dann `on`) und rein lesenden SQL-Beispielen; ausdrücklich festgehalten: keine Übersicht erstellt, kein Drain aktiviert, keine Bestandsdaten ausgewertet. Rot beobachtet (6 failed: „loadWebsiteOptionDrainActivation is not a function“, inaktiver Drain startete trotzdem, falsche Startfolge); GREEN unabhängig wiederholt: unit 241/241, component 360/360, integration 286/286, `test:coverage` vollständig (887 Tests, Schwellen erreicht), Changed-Code 14/15 Zeilen und 8/8 Zweige, Format/Lint/Typen/Build/Docs grün, Compose-Config real valide. Ausgewiesen und zwingend angepasst: `packages/core/src/index.ts` (Export), `tests/unit/worker-main.test.ts` (Aktivierung im bestehenden Draht-Test). **BKP004.2 abgeschlossen (23.10.2026, `refactor: handle website inquiries through normal option events`):** Die Ausnahmequeue ist aus dem Event-Arbeitsbereich entfernt (`EventPanel` rendert `WebsiteInbox` nicht mehr); website-erzeugte Optionen stehen als normale Eventzeilen mit ruhigem Quellenlabel „Website“ (`.event-source-quiet`, Quiet-Tokens, Herkunft statt Status; Restrisiko dokumentiert: Erkennung nur über `Website:`-Präfix). Die Diagnose lebt als Einstellungsabschnitt „Website-Eingänge (Diagnose)“ (`#settings-website`, Unternavigation wie `settings-resources`/`settings-products`, `aria-current` erhalten) mit technischem Einleitungstext („kein Pflichtschritt vor der Eventanlage“), manueller Übernahme als autorisierte Wiederholung, Landfeld als Betreiberentscheid und unverändertem Leerzustand; sie liest beim Mount (ein GET pro Besuch der Einstellungsseite, nur bei `route==='website'` gemountet). In der Eventakte heißt die Offenlegung „Website-Anfrage“, das Original bleibt escaped lesbar und ist auch für kontaktlose Optionen erreichbar (lazy, `/api/v1/events/:id/website-inquiry` unverändert); die Kontaktkarte zeigt „Kontakt noch offen.“ als normalen offenen Zustand, spätere Zuordnung über die normale Eventbearbeitung (Status/Version geprüft). Keine Migration, keine Schema-/API-Änderung, keine gelöschten Aufbewahrungs-/Quittungsdaten. Rot beobachtet (16 failed/106 passed in 6 Komponentendateien, u. a. „Unable to find … Website-Anfrage“, fehlende Region „Website-Eingänge (Diagnose)“, `#settings-website` fiel auf `events` zurück); GREEN unabhängig wiederholt: unit 241/241, component 362/362, integration 286/286, `test:coverage` vollständig (889 Tests, Schwellen erreicht), Changed-Code 6/7 Zeilen und 8/8 Zweige, Format/Lint/Typen/Build/Docs grün, E2E auth 2/2 (beide Anmeldemodi, vollständiger synthetischer Weg Eingang → Diagnose → Übernahme → Badge-Option → Event → Original → „Kontakt noch offen“ → spätere Zuordnung mit Version+1; axe wcag2a/aa+21/22 und kein Body-Overflow bei 1280/390 in Hell und Dunkel). Ausgewiesen und zwingend angepasst: `docs/website-inquiry-intake.md` (alte Heimat beschrieben). Badge nur in der Eventzeile (Kopf zeigt „Anfragequelle“ als Text) — bewusst kompakt gehalten. Damit ist BKP004 insgesamt abgeschlossen; die Aktivierungsgrenze aus 004.1 bleibt Voraussetzung jedes Rollouts, weiterhin kein Merge/Deploy ohne Betreiberentscheid.

- [x] **BKP005 — `style: use restrained neutral surfaces in both themes`** (23.10.2026): neutrale Flächen in beiden Themes statt dominanter Grünflächen. Umgesetzt (MiMo/DeepSeek-Schnitt, 112 API-Calls, Bericht `scratch/bkp005-report.txt`, Vorher-/Nachher-Screenshots im Scratch): alle Theme-Tokens in `styles.css` neu abgestimmt (Darkmode warmes Anthrazit, Hellmode neutrales Offwhite), die festen Seitenleisten-/Backdrop-/Scrim-/Kalender-Farben in Tokens überführt (`--sidebar-*`, `--menu-close-border`, `--backdrop`, `--scrim`, `--calendar-ink`), neue `--disabled-surface`/`--disabled-ink` (gestaffelte Disabled-Tiers nennen jetzt eigene Farben statt 0,6-Deckkraft; generische Inputs behalten die Deckkraft). Grün bleibt als kleiner entsättigter Akzent (Aktion/Fokus/aktive Navigationszeile, `--accent`/`--action` #3d6b58/#9dc1af); H036-Tiers, 44-px-Ziele und Fokus 3px/3px unverändert. Kontraste beider Themes gemessen (Fließtext 16,2/13,3; gedämpft 6,7/7,3; Aktion 6,1/8,6; Fokus 6,5/10,0; Disabled 4,57/6,13; Grenzen ≥3), Status weiterhin textlich benannt. Abnahme im echten Chromium bei 390/1280 in Hell und Dunkel: Referenzfläche (Liste, Formular, Legende, Dialog) sichtbar, kein Body-Overflow, Fokusring ≥3:1, Grünstich-Pixelanteil dunkel 96,2 % → 1,5 % (390) bzw. 0,6 % (1280); `apps/admin/DESIGN.md` trägt exakt die ausgelieferten Werte. Rot beobachtet (4 Component-Tests + E2E „rail is anthracite“ 15 > 4 gegen die Alt-Palette); GREEN unabhängig wiederholt: component 366/366 (u. a. neue Greenness-/Kontrast-/Disabled-Regressionen), unit 241/241 (ein bekannter `worker-main`-Readiness-Timing-Flake im Sammellauf, standalone 2/2 grün — vorbestehend), integration 286/286, `test:coverage` vollständig (893 Tests, Schwellen erreicht), Format/Lint/Typen/Build/Docs grün, E2E 6/6 (shell inkl. Referenzfläche + beide HTTPS-Anmeldemodi). Changed-Code-Coverage 0/0 (keine geänderten TS-Quellzeilen; Abnahme tragen die Messwerte). **Offen dokumentiert:** `.impeccable/design.json` zeigt noch die alte Palette (Sidecar-Drift; regelkonform nicht als Nebenwirkung repariert — nächster Design-Pass: `$impeccable doctor`); die Statuspastellen in `CalendarPanel.tsx` (colors-Map, „frei“ grün-pastell) blieben als kleine belegungsbezogene Zustandsflächen bewusst unverändert; enge Margen: Disabled hell 4,57:1, `quiet-action-border` hell 3,43:1 (jeweils über der 3:1-Grenze).
- [x] **BKP007.1 — `feat: place event filters in a contextual sidebar and mobile drawer`** (23.10.2026): Die Eventfilter stehen als Desktop-Kontextspalte (`.event-context`, 15–17,5 rem = 240–280 px, direkt links der Ergebnisse, geprüfte Bounding-Box bei 1280/1024) mit der Bookitup-Gruppenfolge (Suche → Ansicht mit nur vorhandenen Zielen `#events`/`#calendar` → Sortieren mit „Ohne Datum“-Zähler → „Anfragen“ als Schnellfilter außerhalb der Sortier-Radiogruppe → Zeitraum-Presets → gefaltetes „Eigener Zeitraum“ → Buchungsstatus → Auftragsarten → Aktionen); genau eine Filterkopie, ein Formular (`filterPanel(mobile)` als gemeinsame Quelle), ein URL-Schreiber, keine Filterwand über den Ergebnissen. Mobil (≤1023) bleibt die Liste zuerst: kompakter „Filter“-Zugang mit Kriterienzahl (`activeFilterCriteria` zählt Dimensionen q / from+to+undated / status / eventTypeId, nicht Zeilen) und „Zurücksetzen“, dahinter ein voll bedienbares Sheet mit denselben Gruppen, „Ergebnisse anzeigen“ = genau ein History-Eintrag (per Zurück exakt die vorherige URL), „Filter schließen“ verwirft nur den Entwurf, Escape/Fokussalle (24× Tab) und Fokusrückkehr auf den Zugang; schmutziger Event-Editor bleibt erhalten; Preset-/Tenant-Zeitzonen-/Schaltjahres-/`df_*`-Logik unverändert (matchMedia 1024 mit Fallback „Spalte“ ohne matchMedia). Rot beobachtet (unit 1/242 „activeFilterCriteria is not a function“, neue Komponentendatei 10/10); GREEN unabhängig wiederholt: unit 242/242, component 381/381 (neue `event-filter-layout.test.tsx` 10 Tests), integration 286/286, `test:coverage` (909 Tests), Changed-Code 128/132 Zeilen und 168/180 Zweige, Format/Lint/Typen/Build/Docs grün, E2E 5/5 (auth beide Modi + shell) mit Browserabnahme 1280/1024/768/390/320 in Hell und Dunkel (kein Body-/Sheet-Overflow, Fokusverhalten, ein History-Eintrag). **BKP007.2 abgeschlossen (23.10.2026, `fix: count event filter totals server-side`):** `GET /api/v1/events` liefert additiv `filterCounts: {undated, inquiries}`, berechnet in derselben Repeatable-Read-Transaktion wie die Liste über EINE `count(*) filter (…)`-Aggregatsabfrage neben den Zeilen (keine Abfrage je Event, keine unbeschränkte Gesamtliste; Testbeleg: genau 2 `events`-Lesezugriffe, davon einer mit `count(`). Gemeinsame Filterliste `narrowing()` für Zeilen und Zähler: `q`/`status`/`eventTypeId` schränken ein, `from`/`to`, Sortierung und Undatiert-Ansicht nie (Datumsunabhängigkeit gemäß H041); Antwortfelder alt/`filterCounts`/`timeZone` exakt, `events` feldgleich zum Repository-Ergebnis (Abwärtskompatibilität getestet), Mandantentrennung getestet. Client zeigt die Serverwerte; die toten Clienthelfer `eventFilterCounts`/`filterRows`/`countable`/`FilterRow` sind entfernt, `FilterCounts`/`emptyFilterCounts` ersetzen sie; Zählbasis tabellarisch in `docs/event-search.md`. Rot beobachtet (Integration `expected undefined to deeply equal { undated: 2, inquiries: 3 }`, Component `expected '0' to be '4'`); GREEN unabhängig wiederholt: unit 242/242, component 382/382, integration 287/287, `test:coverage` (911 Tests), Changed-Code 15/15 Zeilen und 14/16 Zweige, Format/Lint/Typen/Build/Docs grün, E2E auth 2/2. **Offene Referenzfrage (bewusst nicht erfunden):** Die Statusabhängigkeit des Anfragenzählers bleibt wie bisher (angewandter Statusfilter gilt mit) — ob Bookitup das ebenso handhabt, ist unbelegt und vor einer Änderung gezielt an der Referenz abzugleichen. **Weiter offen:** Monat/Jahr-Bedienung, echte Ansichtwechsel, Status-/Art-Mehrfachwahl (API kennt Einzelwerte), Solo/Agentur ohne Referenz — laut Ticket Folge-Unter-Slices erst nach gezielter Referenzprüfung.
- [x] **BKP007.3 — `fix: keep the mobile filter sheet a coherent draft until applied`** (23.10.2026, Korrektur-Slice): Von Codex unabhängig reproduzierte P1-Regression der mobilen Filter (Reproduktion am unveränderten `836d627` mit Vitest-Komponentenregression, 3 Assertions rot; Testkopie außerhalb Git unter `/Users/gp/Documents/AuftragsKompass-Sicherung/hermes-review-2026-10-23/review-mobile-filter.tmp.test.tsx`). Fehlerbild: (1) Im mobilen Sheet schreiben Sortierung/Presets/„Anfragen“/„Eventfilter zurücksetzen“ sofort die URL, während Suche/Status/Datum Entwurf bis „Ergebnisse anzeigen“ sind; der URL-Key `key={urlSearch + ':' + timeZone}` remountet daraufhin das Formular und verwirft den Eingabeentwurf (Beleg: Suchfeld springt nach Klick auf „Ohne Datum“ von „Synthetic unsaved search“ auf „Synthetic“ zurück, `pushState` wurde bereits einmal aufgerufen). (2) „Filter schließen“/Escape nehmen die schon geschriebenen Änderungen nicht zurück (URL nach Schließen `?q=Synthetic&undated=true` statt der ursprünglichen `?q=Synthetic&from=2026-10-01`). (3) `applyFilters` setzt `undated` immer auf leer: „Ohne Datum“ auswählen und anschließend „Ergebnisse anzeigen“ hebt die eigene Auswahl wieder auf. Soll (verbindlich): Im mobilen Drawer gilt EIN kohärenter Entwurf für ALLE Filter (Suche/Status/Art/Datum/Sortierung/Presets/„Anfragen“/„Zurücksetzen“); nichts im Sheet schreibt die URL. „Ergebnisse anzeigen“ schreibt atomar genau einen History-Eintrag und holt Ergebnisse; Sortierung „Ohne Datum“ bleibt dabei bestehen und löscht gemäß bestehender Semantik die Datumsgrenzen; chronologisch setzt `undated` leer. „Filter schließen“ und Escape verwerfen ALLE Entwurfsänderungen, erhalten die angewandte URL/Ergebnisse und geben den Fokus an den Filterzugang zurück. Der Entwurf geht bei keiner Kombination (Suche+Preset/Sort/Status/„Anfragen“) verloren. Desktopverhalten bewusst unverändert (sofortige Schreibaktionen in der Kontextspalte bleiben); keine neuen Abhängigkeiten, keine neue Formulararchitektur. Erhalten bleiben `df_*`/fremde Queryparameter, Tenant-Zeitzone, Browser-Zurück (trifft die vorherige URL), ungültige Bereiche (Eingaben bleiben) und der schmutzige Eventeditor. Bestehender Test „both presentations read the same applied filter state“ schreibt den Fehler als Vertrag fest und wird SINNVOLL korrigiert (Sheet-Preset = Entwurf ohne History-Eintrag, Abschluss = genau ein Eintrag mit `undated=true` und ohne `from`), nicht durch zusätzliche grüne Tests ersetzt. Tests zuerst rot (Reproduktionsfall + negative Fälle), echter Chromium-Ablauf Desktop+Mobil mit Mischbedienung, Abbruch, Abschluss und Zurück. MiMo prüft vollständigen Diff und Gates unabhängig; explizites Staging, sofortiger Push, finale CI exakt zum neuen HEAD. Kein Merge/Deploy, keine echten Daten, keine Aktivierung des Website-Drains, keine BKP009–030.
**Abnahme BKP007.3:** Rot auf unveränderter HEAD-Fassung beobachtet (8 failed/9 passed, u. a. `expected 'Synthetic' to be 'Synthetic unsaved search'`, URL `?q=Synthetic&undated=true` statt `?q=Synthetic&from=2026-10-01`, 4 bzw. 2 statt 1 `pushState`); GREEN unabhängig wiederholt: `event-filter-layout.test.tsx` 17/17 (Reproduktion + korrigierter Vertrag „both presentations …“ — Sheet-Sort = Entwurf ohne History-Eintrag, Abschluss = genau ein Eintrag mit `undated=true` ohne `from` — plus Mischkombination, Bug 3, Abbruch/Escape, In-Sheet-Reset, Desktop-Kontrast), component 402/402, unit 243/243, integration 287/287, `test:coverage` (932 Tests, Schwellen erreicht), Changed-Code 44/47 Zeilen und 67/70 Zweige, Format/Lint/Typen/Build/Docs grün, E2E 13/13 (alle Spec-Dateien; auth beide Modi mit Mischbedienung ohne URL-Schreiben, Abbruch mit Fokusrückkehr, Abschluss mit genau einem `/api/v1/events`-Abruf, `goBack` trifft exakt die vorherige URL, 390 hell+dunkel und Desktop-Kontrast 1280/320/768 ohne Overflow). Umgesetzt: `filterDraft` wird beim Öffnen aus der angewandten URL initialisiert, jedes Sheet-Bedienlement schreibt nur in den Entwurf (stabiler Form-Key, kontrollierte Felder, kein Remount), „Ergebnisse anzeigen“ schreibt atomar genau einen History-Eintrag (Sortierung „Ohne Datum“ bleibt bestehen und löscht die Datumsgrenzen; `undated` nie mehr pauschal leer), „Filter schließen“/Escape verwerfen ALLE Entwurfsänderungen und geben den Fokus zurück, In-Sheet-Reset leert nur den Entwurf; Desktop-Kontextspalte behält den Sofortschreiber. **Ehrliche Grenzen dieses Korrekturslices:** eine neu getippte Datumsgrenze hebt den Entwurfs-Sortierer weiterhin auf (bisherige `applyFilters`-Regel „eingereichter eigener Zeitraum ist chronologisch“, auch Desktop-Submit lässt `undated` beim Absenden los — bewusst unverändert laut Vorgabe „Desktopverhalten erhalten“); Popstate bei offenem Sheet lässt den Entwurf stehen (Sheet ist modal); Desktop verliert getippte Suche beim Sofort-Preset weiterhin (unverändert); „Eigener Zeitraum“ öffnet im Sheet imperativ; keine Bildsicht (Belege: Geometrie-/Overflow-Asserts + Screenshots).
- [x] **BKP008 — `feat: make the mobile month calendar readable with a day agenda`** (23.10.2026): Das Monatsraster bleibt ein echtes Mo–So-Raster (BKP001-Ausrichtung unverändert, `month-alignment.spec.ts` 3/3 grün) und wird mobil lesbar: Tageszelle ist ein nativer Tagesknopf mit einzeiliger Zahl (nicht mehr „Do., 01.10.“ in jeder Zelle), Ereignisanzahl als Pille ab zwei Events, gezeichnete SVG-Statusmarken je Status (Form statt Farbe), „heute“ gestrichelt plus Wort und Auswahl als Kontur plus Innenring — ohne große Farbfläche unterscheidbar. Darunter die vollständige Tagesagenda: ganzer Titel (kein Abschneiden, Langtitel geprüft), Zeit bzw. „Tagesbuchung, ohne Uhrzeit“, Status/Ort/Kontakt/Ressourcen und erreichbarer Eventlink; ein leerer Tag sagt „Keine Events an diesem Tag.“; Tageswechsel ohne Refetch, Raster mit genau einem Tab-Stopp plus Pfeiltasten (Home/End am Rand), Legende kompakt, fachliche Warnung unverändert. BKP001 fordert den Eventlink zusätzlich in der Zelle ab 60 rem — erhalten. **H042-Abgleich erfüllt:** die Tageliste von `codex/h042-mobile-geometry` wurde bewusst nicht übernommen (Zielvertrag §4 „keine freie Terminliste“), Sticky-Footer/44-px-Regeln dort bleiben separat dokumentiert. Rot beobachtet (10/10 neue Komponententests, u. a. `expected ['1','2',…] to deeply equal ['Do., 01.10.', …]`); zwei echte Regressionsfunde der Gates behoben: axe `label-content-name-mismatch` (auth.spec 2/2 rot, 41 Knoten → 0) und 2 px Grid-Überlauf durch globales `li > button`-Margin (272 → 270 bei 320). GREEN unabhängig wiederholt: unit 243/243, component 395/395 (neu `calendar-mobile.test.tsx` 13), integration 287/287, `test:coverage` (925 Tests), Changed-Code 57/58 Zeilen und 87/93 Zweige, Format/Lint/Typen/Build/Docs grün, E2E 13/13 (calendar-mobile 3 neu, month-alignment 3, auth 2, shell 4+Referenzfläche) mit Browserabnahme 320/390/768/1280/1440 hell+dunkel (Agenda-Langtitel 132,8 px ungekürzt, Kontraste hell 6,1–16,2 / dunkel 7,3–13,3). **Dokumentierte geometrische Grenze:** bei 320 px sind es 7 Spalten à 32,9 px — 44 px Zielbreite ist im Mo–So-Raster unmöglich; Höhe 44 px gehalten, die ganze Zelle ist Ziel, zusätzlich bestehen Pfeiltasten und die Agenda. Offen vermerkt: kein physischer Touch-/Swipe-Test (kein Gerät), Datumsfeld bleibt ungefaltet, `auth.spec` läuft lokal nur unter Node 26 (Node 23 scheitert unabhängig an `sanitize-html`).
- [x] **BKP031.1 — geprüften Stand sicher in den Testbetrieb geliefert** (23.10.2026, Release-/Betriebsslice): geprüften Stand `eef40bd` sicher in den bestehenden Testbetrieb liefern (Sequenz A aus `docs/bookitup-parity/delivery-workflow.md`, die hier verbindlich verlinkt ist). Vorgehen: (1) Fast-forward-Beziehung `cf68f1e` → `eef40bd` erneut prüfen; die freigegebene UX-Branch `codex/ux-event-simplification` nur per Fast-forward auf den geprüften Paritätsstand vorziehen (Historie erhalten, kein Force-Push, `main` unangetastet). (2) Vollständig grüne CI **einschließlich images** exakt zum freigegebenen SHA auf dieser Branch abwarten (Allowlist `quality.yml`; ein quality-Lauf allein ist kein Deploynachweis). (3) Genau EINEN Updateweg nutzen: den koordinierten automatischen Updater `ak-test-update.timer` (Checkpoint mit Dienste-Pause, verifizierter Dump, zusätzliche Hostkopie mit identischem SHA-256, Digest-Pins, OCI-Revisionsprüfung, `needs-attention`-Fehlersperre, gemeinsames Schloss `/run/lock/auftragskompass-update.lock`); keine parallelen manuellen Updates, laufenden Service abwarten, Timerzustand bewahren. (4) Der automatische Website-Option-Drain bleibt ausdrücklich **off** (kein `AK_INQUIRY_OPTION_DRAIN=on`; Beleg: Worker-Meldung `website_option_drain_inactive`, bereit, Gateway-Empfang läuft, keine Übernahme echter Rückstände). (5) Nach dem Update: drei gesunde Container + exakte OCI-Revision + sichtbare Buildkennung + Browser neu laden (keine ungespeicherten Eingaben verwerfen) + Assets/Filterposition/Theme + **direkte Desktop-/Mobil-Bildprüfung** (Screenshots privat, Build-SHA-bezogen); Betreiberausgleich der Hostkopie mit identischem SHA-256 notieren. (6) Statusmatrix `docs/bookitup-parity/delivery-workflow.md` auf VISUELL ABGENOMMEN / AUSGELIEFERT hochziehen. Kein Produktiv-Cutover, keine echten Datenimporte/Mails, kein Schema-/Datenkontrollverlust; Checkpointfehler stoppen vor Änderungen. Danach Sequenz B (BKP014.1, dann BKP013.1, jeweils einzeln aktiviert, getestet und über denselben Weg ausgeliefert).
- [x] **BKP013.1 — `refactor: organize event details around focused work areas`** (23.10.2026): stabiler Ereigniskopf (Datum/Titel/Status) und klare Kontexte Details/Ressourcen/Dateien (Auftrag Sequenz B.2 + tasks-core BKP013): vorhandene Dokumente aus „Allgemein/Übersicht“ in einen eigenen Dateien-Kontext verschieben (nach tatsächlicher Art beschriften, bestehende Angebote dürfen nicht verschwinden), Notizen/Logbuch sinnvoll zugänglich erhalten, KEIN Mail-Attrappenreiter ohne Mailfunktion; Hauptinformationen Allgemein/Termin/Kontakt/Ort gut gruppiert, mobil Fokus aufs Nötigste; unvollständiges Website-Event ist ein normaler Zustand. Anlegen/Bearbeiten/Speichern/Abbrechen, Dirtyschutz, Wiederladen und Zurück müssen einen vollständigen benutzbaren Weg ergeben; alte Bereichsanker/Back sauber kompatibel auflösen; Ressourcen-/Statusmutation bleibt dieselbe atomare API; kein Backend-Umbau. Tests: Bereichswechsel erhält schmutzige Entwürfe oder fragt, Hintergrundrefresh überschreibt nicht, Dokumenterfolg bleibt bei Neuladefehler sichtbar, Fokus auf gewähltem Bereich, Tastatur/320px. Commit `refactor: organize event details around focused work areas`; danach Auslieferung über denselben Weg und visuelle Abnahme am ausgelieferten Build. **Abnahme/Belege BKP013.1:** Stabiler Ereigniskopf (`event-record-head`, Datum/Zeitfenster/Titel/Status/Art/wirksamer Ort, `data-status` + Statusmarke, Website-Badge, defensiv `source ?? ''`); fünf Bereiche Details/Ressourcen/Dateien/Notizen/Logbuch (kein Mail-Reiter), Dokumente aus „Übersicht“ in den Dateien-Konticht verschoben und nach tatsächlicher Art gruppiert (Angebote als vorhandene Gruppe, andere Arten nur mit echten Zeilen — keine erfundenen Gruppen, bestehende Angebote bleiben); Notizen/Logbuch direkt erreichbar (Notizen bleiben wie zuvor Anzeige — Bearbeitung im Eventformular); Bereiche bleiben `hidden` eingehängt (Status-/Dispositionsentwürfe überleben jeden Wechsel und Hintergrundrefresh), gewählter Bereich erhält den Tastaturfokus; Kontakt/Ort ab 64rem daneben, darunter als bewusstes Disclosure; unvollständiges Website-Event = normaler Zustand („Kontakt noch offen.“). Anker: Bereiche waren nie URL-adressierbar (State), `#event-<id>`/`eventTargetHref` treffen die Akte unverändert, „Übersicht“ = „Details“ mit identischem Inhalt. Nebenbefund behoben: Fixture ohne `source` ließ den Kopf abstürzen → `(source ?? '')`. Rot beobachtet (11/11 neue Kriterientests, u. a. fehlende Rollen „Details“/„Dateien“, `expected null to be truthy` für den Kopf); GREEN unabhängig wiederholt: component 423/423 (`event-record-contexts.test.tsx` 11), unit 243/243, integration 287/287, `test:coverage` (953 Tests, Schwellen erreicht), Changed-Code 61/62 Zeilen und 94/99 Zweige, Format/Lint/Typen/Build/Docs grün, E2E 6/6 (auth beide Modi mit Aktenwegen + shell) und im Agentenlauf zusätzlich axe 0/12 Aktenzustände, 320/390/1280 hell+dunkel ohne Overflow, Aktenschale einzeilig, Aside mobil zu/1280 rechts daneben, Dirty-Weg Status+Disposition, Zurück zur Liste. **Restabweichungen:** Notizen in der Akte read-only (Bearbeitung im Eventformular — unveränderter Vorstand); Browser-Zurück/„Schließen“ verwerfen schmutzige Entwürfe ohne Rückfrage (app-weiter dokumentierter Altzustand, popstate nie abgesichert); Kopf nicht sticky; Kontakt/Ort-Disclosure erst unter 64rem; bei 320 brechen die fünf Bereichsnamen um (44 px Höhe bleibt); keine Bildsicht/echten Zoom-/Touch-Abnahme. **Nachtrag Auslieferung/Abnahme (23.10.2026):** UX-Branch FF `f8d19ea` → `605f75b`, CI 40014987242 quality+images success, `ak-test-update.timer`-Lauf 22:09:59, drei gesunde Container auf `605f75bd1a913feb6087b4b954de39c5e6420b46`, Checkpoint-Kopien ×3 identisch `dcc63a566bc2…`, `last-success` gesetzt, kein `needs-attention`, Drain weiter inaktiv. Visuelle Abnahme am live ausgelieferten Build: acht Zustände 320/390/768/1280 × Hell/Dunkel (Kopf/Bereiche/Artengruppierung/„Kontakt noch offen“/kein Mail-Reiter/Overflow 0), Belege privat `delivery-2026-10-23/bkp013-1-605f75b-*`; Vorher `bkp013-1-vorher-*` (vier Bereiche, Dokumente in Übersicht), Warum = Nutzerbefund + Referenz B04/B05.
- [x] **BKP014.1 — `feat: make event rows scannable cards with a date column`** (23.10.2026): Bookitup-nahe lesbare Eventliste aus vorhandenen Daten, Desktop und mobil (Auftragstext `delivery-and-visible-parity.txt` Sequenz B.1; Referenz B01 „ruhige Eventkarten mit Datumsspalte/Statusstrich/Art/Titel/Ort/Öffnen“). Soll: Datumsspalte (Tag dominant, Wochentag/Monat klein — vorhandene `calendar-range`-Helfer wiederverwenden), klarer Statusmarker PLUS zugänglicher Statusname, Art über Titel, Ort darunter, kompakte native Öffnenaktion, ruhige Monatsüberschrift mit Anzahl; KEINE langen zusammengeklebten Name-Datum-Uhrzeit-Status-Strings als einzige Hierarchie, KEINE technische Ressourcenanweisung in jeder Zeile; Bearbeiten/Duplizieren über kontextuelle ruhige Aktion, keine verschachtelten Buttons in Links; KEINE unechten Ressourcenbadges (fehlende Daten = ehrlich unbekannt/zuordnen; echte aggregierte Ressourcenprojektion ist BKP014.2); Reservierungs-/Geld-/Importlogik unverändert. Tests, die die Nutzerkriterien tatsächlich nachweisen (Scan-Reihenfolge Datum/Status/Name/Ort, vollständige Titel ohne Abschneiden, Monatskopf mit Anzahl, Leer-/Keine-Treffer-/Fehlerzustand), nicht nur „kein Overflow“. Nach Review/Push über denselben sicheren Weg ausliefern, dann visuelle Abnahme am AUSGELIEFERTEN Build (320/390/768/1280(1440), beide Themes, synthetischer Bestand ≥ 6 Events/2 Monate, 0/1/mehrere Ressourcen, Tagesbuchung und Zeitfenster, fehlender Kontakt/Ort, sehr lange Namen) mit Vorher/Nachher/Warum und benannten Restabweichungen. Ponytail full + Impeccable (Operate) einhalten; Markenname/Assets/neutrale Themes/A11y erhalten; kein Bookitup-Logo, kein fremder Code. **Abnahme/Belege BKP014.1:** Umgesetzt als Kartenzeile `.event-card` mit Datumsspalte (dominante Tageszahl 1,65rem/700, klein „Fr / Okt“ über vorhandene `calendar-range`-Formatierung; undatiert ehrlich „– / ohne Datum“), 3px-Statusstrich plus Punkt UND geschriebenem Statusname (neue ruhige `--status-*`-Tokens, Farbe nur zweite Kodierung), Körperreihenfolge Status → Art („Art offen“ bei fehlender Art) → vollständiger umbrechender Titel (kein Ellipsis/Clamp) → Ort („Ort offen“) → Meta (Zeit/„Tagesbuchung, ohne Uhrzeit“/Kontakt/ruhiges „Website“-Quellenlabel), genau ein Link je Karte mit `sr-only` „Öffnen: “ und ohne Button darin; Bearbeiten/Duplizieren bleiben ruhige `tier-quiet-icon`-Aktionen AUSSERHALB des Links; die technische Ressourcenanweisung je Zeile ist gelöscht (keine erfundenen Ressourcenbadges — echte Projektion bleibt BKP014.2). Monatskopf mit „· N Event(s)“ erhalten. Rot beobachtet (8 failed/1 passed, u. a. `card part .event-date: expected null not to be null`, `expected '…' not to match /Ressourcen/i`, Titel-/Tagesbuchungs-/offenes-Ende-Asserts); GREEN unabhängig wiederholt: component 411/411 (`event-list-cards.test.tsx` 9 neue Kriterientests, 35 Flachstring-Asserts in `events.test.tsx` gezielt umgestellt), unit 243/243, integration 287/287, `test:coverage` (941 Tests, Schwellen erreicht), Changed-Code 21/21 Zeilen und 30/31 Zweige, Format/Lint/Typen/Build/Docs grün, E2E 6/6 (auth beide Modi mit Scan-Reihenfolge Datum→Status→Art→Titel→Ort per Bounding-Box, Öffnen/Zurück, 1280/390 beide Themes, plus 320/768/1440 ohne Overflow, axe ohne Verstoß). Zusatzfund und mitbehoben: WCAG 2.5.3 am mobilen Filterzugang („Filter 0“ vs. Name „Filter“). Ausgewiesen außerhalb der Allowlist (je ein alter Flachstring-Assert): `action-hierarchy.test.tsx`, `event-create.test.tsx`, `ui-language.test.tsx`. **Restabweichungen:** echte Ressourcenanzahl/Paket-Symbole der Referenz fehlen bewusst (BKP014.2, keine Listen-Datenquelle); Datumsspalte nutzt `eventDate` (Geschäftsdatum); „Start ohne Ende“ zeigt defensiv „ab HH:MM Uhr“; ICU-Kürzel („Sa / Okt“). **Nachtrag Auslieferung/Abnahme (23.10.2026):** Nach einem ersten rot-gelaufenen CI-Versuch (`ui-language.test.tsx:261`, Abrufzähler-Basislauf-Rasse — Test-Härtung `f8d19ea`: Basis wartet jetzt auf die drei Mount-Abrufe, Assertions unverändert; 5× lokal stabil) lief die Auslieferung über denselben sicheren Weg: UX-Branch FF `f9adac7` → `f8d19ea`, CI 40002841789 quality+images success, `ak-test-update.timer`-Lauf 20:40:52–20:41:43, drei gesunde Container auf `f8d19ea114861970a874f784059ee04781dd0f5b`, Checkpoint-Dump + Hostkopie + Betreiberkopie identisch `6b8b4fd9c4df…`, Drain inaktiv. Visuelle Abnahme am live ausgelieferten Build: acht Zustände 320/390/768/1280 × Hell/Dunkel (alle Kriterien erfüllt, Details in der Statusmatrix) plus Leer-/Fehlerzustand; Vorher = flache Strings + Ressourcenhinweis (vorherige Live-Aufnahmen `live-f9adac7-*`), Nachher = Karten (`bkp014-1-f8d19ea-*`), Warum = Nutzerbefund „optisch weit von Bookitup entfernt“ + Referenz B01 (Datumsspalte/Statusstrich/Art/Titel/Ort/Öffnen). **Abnahme A (23.10.2026, belegt):** UX-Branch `codex/ux-event-simplification` per geprüftem Fast-forward `cf68f1e` → `f9adac7` (Historie erhalten, `main` unangetastet bei `9b5f913`); CI 39986484891 `quality` + `images` success exakt zu `f9adac75fe08e5f9cfa41690159c63d61d937809`; genau ein Updateweg (`ak-test-update.timer`, Lauf 18:42:28–18:43:27, `update-available` → `last-success.json`), drei gesunde Container mit identischer OCI-Revision, Checkpoint-Dump + Hostkopie + Betreiberkopie mit identischem SHA-256 `85a8cc795c6a…`, kein `needs-attention`, Drain ausdrücklich inaktiv (`website_option_drain_inactive`, Worker bereit, Gateway unverändert, 1 unübernommener Eingang bleibt liegen — keine Massenübernahme). Ausgelieferte Assets bewiesen (Bundle `assets/index-BQumZFeG.js` enthält die Revision und alle Wellen-Marker); direkte Desktop-/Mobilprüfung der live ausgelieferten Assets bei 1280/390 in Hell und Dunkel: Overflow 0, 7 Events ohne Filterwand, Kontextspalte 280 px bzw. „Filter 0“-Zugang, Flächen `#f5f4f1`/`#141312`, Grünstich-Anteil 0,25–0,81 %, sichtbare Buildkennung „Version f9adac7“ (Screenshots + Pixelstatistik privat unter `AuftragsKompass-Sicherung/delivery-2026-10-23/`). **Ehrliche Grenze:** keine echte angemeldete Sitzungsansicht in diesem Lauf (die im Auftrag genannten Browserfenster waren geschlossen; kein gespeicherter AK-Login im Tresor, Bitwarden gesperrt; Real-Profil-Browser erfordert ausdrückliche Freigabe zum Schließen) — die Abnahme lief auf den tatsächlich ausgelieferten live Assets mit fiktivem Bestand; ein Real-Sitzungs-Klickpfad bleibt Betreiberkontrolle.

- [x] **Erste Paritätswelle BKP001–BKP008 (22./23.10.2026) abgeschlossen.** Alle acht Tickets sind implementiert, mit echten Tests und Browserabnahmen belegt, einzeln committet und gepusht (`codex/bkp-wave1`, Basis `16616a5`) sowie unter MiMo-Koordination mit DeepSeek-V4.1-Flash-Coding-Slices umgesetzt. **BKP009–BKP030 sind nicht Teil dieser Welle und bleiben offen.** Weiterhin offen (echte Blocker/Entscheidungen, nicht als erledigt markiert): (1) Kein Merge/Deploy der Website-Semantik (BKP002–BKP004) ohne Betreiberentscheid — die Aktivierungsgrenze `AK_INQUIRY_OPTION_DRAIN` steht und ist in den Deploymentvorlagen pausiert; der dokumentierte Rollout-Laufplan beginnt mit einer rein lesenden Mengenübersicht echter Eingänge außerhalb Git (nicht erstellt, keine echten Daten ausgewertet). (2) Referenzabgleich Statusabhängigkeit des Anfragenzählers (BKP007.2) sowie Monat/Jahr-Bedienung, echte Ansichtwechsel, Status-/Art-Mehrfachwahl und Solo/Agentur (BKP007-Folge) warten auf gezielte Bookitup-Beobachtung. (3) Sidecar `.impeccable/design.json` zeigt noch die BKP005-Palette nicht (Drift, Reparatur nur über `$impeccable doctor`). (4) Buchbare Mobil-Gesten/Geräteabnahme und 200 %-Zoom als echter Browserzoom sind mit headless Chromium nicht abbildbar. H042 (Mobile-Workflow) liegt als eigener Branch `codex/h042-mobile-geometry` (`68eee0f`) erhalten und geprüft bereit; die Übernahme der 44-px-/Sticky-Regeln ist ein kleiner separater Schritt. Notiert: das Filterformular remountet weiter bei URL-Wechsel (bestehende Zurück-/Reload-Logik); ein Preset im offenen Sheet lässt es offen und der Fokus fällt auf den Dialog zurück; E2E lokal unter Node 26.7.0 (Shell-Default 23.11 bricht unabhängig davon an `sanitize-html`-Cache-Fehlern).
- [x] **BKP006 — `style: integrate sidebar collapse into the brand row`** (23.10.2026): Der Collapse-Schalter sitzt nicht mehr als eigene Zeile vor der Marke, sondern in einer kompakten `.sidebar-brand-row` mit dem Marken-/Heimlink (Desktop-Seitenleiste); eingeklappt stapelt dieselbe Zeile AK-Marke über Ausklapp-Schalter, beide 44×44 und zentriert, am selben DOM-Knoten und damit an derselben logischen Position mit erhaltenem Fokusziel. Marke/`Home`-Link, Labels, `title`, `aria-expanded`, gespeicherte `ak-sidebar`-Präferenz und Storage-Sync bleiben unverändert (Marke als `brand()`-Helfer identisch in Leiste und mobilem Drawer wiederverwendet); mobil gibt es weiterhin nur Menü öffnen/schließen (kein zusätzlicher Collapse im Drawer, genau ein „Menü öffnen“), der Schriftzug bricht nicht ab und überlappt nichts. Rot beobachtet (2 von 22 Navigations-Tests: `sidebar.firstElementChild`/`toggle.parentElement`); GREEN unabhängig wiederholt: navigation 22/22, component 371/371 (u. a. Struktur-/Fokus-/Label-Regressionen), unit 241/241, integration 286/286, `test:coverage` (898 Tests), Changed-Code 3/3 Zeilen und 8/8 Zweige, Format/Lint/Typen/Build/Docs grün, E2E 5/5 (shell + beide Anmeldemodi) mit Bounding-Box-Abnahme: Zeile 204×44 bei 240er Leiste (Marke 156 px ungekürzt, Schalter 44×44), gestapelt 60 px Zeile ohne Überdeckung, kein Body-Overflow bei 320/390/640/768. **Ehrliche Grenze:** 200 %-Zoom ist als Layoutbreiten-Äquivalent (960/1024/640) geprüft, weil headless Chromium keinen echten Browser-Zoom kennt; Modifier-/Mittelklick auf Marke/Nav bleibt nativ (unveränderter `onClick`-Pfad). **CI-Nachtrag (Run 39924234516):** Der erste CI-Lauf war rot in `auth.spec.ts` (`name.clipped` true): die Wortmarke wurde unter den breiteren Linux-Fonts der Runner ellipsiert, weil die geteilte Zeile nur 156 px Platz ließ (lokal unter macOS-Schrift passten 150,7 px). Gefixt als eigener Folge-Commit `style: keep the sidebar wordmark unclipped in the brand row`: die Markenzeile läuft randlos über beide Innenabstände (Marke ~176 px), die Rail-Wortmarke erhält die dokumentierte Größe `1rem` (Drawer bleibt `1.15rem`), und die E2E hält zusätzlich die font-unabhängige Layoutgarantie `brand.width >= 168` fest (Worst-Case-Schätzung breitester üblicher Systemschrift bei `1rem`: ~157 px Text). `clipped === false` bleibt als Vertrag bestehen; DESIGN.md führt die neue Geometrie.

Prüfbasis: `cf68f1e` ist im gelesenen Remote-Source und der geöffneten App vorhanden; ältere H041-Notiz „Commit/Push ausstehend“ darunter ist ein historischer Zwischenstand. CI-/Container-/Produktivabnahme wurden für R001 nicht wiederholt.

## 1. Lieferstrategie

**Neue Priorität vom 16.10.2026:** Für einen früheren Bookitup-Ausstieg gilt die
[verkürzte Lieferfolge mit Sicherungs- und Umschaltplan](docs/bookitup-exit.md).
M5/M6 werden verschoben; M2/M3/M4 ebenfalls, sofern die dort beschriebenen
externen Ersatzprozesse vor Umschaltung geprüft sind. Notwendige Migration und
Betriebssicherheit aus M7 werden vorgezogen. Die C-Slices unten bleiben der
vollständige Ausbauplan, nicht die Pflichtliste für den verkürzten Erststart.

- [x] E001: Sicherungsmatrix und verkürzte Lieferfolge dokumentiert
- [ ] E002: gewünschter Exportumfang privat gesichert: historische Übersichten, Zukunftsdetails, Vorlagen, Standarddateien, Stammdaten und erreichbare Finanzstände; fachliche Abnahme und unabhängige Zweitkopie offen
- [x] E003: Minimalimport nach [Sicherheitsvertrag und Schritten E003.1–E003.3](docs/minimal-import.md) implementiert und synthetisch geprüft; echte Übernahme und Ressourcenfreigabe separat offen
- [x] E003.1: versionierte, geschützte Importvorschau mit Feld-, Referenz-, Status- und Zukunftsprüfung; keine Schreiboperationen
- [x] E003.2: atomare Übernahme mit Alt-ID-Mapping, Delta-Versionsschutz, expliziten Dublettenentscheidungen und transaktionalem Dry-run; ungeprüfte Zusagen separat
- [x] E003.3: sichtbare Herkunft, Ressourcen-Prüfliste, Mengen-/Versionsabgleich und privater Bericht; synthetischer Gesamtprobelauf; Buchungssperre bei ungeprüften Altzusagen
- [x] H001 (Testbetrieb vorgezogen): Docker-Hub-Images nach grüner CI, getrennte Runtime-/Admin-Tags je Commit für den geprüften amd64-Host; keine Produktivfreigabe. Abnahme: Registry-Konfiguration, Branch-/PR-Schranken und gepinnte Actions geprüft; bestehende Docker-Builds und Qualitätssuite grün. [Einrichtung](docs/homelab.md)
- [x] H002 (Testbetrieb vorgezogen): isolierte Podman-Quadlets für Datenbank, Worker, API und Admin; Loopback-Zugriff, Startfolge und externe Secrets. Abnahme: Schutzregeln getestet und Quadlet-Generator des Zielhosts akzeptiert alle Einheiten. Installation und Browserabnahme bleiben bis zur Login-Entscheidung offen.
- [x] H003: fester Docker-Hub-Name `auftragskompass` aus den vorhandenen USER-/TOKEN-Secrets; Repository vor Veröffentlichung wie ausdrücklich gewählt öffentlich anlegen, vorhandene Sichtbarkeit erhalten; API- und Workflowtests.
- [x] H004: vorhandenes Backup-/Restore-Werkzeug auf benannte Podman-Container erweitern; atomare Sicherung, Dateirechte, getrenntes leeres Restore-Ziel und Schreibsperre beibehalten. Abnahme: Adapter-/Negativtests, bisheriger Compose-Probelauf und isolierter Podman-Probelauf mit veröffentlichten Images; keine Freigabe realer Daten oder der App-Anmeldung.

- [x] H005: eigener Login per E-Mail oder Benutzername und Passwort gemäß Nutzerentscheidung; einmaliger externer Inhaber-Bootstrap, scrypt, persistente Fehlversuchssperre, sichere bestehende Sitzungen und Loginformular. Abnahme: Mandantentrennung, Neustart/Sperre, CSRF, Fehlerfälle und vollständiger Chromium-Geschäftsablauf; bestehendes Google-OIDC unverändert nutzbar. Der eigene Passwortwechsel folgt in H008 und die Betreiber-Wiederherstellung in H009; zusätzliche Passwortkonten folgen bei Bedarf.

- [x] H004.1: CI-Wartebedingung im Import-Oberflächentest korrigiert; erst nach vollständig geladener Ressourcenprüfung bestätigen. Abnahme: betroffener Test und komplette Komponenten-Suite grün.

- [x] H006: Podman-Testinstallation mit eigenem Inhaberkonto, externer einmaliger Passwortdatei und gepinnten veröffentlichten Images. Node-Healthchecks als Exec-Array statt fehleranfälliger Shell-Quotes; optionaler LAN-Port nur für Caddy durch eigene Firewall vor DNAT; bestehende Dienste unverändert. Abnahme: nativer Quadlet-/Firewall-Check, erlaubte/verbotene Zugriffe, Login/Logout, Neustart ohne Bootstrap-Secret und Sicherung; anschließend Caddy und Homer auf Testbetrieb umstellen.

- [x] H007: lesbare responsive Grundgestaltung der vorhandenen Testoberfläche ohne neue UI-Abhängigkeit. Abnahme: bedienbare Eingabegrößen, sichtbarer Tastaturfokus und kein Seitenüberlauf bei 390 px; vorhandene Anmelde- und Geschäftsabläufe bleiben grün.

- [x] H008: eigener Passwortwechsel mit Prüfung des aktuellen Passworts, gemeinsamer persistenter Fehlversuchssperre und atomarem Widerruf aller Sitzungen; nur für lokale Konten, CSRF und Audit unverändert verpflichtend. Abnahme: schwache/falsche Passwörter, gesperrte/fremde Konten, paralleler Widerruf, Audit-Rollback und erneute Anmeldung mit dem neuen Passwort in Chromium.

- [x] H009: kontrollierte Passwortwiederherstellung ausschließlich über den bestehenden SSH-/Podman-Betreiberzugriff; externe geschützte Passwortdatei per stdin, bestehendes aktives Konto, keine Reaktivierung und kein HTTP-Endpunkt. Abnahme: Dateirechte/Git-Grenze, neutrale Ausgaben, Mandantentrennung, Sitzungswiderruf, Audit-Rollback und isolierter nativer CLI-Probelauf ohne Änderung des echten Inhaberkontos.

- [x] C026.1: CI-Screenshot nach dem zweiten Ressourcen-/Terminwechsel erst nach der neu geladenen Eventliste und fertigen Zuweisung aufnehmen; keine pauschale Wartezeit oder Retry. Abnahme: kompletter Chromium-Geschäftsablauf mit einem Worker wiederholt grün.

- [x] E005.1: vorhandene externe Sicherungsdateien mit dem bereits verfügbaren OpenSSL authentifiziert verschlüsseln und vor Veröffentlichung vollständig entschlüsseln/prüfen; Schlüssel bleiben außerhalb von Git. Abnahme: echter CMS-Rundlauf, Manipulation/falscher Schlüssel, Dateirechte, Git-Grenze, atomare Veröffentlichung und Überschreibschutz. Kein unabhängiges Ziel, Zeitplan oder Produktivfreigabe wird damit als erledigt gewertet.

- [x] E005.2: Podman-Dump und vorhandene CMS-Verschlüsselung als serialisierten Sicherungslauf verbinden; private Prüfsummen/Status, Platz- und Rechteprüfung sowie systemd-Service/Timer vorbereiten. Abnahme: Fehler/Parallelität erhalten die letzte erfolgreiche Sicherung, keine Klartextreste nach behandeltem Fehler, nativer Dump→Entschlüsselung→Restore-Probelauf und gültige Units. Aktivierung, unabhängige Kopie und Aufbewahrungsentscheidung separat offen.

- [x] H010: PostgreSQL-Bereitschaft in Compose, Quadlet und nativem Probelauf über TCP statt temporären Initialisierungs-Socket prüfen. Abnahme: Konfigurationsvertrag zunächst rot, frischer Compose-Start mit Backup/Restore und native Abnahme; keine Änderungen an Daten oder anderen Anwendungen.

- [x] E002.1: vorhandenen privaten Bookitup-Bestand unverändert in ein verschlüsseltes Transportarchiv übernehmen; eigenen Wiederherstellungsschlüssel nur beim Betreiber verwahren. Abnahme: jede enthaltene Datei gegen SHA-256 prüfen, entschlüsselte Archivkopie vollständig lesen, Originale unverändert bestätigen; unabhängiges Ziel und fachliche Abnahme bleiben offen.

- [x] H011: getrennte Arbeitsbereiche mit Desktop-Seitenleiste, mobilem zugänglichem Menü und unterteilten Einstellungen; bestehende Eingaben, Suchzustand und direkte Event-/Importlinks erhalten. Abnahme: Bereichswechsel, Browserhistorie, Tastatur-/Fokusbedienung und Chromium-Geschäftsablauf bei 390 px ohne Seitenüberlauf; eigenständige Gestaltung anhand der Nutzerreferenzen.

- [x] H012: Hell-/Dunkelmodus mit sichtbarem Umschalter, Systemeinstellung beim ersten Aufruf und lokaler Speicherung gemäß Nutzerwunsch. Abnahme: Neuladen, Systemwechsel, andere Tabs und gesperrter Browserspeicher; vollständige Farbpalette einschließlich Formularen, Tabellen, Meldungen und mobiler Navigation in Chromium prüfen.

- [x] H013: Eventliste nach Monaten gliedern; Filter und Eventformular nur bei Bedarf öffnen, Bearbeiten/Duplizieren automatisch zum Formular führen und Eingaben beim Einklappen erhalten. Abnahme: Monat/Ohne-Datum-Gruppen, aktive Filter, Entwürfe, Speichern/Abbrechen und direkte Eventlinks im mobilen Chromium-Geschäftsablauf.

- [x] H014: Eventakte als eigener Arbeitskontext mit Bereichen Übersicht, Ressourcen, Notizen und Logbuch; mobile untere Bereichsnavigation, erhaltene Bereichsauswahl nach Aktualisierung und Rückkehr zur Liste. Abnahme: Bereiche verbergen fremde Inhalte, Reservierungsablauf bleibt grün, Neuladen/direkte Links/Browser-Zurück sowie mobile Tastatur-/Fokusbedienung.

- [x] H014.1: fehlende Komponententests für Öffnen, Schließen und Bearbeiten der Eventakte einschließlich Fokusrückgabe ergänzen. Abnahme: Changed-Code-Coverage für den gesamten H014-Diff ab 0773613 erfüllt; keine Laufzeitänderung und kein Deployment eines ungeprüften Standes.

- [x] H015.1: Dokumentation der Anmeldestatus-Platzierung nach finalem Designreview präzisieren; reine Dokumentation, JSON- und Formatprüfung.

- [x] H015: mobile Menüleiste verdichten, Konto/Abmeldung ins Menü verschieben und kontrastreiche Kalenderlinks in beiden Farbmodi sichern. Abnahme: Abmeldung erreichbar, Menüfokus unverändert, mobile Überlagerung/Überlauf ausgeschlossen und gemessener Kalenderlink-Kontrast mindestens 4,5:1.

- [x] E005.3: geschützter vollständiger Event-CSV-Export als offenes Betriebsformat gemäß NF-10; UTF-8, UTC-Zeitpunkte/Zeitzone, Referenzen und Notizen, Formelschutz und no-store. Abnahme: anonymer/fremder Zugriff abgewiesen, alle eigenen Events einschließlich undatierter und annullierter Datensätze enthalten; kein Ersatz für Reservierungsbackup.

- [x] E005.4: geschützter Produkt-CSV-Export mit unveränderten ganzzahligen Cent-/Steuerwerten, Netto-/Bruttobasis und allen Archivzuständen; Formelschutz, no-store und Mandantentrennung. Abnahme: Grenzwerte bleiben exakt, fremde/anonyme Sitzungen scheitern, Archivbestand und Sonderzeichen bleiben enthalten.

- [x] E005.5: Exportbereich unter Einstellungen mit Downloads für Kontakte, alle Events und den Produktkatalog; mobile und helle/dunkle Darstellung, klare Exportgrenzen und private Ablage. Abnahme: geschützter Download im vollständigen Chromium-Ablauf, direkte Navigation/aktive Auswahl und kein mobiler Überlauf.

- [x] E005.6: indirektes source-map-js auf den behobenen Patchstand für CVE-2026-93749 aktualisieren, ohne weitere Versionssprünge. Abnahme: Regression für übergroße Source-Map-Offsets zunächst rot, gültige Maps unverändert, Laufzeit-Audit ohne Befunde und vollständige Suite grün.

- [x] E005.7: CI vor Image-Veröffentlichung auf hohe/kritische Laufzeit-Abhängigkeitsbefunde prüfen; Fehler der Audit-Abfrage stoppen ebenfalls. Abnahme: Workflowvertrag zunächst rot, Prüfung nach eingefrorener Installation und vor Qualitätssuite, keine Fehlertoleranz und Images weiter an quality gebunden.

- [x] E005.8: rein lesende Betreiberprüfung für verschlüsselte Sicherungsbelege, Alter, letzten Versuch, Dateirechte und Chiffretext-Prüfsumme. Abnahme: aktuelle konsistente Sicherung gesund; fehlende/veraltete/manipulierte, fremde, unvollständige und parallel geschriebene Bestände scheitern ohne sensible Ausgabe; keine Timeraktivierung oder externe Übertragung.

- [x] E005.9: beide veröffentlichten Images mit OCI-Quellrepository und vollständiger Commit-Revision kennzeichnen. Abnahme: Workflowvertrag zunächst rot, beide Buildziele tragen exakt github.sha; Tags, Digest-Pins und Veröffentlichungsschranken bleiben erhalten. Tatsächlicher Revisionsabgleich beim nächsten Testdeployment.

- [x] E005.10: Event-CSV um lesbare Namen für Arten/Pakete, Ort und Kontakte ergänzen, IDs und bisherige Spalten erhalten. Abnahme: archivierte Referenzen lesbar, Null-/Leerbestand und fremde Mandanten sicher, Name/ID-Paare aus einem konsistenten Snapshot ohne Abfrage je Event; CSV bleibt formelgeschützt.

- [x] E005.11: native Podman-Sicherungsprobe um den neuen lesenden Zustandsprüfer ergänzen (reiner Testslice). Abnahme: echter fiktiver Dump → Verschlüsselung → Prüfer → Entschlüsselung → frischer Restore; absichtlich beschädigtes Chiffrat und fehlgeschlagener Folgelauf werden erkannt, Testressourcen verschwinden und bestehende Dienste bleiben unverändert.

- [x] E005.12: synthetischer Mengenprobelauf des vorhandenen Datenkerns mit 500 Kontakten und 500 verknüpften Events als begrenzte C081-Vorziehung (Testslice). Abnahme: vollständige Listen und Namenszuordnung, kombinierte Suche, Mandantentrennung sowie jeweils fünf Repository-Durchläufe unter zwei Sekunden; keine allgemeine Last-/Produktivfreigabe.

- [x] H016: offenes mobiles Menü beim Wechsel auf Desktopbreite schließen und Fokus auf sichtbare aktuelle Navigation beziehungsweise Suche zurückgeben. Abnahme: geschlossene/offene Zustände, Suchroute, Listener-Abmeldung, erneutes mobiles Öffnen und Chromium-Breitenwechsel ohne verdeckten Fokus.

- [x] E005.13: schreibfreien Vorabstand für manuelle Podman-Updates sichern; aktive App-Dienste vor Dump stoppen, Datenbank weiterlaufen lassen und bei Fehler vor Image-/Schemaänderungen alte Dienste wieder starten. Abnahme: Reihenfolge, geschlossene Ausgabe, Fehler beim Stoppen/Dump/Wiederanlauf und private Dateigrenze; keine automatische Datenbankrücksetzung.

- [x] E005.14: Authentifizierung und CSRF auf die vom Router aufgelöste Route binden, damit URL-kodierte Präfixe keinen Zugriffsschutz umgehen. Abnahme: kodierte API-/Auth-Pfade ohne, mit fremder/ungültiger und gültiger Sitzung; Schreibzugriffe ohne CSRF abgewiesen, deaktivierte Anmeldung bleibt geschlossen.

- [x] E005.15: Browser-Sicherheitsheader der Admin-Auslieferung ergänzen: lokale Ressourcenrichtlinie ohne Inline-Skripte, keine Einbettung, kein Referrer. Abnahme: Nginx-Vertrag, echte Compose-Antworten und vollständige HTTPS-/Chromium-Abläufe ohne Richtlinienverstöße; eingeschleustes fiktives Inline-Skript wird blockiert.

- [x] E005.16: aktive Admin-Abläufe mit axe in Chromium auf WCAG-A/AA prüfen und bestätigte Befunde im bestehenden Design beheben; fokussierte C082-Vorziehung. Abnahme: Anmeldung, Arbeitsbereiche, Eventakte und mobiles Menü in beiden Darstellungen ohne automatische Verstöße; manuelle Tastatur-/Fokusprüfung und dokumentierte Grenzen, keine pauschale WCAG-Zertifizierung.

- [x] E005.17: vorhandene Mengenprobe um echte HTTPS-/Chromium-Listen mit je 500 fiktiven Kontakten und Events bei 390/1280 Pixel ergänzen (Testslice). Abnahme: vollständige sichtbare Listen, nutzbare erste Aktion, kein Seitenüberlauf und Laden bis zum nächsten Paint jeweils unter zwei Sekunden; kein allgemeiner Hardware-/Produktivnachweis.

- [x] E005.18: veraltete Fastify-Requestlog-Option durch den dokumentierten LogController ersetzen, vorhandene Datensparsamkeit erhalten. Abnahme: frischer Node-Prozess startet ohne FSTDEP023; erfolgreiche, fehlgeschlagene und unbekannte Requests protokollieren weiterhin keine URLs, Header, Inhalte oder internen Fehlermeldungen.

- [x] E005.19: synthetische Chromium-Belege in der CI sieben Tage als eigenes Artefakt erhalten, auch bei Testfehlern. Abnahme: gepinnte Upload-Action, enges Testausgabeverzeichnis, keine erweiterten Berechtigungen oder Veröffentlichung trotz roter Gates; Artefakt am grünen Lauf prüfen.

- [x] E005.20: vorhandene Bewegungsregeln im echten Chromium prüfen (Testslice). Abnahme: Zeigeraufruf mit normaler Bewegung, bewegungsfreier Tastaturaufruf sowie reduzierte Bewegung bei Menü und gedrückter Schaltfläche; Escape/Fokusrückgabe bleiben erhalten. Keine Gestaltungsänderung.

- [x] E005.21: nativen isolierten Podman-Probelauf um Worker-/Datenbankausfall und Wiederanlauf ergänzen; begrenztes Störungshandbuch für den internen MVP (C083-Teil). Abnahme: Bereitschaft fällt geschlossen aus, Liveness bleibt erreichbar, Verbindungspools und Ablaufworker erholen sich ohne Datenverlust; fremde Testinstallation unverändert und eigene Testressourcen entfernt.

- [x] H017: bestehende Desktop-Navigation bei geringer Fensterhöhe mit einem Chromium-Regressionstest absichern (reiner Testslice). Abnahme: Konto/Abmeldung und Rückkehr zu oberen Links bei 1280×420 Pixel in beiden Darstellungen mit echtem Chromium; normales Desktop-/Mobilmenü, Fokus und bestehende Abläufe bleiben unverändert.

- [x] E005.22: nativen und CI-Compose-Restore um fiktive fachliche Daten und Zugriffsschutz erweitern (Testslice). Abnahme: wiederhergestelltes Passwortkonto/Sitzung, Kontakt-/Eventbezug, exakte Produktwerte und gebuchte Ressource erhalten; SQL-Überlappungsschutz, Audit-Unveränderbarkeit, Mandantentrennung und Migrationsprüfsummen bleiben wirksam; leeres Ziel kann nicht als bestandener Restore gelten.

- [x] E003.4: aus vorhandenen privaten Sicherungen einen offline geprüften Importentwurf und eine konkrete Klärungsliste vorbereiten. Abnahme: Quellprüfsummen, eindeutige Kontaktvorschläge, unveränderte Datums-/Statusangaben und deterministische Quellanker; fehlende Werte bleiben als Lücken sichtbar. Reale Dateien bleiben außerhalb Git; keine Übernahme oder Ressourcenfreigabe.

- [x] E003.5: Importvorschau bei ungültigen Feldern um sichere Feldhinweise ergänzen. Abnahme: richtige Felder auch bei mehreren Zeilen und fehlenden Angaben, keine Eingangswerte oder unbekannten Eigenschaftsnamen im Bericht, optionale kompatible API-Angabe und verständliche Anzeige in der vorhandenen Oberfläche.

- [x] E003.6: private Korrekturliste aus dem geprüften Offline-Entwurf und seinen Feldfehlern vorbereiten. Abnahme: eindeutige Quellanker und Zeilen, unveränderte Ausgangswerte, leere Korrektur-/Entscheidungsfelder, Formelschutz und reproduzierbare Ausgabe; kein Rückimport oder Ändern der Originale.

- [x] E004.1: Betreiberwahl LibreOffice als externen Übergangsweg für Angebote/Rechnungen festhalten. Abnahme: Werkzeugentscheidung von noch ungeprüftem Ablauf trennen, Originalbelege/Nummern erhalten und Website-Anfrageweg ausdrücklich offen lassen; keine Produktivfreigabe oder Kundenkommunikation.

- [x] E004.2: das aktuelle Websiteformular als versionierte Felddefinition und unverändernden Eingangsvertrag abbilden. Abnahme: alle acht beobachteten Felder, Pflichtangaben und sichtbaren Paketwerte; sichere Schema-/Datumsprüfung, keine alten Paketwerte als Ziel-ID verwenden, Formular-ID/Version als Grundlage für spätere mehrere/bearbeitbare Formulare. Kein öffentlicher Empfang oder Websiteaustausch.

- [x] E004.3: signierten Übergabevertrag für Anfragen als klar begrenzten C028-Teil implementieren. Abnahme: feste Version/Zwecke, Bindung an Mandant/Richtung/Schlüssel-ID, sichere Signaturprüfung, begrenzte Zeit/Grenzgrößen und überlappende Schlüsselrotation; neutrale Ablehnung ohne sensible Ausgabe. Persistenter Replay-/Operationsschutz folgt getrennt vor jedem Empfangsendpunkt; C028 bleibt insgesamt offen.

- [x] E004.4: persistente Nachrichtensperre und atomare, idempotente Gateway-Operationen ergänzen. Abnahme: Signatur vor DB-Wirkung, PostgreSQL-Eindeutigkeit/Parallelität, gleiche Operation nur einmal, abweichender Inhalt abgewiesen, vollständiger Rollback, Neustart und Mandantentrennung; eigene minimale Gateway-Migration ohne Geschäftstabellen. Keine echten Empfangsendpunkte oder automatisches Löschen von Belegen.

- [x] E004.5: mandantengebundenen verschlüsselten Anfrage-Zwischenspeicher implementieren. Abnahme: alle acht Felder und Datenschutzhinweis erhalten, authentifizierte Verschlüsselung/Schlüsselrotation, idempotenter Eingang auch parallel, begrenzte konfigurierte Kapazität/Laufzeit, private lesende Abholung und Quittierung ohne Klartextrest sowie gezielte Ablaufbereinigung; keine öffentliche Route, kein Versand oder realer Import.

- [x] E004.6: getrennte versionierte Anfrage-API im synthetischen Gateway implementieren. Abnahme: öffentliche Definition/Eingangsbestätigung, strenge Origin-/Größen-/Feld-/Spamprüfung, Rate-Limit, keine internen IDs oder sensiblen Fehler; ausschließlich signierte private Abholung/Quittierung mit Replay-Schutz und begrenzter Antwort. Keine öffentliche Installation, Website-Umschaltung oder reale Übernahme.

- [x] E004.7: lesende Formularvorschau unter Einstellungen ergänzen. Abnahme: dieselben acht versionierten Felder, Pflichtangaben/Paketoptionen/Datenschutzhinweis, lokale native Eingabeprüfung ohne Versand oder Speicherung, geschützter Definitionsabruf, Hell/Dunkel und mobile Bedienung in Chromium. Kein öffentlicher Empfang und keine Formularverwaltung.

- [x] E004.8: atomare lokale Übernahme einer geprüften Website-Anfrage als Kontakt und unverbindliches Event implementieren. Abnahme: Originalfelder/Datenschutzhinweis und Herkunft im Logbuch, idempotenter Neustart/Parallelität, konservative Kontaktzuordnung ohne Stammdaten-Überschreiben, explizites Land für neue Kontakte, vollständiger Rollback und Mandantentrennung; keine Netzwerkabholung, echte Übernahme oder Reservierung.

- [x] E004.9: vollständige Originalanfrage über einen geschützten lesenden Endpunkt und eine aufklappbare Eventaktenansicht zugänglich machen. Abnahme: alle acht Originalfelder einschließlich langer Kommentare/Datenschutzhinweis, klare Trennung von bearbeiteten Stammdaten, Abruf erst beim Öffnen, Lade-/Fehlerzustände, Mandantentrennung und mobiles Hell/Dunkel in Chromium; keine Schreiboperation oder echte Übernahme.

- [x] E004.10: vollständige Website-Eingänge vor fachlicher Zuordnung dauerhaft lokal zwischenlagern. Abnahme: geschützter mandantengebundener Dienst, strikte Originalprüfung, idempotenter Neustart/Parallelität, abweichender Inhalt abgewiesen, atomarer Rollback und Erhalt nach Gateway-Ablauf im echten Restore-Probelauf; keine Eventanlage, Netzwerkabholung oder Quittierung.

- [x] E004.11: signierte Gateway-Abholantworten atomar in den dauerhaften lokalen Eingang übernehmen. Abnahme: Bindung an den eigenen Pull-Aufruf, strikte Batch-/Originalprüfung, persistenter Replay-/Operationsschutz, Neustart und Parallelität, vollständiger Rollback bei einem fehlerhaften Eintrag und aktive Betreiberberechtigung auch bei Wiederholung; kein Netzwerkaufruf, keine Quittierung oder reale Aktivierung.

- [x] E004.12: einen dauerhaft gesicherten Eingang kontrolliert als unverbindliches Event weiterverarbeiten. Abnahme: ursprünglicher lokaler Prüfzeitpunkt statt abgelaufener Gateway-Frist, erneute aktive Betreiberprüfung, Land ausschließlich explizit für neue Kontakte, unklare Zuordnung bleibt ohne Teilanlage erhalten, idempotente Parallelität/Neustart und Mandantentrennung; keine automatische Verarbeitung oder Quittierung.

- [x] E004.13: offene Website-Eingänge im bestehenden Eventbereich geschützt prüfen und bewusst als Anfrage übernehmen. Abnahme: paginierte Mandantenliste, vollständige Originalangaben erst im aufgeklappten Prüfbereich, explizites Land ohne Vorbelegung, CSRF/Autorisierung, sichtbare und wiederholbare Zuordnungsfehler, kein Duplikat bei Retry sowie mobile Hell/Dunkel-/Tastaturprüfung in Chromium; keine öffentliche Anbindung oder echte Übernahme.

- [x] E004.14: ausgehende HTTPS-Abholung signierter Gateway-Batches implementieren. Abnahme: fester versionierter Pull-Pfad ohne Redirects/Cookies, aktive lokale Freigabe vor dem Abruf, feste Zeit-/Bytegrenzen einschließlich fehlerhafter Streams, erneute Signatur-/Zeitprüfung und atomare dauerhafte Ablage; keine Quittierung, Worker-Aktivierung oder echte Verbindung.

- [x] E004.15: dauerhafte Quittierungs-Outbox ausschließlich für lokal gesicherte Originale ergänzen. Abnahme: stabile Operations-ID und unveränderliche Batch-Zuordnung über Neustart/Parallelität, frische persistente Versuch-ID, signierter und gebundener Empfangsbeleg, atomarer Abschluss/Replay-Schutz und Mandantentrennung; kein HTTP-Versand oder automatischer Lauf.

- [x] E004.16: vorbereitete Quittierungsaufträge über begrenztes HTTPS versenden. Abnahme: Commit vor Versand, stabile Operation bei verlorener Gateway-Antwort und Neustart, frischer signierter Versuch, Bindung des Empfangsbelegs an den aktuellen Aufruf, sichere Transportgrenzen und kein lokaler Abschluss bei Fehler; kein automatischer Lauf oder echte Verbindung.

- [x] E004.17: browsergeeignete gemeinsame Formulardefinition und öffentlichen Sendeclient bereitstellen. Abnahme: unverändert acht Felder ohne Servermodule im Browser-Bundle, feste HTTPS-Route ohne Cookies/Redirects, begrenzte neutrale Antworten und unveränderliche Einsendung mit gleicher ID bei Wiederholung/Parallelität; keine Website-Umschaltung oder echte Einsendung.

- [x] E004.18: die acht bisherigen Anfragefelder als mobil bedienbares, isoliert einbettbares React-Formular umsetzen. Abnahme: Pflichtangaben/Datenschutz unverändert, native Prüfung, eindeutige Lade-/Fehler-/Erfolgszustände, gesperrter unveränderlicher Retry bei unklarem Eingang, externe isolierte CSS-Datei, Tastatur/Hell/Dunkel und echte Chromium-Gateway-Einsendung mit synthetischen Daten; keine echte Website-Umschaltung.

- [x] H018: Sitzungen gemäß Nutzerwunsch auf 90 Tage absolute Laufzeit verlängern; gemeinsame Dauer für Passwort-/Google-Login und Browser-Cookie. Abnahme: identische Cookie-/Datenbankfrist, Erhalt bei API-Neustart, kein stilles Verlängern bei Zugriff, Ablauf/Logout/Passwortwechsel/Kontosperre bleiben wirksam. Bestehende Sitzungen unverändert; neue Frist nach erneuter Anmeldung.

- [x] H019: Projekt- und Betreiberübergabe für einen Sessionwechsel dokumentieren, Skill-Vorgaben in AGENTS.md verankern und Einstieg in README/Plan verlinken. Abnahme: Funktionsstand, Entscheidungen, offene Grenzen, geprüfter Laufzeitstand und Fortsetzungsschritte nachvollziehbar; Dokumentations-/Linkprüfungen grün, private Betreiberangaben ausschließlich außerhalb Git. Reiner Dokumentationsslice ohne Deployment.

- [x] H020: gemäß Nutzerwunsch automatische koordinierte Podman-Testupdates alle fünf Minuten einrichten. Nur grüner aktueller Branch-Head samt beiden Images, vorwärts gerichtete Revision, geprüfte Image-Labels/Digests, pausierter Checkpoint und verifizierte CT-/Host-Sicherung vor Änderungen; gemeinsames Schloss mit manuellem Update, dauerhafte Fehlersperre ohne Schema-Rollback. Abnahme: Negativ-/Reihenfolgetests, native systemd-Prüfung, echter abgesicherter Update-/No-op-Probelauf und aktivierter Timer; andere Dienste und laufende Gateway-Entwicklung unverändert.
- [x] C028: öffentliche Gateway-Laufzeit und dauerhafter Pull/Quittung im Worker. Scope: `apps/gateway` als eigenständiger Fastify-Server, der `pullWebsiteInquiries`, `receiveWebsiteInquiryBatch`, `receiveWebsiteInquiryAcknowledgement` und `registerWebsiteInquiryRoutes` aus `@auftragskompass/core` über eine gesonderte HTTP-Route (kein gemeinsamer Listener mit `apps/api`) mit strikter Origin-/Größen-/Rate-Limit-Prüfung, Loopback-Bindung `127.0.0.1` und ohne anonyme Klartext-Antworten exponiert. `apps/worker/main.ts` wird um eine Pull-/Quittungs-Schleife mit `startWebsiteInquirySync` und `acknowledgeWebsiteInquiries` erweitert; Stop/Neustart über die vorhandenen Fastify-Lifecycle-Hooks. `compose.yaml` und `infrastructure/podman/` erhalten einen `gateway`-Service bzw. `ak-test-gateway.container` (gleiches `runtime`-Image, eigener Port, eigener Healthcheck). Im Testbetrieb bleiben diese gestoppt, bis die M2-Abnahme grün ist — die bestehenden Container `ak-test-api`, `ak-test-worker`, `ak-test-admin`, `ak-test-database` werden nicht verändert. Sperren: keine Exposure unter `auftragskompass.samuelgesang.de`, keine WordPress-Anbindung, keine Caddy-/Tunnel-Änderung, kein echter Empfang in Produktion; reale Domain erst nach gemeinsamer Abnahme und ausdrücklicher Freigabe. Umgesetzt und abgenommen: Prozesskonfiguration des Gateway (`loadInquiryConfig`) und Synchronisationskonfiguration des Workers (`loadInquirySyncConfig`) mit zehn Konfigurationstests; drei neue Integrationstests fahren die Schleife gegen eine echte Testdatenbank und synthetische signierte Pull-Antworten und prüfen Eingang, Quittung, Fehlerlauf und die Pflicht auf eine aktive Betreiberberechtigung; bestehende 443 Tests und vier Chromium-Abläufe unverändert grün; alle Gates (`format:check`, `lint`, `typecheck`, `unit`, `integration`, `component`, `e2e`, `build`) grün; Conventional Commit, explizites Staging, sofortiger Push. Risiko ohne Maßnahme: Bibliotheks- und Contract-Tests belegen die Datenverträge, aber keine betriebene Verbindung — solange die App öffentlich erreichbar ist, ohne dass ein Gateway läuft, wirkt der Anschluss fertig, obwohl kein Pull und keine Quittung stattfinden. Umgesetzt in `2543107` (Gateway-Laufzeit) und `7107edb` (Worker-Takt); der dokumentierte Sync ist noch an keinem real gestarteten Gateway erprobt.
- [x] C028.1: Gateway-Kaltstart und M2-Aktivierung abgenommen. Umgesetzt: Caddy in LXC 120 leitet `/public/*` und `/sync/*` an den Gateway (`192.168.68.194:3002`), alles andere bleibt beim Admin; Gateway veröffentlicht den Port im LXC, bleibt gesund und meldet `ready`; Worker führt Pull und Quittung über HTTPS gegen `https://auftragskompass.samuelgesang.de` aus. Nachgewiesen mit einer synthetischen Einsendung: öffentlicher `POST` → **202**, Worker-Abholung → **ein Eintrag** in `website_inquiry_deliveries`, Quittung → `acknowledged_at` gesetzt und Chiffretext vernichtet (`t|t`). Der öffentliche Endpunkt erwartet die Hülle `{submissionId, submission}` und antwortet mit 202, nicht mit der nackten Submission. Abnahme: drei Statusabfragen im Betrieb, Worker dauerhaft healthy. Offen: Formular auf der Website einbinden; Caddy- und Worker-Sicherungen liegen auf dem Host.
- [x] C038.1: lokaler Storage-Adapter als gezogene Vorstufe aus C038. Umgesetzt: `localStorageAdapter` mit Wurzelverzeichnis und Größenlimit, Schlüsselprüfung gegen Pfadtrenner/Traversal/versteckte Namen, Schreiben über eine synchronisierte temporäre Datei und atomares Umbenennen, Rechte 0600 für Dateien und 0700 für das Verzeichnis, typisierte Fehler (`invalid_key`, `too_large`, `missing`, `failed`) ohne Pfadleck, idempotentes Entfernen. Abnahme: sechs Unit-Tests (Round-trip samt Rechteprüfung, fehlendes Objekt, Größenlimit ohne Rückstand, Traversal vor jedem Dateizugriff, idempotentes Löschen, Schlüsselformat). Offen: Einbindung in PDF-Ablage und Logo; S3-Unterstützung bleibt Sache der späteren Umsetzung.
- [x] C047: Dokumentvorlagen als Datengrundlage für Angebot, Auftragsbestätigung, Anzahlungsrechnung, Rechnung und Korrektur (DV-01/DV-02/DV-03). Umgesetzt: Migration `0026`, mandantengebundene Vorlagen mit Art, Bezeichnung, Betreff, Einleitungs-/Schlusstext, konfigurierbarer Angebotsgültigkeit und Archivzustand; Positionen als eigene Tabelle mit Produktbezug, Menge, Einheit, exakten Centpreisen, Steuersatz und Rabatt, in Reihenfolge und atomar mit der Vorlage ersetzt; Versionszähler mit Konfliktschutz; Auditaktionen `document_template.created/updated`; Platzhaltervertrag nach ET-02 mit Zurückweisung unbekannter Platzhalter beim Speichern und fehlender Werte beim Rendern. Abnahme: neun Rendering-Tests, drei Integrationstests (Reihenfolge/Version/Archiv, Mandantentrennung inklusive Fremdschlüssel, API mit 401/400/409), Migrationszählung nachgezogen; alle Gates grün. Offen bleibt die Bedienoberfläche (C047.1).
- [x] C047.1: Vorlagenverwaltung in der bestehenden Einstellungsoberfläche. Umgesetzt: Eintrag „Dokumentvorlagen" unter Einstellungen, Liste nach Dokumentart mit Positionszahl und Archivkennzeichnung, Formular für Art/Bezeichnung/Betreff/Einleitung/Schluss/Gültigkeit/Zustand, mehrere Positionen mit Produktauswahl (übernimmt Einheit, Preis und Steuer), freie Positionen, Entfernen/Hinzufügen, Platzhalterhilfe mit den acht ET-02-Namen, Bearbeiten/Duplizieren/Archivieren ohne Positionsverlust. Abnahme: drei Komponententests (Laden und Speichern mit exakten Centwerten und Version, Meldung bei unbekanntem Platzhalter, Produktübernahme), 141 Komponententests und vier Chromium-Abläufe grün.
- [x] C050: getrennte Nummernkreise mit Jahr/Monat/Tag/Sequenz und unverbindlicher Vorschau (NK-01 bis NK-04). Umgesetzt: Migration `0027`, ein Nummernkreis je Dokumentart mit Muster, konfigurierbarer Mindestlänge (führende Nullen), nächstem Wert und Versionsschutz; Musterprüfung mit genau einem `{SEQ}` und ausschließlich `{YYYY}`/`{YY}`/`{MM}`/`{DD}`; Datumsanteile werden in der Mandantenzeitzone gebildet; `preview` liest nur und verbraucht nie eine Nummer; `allocateDocumentNumber` erhöht in genau einer Anweisung und ist damit auch parallel eindeutig; Auditaktion `document_number.updated` bei jeder Übernahme der nächsten Nummer. Abnahme: sieben Formattests inklusive Jahreswechsel an der Zeitzonengrenze, fünf Integrationstests (Vorschau verbraucht nicht, zwanzig parallele Zuweisungen ohne Dublette, Rollback gibt die Nummer zurück, Versionskonflikt und Mandantentrennung, API mit 401/400/404); Migrationzählung nachgezogen.
- [x] C050.1: Nummernkreise in der Oberfläche verwalten. Umgesetzt: Eintrag „Nummernkreise" unter Einstellungen, je Dokumentart ein Bereich mit Muster, Mindestlänge und nächster Nummer, getrennte Schaltflächen zum Speichern und für die unverbindliche Vorschau, Vorschau bleibt gesperrt solange kein Nummernkreis eingerichtet ist, Meldungen für ungültiges Muster, Versionskonflikt und fehlenden Nummernkreis. Abnahme: fünf Komponententests (Laden/Vorschau ohne Verbrauch/Speichern mit Version, Neuanlage je Art, Muster- und Konfliktmeldung, fehlende Vorschau, Ladefehler), 151 Komponententests und vier Chromium-Abläufe grün.
- [x] C048: Marken-Layout und deterministische Dokument-Erzeugung (DV-03/DV-04 teilweise, Grundlage für C049). Umgesetzt: Migration `0028`, ein Layout je Mandant mit Absenderblock, Primär-/Textfarbe (Hex, per CHECK erzwungen), Schriftfamilie, Seitenzahlen- und Positionsnummern-Schalter, Versionsschutz und Auditaktion `document_layout.updated`; exakte Geldrechnung in `document-totals.ts` (Bruttopreise, Rabatt auf brutto, Steuer aus brutto extrahiert, Steuergruppen je Satz, Überlauf- und Plausibilitätsprüfung, `assertTotalsConsistent`); deterministische HTML-Erzeugung mit vollständiger Maskierung aller eingesetzten Werte, Platzhalterauflösung aus dem Vorlagenvertrag und Formatierung ohne `Intl`-Währungsabhängigkeit. Abnahme: 16 Unit-Tests (Steuer-Extraktion centgenau, Rabatt, Menge, Steuersatz 0 und 100 % Rabatt, acht abgewiesene Eingaben, Überlauf, Steuergruppen, Betragsformat mit Tausenderpunkten, Datum über die Jahresgrenze, Maskierung, Positions-/Seitennummern-Schalter, zwei Steuersätze) und drei Integrationstests (Anlage/Versionierung/Konflikt/Rendering, Mandantentrennung, API mit 401/400/409); Migrationzählung nachgezogen. Bewusst noch offen: Logo (braucht den Storage-Adapter) und die PDF-Erzeugung selbst.
- [x] C048.1: Logo im Dokumentlayout über den lokalen Storage-Adapter. Umgesetzt: Migration `0031` ergänzt `logo_key` und `logo_media_type` mit Paar-CHECK und Schlüsselformat; `assertLogo` prüft PNG-/JPEG-Signatur gegen den deklarierten Typ und die 512-KB-Grenze; `saveLogo` schreibt über den vorhandenen Storage-Adapter, setzt Schlüssel und Medientyp im Layout, erhöht die Version und protokolliert `document_layout.updated`; ein ersetztes Logo wird erst nach dem erfolgreichen Update entfernt. `PUT /api/v1/document-layout/logo` nimmt einen rohen Bildkörper über einen eigenen Parser mit Größenlimit an; Auth und CSRF gelten wie bei den übrigen Schreibzugriffen. Beim Finalisieren liest der Dokumentdienst die Bytes und bettet sie als `data:`-URI in das HTML ein, ein fehlendes Artefakt bricht mit `missing_reference` ab. Abnahme: drei neue Logo-Integrationstests im Layoutmodul (Ablage/Version/Referenz, Ersetzen ohne Rückstand und fremder Mandant, abgewiesene Bytes und Größe, API mit 401/403/400/404/413/415), ein Unit-Test für die Logo-Einbettung, ein Integrationstest für die Einbettung in das finale HTML samt fehlendem Artefakt; Migrationszählung 31. Keine Öffnung der bestehenden Speicherregeln.
- [x] C049: unveränderliche PDF-Erzeugung als Kern. Umgesetzt: `renderDocumentPdf` prüft die Eingabe vor dem Renderer, ruft einen injizierten Renderer auf und liefert Bytes, Länge und einen sha256 über exakt diese Bytes; `contentHash` ist separat prüfbar; `chromiumPdfRenderer` kapselt Chromium (puppeteer-core, A4, 20 s Zeitgrenze, `--no-sandbox`/`--disable-dev-shm-usage` im Container) und wird nur auf bereits erzeugtem HTML eingesetzt. Das Runtime-Image erhält `chromium` und `fonts-dejavu-core`. Abnahme: fünf Unit-Tests (stabiler Hash, wechselnder Inhalt, Byte-Gleichheit, leerer Eingang ohne Rendereraufruf, typisierter Rendererfehler, leere und nicht-Buffer-Ausgabe). Offen: dauerhafte Ablage der Artefakte und die Einbindung in Angebot/Rechnung.
- [x] C049.1: PDF-Download für finalisierte Dokumente. Umgesetzt: `GET /api/v1/documents/:id/pdf` liest den PDF-Hash aus der Dokumentzeile und die Bytes über `readDocumentPdf`; die Antwort ist `application/pdf` mit `inline`-Dateinamen aus der Dokumentnummer, auf unkritische Zeichen reduziert. Entwürfe, fremde Dokumente und fehlende Artefakte liefern `404`, ein Ablagefehler `500`. Abnahme: Integrationsprüfungen am Repository und an der API (Download mit `%PDF-`-Kopf und Content-Type, Entwurf, fremder Mandant, nachträglich entfernte Datei, defekter Adapter, fehlende Anmeldung); alle Gates grün.
- [x] C051.1: Domänenkern für Dokument-Snapshots als Vorstufe zu C051. Umgesetzt: `assertTransition` lässt nur Entwurf → final oder zurückgezogen zu und friert danach jeden weiteren Wechsel ein; `buildDocumentSnapshot` verlangt Empfänger, Dokumentnummer und mindestens eine Position, löst die Vorlagenplatzhalter auf, berechnet Netto/Steuer/Brutto in Cent und liefert HTML, sha256 über genau diese Bytes, Byte-Länge und Summen; Vorlagen-, Layout- und Rechenfehler werden zu einem typisierten Snapshot-Fehler statt zu einem rohen Fehler. Abnahme: fünf Unit-Tests (erlaubte und verbotene Zustandswechsel, Determinismus samt exakter Summen, Hash-Änderung bei einem geänderten Zeichen, fehlende Referenzen, Platzhalterfehler). Offen: Persistenz, Nummernvergabe beim Finalisieren und PDF-Ablage.
- [x] C051: Angebote persistieren und finalisieren. Umgesetzt: Migration `0030` mit `documents` (Art, Vorlage, Event, Kontakt, Nummer nullable und je Mandant eindeutig, Zustand `draft|final|withdrawn`, `issued_at`, `finalized_at`, Snapshot- und PDF-Hash, Netto/Steuer/Brutto in Cent, Version) und `document_lines` als Positions-Snapshot mit Reihenfolge und Produktbezug; Datenbank-Invarianten verlangen eine vollständige finale Zeile und halten Entwürfe frei von Nummer und Hashes; Auditaktionen `document.created`/`document.finalized` samt gepflegter CHECK-Constraint. `createDraft` übernimmt ohne eigene Positionen die Vorlagenpositionen und speichert die Summen schon im Entwurf; `finalize` zieht die Nummer, baut den Snapshot, rendert die PDF über Chromium, legt sie inhaltsadressiert ab und setzt die Zeile in **einer** Transaktion auf final. Ein zweites Finalisieren liefert `invalid_state` ohne weiteren Nummernverbrauch; ein Renderer- oder Ablagefehler rollt Nummer und Zustand zurück, ein unerwarteter Adapterfehler wird nicht verschluckt. Empfänger und Platzhalter stammen aus Kontakt, Event und Summen; ein fehlender Wert bricht ab, statt Lücken zu drucken. API: `POST /api/v1/documents`, `POST /api/v1/documents/:id/finalize`, `GET /api/v1/documents/:id` mit Anmeldung, CSRF, Administratorrecht und Mandantentrennung. Betrieb: `AK_DOCUMENT_STORAGE` (Standard `/data`) und `AK_CHROMIUM_PATH`, Volume `ak-test-documents`/`documents`, das Image legt `/data` für den Containerbenutzer an. Abnahme: 15 Integrationstests (Entwurf aus Vorlage mit exakten Summen, Finalisieren mit Nummer/Hash/Ablage, zweites Finalisieren, Rollback bei Renderer-, Ablage- und unerwartetem Adapterfehler, Mandantentrennung inklusive fremder Vorlage und fremdem Kontakt, fehlendes Layout/Kontakt/Nummernkreis, leere und ungültige Positionen, Eventart/Paket-Platzhalter, Platzhalter ohne Wert, Kontakt ohne Ansprechpartner, Wanduhr als Standardzeit, API mit 401/403/400/404/409/500), ein Unit-Test für alle Zustandsübergänge inklusive Selbstübergang, Migrationszählung 30; neue Datei bei 97,6 % Zeilen und 85,9 % Zweigen. Offen: Bedienoberfläche, Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, Bearbeiten von Entwürfen, PDF-Download (C049.1) und Logo (C048.1).
- [x] C051.2: Dokumentübersicht als Grundlage der späteren Angebotsoberfläche. Umgesetzt: `GET /api/v1/documents` mit optionalen Filtern `eventId`, `kind` und `state`, mandantengebunden, neueste zuerst, ohne Positionen und Hashes; unbekannte Filterwerte weist das Schema mit `400` ab. Abnahme: ein Integrationstest für Liste, Filter und Mandantentrennung sowie API-Prüfungen auf `200`, `401` und `400`; alle Gates grün.
- [x] C051.3: Angebote in der Eventakte bedienbar. Umgesetzt: Abschnitt „Angebote“ in der Übersicht der Eventakte; lädt die Dokumente des Events und die aktiven Angebotsvorlagen, legt einen Entwurf aus der Vorlage mit dem Hauptkontakt an, finalisiert mit Rückmeldung der vergebenen Nummer und verlinkt die PDF. Fehlende Vorlage oder fehlender Hauptkontakt werden erklärt und deaktivieren das Formular; Lade-, Fehler-, Leer- und Beschäftigt-Zustände sind abgedeckt, eine strukturell unerwartete Zeile wird verworfen, statt die Akte zu brechen. Abnahme: acht Komponententests (Liste und Vorlagenfilter, Anlegen mit Event und Kontakt, Finalisieren mit Nummer und PDF-Verweis, Konfliktmeldung, abgewiesener Entwurf und fehlgeschlagene PDF, fehlende Vorlage/Kontakt, Ladefehler, zurückgezogenes Dokument ohne Aktionen), 159 Komponententests grün, Format, Lint, Typen und Build grün. Offen: Logo-Upload in der Oberfläche, Bearbeiten von Entwürfen und Gültigkeitsdatum.
- [x] H021: Korrekturen aus dem Betreiberfeedback vom 19.10.2026. Umgesetzt: (1) Kalender-Abos laufen nicht mehr ab — Migration `0029` macht `expires_at` nullable, entfernt Vorgabe und Räumung, List- und Token-Abfrage prüfen keine Frist mehr; Altbestände mit abgelaufenem Datum bleiben gültig, bis der Link gelöscht wird; die Oberfläche sagt „läuft nicht ab" statt eines Datums. (2) Termine werden als echte Ganztagstermine ausgegeben: `DTSTART;VALUE=DATE`, `DTEND;VALUE=DATE` (Folgetag, exklusiv) und `X-MICROSOFT-CDO-ALLDAYEVENT:TRUE` statt `DURATION:P1D`, damit Kalender sie in der Ganztagszeile führen. (3) Hamburger-Menü mittig im 44-px-Rahmen; „Menü schließen", „Abmelden" und „Dunkelmodus" sind reine Icon-Schaltflächen mit `aria-label` und unverändertem zugänglichem Namen. Abnahme: ICS-Tests auf das neue Format umgestellt (inklusive Abwesenheit von `DURATION`), Feed-Test auf „Altbestand bleibt gültig" umgestellt, 159 Unit-, 216 Integrations- und 151 Komponententests grün, Passwort-Chromium-Ablauf isoliert grün; die volle Chromium-Suite lief zuvor in einen Timeout unter Parallelast und wurde deshalb einzeln bestätigt.
- [x] H022 (UX-Vereinfachung, pausierte neue Funktionen): Terminzeiten ohne manuelle UTC-Versatzfelder in Anlegen, Bearbeiten und Duplizieren. Scope: (1) Die Felder „UTC-Versatz Beginn/Ende" entfallen; die Oberfläche fragt nur lokales Datum und lokale Uhrzeit ab und löst eindeutige Zeiten automatisch in der Event-/Mandantenzeitzone auf. (2) Nur doppelte Herbst-Uhrzeiten zeigen eine Auswahl „Sommerzeit/Normalzeit" mit dem jeweiligen Versatz; nicht existierende Frühjahrszeiten erklären einen Feldfehler am Beginn-/Endefeld und werden nicht gesendet. (3) Unveränderte Zeiten übernehmen den gespeicherten Zeitpunkt exakt, auch innerhalb der doppelten Stunde und mit Sekunden/Millisekunden; nach einer Änderung von Datum oder Uhrzeit wird nie ein früherer Versatz weiterverwendet. Keine Server-, API-, Datenbank- oder Migrationsänderung; die Versatzfelder der Disposition bleiben unverändert. Abnahme: Unit-Regressionstests für Sommer-/Winterauflösung, beide Auswahlmöglichkeiten der doppelten Stunde, nicht existierende Uhrzeit, unveränderte doppelte Stunde und Erhalt von Sekunden; Komponententests für Datumswechsel Sommer→Winter und Winter→Sommer, beide Auswahlmöglichkeiten, Feldfehler ohne Absenden und unveränderte doppelte Stunde; echter Datumswechsel über die Zeitumstellung im Chromium-Ablauf (16.10. nach 16.11. und zurück). Status: umgesetzt; 184 Unit-, 164 Komponenten-, 237 Integrationstests und vier Chromium-Abläufe grün, Format, Lint, Typen, Coverage und Build grün. Offen: die Versatzfelder der Ressourcen-/Sperrdisposition bleiben bewusst unverändert und folgen erst mit einem eigenen Slice. Korrektur nach unabhängiger Prüfung: neue und geänderte doppelte Uhrzeiten verlangen ausdrücklich „Bitte wählen“ und lösen ohne Wahl weder still auf noch senden sie; ein gespeicherter doppelter Zeitpunkt zeigt seinen Versatz vorausgewählt, behält ohne Änderung den exakten Zeitpunkt (inklusive Sekunden/Millisekunden) und lässt den bewussten Wechsel auf den anderen Versatz zu, der dann Vorrang hat. Ein unlesbarer gespeicherter Zeitstempel verwirft eine gültige Wanduhrzeit nicht mehr; Beginn und Ende werden getrennt geprüft, und der erste fehlerhafte Feldeingang erhält den Fokus. Abnahme: drei zusätzliche Unit-Tests (Vorrang der expliziten Wahl, Vorauswahl des gespeicherten Versatzes, toleranter Umgang mit beschädigtem Altzeitpunkt) und sechs zusätzliche Komponententests (Beginn und Ende doppelt ohne Wahl blockiert, Frühjahrslücke am Ende, Duplikat mit erhaltenem Zeitpunkt und Millisekunden, geänderte doppelte Uhrzeit erneut ohne Wahl, bewusster Versatzwechsel); 187 Unit-, 170 Komponenten- und 237 Integrationstests, der Chromium-Passwortablauf mit Datumswechsel über die Zeitumstellung sowie Coverage und Build grün.

- [x] H023 (UX-Zuverlässigkeit, pausierte neue Funktionen): Bestätigtes Speichern von anschließendem Ladefehler trennen. Scope: `EventPanel.tsx`, `EventDetails.tsx`, `ResourceAssignments.tsx` und `EventDocuments.tsx` melden nach einer 2xx-Antwort „gespeichert“ und schließen bzw. leeren den Anlegeeditor, auch wenn das folgende `GET` scheitert; ein Hinweis „gespeichert, aber nicht neu geladen“ mit Schaltfläche zum erneuten Laden ersetzt jede Aufforderung, erneut zu speichern oder anzulegen. Nur ein tatsächlich fehlgeschlagener Schreibzugriff behält die Eingabe. Eine synchrone Sperre verhindert doppelte Mutationen durch schnelle Doppelklicks, zusätzlich zu den vorhandenen Beschäftigt-Zuständen. `EventDetails` nummeriert Ladeanfragen und ignoriert verspätete Antworten älterer Anfragen. Keine API-, Datenbank- oder Migrationsänderung. Abnahme: je ein Komponententest für `POST`/`PUT` mit 2xx und anschließend fehlgeschlagenem `GET` samt genau einer Mutation und funktionierender Wiederholung des Ladens, ein Test für verspätete Eventakten-Antworten und ein Test, dass eine abgelehnte Statusänderung die Auswahl behält; 187 Unit-, 175 Komponenten- und 237 Integrationstests, der Chromium-Ablauf und Coverage grün.

- [x] H024 (UX-Vereinfachung, pausierte neue Funktionen): Termin-Editor auf den Normalfall reduzieren und Zeitplan feldbezogen prüfen. Scope: Der sichtbare Normalfall umfasst Eventname, Status, Hauptkontakt und Termin; Eventart, Paket, Veranstaltungsort, Anfragequelle, weitere Kontakte, Beschreibung und interne Notizen wandern in das aufklappbare „Weitere Angaben“, ohne Werte, HTML-Eingabe oder serverseitige Bereinigung zu verändern. Die Prüfung verlangt Beginn und Ende gemeinsam oder gar nicht, ein Ende nach dem Beginn und leitet bei vorhandenem Beginn das fachliche Eventdatum aus dem lokalen Starttag ab (auch über Mitternacht und an Zeitumstellungstagen); ohne Uhrzeiten bleiben Datum oder undatiertes Event möglich. Der Hauptkontakt ist in den weiteren Kontakten ausgeschlossen, ein Hauptkontaktwechsel entfernt ihn dort, und eine doppelte Zuordnung blockiert mit Erklärung. Fehler bleiben am betroffenen Feld sichtbar, der Entwurf bleibt erhalten; ein gebuchtes Event behält seinen Status. Keine API-, Datenbank- oder Migrationsänderung. Abnahme: Komponententests für Basis-Anlegen/-Bearbeiten/-Duplizieren, abgeleitetes Datum über Mitternacht und Zeitumstellung, erhaltene Werte der weiteren Angaben, Ausschluss des Hauptkontakts, teilweise oder umgekehrte Zeiten ohne Mutation und unveränderten Gebucht-Status; Chromium-Ablauf klappt „Weitere Angaben“ für Fortgeschrittenfelder auf; 187 Unit-, 181 Komponenten- und 237 Integrationstests, alle vier Chromium-Abläufe, Format, Lint, Typen, Build und Coverage (97,11 % Zeilen, 94,67 % Zweige) grün.

- [x] H025 (UX-Härtung aus der unabhängigen Prüfung von H023/H024, pausierte neue Funktionen): Scope: (1) Der aufklappbare Bereich „Weitere Angaben“ nutzt die volle Breite des Formulargitters; seine Felder stehen in einem responsiven Raster, das auf schmalen Geräten einspaltig wird. Geprüft wird die tatsächliche DOM-Geometrie bei 1280 px und 375 px, nicht ein Screenshot. (2) Ein aus dem Beginn abgeleitetes Eventdatum erscheint bei vorhandenem Beginn schreibgeschützt samt Hinweis und folgt weiterhin dem lokalen Starttag; nach dem Leeren des Beginns ist das Datum wieder eingebbar, Datum ohne Uhrzeiten und undatiertes Event bleiben unverändert möglich. (3) Weitere Kontakte werden beim Laden einer gespeicherten Fassung, beim Duplizieren und bei einem Hauptkontaktwechsel ohne den Hauptkontakt normalisiert; der bisherige, im geschlossenen Bereich unsichtbare Blockierzustand entfällt, sodass kein nicht auflösbarer Zustand das Speichern sperrt. Die Serverprüfung bleibt unverändert. (4) Ein erneutes Laden der Eventakte verwirft ungespeicherte Status- und Ressourceneingaben nur nach ausdrücklicher Bestätigung; ohne Bestätigung bleiben Entwurf und Hinweis stehen, mit Bestätigung werden die Formulare neu aufgebaut, und der nächste Schreibzugriff verwendet die frisch geladene Version statt einer veralteten. (5) Jeder erfolgreiche Listenabruf löscht einen alten Hinweis „gespeichert, aber nicht neu geladen“; eine bestätigte Ressourcenspeicherung bleibt als Meldung im stabilen Elternteil sichtbar, auch wenn die Ressourcenkomponente nach dem versionsbedingten Neuladen neu eingehängt wird und die Listenabfrage danach scheitert. Gespeichert und fehlgeschlagen bleiben getrennt. (6) Hinweistext und Schaltfläche sind getrennt (die Live-Region enthält nur den Text); die Abdeckung für ein Tagesende am selben Tag in der doppelten Stunde ist wiederhergestellt, und ein Duplikattest prüft die erhaltenen Werte der weiteren Angaben über einen echten Klick auf das Summary. Keine API-, Datenbank- oder Migrationsänderung. Abnahme: acht zuvor fehlschlagende Komponentenregressionen (Normalisierung statt Blockade, abgeleitetes Datum schreibgeschützt und wieder eingebbar inklusive datumslosem und undatiertem Event, erhaltene Werte beim Duplizieren, Löschen eines alten Hinweises nach erfolgreichem Listenabruf, bestätigte Ressourcenspeicherung bei fehlgeschlagener Listenabfrage, Bestätigungspflicht beim erneuten Laden für Status- und Ressourceneingaben mit anschließender Verwendung der frischen Version) sowie eine echte DOM-Geometrieprüfung mit Chromium in einem lokalen Scratch-Ablauf (Details 1238 px in einem 1280-px-Gitter, vier Spalten, 21 px Rand beidseitig; mobil 345,8 px, eine Spalte, kein horizontaler Überlauf); 187 Unit-, 187 Komponenten- und 237 Integrationstests, alle vier Chromium-Abläufe, Format, Lint, Typen, Build und Coverage (97,64 % Zeilen, 94,66 % Zweige) grün. Status: umgesetzt. Offen bleiben die UTC-Versatzfelder der Ressourcen- und Sperrdisposition und eine eigene Führung für gleichzeitige 409-Konflikte in der Akte; beides ist nicht Teil dieses Slices.

- [x] H026 (UX-Vereinfachung der Ressourcendisposition, pausierte neue Funktionen): Termin und Ressourcenzuweisung der Eventakte auf den Normalfall reduzieren und manuelle UTC-Versätze verbergen. Scope: (1) Ein Terminblock fragt nur lokales Datum und lokale Uhrzeit ab und löst den Versatz über die vorhandenen Helfer `EventTimeField`/`event-time.ts` in der Eventzeitzone auf; die Versatzfelder für Eventbeginn und Eventende entfallen. (2) Nur doppelte Herbst-Uhrzeiten verlangen eine Auswahl Sommerzeit/Normalzeit für Beginn und Ende getrennt; Frühjahrslücken erzeugen einen Feldfehler und fokussieren das betroffene Feld, ohne zu senden. Ein unveränderter gespeicherter Zeitpunkt bleibt exakt erhalten, auch in der doppelten Stunde und mit Sekunden/Millisekunden; nach einer bewussten Änderung wird nie ein früherer Versatz weiterverwendet. (3) Das Eventdatum wird bei vorhandenem Beginn aus dem lokalen Starttag abgeleitet, sichtbar schreibgeschützt und nach dem Leeren des Beginns wieder eingebbar; Datum ohne Uhrzeiten und undatiertes Event bleiben möglich. (4) Eigene Dispositionszeiträume je Einheit liegen im zugänglichen Bereich „Erweitert“; gespeicherte Werte sind bereits im zugeklappten Zustand sichtbar und werden unverändert übernommen, auch wenn der Bereich geschlossen bleibt. (5) Eine erforderliche Korrektur in diesem verborgenen Bereich öffnet ihn und fokussiert das erste fehlerhafte Feld. (6) Eine ausdrückliche Speicherung bleibt; bestätigtes Speichern und anschließender Ladefehler bleiben getrennt, ungespeicherte Eingaben werden vor einem erneuten Laden nur nach Bestätigung verworfen. Pflichtprüfungen zu Quelle, Prüfstatus, Fotobox und Belegungskonflikten sowie alle Server-APIs und Reservierungsconstraints bleiben unverändert; keine API-, Datenbank- oder Migrationsänderung, keine neue Funktion. Die Versatzfelder der zeitweisen Sperren blieben in H026 ausdrücklich unverändert offen und entfallen mit H040 (`ResourceBlocks.tsx`). Abnahme: Komponentenregressionen für Frühjahrslücke mit Feldfehler und Fokus ohne Mutation, doppelte Herbststunde für Beginn und Ende mit ausdrücklicher Wahl und getrennten Zeitpunkten, erhaltenen exakten Zeitpunkt in der doppelten Stunde samt Millisekunden, Datumswechsel Sommer→Winter und Winter→Sommer ohne alten Versatz, schreibgeschütztes abgeleitetes Datum samt wieder eingebbarem Datum, erhaltenen gespeicherten Zeitraum bei zugeklapptem „Erweitert“ sowie Öffnen und Fokussieren eines dort verborgenen fehlerhaften Feldes; bestehende Tests zu Speichern plus Ladefehler, Doppelklick-Sperre und schmutzigem Neuladen bleiben erhalten. Der Chromium-Ablauf prüft den Terminblock ohne Versatzfelder, das schreibgeschützte Datum und das Öffnen von „Erweitert“ über einen echten Summary-Klick. Ein Nachtrag nach der unabhängigen Prüfung behebt zwei Befunde ohne Architekturänderung: Ein korrigiertes Terminfeld löscht seinen Fehler und `aria-invalid` ohne erneutes Speichern; Partnerfehler (Beginn/Ende sowie je Einheit) verschwinden mit der Korrektur des jeweils anderen Felds, während eine weiterhin unmögliche lokale Uhrzeit ihren aktuellen Feldfehler behält. Termin-Editor und Eventakte vergeben über einen festen `idPrefix` getrennte Fehler-IDs, sodass `aria-describedby` jeweils den eigenen Text nennt. Die sechs Feldprüfungen der Akte (Beginn oder Ende fehlt, Ende nicht nach dem Beginn, Dispositionsbeginn oder -ende leer, Dispositionsende nicht nach dem Beginn) sind mit Fokus belegt. Abnahme: zwei neue Komponentenregressionen für den gelöschten Altfehler ohne zweites Speichern und für gleichzeitige Editor- und Aktenfehler mit eigenen IDs und eigenem Text. Status: umgesetzt; 187 Unit-, 197 Komponenten- und 237 Integrationstests sowie beide Chromium-Abläufe grün, Format, Lint, Typen, Build und Coverage (97,68 % Zeilen, 94,57 % Zweige; `ResourceAssignments.tsx` 100 % Zeilen und 93,8 % Zweige, `EventTimeField.tsx` 100 % Zeilen und 89,7 % Zweige). Offen blieben die UTC-Versatzfelder der zeitweisen Sperren (seit H040 entfernt) und eine eigene Führung für gleichzeitige 409-Konflikte in der Akte.

- [x] H027 (Testbetrieb, pausierte UI): Images der freigegebenen UX-Branch veröffentlichen, ohne `main` zu mergen oder fremde Branches zu überschreiben. Scope: Der `images`-Job in `quality.yml` prüft die Veröffentlichungsfreigabe über genau eine `fromJSON`-Allowlist der vollständigen Branch-Refs `refs/heads/main`, `refs/heads/codex/local-runtime-ci` und `refs/heads/codex/ux-event-simplification`; weiterhin nur bei `push`, niemals bei Pull Requests, unverändert nach `needs: quality`, mit denselben gepinnten Actions, Secrets, `linux/amd64`-Plattform und SHA-Tags. Keine neue Berechtigung, kein `latest`-Tag, kein Merge, kein Force-Push; `main` und `local-runtime-ci` behalten ihre bisherige Freigabe. Abnahme: Workspace-Test auf die exakte Allowlist-Menge, genau einen `github.ref`-Vergleich, ausgeschlossene Pull Requests und weiterhin vorhandene Sicherheitsmerkmale; Dokumentation der Freigabe, der zweiten Veröffentlichungsbranch und der Regel, dass jeder künftige Head erst nach grünem Lauf samt beiden Images automatisch folgt.

- [x] H028 (Testbetrieb, pausierte UI): Zielbranch des automatischen Testupdates sicher konfigurierbar machen. Scope: `scripts/auto_update.py` liest den optionalen Schlüssel `branch` aus der privaten Betreiberkonfiguration; ohne Schlüssel gilt unverändert `codex/local-runtime-ci`, ausdrücklich freigegeben sind nur `codex/local-runtime-ci` und `codex/ux-event-simplification`. Der Wert wird als exakter Token gegen ein hartes Allowlist-Set und ein enges Muster geprüft; fremde Branches, URLs, Pfadanteile, Leerraum und andere Typen werden vor jedem GitHub-Aufruf abgewiesen. Die konfigurierte Branch steuert Ref-Abfrage, `branch`-Filter der Workflow-Läufe und die `head_branch`-Prüfung des Laufs; unverändert bleiben Redirect-Abweisung, Größenlimit, Prüfung des aktuellen exakten SHA, Vorwärtszwang, Revision/Digest-Pins, Quadlet-Snapshot, Marker, gemeinsames Schloss, Checkpoint mit verifizierter Hostkopie, atomare Quadlets und Gesundheitsprüfung. Keine UI-, API-, Datenbank- oder Migrationsänderung. Abnahme: Standardkonfiguration ohne `branch` folgt weiterhin der bisherigen Branch; UX-Konfiguration verwendet dieselbe Branch in Ref, Lauf-Filter und Kopfprüfung; ein grüner Lauf einer anderen freigegebenen Branch oder mit abweichendem SHA ergibt `waiting-for-green-head` ohne Pull; unbekannte, fehlerhafte und fremde Branchwerte sowie zusätzliche Konfigurationsschlüssel werden ohne GitHub-Kontakt abgewiesen; Dokumentation von Allowlist, Umschaltprozedur und Vorwärtsbedingung.

- [x] H029 (P1, Bookitup-inspiriertes Anlegen): Leichtes, Bookitup-inspiriertes Event-Anlegen mit Datum zuerst. Scope: Ein modaler Dialog öffnet mit nativem Datumsfeld, Kundenauswahl und Eventart; Zeiten, Ort, Notizen, Paket, Quelle, Status und weitere Kontakte liegen zugeklappt unter „Weitere Angaben“ und behalten ihre Eingaben beim Auf- und Zuklappen. Der serverseitig erforderliche Name wird deterministisch aus Eventart und Hauptkontakt erzeugt und ist unter „Weitere Angaben“ manuell überschreibbar; ein zusätzliches Pflichtfeld nur für die API entsteht nicht. Datum ohne Zeiten speichert `startsAt`/`endsAt` als `null` mit korrektem `eventDate`, undatiert bleibt zulässig; es wird nie Mitternacht erfunden. Die vorhandenen Terminregeln (gemeinsam oder gar nicht, Ende nach Beginn, Sommerzeit-Auswahl, Frühjahrslücke) und die schreibgeschützte Datumsableitung aus dem Beginn bleiben. Fokus startet im Datumsfeld, Tab bleibt im Dialog, Escape und Schließen schreiben nichts und geben den Fokus zurück; genau eine primäre Speichern-Aktion, ein zugänglich benanntes Schließen. Doppelte POSTs sind synchron gesperrt; ein bestätigtes Speichern schließt den Dialog auch bei anschließend fehlgeschlagener Listenabfrage. Bestehendes Bearbeiten/Duplizieren, gebuchter Status, schmutziger Entwurf und Speichern-vs-Neuladen bleiben gleich stark. Keine Server-, API-, Datenbank- oder Migrationsänderung. Abnahme: zuerst fehlschlagende Komponenten- und Chromium-Regressionen für Datum-only, undatiert, generierten Namen samt Überschreibung, optionale Zeiten, Werterhalt der weiteren Angaben, Abbrechen/Escape/Fokus, echte Platzhalter-Eingabe ohne Löschen gespeicherter Werte, Doppelklick und Speichern-Erfolg bei Neuladefehler; Desktop-/Mobilgeometrie und Tastaturführung mit synthetischen Daten. Status: umgesetzt; 187 Unit-, 210 Komponenten- und 237 Integrationstests, vier Chromium-Abläufe, Format, Lint, Typen, Build und Coverage (97,37 % Zeilen, 93,75 % Zweige; `EventCreateDialog.tsx` 99,1 % Zeilen und 91,7 % Zweige) lokal grün. Review-Nachtrag: Anlegen/Duplizieren sind bei offenem Bearbeiten-Entwurf gesperrt, der Dialog nutzt eigene `event-create-*`-IDs, der Fokus kehrt nach Editor-Abbruch/-Speichern auf einen überlebenden Auslöser zurück, Schließen und Escape sind während eines laufenden POST wirkungslos, und der Hinweis nennt Datum, Kunde oder Eventart als ausreichend. Keine Server-, API-, Datenbank- oder Migrationsänderung.

- [x] H030 (P1, UX-Grundlage, umgesetzt): Automatische Aktualisierung statt manueller Aktualisieren-Schaltflächen. Die sichtbaren Schaltflächen „Events aktualisieren“, „Eventakte aktualisieren“ und „Kalender aktualisieren“ entfallen. Ein gemeinsamer, fokussierter Lifecycle-Hook aktualisiert Eventliste, Eventakte und Kalender nach erfolgreichen Schreibvorgängen sowie beim Sichtbarwerden des Dokuments oder Fokusgewinn des Fensters. Fokus und Sichtbarkeit derselben Rückkehr lösen genau eine Abfrage aus; ein laufender Abruf und ein verborgenes Dokument werden übersprungen, Listener verschwinden beim Unmount, es gibt keinen Takt und keine Umfrage. Ein schmutziger Entwurf wird nie still verworfen: Liste und Kalender dürfen sich um einen intakten Editor aktualisieren; die Eventakte hält Hintergrundladungen zurück, solange Status- oder Ressourceneingaben ungespeichert sind, und zeigt stattdessen einen ruhigen Hinweis mit ausdrücklicher Verwerfen-und-Neuladen-Aktion. Kein Hintergrund-`window.confirm`, kein versionsbedingter Remount schmutziger Formulare. Nach Speichern oder Abbrechen wird sicher neu geladen; die danach verwendete Fassung ist die zuletzt geladene. Ein Ladefehler behält die letzten guten Zeilen beziehungsweise Details und bietet eine reine Wiederholungsaktion ohne erneute Mutation; gespeichert und nicht neu geladen bleiben getrennt. Abnahme: kein manueller Aktualisieren-Knopf im Normalfall, keine Doppelabfragen, Entwurfsschutz und ehrliche Fehlerzustände. Status: umgesetzt in `b2100b4c7df0b05dec81ada119017e13f01ad424`. Die unabhängige Prüfung ist eingearbeitet: doppelter Aktenabruf bei gleichzeitiger Listenaktualisierung durch In-Flight-/Id-/Revisionsschutz samt Kombinationstest behoben, verzögerter Hinweis präzisiert und als Status angekündigt, obsoleter WebsiteInbox-Text und Kalender-Fokusverlust korrigiert. Lokal grün: 187 Unit-, 231 Komponententests, vier Chromium-Abläufe, Format, Lint, Typen, Build, Coverage 97,38 % Zeilen/93,81 % Zweige, Changed-Code 65/65 Zeilen und 73/77 Zweige. GitHub-Qualitätslauf 39477841511 mit Quality und beiden Images erfolgreich; der automatische Testupdater hat `ak-test-api`, `ak-test-worker` und `ak-test-admin` gesund auf exakt diesem SHA übernommen (`last-success.json` stimmt, `ak-test-update.timer` aktiv, kein `needs-attention`). `https://auftragskompass.samuelgesang.de` antwortet 200; das ausgelieferte Admin-Bundle enthält die drei alten Aktualisieren-Texte nicht mehr und zeigt die Fehler-Wiederholungsaktionen sowie den verzögerten Hinweis. Eine echte Tab-Rückkehr lässt sich im headless Chromium nicht abbilden; der E2E-Ablauf löst dieselbe Sichtbarkeits-/Fokusfolge im gebauten Bundle aus. Die manuelle Sichtprüfung eines echten Tab-Wechsels bleibt als Restrisiko dokumentiert.

- [x] H031 (P1, Navigation und ruhige Aktionen, Phase 2 Quellstand): Markenname, Bereichstitel und Eventzeilen führen zur Übersicht beziehungsweise Eventakte; die Navigation lässt sich auf Icons einklappen, und häufige Aktionen sind ruhige, benannte Icon-Schaltflächen. Scope: (1) Desktop-Markenname und mobiler Bereichstitel bleiben echte `#events`-Links; der bereits aktive Heimweg erzeugt keinen zusätzlichen Historieneintrag und fragt nicht. (2) Die Eventzeile selbst ist der native Link zur Akte (`#event-<id>`, Fokus beim Schließen zurück auf die Zeile); der separate „Eventakte öffnen“-Knopf entfällt. Die Zusammenfassung enthält keine verschachtelten Links oder Knöpfe, Textauswahl verhindert das Öffnen, Bearbeiten/Duplizieren bleiben unabhängige Geschwisteraktionen, und ein Klick öffnet die Akte genau einmal. (3) Sichtbare Icon-only-Bedienelemente in Navigation, Kopf, Theme, Abmelden, Dialog-Schließen, Event, Kalender und Kontaktsuche haben präzise `aria-label` und `title`; der Theme-Knopf beschreibt die nächste Aktion („Dunkelmodus aktivieren“/„Hellmodus aktivieren“) und behält `aria-pressed`. (4) Die Desktop-Seitenleiste klappt über einen benannten Knopf mit `aria-expanded` auf reine Icons ein und wieder aus; Marke/Home bleibt als „AK“-Link nutzbar, Links behalten `aria-label`, `title` und `aria-current`, Version/Untertitel/Kontozusatz werden kompakt ausgeblendet, und die Präferenz liegt unter `ak-sidebar` inklusive Storage-Sync. Der mobile Dialog bleibt unverändert eine Textnavigation. (5) Event anlegen, Event bearbeiten und Event duplizieren sind 44-px-Icon-Schaltflächen mit denselben semantischen Namen, Disabled-/Busy-Regeln und ohne sichtbaren Text; Kalender-Vor/Zurück/Heute und die Kontaktsuche folgen demselben Muster, während Datum und Ansichtsauswahl den Kalenderkontext sichtbar halten. (6) Die globale Suche startet als Icon, öffnet ein fokussiertes Eingabefeld, behält einen nicht abgesendeten Entwurf über Schließen/erneutes Öffnen, schließt per Escape oder Knopf mit Fokusrückkehr und schreibt erst beim Absenden `q` plus `#search` in einem Historieneintrag; die bestehenden Ergebnislisten und URL-Filter bleiben unverändert. Heim- und Suchwechsel verwenden den kleinen registrierten Dirty-Hook für die Eventakte; Abbrechen hält Route und Eingabe, Bestätigen erlaubt den Wechsel. Keine API-, Datenbank- oder Migrationsänderung. Grenzen: Andere Navigationslinks, „Eventakte schließen“, Browser-Zurück und nicht registrierte Formulare (z. B. eine gewählte, nicht abgesendete Dokumentvorlage) bleiben außerhalb dieser Abfrage; keine universelle Dirty-Garantie. Abnahme: fehlschlagende Komponentenregressionen für direkte Eventzeilen samt Textauswahl und unabhängigen Icons, Icon-Titel und Theme-Labelwechsel, Einklappen/Ausklappen samt `aria-current`, Tooltip, Fokus, Storage-Sync und mobil unverändertem Dialog, Icon-Aktionen in Event/Kalender/Kontakten, Suche öffnen/fokussieren/Entwurf/Escape/Absenden/Route sowie Heim- und Such-Dirty-Schutz. Die unabhängige Prüfung ist eingearbeitet: eingeklappte Leiste blendet nur die Konto-Identität aus und hält Logout-Fehlerstatus sichtbar/angekündigt; Modifier- und Mittelklick auf Eventzeilen ändern den aktuellen Tab nicht; Desktop→Mobil verliert den Fokus aus der Leiste nicht; „Stammdaten bearbeiten“ ist eine benannte Icon-Aktion; der AK-Heimlink hat einen Titel; die Eventzeilen verwenden sichtbaren Text als zugänglichen Namen ohne Label-Mismatch. Lokal: 187 Unit- und 244 Komponententests, Format, Lint, Typen, Build und Dokumentationsprüfung grün; Changed-Code 103/103 Zeilen und 84/87 Zweige. Die vollständige Chromium-Suite (4 Abläufe, Google- und Passwortanmeldung) ist mit synthetischen Daten grün, einschließlich 1280/390-Geometrie, eingeklappter Leiste mit Persistenz und Logout-Fehlerstatus, Suche/Entwurf/Overflow, Tastatur-Enter auf Eventzeilen, 44-px-Zielen und Dirty-Dialogen. Commit, CI und Testbetrieb sind nach diesem Stand zu verifizieren; Integrationstests und Linux-CI bleiben maßgeblich. Kein Merge nach `main`.

- [x] H032 (P1, Website-Anfragen, umgesetzt: Quellstand und lokale Abnahme grün; Push/CI/Testbetrieb im Scratch-Beleg): Eine übernommene Website-Anfrage wird automatisch zur Option ohne Zeiten und ohne Reservierung; Herkunft und Logbuch bleiben erhalten. Umgesetzt: `receiveWebsiteInquiry` nimmt einen optionalen Status `'inquiry' | 'option'` an (Standard `'inquiry'` für bestehende direkte Aufrufe); Automatik und autorisierte manuelle Wiederholung `POST /api/v1/website-inquiries/:id/import` verwenden dieselbe Transaktion und liefern eine Option - Fingerabdruck-Idempotenz, Mandantensperre, Fremdschlüssel, Herkunft `Website: <formId> (v<version>)`, Original-Payload, leer bleibende Uhrzeiten, `eventDate` und Logbuch `website_received` mit `nextStatus option` sind unverändert, ohne Reservierung, Mail und Paket-/Eventartzuordnung. `startWebsiteOptionDrain` (`packages/core/src/website-option-worker.ts`) verarbeitet pro Takt höchstens zehn noch nicht übernommene Eingänge (`NOT EXISTS`, sortiert nach lokalem Eingang und ID), jeden Eintrag in eigener Transaktion; ein fachlich scheiternder Eintrag wird mit festem Code protokolliert, beendet den Lauf nicht und bleibt als Ausnahme sichtbar; nur Infrastruktur-/Datenbankfehler setzen die Bereitschaft herab; kein persistenter Zähler/Backoff, ein prozesslokaler Satz versucht jeden Eintrag im laufenden Prozess genau einmal (Neustart oder manuelle Übernahme setzt ihn zurück). `apps/worker/src/worker-start.ts` verdrahtet Start, Health (`expiry && (!drain || drain.ready()) && (!sync || sync.ready())`) und Reihenfolge beim Herunterfahren (erst Drain, dann Sync, Ablauf, Pool); die echte `apps/worker/src/main.ts` wird in einem Kindprozess samt Health-Abfrage und Signalende geprüft. Die Inquiry-Kennungen sind optional: fehlen beide, startet kein Takt, eine Warnung `website_option_drain_unconfigured`, der Worker bleibt gesund und alle Eingänge bleiben Ausnahmen; genau eine Kennung oder eine Nicht-UUID bleibt ein Fehler (`website_option_config_invalid`, nicht bereit). Eine kaputte Sync-Konfiguration bricht den Start nicht ab (`inquiry_sync_config_invalid`). Die unabhängige Prüfung bestätigte genau einen deployment-kritischen Defekt (die Bereitschaft hing an der optionalen Inquiry-Konfiguration und hätte einen frischen oder wiederhergestellten Testbetrieb dauerhaft unhealthy gemacht); er ist mit fehlschlagender Regression zuerst behoben, und `tests/unit/worker-main.test.ts` prüft den echten Worker jetzt ohne diese Kennungen (bereit, genau eine Warnung, kein Takt) sowie sauberes Signalende mit Exitcode 0. Land: `AK_INQUIRY_DEFAULT_CONTACT_COUNTRY` (`^[A-Z]{2}$`, Betreiberentscheidung 19.10.2026: DE als Deployment-Wert) und `AK_INQUIRY_OPTION_INTERVAL_MS`; ohne ENV bleibt jeder Eingang mit neuem Kontakt als sichtbare Ausnahme `contact_review` stehen, in der Domäne ist kein Land fest verdrahtet. Die Oberfläche heißt „Website-Eingänge (Ausnahmen)“, erklärt die automatische Option, zeigt nur noch nicht automatisch angelegte Eingänge mit leerem Landfeld (nur für neue Kontakte), behält die idempotente autorisierte Wiederholung und lädt beim Öffnen bzw. bei Rückkehr statt zu pollen. Kontaktregeln unverändert (nur exakter aktiver privater Name+E-Mail-Treffer wird wiederverwendet, sonst Prüfung); zwei Anfragen derselben Person werden über die Mandantensperre serialisiert und die zweite nutzt den ersten Kontakt. Keine Migration, keine neue Route, keine Schema-/Auth-/CSRF-/Tenant-Änderung. Abnahme lokal: 226 Unit-, 315 Komponenten- und 274 Integrationstests (39 davon Website-Eingänge mit den H032-Fällen A-K: neue Option mit Datum, leeren Zeiten, null Reservierungen, einem Beleg und exakter Herkunft; Wiederholung/Parallelität/Pool-Neustart ohne Dublette; Mandantentrennung und fremde IDs; ungültige Zustellungen ohne Wirkung; mehrdeutiger Kontakt als Ausnahme bei weiterlaufendem Lauf; Rollback ohne Reste; Worker-Start/Bereitschaft/Stopp/kein Überlappen; ENV-Land gültig/ungültig/fehlend; idempotente manuelle Wiederholung), der Chromium-Ablauf, Format, Lint, Typen, Build und Dokumentationsprüfung grün. Coverage, vollständige Chromium-Suite, CI und Testbetrieb werden nach dem Push im Scratch-Ergebnis belegt, ohne zweiten Dokumentations-Commit. H035 (Dateien, d1999e7/f1344c1/9984cbf) und H037 (Kalender, c744fd7) waren zum Zeitpunkt dieses Eintrags bereits released (die H035-Checkbox war stale und ist nachgezogen); offen bleibt H036. Grenze: der macOS-`RLIMIT_FSIZE`-Backuptest bleibt lokal rot, Linux-CI ist maßgeblich.

- [x] H033 (P2, Einstellungen, umgesetzt: Quellstand und lokale Abnahme grün; Push/CI/Testbetrieb werden nach dem Commit im Scratch-Ergebnis belegt): Ressourcen- und Produktverwaltung wandern vollständig unter Einstellungen und verlassen die Hauptnavigation; bestehende Ressourcen-, Sperr-, Kalender-, Preis-, Katalog- und Eventzuordnungsfunktionen bleiben unverändert. Die Nutzerentscheidung vom 20.10.2026 erweitert den ursprünglichen Ressourcen-Scope ausdrücklich um die Produktverwaltung. Scope: (1) Die Hauptnavigation enthält in Desktop-Seitenleiste und mobilem Dialog weder „Ressourcen“ noch „Produkte“; die Einstellungsunterseite führt beide als Abschnitte `#settings-resources` und `#settings-products` mit korrektem `aria-current` in Haupt- und UnterNavigation. (2) Die bisherigen Tokens `#resources` und `#products` bleiben exakt erhalten und werden ohne Router-Umbau auf dieselben Routen abgebildet; alte Lesezeichen sowie Zurück/Vorwärts und Hash-Wechsel öffnen die Verwaltung innerhalb von Einstellungen ohne vollständiges Neuladen, ohne Auth-Reset und ohne Verlust von Query, Filter- oder Entwurfszustand. (3) Beide Panels werden genau einmal gerendert und beim Wechsel zwischen den Einstellungsabschnitten nur verborgen, nicht neu eingehängt; Ressourcen- und Produktabrufe fallen dadurch nicht doppelt an, ungespeicherte Eingaben bleiben erhalten. (4) Jeder Abschnitt hat genau eine eigene H2 („Ressourcen“ beziehungsweise „Produkte“) unter dem einzigen Seiten-H1 „Einstellungen“; Bereichsnamen, einklappbare Icon-Beschriftungen, Tastaturfokus und mobile Geometrie bei 320/390 px ohne horizontalen Überlauf bleiben intakt. (5) Ressourcenbearbeitung samt zeitweisen Sperren und Produkte samt Steuer, Preisen, Zustand und Duplizieren bleiben mit bestehender Berechtigungs-/Deaktiviert-Logik erreichbar; Ressourcenzuweisung in Event und Kalender sowie Produktauswahl in Angeboten/Events bleiben im normalen Workflow. Keine API-, Schema-, Migrations-, Auth-, Tenant-, CSRF- oder Geschäftsregeländerung, keine öffentliche Projektion. Abnahme: fehlschlagende Komponententests für Haupt-/Unternavigation, kanonische und alte Hashes, genau ein sichtbares Panel ohne doppelte Abrufe/IDs, erhaltene Entwürfe beim Alias-Wechsel sowie bestehende Ressourcen-/Produktabläufe; Chromium bei 1280/390/320 für die betroffenen Einstellungs-, Ressourcen-, Sperr- und Produktpfade. Lokaler Abschluss: 190 Unit-, 265 Komponenten- und 237 Integrationstests grün; Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung grün; Coverage 97,40 % Zeilen und 93,80 % Zweige. Die vollständige Chromium-Suite ist mit 6/6 Abläufen grün, einschließlich beider Anmeldearten, Ressourcen-/Sperr-/Produktpfaden, echter Zurück-/Vorwärts-Navigation zwischen kanonischen und alten Hashes ohne Neuladen oder Query-Verlust, erhaltener Entwürfe und einzelner Abrufe, Tastatur-Enter/Fokus in der Einstellungs-Unternavigation auf Desktop und mobil sowie 1280/390/320 ohne horizontalen Überlauf (lange Untermenü-Labels brechen bei 320 px um). Changed-Code-Coverage, Linux-CI und Testbetrieb werden nach Commit/Push im Scratch-Ergebnis belegt; keine zweite Dokumentations-Pushrunde. Die unabhängige Quellprüfung fand keine bestätigten funktionalen Defekte. Offen bleiben H032 (Website-Option) und H034 (Locations).

- [x] H034 (P2, Ort/Adresse am Event, umgesetzt: Quellstand und lokale Abnahme grün; Push/CI/Testbetrieb werden nach dem Commit im Scratch-Ergebnis belegt): Nutzerentscheidung 21.10.2026 ersetzt „keine Migration“): Der Ort ist eine optionale Freitextangabe der Buchung; Orts-Stammdaten verschwinden aus dem regulären UX-Pfad, bestehende Ortsdaten, Eventbezüge und die Locations-API bleiben unangetastet. Scope: (1) Additive Migration `0032_event_venue.sql` mit `events.venue` (bis 1.000 Zeichen, mehrzeilig, getrimmt) und `events.venue_override` (Default false); keine Tabelle, kein Service, keine Rückfüllung, keine Destruktion. (2) Wirksame Quelle: `venueOverride=true` zeigt ausschließlich den Freitext (leer = bewusst kein Ort, kein Rückfall), `false` die bisherige Bestandsanschrift mit unveränderter Formatierung. (3) `POST`/`PUT` akzeptieren beide Eigenschaften optional; alte Voll-PUTs ohne sie erhalten den Stand, nur ein tatsächlich geänderter `locationId` setzt `venueOverride=false` und behält den Freitext; ein Status-PUT und unabhängige Bearbeitungen erhalten den Stand; Duplizieren kopiert Rohtext, Flag und Bestandsbezug. (4) Eventliste, Event-Details, Suche (nur wirksame Quelle), Kalender, ICS, CSV und `{{location}}` nutzen dieselbe Auflösung; CSV behält Spaltennamen/-reihenfolge, `locationName` ist der wirksame Ort, `locationId` bei Freitext leer; finale Dokument-Snapshots bleiben unverändert. (5) Oberfläche: „Ort / Adresse“ statt Location-Select in Event-Editor und Anlegen-Dialog (Werte bleiben beim Zu-/Aufklappen erhalten, Bestandsort vollständig vorbelegt, Sent nur bei Bearbeitung), Details zeigen nur den wirksamen Ort, kein Locations-Menü und keine Locations-Einstellungen, `#locations` leitet ohne neuen History-Eintrag und ohne Query-Verlust auf Events um; kein verstecktes `POST /locations`. (6) Website-Intake übernimmt den freien Ort als `venue`/`venueOverride` und lässt nur die neue Doppelzeile der generierten Beschreibung weg; Original-Payload und alte Beschreibungen bleiben. Keine Änderung an Ressourcen-/Produkt-Einstellungen, Event-Ressourcenzuweisung, Auth, Mandanten, CSRF oder Buchungsinvarianten. Abnahme: fehlschlagende Integrationstests für Neu ohne Ort, Freitext/mehrzeilig/1.001 Zeichen, Bestand unverändert, Ersetzen und bewusstes Leeren ohne Wiederkehr in Detail/Suche/Kalender/CSV/ICS/Dokument, Duplikat/Status/fremde Bearbeitung, alter PUT mit/ohne `locationId`-Wechsel, explizite Null-/False-/True-Grenzen, Fremdmandant, Migration auf Altstand und wiederholte Migration; Komponententests für Feld, Leeren, Vorbelegung ohne stille Übernahme, Duplikat, Details und `#locations`; Komponenten-/E2E-Geometrie folgt im Review. Lokaler Abschluss (Node 24.15.0): 201 Unit-, 277 Komponenten- und 257 Integrationstests, Format, Lint, Typen, Workspace- und Dokumentationsprüfung, Build, Coverage 97,40 % Zeilen/93,84 % Zweige, Changed-Code und 6/6 Chromium-Abläufe inklusive Ortsablauf, Alt-Hash, Einstellungen, Kontakten, Theme, Favicon, optionalen Zeiten und DST grün. Die unabhängigen Reviews sind eingearbeitet (Migranzählung/Spalten, Laufzeit-Hash-Normalisierung, archivierter Bestandsort beim Duplizieren, explizites `null` im Request-Schema, späte Ortsdaten, vollständige Bestandsadresse, CSV-/ICS-/Dokument-/Suchabdeckung). Bekannt: macOS-`RLIMIT_FSIZE`-Backuptest lokal rot, Linux-CI maßgeblich; Changed-Code-Coverage, CI und Testbetrieb folgen nach dem Push im Scratch-Beleg. Kein Locations-Menü, keine Locations-Einstellungen, Locations-API/-Tabelle und Integrationstests bleiben.

- [x] H035 (P2, Dateien, released: Commits d1999e7, f1344c1 und 9984cbf, GitHub-Lauf 39738657651 quality und images success, Testbetrieb auf 9984cbf verified): Eigener Dateien-Navigationspunkt mit Liste und Filtern auf Basis der vorhandenen Ablage; noch kein neues Datei-Backend. Umgesetzt: `#files` in der Hauptnavigation (Desktop-Icon-Leiste und mobiler Dialog) mit `aria-current` und Titel „Dateien“; `FilesPanel` listet ausschließlich die bestehenden Geschäftsdokumente über `GET /api/v1/documents?include=metadata&limit=26&offset=…` mit Art-/Status-/Zeitraumfiltern, die serverseitig auf das gesamte Ergebnis wirken, Seitenumbruch über eine zusätzliche Zeile (`hasMore`, kein erfundenes Total), ehrlichem letzten Stand bei Fehlern mit reinem GET-Retry, Stale-Guard, `useAutoRefresh` bei Rückkehr und einem lokalen Filter-Namensraum `df_kind`/`df_state`/`df_from`/`df_to`/`df_page`, der die globale Suche und Eventfilter nicht überschreibt. Eine eigene H1 gibt es nicht (einzige Seitenüberschrift bleibt die Werkzeugleiste), Beträge nutzen einen exakten Cent-Formatter ohne Float-Rundung, der Event-Link entfernt nur den Event-Filter-Namensraum, ein regulärer Klick auf den neuen Dateien-Eintrag fragt bei registrierten ungespeicherten Eingaben nach (Abbrechen hält Hash/Entwurf/Fokus; Modifier-Klick ohne Dialog und ohne Änderung der aktuellen Ansicht), das Panel lädt nur bei aktiver Route, und ein nummernloses `withdrawn`-Dokument zeigt seinen echten Zustand. Zeilen zeigen Art und Nummer (kein erfundener Dateiname), Datum aus dem serverseitigen `issuedDate` (tenant-lokaler `issued_at`), Eventname mit nativem `#event-<id>`-Link nur bei gültiger ID, exakten Betrag in Cent und einen PDF-Link ausschließlich bei `pdfAvailable`. Additive API: optionale `from`/`to` (inklusive lokale Tage, halboffen bis zum nächsten lokalen Mitternacht, DST-fest), `limit` 1–100, `offset` und `include=metadata`; ohne diese Parameter bleibt der Abruf unverändert ungepaggt mit exakt alten Feldern. Keine neue Tabelle, Route, Migration, Ablage, kein Upload, kein Finalisieren, keine Nummernvergabe, keine Finanzwirkung. Abnahme: Navigation, leere/fehlerhafte Zustände, keine Rechteausweitung; Befund: eine vollständige Nutzer-Upload-Bibliothek, Standard- und Eventdateien sind weiterhin nicht vorhanden und bleiben eine eigene Scheibe.

- [ ] H036 (P3, visuelle Hierarchie, Phase 2 eingearbeitet: Quellstand und lokale Abnahme grün, unabhängige Prüfung eingearbeitet; Commit/Push/Deploy folgen): Jede Fläche hat genau eine visuell dominante primäre Aktion; sekundäre und tertiäre Aktionen sind ruhiger, bleiben aber erreichbar und gleich bedienbar. Scope: (1) `apps/admin/src/styles.css` erhält einen kleinen gemeinsamen Token-/Klassensatz statt einer akzentgefüllten Schaltfläche für alle Aktionen: `--action`/`--action-border` (gefüllte Primäraktion), `--quiet-ink`/`--quiet-action-border` (Sekundär/Tertiär) sowie die Klassen `.primary-action` (gefüllt, Gewicht 650), `.secondary-action` (transparent, Rand, Gewicht 600), `.tertiary-action` (transparent, randlos, Gewicht 500, Unterstreichung und Fläche erst bei Hover) und `.nav-action` (ruhige Bereichsnavigation) sowie die Icon-Modifikatoren `.tier-primary-icon` (einziges anlegenden Icon je Bereich, weiterhin 44-px-Icon) und `.tier-quiet-icon` (Filter-, Such-, Navigations- und Zeilenicons). (2) Angewendet auf alle vorhandenen Flächen ohne Layout-, Positions-, Wortlaut- oder Funktionsänderung: Anmeldung/Abmelden/Theme, Events (Liste, Filter, Editor), Anlegen-Dialog, Event-Details, Ressourcenzuweisung, zeitweise Sperren, Kalender, Kontakte (Werkzeugleiste, Zeilen, Dialog), Dateien, Website-Eingänge, Angebote, Nummernkreise bleiben unverändert bei einer Speichern-Aktion, Stammdaten, Ressourcen, Produkte, Kalender-Abos, Konto/Zugriff. H031s ruhige Icon-Aktionen (Event anlegen/bearbeiten/duplizieren, Kalendernavigation, Kontaktsuche) bleiben erhalten und werden nur in denselben Satz eingeordnet, nicht zurückgedreht. (3) Keine reine Farbcodierung: jede Stufe unterscheidet sich in Füllung, Rand und Schriftgewicht; der aktive Bereich der Detailnavigation trägt zusätzlich Gewicht und Rand; der gedrückte Theme-Umschalter zusätzlich 2-px-Rand; deaktivierte Aktionen erhalten Deckkraft **und** gestrichelten Rand mit `not-allowed`, Fehlerfarben bleiben serverunverändert. Sichtbarer `:focus-visible`-Rahmen (`3px solid var(--focus)`, Offset 3px) und 44-px-Mindestfläche gelten für alle Stufen inklusive der ruhigsten; Tastaturreihenfolge, Namen und `title` bleiben unverändert, nichts wird versteckt. Keine API-, Datenbank-, Migrations-, Auth- oder Textänderung; keine neue Abhängigkeit. Abnahme (fail-first, dann grün): neue `tests/component/action-hierarchy.test.tsx` mit 12 zuvor fehlschlagenden Tests — je Fläche genau eine primäre Aktion und für jede sichtbare Aktion eine benannte Stufe, Icon-Stufen und ruhige Zeilen-/Navigations-Aktionen, verschachtelte Event-Detailflächen (Übersicht, Angebote, Ressourcen) getrennt, Stylesheet-Vertrag (Tokenpaare, 44 px, Fokus, deaktiviert), WCAG-AA-Kontrast in Hell **und** Dunkel für Primär-, Hover-, Sekundär- und Tertiärtext sowie Hover-/Stapelzustände; dazu `tests/component/ui-language.test.tsx` mit einer Mount-Reihenfolge-Härtung (die Grundlinie der Abrufzähler wartet jetzt auf den abgeschlossenen Erstaufbau). Lokal (Node 24.15.0, seriell): 227 Unit-, 341 Komponenten- (achtmal hintereinander stabil), Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung grün; alle sechs Chromium-Abläufe grün. Zusätzlich im echten Chromium gegen das gebaute Bundle mit synthetischen Antworten gemessen: 246 sichtbare Aktionen auf sechs angemeldeten Flächen in beiden Themen bei 1280/390/320 px ohne Kontrast- (< 4,5:1) und ohne 44-px-Verstoß sowie ohne Body-Überlauf, dazu die Anmeldeseite; Fokusrahmen in beiden Themen 3 px/Offset 3 px. Grenzen: Coverage-Lauf, Linux-CI und Testbetrieb stehen noch aus; der macOS-`RLIMIT_FSIZE`-Backuptest bleibt unverändert lokal rot. Zwischenstand aufgelöst: die speziell angefragten H031-Icon-Aktionen waren bereits ruhig, die allgemeine sekundäre Hierarchie war offen und ist mit dieser Phase abgedeckt; Commit/Push folgen erst nach der unabhängigen Prüfung. Phase 2 nach der unabhängigen Prüfung (die Kontrast, Fokus, 44 px, Tastatur, Overflow und Wortlaut bestätigte und drei Lücken benannte), alles mit fehlschlagender Regression zuerst: (a) **Abdeckungslücke behoben**: `PasswordPanel.tsx` hatte gar keine Stufe - „Passwort ändern“ ist jetzt `.primary-action`; als ausdrücklich zu H036 gehörende gewöhnliche Flächen (keine Designsystem-Neufassung) sind zusätzlich `ImportPanel.tsx` (5 Aktionen: Vorschau/Probelauf/Dublettenentscheidung secundary, geprüfte Übernahme primary, Dublettenverwerfen zusätzlich in `ImportOverview.tsx` tertiary/secondary), `DocumentTemplatesPanel.tsx` (7: Vorlage speichern primary, Position hinzufügen/entfernen, Bearbeiten, Duplizieren, Archivieren secondary bzw. tertiary, Abbrechen tertiary), `DocumentNumbersPanel.tsx` (2 je Nummernkreis: Speichern primary nur im bearbeiteten Kreis, sonst secondary, Vorschau secondary) und `ImportPromiseReview.tsx` (3: Schließen/Aktualisieren tertiary, Ausschluss secondary; die bestätigte Übernahme bleibt über `ResourceAssignments importReview` primary) getaggt. (b) **Testvertrag geschlossen**: die Flächentests rendern weiterhin einzeln; neu kommt ein echter Hüllentest über alle 13 Routen (AuthPanel/Navigation mit `[hidden]`-Workspace-Seiten) hinzu, der pro gemounteter Route 0 oder 1 **sichtbare** primary und für jede sichtbare Aktion eine benannte Stufe prüft - `[hidden]{display:none!important}` wird dabei als Vertrag ausgewertet, nicht als Zählung verborgener Knoten. Beim Bau des Tests fiel auf, dass die Einstellungsseite drei „Speichern“ gleichzeitig zeigte: `MasterDataPanel` bekommt dafür ein optionales `primary` (Paketwerte und Absagegründe secondary), die Nummernkreise tragen die primary am gerade bearbeiteten Kreis, und die Zeilen-Icons `Event duplizieren`/`Event bearbeiten`, `Stammdaten bearbeiten` sowie die Such-Icons in `Navigation` tragen `tier-quiet-icon`. (c) **Rahmenregel entschärft**: Event-Details behält beide primaries in getrennten Frames („Status speichern“ und „Entwurf anlegen“); die Zusicherung lautet jetzt je Frame ≤ 1 statt starr genau 2 offene Frames. (d) ResourcePanel hält seine zwei gemounteten primaries (eigener Editor + geerbtes `MasterDataPanel`); der Test kodiert, dass nur einer sichtbar ist. Lokal (Node 24.15.0, seriell): fail-first belegt (neue Flächentests rot auf dem unveränderten Quellstand, Hüllentest rot mit drei sichtbaren primaries auf `#settings`), danach 227 Unit-, 346 Komponententests (davon 17 in `action-hierarchy`), Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung sowie alle sechs Chromium-Abläufe grün; Coverage 97,13 % Zeilen / 93,94 % Zweige, Changed-Code 8/9 Zeilen und 12/12 Zweige (die einzige ungetroffene Zeile ist der bereits vorher ungetroffene zweite Retry-Knopf auf der Kontaktseite, nicht H036-Code). Vorbestehend und ausdrücklich **nicht** Teil von H036, als eigene Scheibe zu führen: die in `[hidden]`-Workspace-Seiten weiterhin fokussierbaren Bedienelemente (Mount-Zustand) und der doppelte „Bearbeiten“-Knopf in Ressourcen. Grenzen: Linux-CI und Testbetrieb folgen nach dem Push im Scratch-Beleg; der macOS-`RLIMIT_FSIZE`-Backuptest bleibt lokal rot, Linux-CI ist maßgeblich; der `worker-main`-Unit-Test ist vorbestehend sporadisch (auf `c52e4ca` reproduziert, Child-Prozess-Timing).

- [x] H037 (P3, Termine, umgesetzt: Quellstand und lokale Abnahme grün; Push/CI/Testbetrieb im Scratch-Beleg): Einfachere Kalenderübersicht und wahrheitsgetreue Datum-anzeige in Liste und Kalender. Scope: (1) Ohne ausdrückliche URL-Wahl startet der Kalender im Monat; Tag/Woche/Monat bleiben verfügbar, Ansicht und Datum überstehen den Bereichswechsel, weil die Ansicht eingehängt bleibt. Keine neue Präferenzablage. (2) Eine ruhige Navigationszeile mit Vorheriger Zeitraum/Heute/Nächster Zeitraum als benannten 44-px-Icon-Aktionen, sichtbarer Zeitraumüberschrift samt Spanne und den vorhandenen Feldern für Ansicht und Datum; kein manueller Aktualisieren-Knopf, H030 unverändert. (3) Die Ressourcenbelegung ist ein natives, unkontrolliertes `<details>`; der Inhalt bleibt eingehängt und wird vom Browser im zugeklappten Zustand verborgen. Auf-/Zuklappen über Maus, Tastatur und programmatisches `open` zeigt denselben Inhalt, der Fokus bleibt auf dem Summary, es gibt keinen zusätzlichen Abruf. Kalender-Ladefehler, ungeprüfte Bestandszusagen („Bestand ungeprüft", kein „Frei") und die Legende bleiben außerhalb des Bereichs sichtbar. (4) Datumsgenaue Events zeigen „Tagesbuchung, ohne Uhrzeit" ohne synthetisches „00:00"; die Entscheidung stützt sich ausschließlich auf die vorhandenen nullbaren `startsAt`/`endsAt`, ohne neues API-Feld. Ein echtes Mitternachts-Event behält seine reale Uhrzeit, mehrtägige Buchungen zeigen ihren ursprünglichen Zeitraum in jeder belegten Tageszelle (nicht auf den sichtbaren Tag umdatiert), und die Eventliste nutzt dieselbe Regel (`listScheduleText`); die Event-Details nennen fehlende Uhrzeiten ausdrücklich. Undatierte Events bleiben „Ohne Datum". (5) Nach einem fehlgeschlagenen Ansichts-/Datumswechsel bleibt der letzte Stand in seinem eigenen Raster: Spalten, Wochentagsköpfe und Monats-Padding richten sich nach `data.view`, während Select/Datum und Fehlerhinweis den angeforderten Zustand ehrlich zeigen; „Kalender erneut laden" stellt ihn her. (6) Die Monatsübersicht passt in den Container (sieben Spalten, Wochentagskopf, kompakte Zellen, gekürzte Eventchips mit vollem Namen/Status im Titel und 44-px-Linkziel), sodass bei 1280 px mit ausgeklappter und eingeklappter Seitenleiste sowie bei 320/390 px weder das Raster noch der Body horizontal scrollt; Woche und Tag behalten ihre innere Belegungsscrollung. Keine API-, Schema-, Migrations-, Buchungs- oder Geldänderung, kein neues Kalender-Framework, kein Drag-and-drop. Abnahme: 209 Unit- und 290 Komponententests (unter anderem Monatsdefault gegen URL-Wahl, erhaltener Zustand, Navigationszeile und 44-px-Ziele, Datum-only gegen echtes Mitternachts-Event im Kalender und in der Liste, Mehrtagestermin ohne Umdatierung, zugeklappte Belegung mit echtem Klick, Tastatur/Summary-Fokus und programmatischem `open` ohne Abruf, Warnungen und Legende außerhalb der Belegung samt „kein Frei" nach dem Aufklappen, Fehlerfall mit Raster der geladenen Ansicht); Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung und Coverage (97,40 % Zeilen, 93,82 % Zweige; 756 Tests, `calendar-range.ts` 100 % Zeilen) grün; alle sechs Chromium-Abläufe grün, darunter echte Summary-Interaktion per Klick und Enter samt Fokuserhalt, Monatsraster ohne innere/Body-Scrollung bei 1280/390/320 und 44-px-Navigation. Commit, Linux-CI und Testbetrieb werden nach dem Push im Scratch-Beleg geführt. Offen bleiben H032 (Website-Option) und H035 (Dateien). Grenze: Der macOS-`RLIMIT_FSIZE`-Backuptest bleibt lokal rot, Linux-CI ist maßgeblich.
- [x] H038 (P1, UI-Sprache und Seitenhierarchie, umgesetzt): Eigene Oberfläche spricht nicht mehr von „Eventakte“, doppelte Seitentitel und der Marken-Hero entfallen, und die App erhält ein eigenes Kompass-Favicon. Scope: (1) Sichtbare Labels, Überschriften, Tooltips, zugängliche Namen, Status- und Fehlertexte verwenden „Event“ beziehungsweise „Event-Details“; interne Komponenten-, CSS-, URL-, API- und Datenbankbezeichnungen bleiben unverändert. Historische Bookitup-Recherche und datierte Übergabenotizen dürfen den alten Begriff als Beleg behalten. (2) Der App-Ebenen-Hero „AuftragsKompass / Anfragen, Kontakte und Stammdaten verwalten.“ entfällt; die Seitenleiste trägt die Marke. Die Anmeldung erhält genau einen H1 „Anmelden bei AuftragsKompass“. Der Bereichstitel der Werkzeugleiste wird der einzige sichtbare Seiten-H1; Bereichsflächen wiederholen ihn nicht als sichtbares H2. Auf der Suchroute bleiben „Events“ und „Kontakte“ als eigene sichtbare Abschnitts-H2 erhalten. Eigenständige Unterabschnitte wie der Kalender behalten ihre genaueren H2. Zugängliche Bereichsnamen bleiben bestehen; keine Routen-, Daten- oder Entwurfs-Remount-Änderung. (3) Ein originales, geometrisches Kompass-SVG-Favicon (eigene Marke, kein Bookitup-Asset) liegt unter dem stabilen Vite-Pfad `/favicon.svg` samt 32px-PNG-Fallback und korrekt deklarierten `link`-Elementen; Dokumenttitel bleibt „AuftragsKompass“. Keine neue Abhängigkeit, keine CSP-Ausweitung. Abnahme: fehlschlagende Komponentenregressionen für Event-Sprache, eindeutigen Seiten-H1, Anmelde-H1, Suchabschnitte, Ressourcen-Überschriftenfolge sowie genau einen Theme-Umschalter vor und nach der Anmeldung; bestehende Detail-Öffnen/Speichern/Fehler/Schließen-Abläufe bleiben unverändert; Favicon-Link und ausgeliefertes Asset mit korrektem MIME, identischer SVG-/PNG-Geometrie und 16/32-Renderkontrast in Chromium. Review-Befunde sind eingearbeitet: ThemeToggle sitzt wieder in Anmeldekarte und Werkzeugleiste, ResourceBlocks verwendet h2, Importbericht h3, und die Monatsüberschriften-Dokumentation ist korrigiert. Lokal: 190 Unit- und 247 Komponententests, fünf Chromium-Abläufe, Format, Lint, Typen, Build und Dokumentationsprüfung grün. CI und Testbetrieb werden nach dem Push im Scratch-Ergebnis belegt.

- [x] H039 (P2, Kontakte-UX, released: Suche/Liste zuerst, Plus-Dialog; Commit 065b6faece92eb3fea48da235a2d8d59e1f848fb, GitHub-Lauf 39514678870 und Testbetrieb verifiziert): Die Kontaktseite zeigt zuerst die Suche und unmittelbar darunter die Liste; das Anlegeformular liegt hinter einer zugänglich benannten Plus-Aktion und öffnet das bestehende Formular in einem Dialog. Scope: (1) Die sichtbare Reihenfolge ist Suchwerkzeugleiste (Suchfeld, Icon-Suche, CSV-Export, Plus) und darunter die Kontaktliste; das Anlegeformular ist initial nicht gerendert und damit nicht tabbar. (2) Die Plus-Aktion ist eine 44-px-Icon-Schaltfläche ohne sichtbaren Text mit `aria-label`/`title` „Kontakt anlegen“; der Dialog trägt `role=dialog`, `aria-modal`, `aria-labelledby` und den eigenen Titel „Kontakt anlegen“ beziehungsweise „Kontakt bearbeiten“ (kein doppelter Seitentitel, kein Hero). (3) Der Dialog folgt dem vorhandenen Muster aus H029 ohne neue Abhängigkeit: Fokus im ersten Bedienelement (Kontaktart), Tab-Falle, Schließen über X mit Namen „Dialog schließen“, Escape und „Kontakt abbrechen“ mit Fokusrückkehr auf den auslösenden Knopf beziehungsweise die Zeile und Rückfall auf die Plus-Aktion. (4) Alle Formularwerte sind kontrolliert; beim Wechsel zwischen Neuanlage, verschiedenen bestehenden Kontakten und erneutem Öffnen werden keine alten Werte weiterverwendet. Neuanlage startet mit `kind=private`, `state=active` und `country=DE`; Bearbeiten übernimmt die gespeicherten Werte samt `version`, bestehende Kontaktarten, Privat-/Firmenfelder, Pflichtfelder (Name, Ländercode), Längenbegrenzungen, Trimmen, CSRF, Dublettenprüfung mit `excludeId` und der CSV-Export bleiben unverändert. (5) Ein geänderter Entwurf ist über den vorhandenen kleinen Dirty-Hook registriert und verlangt beim Schließen eine ausdrückliche Verwerfen-Bestätigung; ein unverändert geöffneter Dialog gilt nicht als schmutzig. Ehrliche Grenze: Der Hook wird nur von Heim- und Suchwechsel ausgewertet; andere Navigationslinks und Browser-Zurück bleiben wie bei den Events ungeschützt. (6) Während eines laufenden POST sperren Schließen, Escape und Abbrechen; ein synchroner Ref-Guard verhindert doppelte Mutationen auch bei doppeltem Submit. Ein Fehlschlag behält Dialog, Eingaben und Fehlermeldung für den erneuten Versuch. Ein bestätigtes Speichern schließt und leert den Entwurf, lädt die Liste neu und unterscheidet einen anschließenden GET-Fehler ehrlich („gespeichert, die Liste konnte nicht neu geladen werden“) mit reiner GET-Wiederholung ohne zweite Mutation. (7) Suchtext, Filterergebnis und Listeninhalt bleiben beim Öffnen/Schließen erhalten; `#contact-<id>` bleibt als Route erreichbar, die Liste vergibt passende Zeilenanker und scrollt den Treffer. Die Zeilenaktionen „Events anzeigen“ und „Kontakt bearbeiten“ sind ebenfalls ruhige 44-px-Icon-Aktionen ohne sichtbaren Text mit unveränderten zugänglichen Namen und lokalem `title`; E-Mail-, Telefon- und CSV-Links bleiben Text. Keine neue API, keine Datenbank-/Migrationsänderung, kein Auto-Refresh und kein Hintergrund-Confirm. (8) Review-Befunde der unabhängigen Phase-1-Prüfung sind eingearbeitet: Ein erfolgreicher Listenabruf löscht den Neuladehinweis samt Wiederholungsknopf, auch bei einem Such-/Filterneuladen, und ein verspäteter älterer Abruf kann einen neueren Fehler nicht mehr löschen (`sequence`-Guard). Während eines laufenden POST/PUT bleibt der Fokus im als `aria-busy` markierten Dialog: Der Dialogwurzel ist programmatisch fokussierbar, Tab und Shift+Tab bleiben auch dann im Dialog, wenn alle Bedienelemente inklusive des deaktivierten Fieldsets gesperrt sind, Escape/Schließen brechen nichts ab, und nach einem Fehlschlag wird der Fehlertext (`role=alert`, fokussierbar) fokussiert, während Eingaben erhalten bleiben. Eine erfolgreiche Dublettenprüfung meldet „Keine möglichen Dubletten gefunden.“ als ruhigen `role=status` ohne Fehlerfarbe, wird bei Eingabeänderung verworfen, und echte Fehler bleiben `role=alert` mit Feldfehlerfarbe. Abnahme (Phase 2): 21 Komponententests der Kontaktoberfläche (neu beziehungsweise angepasst unter anderem: initiale Reihenfolge ohne Formular, Plus-Name/-Titel, Dialog-Fokus/Tab-Falle/Escape/Fokusrückkehr, Fokusbindung bei laufendem POST inklusive Tab/Shift+Tab ohne aktive Bedienelemente und Fehlerfokus, Privat-/Firmen-Payload und DE-Default, Version und kein Wertabfluss beim Zielwechsel, erhaltener Such-/Listenzustand, Dirty-Bestätigung mit erneutem Bearbeiten ohne Altwerte, Fokus-Rückfall auf Plus nach verschwundener Zeile, ehrlicher Speicher-/Neuladefehler mit GET-only-Retry und verschwindendem Hinweis nach Erfolg, Stale-GET-Schutz, Dubletten-Erfolgs-/Fehlersemantik, Deep-Link ohne Treffer/bei Filterung, keine Platzhalter-/Fokuslöschung, CSV-Export); die bestehenden Fehler-, Dubletten-, Eventverknüpfungs- und Suchrennen-Tests bleiben erhalten. Lokal grün: 190 Unit- und 263 Komponententests, Format, Lint, Typen, Build und Dokumentationsprüfung, Coverage 97,39 % Zeilen und 93,79 % Zweige sowie Changed-Code 164/170 Zeilen und 97/109 Zweige. Die vollständige Chromium-Suite ist mit sechs Abläufen grün, darunter beide Anmeldearten mit Kontakt anlegen/bearbeiten/suchen, Dirty-Abbruch, tatsächlichem Mutationsfehler und anschließendem Neuladefehler samt GET-Retry sowie Dialog-/Toolbar-/Bereichsgeometrie bei 1280/390/320 ohne horizontalen Überlauf, 44-px-Plus- und Zeilenaktionen, initialem Fokus, Escape-Fokusrückkehr und Tab im Dialog. Release: Commit 065b6faece92eb3fea48da235a2d8d59e1f848fb am 21.10.2026 gepusht, Remote-Readback identisch; GitHub-Quality-Lauf 39514678870 mit quality und images success; Auto-Updater auf pve1/CT114 mit last-success 065b6fa, ak-test-api/-worker/-admin healthy auf derselben Revision; öffentliche URL HTTP 200 mit den Kontakt-Markern im ausgelieferten Bundle. Nutzerentscheidung vom 20.10.2026, bewusst außerhalb von H038. Offen bleiben H032 (Website-Option) und H033 (Ressourcen/Produkte unter Einstellungen, eigener Commit).
- [x] H040 (P2, Zeitweise Ressourcensperren): Die zeitweisen Sperren fragen wie Termin und Disposition nur noch lokale Datum-/Uhrzeitwerte ab; die manuellen UTC-Versatzfelder `startOffset`/`endOffset` entfallen. Scope: (1) `ResourceBlocks.tsx` nutzt unverändert `EventTimeField`/`event-time.ts` (`resolveEventTime`, `savedAmbiguousChoice` über die Feldkomponente) in der Mandantenzeitzone; keine zweite Zeitzonenrechnung, keine Server-, API-, Datenbank- oder Migrationsänderung, keine neuen Endpunkte, unveränderte Reason-/State-/Historien-Semantik, Einheitenbezüge, Auth/Tenant/CSRF und Konfliktprüfung. Ein neues Sperrformular startet leer; gespeicherte Zeitfenster gelangen ausschließlich über die ausdrückliche Aktion „Zeiten übernehmen: <Grund>“ je Listeneintrag in den Entwurf, die bei ungespeichertem Entwurf vorher nachfragt. Dadurch kann ein Speichern mit nur Einheit und Grund kein vorhandenes Fenster still duplizieren und keine vergangene Sperre den Serverfehler `invalid_period` auslösen. (2) Nur doppelte Herbst-Uhrzeiten zeigen je Feld eine Auswahl „Sommerzeit (UTC+..)/Normalzeit (UTC+..)“ mit vorausgewähltem gespeichertem Versatz; Frühjahrslücken erzeugen einen Feldfehler mit `aria-invalid`/`aria-describedby`, Fokus auf das Feld und keine Anfrage. Eine unveränderte Zeit behält ihren exakten Zeitpunkt einschließlich Sekunden/Millisekunden; nach jeder Änderung von Datum oder Uhrzeit wird kein früherer Versatz weiterverwendet (Senderichtung Sommer→Winter und Winter→Sommer). (3) `idPrefix` `block-start`/`block-end` verhindert ID-Kollisionen mit `EventPanel`/`EventCreateDialog` (`event-*`) und `ResourceAssignments` (`assignment-*`), wenn mehrere Formulare gleichzeitig eingehängt sind. Ein fehlendes bzw. umgekehrtes Sperrende wird am Feld erklärt und fokussiert; ein korrigiertes Feld löscht seine Meldung ohne erneute Anfrage. (4) Bestätigtes Speichern und anschließender Ladefehler bleiben getrennt (genau ein POST, Hinweis „gesperrt, aber nicht neu geladen“ mit reinem GET-Retry); ein Hintergrund-/Listenabruf überschreibt keinen ungespeicherten Entwurf. Abnahme: zuerst fehlschlagende Komponentenregressionen (Versatzfelder fort, Frühjahrslücke Beginn und Ende mit Fokus ohne Mutation, neue doppelte Stunde mit Pflichtwahl, unveränderte doppelte Sperre mit Sekunden und bewusstem Versatzwechsel, Datumswechsel Sommer↔Winter, eindeutige Fehler-IDs bei gleichzeitig eingehängtem `EventPanel` und `ResourceAssignments`, fehlendes/umgekehrtes Ende, Speichern-vs-Neuladen, Entwurfserhalt bei Listenaktualisierung), ein Unit-Test auf die gemeinsamen Helfer und eine E2E-Prüfung ohne Versatzfelder. Lokal (Node 24.15.0): 227 Unit-, 329 Komponenten- und 274 Integrations- (Reservierungen/Sperren) Tests, Format, Lint, Typen, Workspace- und Dokumentationsprüfung sowie Build grün. Ein Nachtrag nach der unabhängigen Phase-1-Prüfung behebt zwei Befunde ohne Architekturänderung: (a) Das Neuformular war aus `data.blocks[0]` unabhängig von dessen Zustand vorbelegt und duplizierte beim Speichern mit nur Einheit und Grund still das vorhandene Fenster beziehungsweise scheiterte bei ausschließlich vergangenen Sperren an `invalid_period`; es startet jetzt leer, und die Vorbelegung ist eine ausdrückliche, rückfragende Aktion je Eintrag. (b) `attached()`/`formRef` waren an kein Formular gebunden und damit wirkungslos; der tote Code samt `wallClock`/`localDateTime`-Import ist entfernt, der Byte-Erhalt kommt sichtbar aus `EventTimeField` (`instant` + `savedAmbiguousChoice`). Neue Regressionen: leeres Neuformular bei vergangener und gesperrter Sperre, ausdrückliche Übernahme samt Bestätigungspflicht, kein stilles Duplikat, Normalzeit-Wechsel im Endfeld der doppelten Stunde. Lokal weiter grün: alle sechs Chromium-Abläufe, Coverage 97,13 % Zeilen und 93,86 % Zweige (`ResourceBlocks.tsx` 99,14 % Zeilen / 96,84 % Zweige, `EventTimeField.tsx` 100 % Zeilen / 89,65 % Zweige), Changed-Code 63/64 Zeilen und 54/57 Zweige. Linux-CI und Testbetrieb folgen in Phase 2.
- [ ] H041 (P2, Eventliste-Filter nach bookitup; Quellstand und lokale Abnahme grün, unabhängige Prüfung eingearbeitet; Commit/Push/Deploy stehen aus): Die Eventliste filtert mit Schnellzeiträumen, Zählern und einer Sortierzeile wie die bookitup-Referenz (Abschnitt 3 und 9), ohne API-, Datenbank- oder Schemaänderung. Scope: (1) Die beiden nackten Datumsfelder „Filter von“/„Filter bis“ liegen in einem zugeklappten „Eigener Zeitraum“; darüber stehen die Schnellknöpfe „Dieser Monat“, „Nächster Monat“ und „Nächste Events“, die `q`/`from`/`to` atomar in genau einem History-Eintrag setzen. Die Zeiträume sind tenant-lokale Kalendertage (Temporal-Polyfill mit der geladenen Mandantenzeitzone, nicht Browserzone/-sprache): „Dieser Monat“ erster bis letzter Tag, „Nächster Monat“ dasselbe im Folgemonat (Schaltjahr über `with({day:31})` geklemmt), „Nächste Events“ nur untere Grenze. Ein Knopf ist ausgewählt, wenn die URL exakt seinen Bereich trägt (`aria-pressed`, 2-px-Rand, Gewicht 700 und Unterstreichung, nicht nur Farbe). Ohne geladene Mandantenzeitzone ist ein Preset wirkungslos (kein History-Eintrag, keine Markierung). „Events filtern“ für eigene Bereiche und „Eventfilter zurücksetzen“ bleiben unverändert. (2) Zähler für „Ohne Datum“ (in der Sortierzeile) und „Anfragen“ kommen ausschließlich aus der bereits geladenen Liste (kein zusätzlicher Abruf), wenden `q`/`status`/`eventTypeId` an, blenden aber Sortierung und Datumsgrenzen aus, damit eine Option sich nicht selbst zählt, und folgen jedem Filterwechsel. „Anfragen“ zählt `status === 'inquiry'` (eine eigene Statusart „Neue Anfrage“ existiert nicht; Statusliste: inquiry/option/booked/unavailable/cancelled). (3) Über den Zeiträumen steht die Radiogruppe „Sortieren“ mit ausschließlich „Chronologisch“ (Standard) und „Ohne Datum“. „Ohne Datum“ setzt `undated=true` und löscht `from`/`to` – dieselbe URL-Semantik wie die alte Checkbox, damit Lesezeichen und bestehende Tests weiter gelten. Die Checkbox „Nur Events ohne Datum“ und ihr Erklärsatz entfallen; die Undatiert-Ansicht filtert die geladene Liste zusätzlich clientseitig, damit sie ohne erneuten Abruf stimmt. (4) Jede Monatsüberschrift trägt grau „· N Event(s)“ aus der Zahl der Gruppe; die Gruppe „Ohne Datum“ bleibt am Ende. Grenzen: kein neuer API-Parameter (`from`/`to` existieren), keine neue Abhängigkeit, keine Änderung an Anlegen, Kalender, Kontakten, Dateien, Einstellungen, Website-Optionen, Icon-Hierarchie, Suche, Favicon, Theme, Entwurf/Auto-Aktualisierung (H025/H030) oder den H036-Stufen; die Filteraktionen behalten `.secondary-action`/`.tertiary-action`. Nach der unabhängigen Prüfung (keine funktionalen Defekte an Presets, Zählern, Sortierung und Monatszähler) alles fehlschlagend zuerst repariert: (a) **Design/Semantik** – „Anfragen“ war ein drittes Radio in „Sortieren“, obwohl es nur `status` setzt und `from`/`to` stehen lässt und damit Screenreader als Sortierwahl täuscht. Es ist jetzt eine eigene Schnellfilter-Zeile (`role="group"`, `aria-label="Schnellfilter"`) mit erhaltenem Zähler und `aria-pressed`; ein Klick schreibt ausschließlich `status=inquiry` und behält `from`/`to`/`q`/`eventTypeId`, ein zweiter Klick hebt den Status wieder auf. Die Radiogruppe enthält nur noch „Chronologisch“ und „Ohne Datum“. (b) **Belege** – `scripts/changed-coverage.mjs` verglich `<rev>..HEAD` und übersah damit die Arbeitskopie samt untracked `event-filters.ts`; es kennt jetzt `COVERAGE_DIFF=worktree` (Intent-to-add nur für `apps`/`packages`, danach zurückgenommen) mit eigenem Workspace-Test. Abnahme, fehlschlagend zuerst: neue Unit-Datei `tests/unit/event-filters.test.ts` (tenant-lokaler Tag gegen Browser-/UTC-Tag, Monats-/Folgemonats-/Schaltjahresgrenzen, Auswahl nur bei exaktem Bereich, Zähler aus der Liste ohne Eigenzählung, Sortier- und Monatsgruppen-Helfer) sowie zehn neue bzw. verschärfte Komponentenregressionen in `tests/component/events.test.tsx` (fester Clock: ein History-Eintrag und Abruf mit exaktem Bereich, „Nächster Monat“ tenant-lokal mit erhaltenen Filtern, Auswahl ohne reine Farbcodierung, zugeklappter eigener Zeitraum mit weiter funktionierenden Datumsfeldern, Sortierwechsel setzt `undated=true` und löscht Grenzen, Zähler ohne Zusatzabruf und mit Filterfolge, Schnellfilter „Anfragen“ = `status=inquiry` bei erhaltenem `from`/`to`/`q`/`eventTypeId` und Sortiergruppe mit genau zwei Radios, Umschalten auf leerer URL, wirkungsloses Preset ohne Zeitzone, Monatsüberschrift mit Einzahl/Mehrzahl). Angepasst ohne Abschwächung: der bestehende Filterablauf nutzt die Sortierzeile, die Suchüberschriften erwarten den Zähl-Suffix, der Chromium-Ablauf öffnet den eigenen Zeitraum und prüft Presets (ein History-Eintrag, `aria-pressed`), den Schnellfilter außerhalb der Sortiergruppe mit erhaltener Spanne, Zurück, die Undatiert-Sortierung, den Monatszähler sowie 1280/390/320 ohne Body-Überlauf und 44-px-Ziele. Lokal (Node 24.15.0 über `pnpm --use-node-version`, seriell): 232 Unit-, 357 Komponenten- und 274 Integrationstests, Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung grün; alle sechs Chromium-Abläufe grün; Coverage `event-filters.ts` 39/39 Zeilen und 39/39 Zweige, `EventPanel.tsx` 94,35 % Zeilen und 88 % Zweige (Gesamtlauf 96,58 %/94,13 %); Changed-Code über `scripts/changed-coverage.mjs` mit `BASE_REVISION=2772847` **66/66 Zeilen und 97/97 Zweige** – derselbe Befehl wie in CI (dort der vorherige Commit), und im Worktree-Modus dieselbe Zahl. Grenzen: macOS-`RLIMIT_FSIZE`-Backuptest unverändert lokal rot, Linux-CI maßgeblich; der `worker-main`-Unit-Test war sporadisch rot (vorbestehendes Child-Prozess-Timing, Wiederholung grün). Kein Merge nach `main`.

Die Entwicklung beginnt mit einem bewusst kleinen internen MVP. Dieser kann Kontakte und Events verwalten, FB1/FB2 konfliktfrei reservieren, die Belegung im Kalender zeigen und einen ICS-Feed bereitstellen. Erst danach kommen öffentliche Anfragen, E-Mail, Geschäftsdokumente, Verträge, Fragebögen und weitere Komfortfunktionen hinzu.

Es gibt keine lange Integrationsphase am Ende: Jeder Commit liefert einen vertikalen, testbaren Fortschritt. Datenbank, API und Oberfläche werden für ein Feature möglichst gemeinsam erweitert.

C001 wird mit dieser Planprüfung nachgebessert; es wird noch kein Implementierungsschritt vorgezogen. Prüfungen: `python3 -B scripts/check_docs.py` und `python3 -B -m unittest discover -s tests/docs -v`. Die Zuordnung aller Anforderungen steht in [docs/requirements.md](docs/requirements.md), die fachlichen Präzisierungen in [docs/decisions.md](docs/decisions.md).

- [x] C001: Planungsunterlagen und überprüfbare Anforderungszuordnung
- [x] C002: privater TypeScript-Workspace mit Build und Typecheck
- [x] C003: Format-, Lint- und Commitprüfungen mit Negativtests
- [x] C004: Vitest, React-Komponenten, PostgreSQL-Testcontainer und Chromium-E2E
- [x] C005: Compose-Clean-start, persistente Daten, Backup/Restore geprüft
- [x] C006: Qualitätsworkflow und Changed-Code-Coverage (CI-Abnahme am gepushten Commit)
- [x] C007: validierte Konfiguration, minimale Logs und Liveness/Readiness
- [x] C008: transaktionale Migrationen, Mandanten und isolierte Benutzer-Repositories
- [x] C009: Google-OIDC, PKCE, sichere Sitzungen, CSRF und Logout
- [x] C010: einmaliger Bootstrap, Kontofreigaben, Sitzungswiderruf, Aussperrschutz und Änderungsnachweis
- [x] C011: unveränderbares Auditlog, atomare Sitzungsereignisse und mandantenbegrenzter Lesezugriff
- [x] C012: Eventarten und Paketwerte mit Archivierung/Versionsschutz; fünf bestätigte Startwerte und feste Status
- [x] C013: konfigurierbare Absagegründe mit acht Startwerten und Erhalt historischer Zuordnungen
- [x] C014: Ressourcenstamm mit getrennten Boxen/Zubehör, Bestand, Puffern, Sperre und Archivierung
- [x] C015: Produktkatalog mit exakten Centwerten, Steuerbasis, Duplizieren und Archivierung
- [x] C016: Privat-/Firmenkontakte, Suche, Dublettenvorschläge, Archiv und CSV-Export; Event-/E-Mail-Verknüpfungen folgen mit den Fachmodellen
- [x] C017: wiederverwendbare Locations mit Anschrift, Suche, Archiv und Versionsschutz
- [x] C018: Eventanlage/-bearbeitung mit Terminen, sicheren Notizen, Kontakt-/Stammdatenbezügen und Versionsschutz; Buchung folgt mit C023
- [x] C019: chronologische Eventliste, kombinierbare Suche/Filter, URL-Zustand und gemeinsame Kontaktsuche
- [x] C020: gebündelte Eventakte mit direkter Statusänderung und unveränderbarem fachlichem Logbuch
- [x] C021: physische Einheiten, getrennte Reservierungszeiträume, Kalenderpuffer, idempotente Vormerkungen und Ablaufbereinigung; feste Buchungen bleiben gesperrt
- [x] C022: PostgreSQL-Konfliktschutz für feste Buchungen und Sperren einschließlich Parallelität und Rollback
- [x] C023: Verfügbarkeit und atomare Box-/Zubehörzuweisung in der Eventakte, manuelle Buchung, geprüfte Termin-/Boxwechsel und Logbuch
- [x] C024: zeitweise Sperren ohne Kundenauftrag, genaue Zeiträume und Gründe, idempotente Anlage und Freigabe mit Historie
- [x] C025: interner Tages-/Wochen-/Monatskalender mit physischer Ressourcen-Zeitleiste, Puffern, Sperren und textlich/farblich sichtbaren Vormerkungskonflikten
- [x] C076 (vorgezogen): [manueller Ressourcenabgleich](docs/import-resource-review.md), atomare Übernahme, Wiederholschutz und Ausschluss inzwischen vergangener Zusagen; synthetisch geprüft, echte Ressourcenabnahme offen
- [x] C026: Gesamt- und Ressourcen-ICS mit widerrufbaren, ablaufenden Bearer-Links, datensparsamer Ausgabe und Einstellungen; synthetische HTTPS-/Chromium-Abnahme grün. [Kalender-Abo und noch offener Smartphone-Probelauf](docs/calendar-feeds.md).
- [ ] C027–C075 und C077–C085: noch nicht implementiert oder abgenommen

## 2. Qualitätsregeln

- Jeder Funktionscommit enthält passende Tests.
- Kein Commit darf die vorhandene Suite rot hinterlassen.
- Kritische Buchungs- und Finanzregeln werden zusätzlich mit Parallelitäts- und Negativtests geprüft.
- Milestone-Commits enthalten keine neuen Features, sondern nur Versionierung, Dokumentation und vollständig grüne Abnahmetests.
- Die genauen Coverage-Grenzen und Git-Regeln stehen in `AGENTS.md`.

## 3. Milestones

| Milestone                           | Ergebnis                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| M0 – Walking Skeleton               | Projekt startet lokal reproduzierbar und besitzt CI, Datenbank und Testgrundlage                     |
| M1 – Minimaler interner MVP         | Kontakte, Events, Ressourcen, konfliktfreie Buchung, Kalender und ICS sind produktiv nutzbar         |
| M2 – Öffentliche Anfragen           | WordPress zeigt anonymisierte Verfügbarkeit und erzeugt lokale Anfragen/Vormerkungen                 |
| M3 – Kommunikation                  | Postfach, Zuordnung, Vorlagen, Entwürfe und geplante E-Mails funktionieren                           |
| M4 – Angebote und Rechnungen        | Produkte, Vorlagen, PDFs, Nummernkreise, Angebote, Rechnungen und Zahlungen funktionieren            |
| M5 – Verträge und Fragebögen        | Kunden können sichere Formulare ausfüllen und Verträge unterschreiben                                |
| M6 – Aufgaben und Erkenntnisse      | Relative To-dos, Absagegründe und einfache Auswertungen sind verfügbar                               |
| M7 – Migration und Produktionsreife | Relevante Bestandsdaten sind übernommen; Backup, Sicherheit, Leistung und Barrierearmut sind geprüft |

## 4. Commitfolge

### M0 – Walking Skeleton

| ID   | Commit                                                 | Inhalt                                                                                                                                                                                               | Tests/Abnahme                                                                                                       |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| C001 | `docs: define product scope and delivery rules`        | Lastenheft, Konkurrenzinventar, AGENTS-Regeln, Commitplan und sichere Git-Allowlist                                                                                                                  | Links/Markdown prüfen; ausschließlich freigegebene Dateien sind trackbar                                            |
| C002 | `chore: initialize typescript workspace`               | pnpm-Workspace, gemeinsame TypeScript-Konfiguration, Verzeichnisstruktur für Admin, API, Worker, Gateway, Widget und Pakete                                                                          | Typecheck eines Minimalmoduls; Workspace-Install reproduzierbar                                                     |
| C003 | `chore: add formatting linting and commit checks`      | Prettier, ESLint, Commit-Konvention und lokale Prüfskripte                                                                                                                                           | Absichtlich fehlerhafte Fixture wird von jedem Gate erkannt                                                         |
| C004 | `test: establish unit integration and e2e harnesses`   | Vitest, disposable PostgreSQL-Testdatenbank, React-Komponententests und Playwright-Grundlage                                                                                                         | Je ein grüner Beispieltest pro Ebene                                                                                |
| C005 | `chore: add local docker compose environment`          | PostgreSQL, API, Worker und Admin; persistente Volumes, Healthchecks sowie automatisierbare tägliche Backup-/Restore-Skripte, Loopback-Bindung der Administration und dokumentierte TLS-Terminierung | Clean-start-Test; Container werden healthy; gesicherte Testdaten lassen sich in eine frische Umgebung zurückspielen |
| C006 | `ci: run quality gates on every push`                  | GitHub Actions für Format, Lint, Typen, Tests, Build und Coverage-Artefakte                                                                                                                          | CI läuft auf Repository-Branch vollständig grün                                                                     |
| C007 | `feat: add runtime configuration and health endpoints` | Validierte Umgebungsvariablen, strukturierte, von personenbezogenen Daten und Tokens bereinigte Logs, Readiness/Liveness und Build-Info                                                              | Fehlende Konfiguration stoppt sicher; Healthchecks unterscheiden DB/Worker-Zustand                                  |

### M1 – Minimaler interner MVP

| ID   | Commit                                                 | Inhalt                                                                                                                                                                                                                     | Tests/Abnahme                                                                                                                 |
| ---- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| C008 | `feat: add tenant and user persistence`                | Mandant, Benutzer, Membership und Grundschema mit `tenant_id` und mandantengebundenen Fremdschlüsseln                                                                                                                      | Migrationstest, Eindeutigkeit, tenant-gefilterte Repositories                                                                 |
| C009 | `feat: authenticate administrators with google oidc`   | Authorization-Code-Flow, sichere Session-Cookies, Logout und Callback, PKCE, CSRF-/Origin-Schutz für schreibende Admin-Routen                                                                                              | OIDC-Adaptertest, State/Nonce/Redirect-Angriffe, Sessionablauf                                                                |
| C010 | `feat: restrict login with an administrator allowlist` | Oberfläche und Regel für freigegebene Google-Konten; sicherer Erstkonto-Bootstrap über lokale Konfiguration; Sitzungswiderruf bei Sperre; letzter Admin vor Aussperrung geschützt; deaktivierter Notfallzugang vorbereitet | Nicht erlaubtes Konto abgewiesen; Erstkonto ohne offene Registrierung; Sperre widerruft Sitzungen; Änderung auditiert         |
| C011 | `feat: record append-only audit events`                | Auditlog für Anmeldung und spätere Fachaktionen                                                                                                                                                                            | Einträge unveränderbar; Tenantzugriff geprüft                                                                                 |
| C012 | `feat: manage event types packages and statuses`       | Konfigurationsoberflächen für Eventarten (fünf bestätigte Startwerte), Paketwerte und feste Status                                                                                                                         | CRUD-/Archivtests; historische Referenzen bleiben gültig                                                                      |
| C013 | `feat: manage cancellation reasons`                    | Konfigurierbare Absagegründe als Stammdaten                                                                                                                                                                                | Archivierung statt Löschung; tenant-isolierte API/UI                                                                          |
| C014 | `feat: manage resource master data`                    | FB1, FB2, Glamour- und Schwarzwald-Paket; Bestand, Kategorien, Sperrstatus und Puffer                                                                                                                                      | CRUD, Bestand ≥ 0, Archivregeln, synthetische Seeds                                                                           |
| C015 | `feat: manage product catalog`                         | Produkte, Preise, Steuer, Einheit, Aktivierung und Sortierung                                                                                                                                                              | Exakte Geldwerte, Archivierung und Validierung                                                                                |
| C016 | `feat: manage private and company contacts`            | Kontakt-CRUD, Firmen/Ansprechpartner, Suche, Eventbezüge, Archiv und offener Datenexport                                                                                                                                   | Normalisierung, Dublettenvorschlag, Tenantgrenzen, UI-Komponenten                                                             |
| C017 | `feat: manage reusable event locations`                | Location-CRUD und Suche                                                                                                                                                                                                    | Validierung, Archivierung, Eventreferenz bleibt bestehen                                                                      |
| C018 | `feat: create and edit events`                         | Eventmodell, Status, Art, Termin, Ort, Paket, Anfragequelle, Haupt-/weitere Kontakte und sanitizierte formatierte Notizen; Versionsprüfung gegen verlorene Änderungen                                                      | Zustands- und Validierungstests; vollständiger API/UI-Pfad                                                                    |
| C019 | `feat: add event list search and filters`              | Chronologische Liste, Suchtext, Zeitraum, Status, Art und Events ohne Datum; gemeinsame Suchnavigation zu Kontakten und Events                                                                                             | Filterkombinationen, URL-Zustand, leere/fehlerhafte Ansichten                                                                 |
| C020 | `feat: add event details and activity log`             | Gebündelte Eventakte und fachliches Logbuch                                                                                                                                                                                | Änderungen erzeugen korrekte unveränderbare Aktivitäten                                                                       |
| C021 | `feat: model resource holds and bookings`              | Reservierungszeitraum getrennt vom Event, Status Vormerkung/Gebucht/Blockiert, Pufferberechnung, Ablauf temporärer Vormerkungen und konsistente Statusübergänge gemäß docs/decisions.md                                    | Randgrenzen, beide DST-Wechsel, Zwei-Tage-Puffer, Storno-Freigabe und Ablauf bei ausgefallenem Worker                         |
| C022 | `feat: prevent overlapping confirmed reservations`     | PostgreSQL-Zeitbereiche und Exclusion Constraint pro physischer Ressourceneinheit/Mandant; Sperren nehmen am selben Konfliktschutz teil                                                                                    | Gleichzeitige Transaktionen; gleiche Box blockiert, FB1/FB2 parallel erlaubt                                                  |
| C023 | `feat: show availability and assign resources`         | Event-UI für Verfügbarkeit, Konflikte, Wechsel und Zubehör; manuelles Buchen ohne Vertrag; Terminverschiebung mit atomarer Neuprüfung                                                                                      | Komponenten- und API-Tests; atomare Zuweisung; alte Buchung bleibt bei Konflikt erhalten; konkurrierende Änderungen; Auditlog |
| C024 | `feat: add resource blocks for maintenance`            | Interne Sperren ohne Kundenauftrag                                                                                                                                                                                         | Sperre kollidiert mit Buchung; Freigabe und Historie geprüft                                                                  |
| C025 | `feat: add internal event and resource calendar`       | Tages-/Wochen-/Monatsansicht und Ressourcen-Zeitleiste                                                                                                                                                                     | Parallele Boxen, Puffer, Optionen und Konfliktfarben visuell/E2E geprüft                                                      |
| C026 | `feat: publish revocable ics calendar feeds`           | Gesamtfeed und Feeds pro Ressource; Tokenverwaltung, geschützter TLS-Zugriff aus Kalenderclients ohne Freigabe der Admin-API; optionaler ausgehender Feed-Abgleich zu einem getrennten Token-Endpunkt                      | RFC-nahe Parser-Tests, Update/Storno, keine ungewollten Datenfelder                                                           |
| C027 | `release: mark minimal internal mvp`                   | Version, Betriebsanleitung und M1-Abnahmetest; tägliche Sicherung und Restore geprüft; reale Nutzung erst nach Ressourcenabgleich, Zugriffsschutz und dokumentierter Datenübernahme                                        | Frische Installation; kompletter Kontakt→Event→FB1/FB2→Kalender→ICS-Pfad                                                      |

### M2 – Öffentliche Verfügbarkeit und Anfragen

| ID   | Commit                                              | Inhalt                                                                                                                                                                                                        | Tests/Abnahme                                                            |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| C028 | `feat: define versioned public gateway protocol`    | Signierte Sync-Nachrichten, Idempotenzschlüssel und minimale öffentliche Datenverträge, Schlüsselrotation, Replay-Schutz, Payload-Limits und getrennte Endpunkte für anonymisierte und token-geschützte Daten | Contract-Tests beider Seiten; alte/ungültige Signaturen abgewiesen       |
| C029 | `feat: project anonymized availability snapshots`   | Lokale Projektion von Ressourcenständen ohne Kundendaten                                                                                                                                                      | Datenschutztest; Status-/Pufferänderungen erzeugen korrekte Deltas       |
| C030 | `feat: synchronize availability through the outbox` | Ausgehende, wiederholbare Übertragung mit Quittierung; Job-Leases, Crash-Recovery, Backoff und sichtbare endgültige Fehler                                                                                    | Netzfehler, Retry, Duplikat und Reihenfolge getestet                     |
| C031 | `feat: render the embeddable availability widget`   | Responsiver Monatskalender als Web Component                                                                                                                                                                  | Browser-/Theme-Isolation, Tastatur, Mobilansicht und visuelle Snapshots  |
| C032 | `feat: configure widget branding and labels`        | Farben, Schrift, Rundungen, Legende und öffentliche Statusregeln, erlaubte Einbettungsdomains sowie widerrufbare Widget-Kennungen (keine Geheimnisse)                                                         | Konfiguration wirkt ohne Neubuild; unsichere CSS-/HTML-Werte abgewehrt   |
| C033 | `feat: add wordpress shortcode integration`         | Minimales WordPress-Plugin, Script-Laden und Shortcode                                                                                                                                                        | WordPress-Integrationsfixture; Mehrfacheinbindung; Cache-Versionierung   |
| C034 | `feat: collect public availability inquiries`       | Datum, Paket, Zubehör, Kontakt, konfigurierbare Formularquellen/Feldzuordnung, Einwilligung und Spam-Schutz; serverseitige Prüfung der Snapshot-Aktualität; getrennte Eingangs- und Übernahmebestätigung      | Schema-, Rate-limit-, Honeypot- und Consent-Tests                        |
| C035 | `feat: import inquiries and create temporary holds` | Ausgehendes Abholen, Dublettenschutz, Eventanlage und lokale Vormerkung mit Ablauf; verschlüsselte Zwischenablage im Gateway, Quittierung und befristete Löschung                                             | At-least-once-Zustellung, doppelte Anfrage, inzwischen belegte Ressource |
| C036 | `feat: degrade safely when availability is stale`   | Aktualitätsanzeige, keine Zusage bei Störung, verständliche Alternativen; Versionen verhindern Rücksprünge, Aktualisierung binnen 60 Sekunden im Normalbetrieb                                                | Gateway offline, verspätete Snapshots und Race-Condition E2E             |
| C037 | `release: mark public inquiry milestone`            | M2-Dokumentation und vollständiger WordPress→lokales Event-Abnahmetest                                                                                                                                        | Öffentlicher Test enthält keinerlei Bestandskundendaten                  |

### M3 – E-Mail und Kommunikation

| ID   | Commit                                              | Inhalt                                                                                                                                     | Tests/Abnahme                                                                                                            |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| C038 | `feat: add secure local file storage`               | Storage-Adapter, Metadaten, Limits, MIME-Prüfung, verpflichtende Quarantäne und Scan-Freigabe, unveränderbare Dateiversionen               | Traversal, falscher MIME-Typ, Größe, Tenantzugriff, Ersetzen und Scanner-Ausfall ohne Dateifreigabe                      |
| C039 | `feat: send email through configurable smtp`        | SMTP-Konfiguration, Signatur, Anhänge und Outbox                                                                                           | Fake-SMTP, TLS-Fehler und Retry vor Übergabe; unklarer SMTP-Ausgang wird sichtbar angehalten statt blind erneut gesendet |
| C040 | `feat: synchronize mailbox messages through imap`   | IMAP-Polling/Idle, Ordner, UIDVALIDITY/UID-Cursor und Umschaltgrenze ohne historische Nachrichtenimporte                                   | Fake-IMAP, Reconnect, Duplikate, gelöschte/verschobene Nachrichten                                                       |
| C041 | `feat: associate messages with contacts and events` | Automatische Vorschläge und manuelle Korrektur                                                                                             | Absender-/Thread-/Referenzfälle und falsche Zuordnung                                                                    |
| C042 | `feat: add inbox and event conversation views`      | Posteingang, unerledigt, gesendet, Entwürfe, geplant, Fehler, Papierkorb                                                                   | Listen-/Statusaktionen, Tenant- und Berechtigungstests                                                                   |
| C043 | `feat: manage email templates and placeholders`     | Vorlagen, elf Ausgangstypen, Platzhalter und Standardanhänge                                                                               | Fehlende Werte, Escaping, Vorschau und Archivierung                                                                      |
| C044 | `feat: compose drafts replies and attachments`      | Editor, Antworten, Weiterleiten und Dateibibliothek                                                                                        | Header/Threading, Uploadgrenzen, XSS und Entwurfserhalt                                                                  |
| C045 | `feat: schedule email delivery and follow ups`      | Geplanter Versand und zwei feste Regeln für interne Erinnerungen (offen/erledigt/verworfen); Kunden-Nachfassmails nur ausdrücklich geplant | Uhrzeit/Zeitzone, Reaktion stoppt Erinnerung; keine doppelten Jobs; unklarer Versand wird angehalten                     |
| C046 | `release: mark communication milestone`             | M3-Abnahme und Betriebsdokumentation                                                                                                       | Anfrage→Antwort→Zuordnung→Follow-up vollständig E2E                                                                      |

### M4 – Angebote, Rechnungen und Zahlungen

| ID   | Commit                                           | Inhalt                                                                                                                                  | Tests/Abnahme                                                      |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| C047 | `feat: manage document templates`                | Vorlagentexte, Produktpositionen, Platzhalter und Versionen                                                                             | Rendering, Archivierung, alte Version unverändert                  |
| C048 | `feat: configure branded document layouts`       | Logo, Farben, Schrift, Absender, Seitenzahlen und Vorschau                                                                              | Deterministischer HTML-/Visual-Snapshot                            |
| C049 | `feat: render immutable pdf documents`           | Chromium-PDF, Inhalts-Hash und dauerhafte Artefakte                                                                                     | PDF parsebar, Fonts stabil, Hash ändert sich nur bei Inhalt        |
| C050 | `feat: allocate atomic document numbers`         | Getrennte Nummernkreise mit Jahr/Monat/Tag/Sequenz und unverbindlicher Nummernvorschau                                                  | Parallelität, Rollback, führende Nullen und keine Wiederverwendung |
| C051 | `feat: create and finalize offers`               | Positionen, Rabatt, Steuer, konfigurierbare Gültigkeit (Standard 14 Tage) und Status                                                    | Geld-/Steuerbranches, Ablauf, finale Version unveränderbar         |
| C052 | `feat: record offer acceptance by channel`       | E-Mail, Telefon, PDF oder Sonstiges mit Zeitpunkt/Notiz                                                                                 | Zustandsübergänge und optionaler Anhang                            |
| C053 | `feat: convert offers to order confirmations`    | Übernahme ohne Neueingabe                                                                                                               | Positions-/Summengleichheit und unabhängige Finalisierung          |
| C054 | `feat: create invoices deposits and corrections` | Rechnung, Anzahlung, Schlussrechnung und Korrektur                                                                                      | Pflichtangaben, Steuer, Verrechnung, Storno und Unveränderbarkeit  |
| C055 | `feat: record payments and outstanding balances` | Zahlungen, Teilzahlung, bezahlt/überfällig und CSV-Export inklusive Dokumentmetadaten; Schutz vor Tabellenformeln in allen CSV-Exporten | Über-/Teilzahlung, Datum, Korrektur und exakte Salden              |
| C056 | `release: mark commercial documents milestone`   | M4-Abnahme und Dokumentationsstand                                                                                                      | Angebot→Annahme→Anzahlung→Schlussrechnung→Zahlung E2E              |

### M5 – Online-Verträge und Fragebögen

| ID   | Commit                                            | Inhalt                                                                                                                                                                     | Tests/Abnahme                                                                                                                 |
| ---- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| C057 | `feat: manage versioned contract templates`       | Vertragsbausteine, Felder, Bestätigungen, Sichtbarkeit und Sperrregeln                                                                                                     | Schema-/Versions-/Archivtests; Rich-Text-Sanitizing                                                                           |
| C058 | `feat: issue secure public contract links`        | Gehashte Tokens, Ablauf, Widerruf, Prefill und Autosave; ausgehender Abgleich persönlicher Vertragsinstanzen, befristete Gateway-Aufbewahrung und sichere Offline-Zustände | Token-Raten, fremder Tenant, Ablauf, Replay und Zwischenspeichern                                                             |
| C059 | `feat: validate and capture contract signatures`  | Pflichtfelder, Einwilligungen und Unterschrift                                                                                                                             | Fehlende/gefälschte Felder, mobile Eingabe und Abschluss nur einmal                                                           |
| C060 | `feat: finalize signed contracts and evidence`    | Unveränderbares PDF, Dokumenthash, Nachweisprotokoll und Versand erst nach verbindlichem Abschluss; wiederanlaufbare PDF-Bereitstellung gemäß docs/decisions.md            | Manipulationserkennung, Vorlagenversion und deterministische Artefakte                                                        |
| C061 | `feat: confirm resources after contract signing`  | Lokaler atomarer Abschluss nach ausgehend abgeholtem Signaturauftrag; Gateway meldet bis zur Quittierung nur ausstehend, erneute Ressourcenprüfung, Status Gebucht         | Zwei parallele Signaturen auf letzte Box; Offline, Crash, verlorene Quittierung und Replay; sicherer Abbruch ohne Widerspruch |
| C062 | `feat: remind customers about unsigned contracts` | Konfigurierbare Erinnerung und Stop nach Abschluss/Widerruf                                                                                                                | Zeitsteuerung, Retry und kein Versand nach Abschluss                                                                          |
| C063 | `feat: manage questionnaire templates`            | Feldtypen, Sortierung, Uploadregeln und Feldmapping                                                                                                                        | Schema, Archivierung, sichere Konfiguration                                                                                   |
| C064 | `feat: collect fotobox questionnaire responses`   | Sicherer Link, Prefill, Autosave, Abgabe und Eventanzeige                                                                                                                  | Mobil-E2E, Uploadschutz, Tenanttrennung und Logbuch                                                                           |
| C065 | `feat: map questionnaire answers into event data` | Kontrollierte Übernahme und Korrekturfreigabe                                                                                                                              | Konflikt mit intern geänderten Daten, Audit und Wiederöffnung                                                                 |
| C066 | `release: mark customer forms milestone`          | M5-Abnahme und rechtliche Prüfliste                                                                                                                                        | Angebot→Vertrag→Signatur→Buchung→Fragebogen vollständig E2E                                                                   |

### M6 – To-dos und Absagegründe

| ID   | Commit                                            | Inhalt                                                                    | Tests/Abnahme                                                              |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C067 | `feat: manage event and general tasks`            | Offen/erledigt/verworfen, Fälligkeit und Übersichten                      | Überfällig, Filter, Eventbezug und Audit                                   |
| C068 | `feat: manage relative task templates`            | Mehrere Aufgaben, Anker Anfrage/Buchung/Event, Vor-/Nachlauf und Filter   | Relative Datumsberechnung über DST/Zeitzonen und Pakete                    |
| C069 | `feat: instantiate and reschedule relative tasks` | Automatische/manuelle Anwendung und Vorschau bei Datumsänderung           | Keine Duplikate, erledigte Tasks bleiben, offene werden korrekt verschoben |
| C070 | `feat: notify about due and overdue tasks`        | E-Mail-/Browserhinweise                                                   | Debounce, Zeitzone, erledigte/verworfene Aufgaben stoppen Meldung          |
| C071 | `feat: capture cancellation reasons on events`    | Pflichtauswahl oder bewusst unbekannt; Notiz und Trennung der Absagearten | Statusübergänge, archivierte Gründe und bestehende Events                  |
| C072 | `feat: report cancellation reasons`               | Zeitraum, Anteil, Eventart, Quelle, Paket und CSV                         | Aggregations-/Tenanttests und nachvollziehbare Prozentwerte                |
| C073 | `release: mark operations insight milestone`      | M6-Abnahmetests und Dokumentation                                         | Aufgabe relativ verschoben; Absage korrekt ausgewertet                     |

### M7 – Migration, Sicherheit und Produktionsreife

| ID   | Commit                                                   | Inhalt                                                                                                                                                                                                                         | Tests/Abnahme                                                                |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| C074 | `feat: import contacts with duplicate reporting`         | Bookitup-Import, Dry-run und Fehlerbericht; Auskunftsexport und dokumentierte Lösch-/Anonymisierungsvorgänge mit Aufbewahrungssperren                                                                                          | Zeichensätze, Firmen, Dubletten, Wiederholung und Rollback                   |
| C075 | `feat: import events and master data`                    | Aktive/zukünftige Events, Arten, Pakete, Produkte, Locations und Notizen; Export von Events/Produkten; Übernahme von E-Mail-/Dokumentvorlagen, Logo, Gestaltung, Signatur und acht Standarddateien über die vorhandenen Module | Referenzintegrität, Statusmapping und Wiederanlauf                           |
| C076 | `feat: reconcile resource assignments before cutover`    | Manuelle Prüfliste für FB1/FB2 und Zubehör                                                                                                                                                                                     | Jeder gebuchte Zukunftstermin konfliktfrei oder explizit blockiert           |
| C077 | `feat: import open commercial balances and counters`     | Offene Vorgänge und nächste Nummern; keine Altarchive/E-Mails; Originalnummern und unveränderbare Originalbelege offener Vorgänge erhalten, keine Neuausstellung                                                               | Summenkontrolle, Nummernüberschneidung und Dry-run-Bericht                   |
| C078 | `ops: automate encrypted backup and restore`             | PostgreSQL- und Dateisicherung, Rotation und Restore-Befehl                                                                                                                                                                    | Vollständiger Restore in frische Umgebung mit Prüfsummen                     |
| C079 | `security: harden public and administrative endpoints`   | Modulübergreifende Nachprüfung der bereits bei Einführung verpflichtenden Security Header, CSRF, Rate-Limits, Uploadscan, Tokenrotation und Dependency Audits                                                                  | Automatisierte Missbrauchs-/Autorisierungsfälle und Security-Scan            |
| C080 | `test: verify tenant isolation across all modules`       | Systematische Negativsuite für späteren Mehrmandantenbetrieb                                                                                                                                                                   | Kein Zugriff über IDs, Suche, Dateien, Jobs, Exporte oder öffentliche Tokens |
| C081 | `perf: validate production data volumes and concurrency` | Lasttests für Listen, Mail, Widget und gleichzeitige Reservierung                                                                                                                                                              | Definierte Antwortzeiten und keine Doppelbuchung unter Last                  |
| C082 | `a11y: audit administrative and public workflows`        | Tastatur, Fokus, Kontrast, Labels und Screenreader-Grundlagen                                                                                                                                                                  | Automatisierte axe-Prüfung plus dokumentierte manuelle Checks                |
| C083 | `ops: document update rollback and incident procedures`  | Betriebshandbuch, Updates, Rollback nur bei kompatiblem Schema, sonst getestete Wiederherstellung; OAuth-/Mail-/Gateway-Ausfall                                                                                                | Dry-run der Verfahren auf Testinstallation                                   |
| C084 | `test: rehearse migration and production cutover`        | Vollständiger Probelauf mit synthetischem Export und Delta-Verfahren; echte Exporte ausschließlich lokal und ignoriert                                                                                                         | Mengen-/Summen-/Ressourcenabgleich vollständig grün                          |
| C085 | `release: publish the first production-ready version`    | Changelog, versionierte Images, Prüfsummen und finale Abnahme                                                                                                                                                                  | Gesamte Suite, Clean install, Restore und Kernprozess vollständig grün       |

## 5. Definition des minimalen MVP nach C027

Der erste bewusst minimale Nutzwert ist erreicht, wenn:

1. der Inhaber sich mit dem gewählten Anmeldeverfahren anmelden kann,
2. Eventarten, Pakete, Produkte und Ressourcen konfigurierbar sind,
3. Kontakte und Events manuell verwaltet werden können,
4. FB1 und FB2 sowie einmaliges Zubehör mit zwei Tagen Puffer disponiert werden,
5. die Datenbank gleichzeitige Doppelbuchungen verhindert,
6. Kalender und Ressourcenansicht die Belegung verständlich zeigen,
7. ein widerrufbarer ICS-Feed auf dem Smartphone funktioniert,
8. Auditlog, Backup-Grundlage und automatisierte Tests vorhanden sind.

Dieser Stand ersetzt noch nicht bookitup vollständig, ist aber bereits als verlässliche interne Disposition nutzbar. Für die frühere Ablösung sind zusätzlich die vorgezogenen Archiv-, Migrations-, Ersatzprozess- und Betriebsabnahmen aus dem [Ausstiegsplan](docs/bookitup-exit.md) erforderlich. Jede spätere Phase fügt einen fachlichen Bereich hinzu.

## 6. Release- und Push-Regel

- Nach jedem Commit: vollständige relevante Tests, explizite Staging-Prüfung, Commit und sofortiger Push.
- Nach jedem Milestone: komplette Testsuite, E2E-Abnahme, aktualisierte Dokumentation und ein versionierter Tag.
- Kein Milestone wird durch Überspringen eines fehlgeschlagenen Tests abgeschlossen.
- Der konfigurierte Remote ist `https://github.com/gcode-de/auftragskompass.git`; Sichtbarkeit und Repository-Einstellungen werden nicht beiläufig geändert.
