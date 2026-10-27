# Projektübergabe AuftragsKompass

Stand der Fortsetzung: **26.10.2026**. Aktuelle Abschnitte stehen oben; frühere datierte Berichte bleiben historische Nachweise. Einstieg für eine neue Arbeitssession und kompakter Funktionsüberblick. Dieses Dokument ersetzt weder den aktuellen Git-/CI-/Betriebsabgleich noch das Lastenheft. Bei Fortsetzung aktualisieren; keine alten Kontingentwerte oder Chat-Automationen ungeprüft wiederverwenden.

## H073: RG-08 – „Überfällig“ abgeleitet, 26.10.2026

- **RG-08 `8a306dd`** – der letzte fehlende RG-08-Status: „Überfällig“
  wird **abgeleitet, nie gespeichert** (keine Migration): zahlbare
  Rechnung/Anzahlung ∧ offener Saldo > 0 ∧ `due_date` < Mandantenheute
  (strikt – „fällig heute“ ist nicht überfällig; DST-sicher wie
  `offerExpired`). Gilt bei Teilzahlung, Anzahlungen und Schlussrechnungen
  (reduzierter Anspruch), nicht bei Korrekturen/AB/Angeboten, nicht ohne
  Zahlungsziel, nicht bei bezahlt/voll storniert. Badge „Überfällig“ als
  eigenes `<strong>` neben „Offen/Teilweise bezahlt/Bezahlt“ (keine neue
  CSS-Regel); Gutschriften können Überfälligkeit heilen, Lastschriften
  begründen; keine Historie „war überfällig“. Damit sind **alle sieben
  RG-08-Status** abgedeckt (Entwurf/final, versendet = Angebots-Achse,
  teilweise bezahlt/bezahlt, überfällig, storniert = abgeleitet).
- **Abnahme:** RED sauber beobachtet (14 Integrationsfehler „Schlüssel
  `overdue` fehlt“ + 1 Component- + 1 E2E-Fehler), dann grün: unit 274,
  component 748, integration 482 (14 neue Fälle inkl. fällig-heute-Grenze,
  zwei DST-Grenzen 2029-10-28/2029-03-25, Mandantentrennung Berlin vs.
  Auckland bei gleichem `due_date`, „Ableiten schreibt nichts“), coverage
  vollständig (0 ungedeckte neue Zeilen), E2E 16/16 inkl. frischer Rechnung
  ohne Badge und – nach dokumentiertem Test-Backdating (SQL-Fixture, kein
  Produktweg) – Badge neben „Teilweise bezahlt“, Build grün.
- **Ehrlich notiert:** im E2E-Backdating musste `payment_term_days=1`
  mitgesetzt werden (CHECK 0047) – die Fixture ist sichtbar künstlich;
  „überfällig“ ist noch nicht filter-/exportierbar (folgt mit (e)); kein
  `due_date`-Index; zwei Testerwartungen waren in der GREEN-Phase falsch
  (im Test korrigiert, nicht im Produkt); MiMo-Reviewfix tilgte zwei
  veraltete „Überfällig fehlt“-Stellen (Code-Kommentar + Doku);
  Bookitup-„überfällig“-UI bleibt unbekannt, keine Rechtsaussage.

**Nächste Unter-Slices:** (e) Fristen-/Statusfilter und Export (jetzt mit
`due_date`/`overdue` möglich); dazu RG-04 (Pflichtangaben-Ausstattung),
Annahme-Korrekturpfad, Rückzahlungslogik, BKP020-Reste und BKP021+
(Mailkern bis BKP030). Betrieb unverändert: verifiziert live **c21330c**,
alleiniger Auto-Updater; Checkpoint-/OCI-Nachweis weiterhin offen
(Proxmox-Host 192.168.68.201 nicht erreichbar).

## H072: RG-07b – Bankverbindung auf Rechnungen, 26.10.2026

- **RG-07b `baf7532`** – das letzte fehlende RG-07-Feld: Rechnungs-,
  Anzahlungs- und Korrekturbelege tragen optional eine **Bankverbindung**
  (Freitext ≤500, mehrzeilig), wörtlich gedruckt (keine Platzhalter, keine
  IBAN-/Bankprüfung – keine Banklogik erfunden), im Entwurf änderbar, nach
  Finalisierung unveränderlich (kein Update-Pfad friert ein – bewusst keine
  Einfrier-Spalte). Gedruckt unter der Fälligkeitszeile mit `<br/>`-Umbrüchen
  (keine neue CSS-Regel – die Byte-Goldwächter blieben intakt).
  Migration `0048` additiv (Steuerzeichen-Regel mit erlaubtem `\n`),
  Projektion `include=offer` additiv um `bankAccount`.
- **Nebenbefund (echter RG-07a-Defekt, behoben):** der Editor-Ladepfad verlor
  Leistungsdatum/Zahlungsziel beim Neuladen – die nächste Speicherung hätte
  sie gelöscht. Im selben erlaubten File korrigiert, der Reload-Test beweist
  es.
- **Abnahme:** RED sauber per `git stash` getrennt (14 Fehlerbilder;
  ehrlich: E2E nicht rot beobachtet), danach grün: unit 274, component 746,
  integration 468 (11 Bankfälle inkl. 500/501, `\n` vs. Steuerzeichen,
  DB-CHECKs, Einfrieren, Bytegleichheit, Mandantentrennung), coverage 1488
  vollständig (Changed ≥85/80), E2E 16/16 (Passwort 2,1 min im Budget)
  inkl. gedruckter Bankzeile mit Umbruch, Build grün.
- **Ehrlich notiert:** DB-Steuerzeichen-Regel für 0x7F–0x9F möglicherweise
  laxer als die Domäne (sichere Richtung gewählt); Längenmessung UTF-16 vs.
  Zeichen bei Emoji (Domäne strenger); kein Zeilenlimit/Umbruchschutz im
  Druck (offene Gestaltungsfrage); einmaliger nicht reproduzierbarer
  E2E-Flake an unberührter History-Restore-Stelle (auth.spec.ts:2610–2631);
  kein Mandanten-/Layout-Default (Vorrangregel offen).

Damit ist **RG-07 vollständig** (Rechnungsdatum, Leistungsdatum,
Zahlungsziel, Bankverbindung – alle „unterstützt“ im Sinne von führen,
drucken, prüfen; keine Rechts-/Steuerabnahme).

**Nächste Unter-Slices:** RG-08 („überfällig“ abgeleitet – jetzt möglich,
`due_date` steht), (e) Fristen-/Statusfilter und Export; dazu RG-04
(Pflichtangaben-Ausstattung), Annahme-Korrekturpfad, Rückzahlungslogik,
BKP020-Reste und BKP021+ (Mailkern bis BKP030). Betrieb unverändert:
verifiziert live **c21330c**, alleiniger Auto-Updater; Checkpoint-/OCI-
Nachweis weiterhin offen (Proxmox-Host 192.168.68.201 nicht erreichbar).

## H071: RG-07a – Leistungsdatum und Zahlungsziel (RG-07), 26.10.2026

- **RG-07a `2658751`** – Rechnungs-, Anzahlungs- und Korrekturbelege tragen
  optional ein Leistungsdatum und ein Zahlungsziel in Tagen (0 = sofort
  fällig). Das **Rechnungsdatum bleibt das Ausstellungsdatum** (geführt und
  gedruckt, keine Rückdatierung – keine zweite Datumswahrheit); das
  **Fälligkeitsdatum wird beim Finalisieren eingefroren** (Mandantentag +
  Tage, DST-sicher) – „Ziel vor Rechnungsdatum“ ist strukturell unmöglich.
  Gedruckt nur wo gesetzt (ohne Werte bytegleich), Projektion additiv.
  Migration `0047` additiv ohne Backfill; Felder nur für die
  Rechnungsfamilie; Entwurf änderbar, danach eingefroren.
- **Abnahme:** RED sauber per `git stash` getrennt beobachtet (12
  Fehlerbilder; ehrlich: der Byte-Wächter war vorher grün – er pinnt
  Unverändertheit, Goldwerte vom Vor-Slice-Code; ein echter E2E-Rotfall
  wurde behoben), danach grün: unit 274, component 744, integration 456
  (10 neue Fälle inkl. DST-Grenze 2029-10-27, Term-Grenzen,
  Service-Tag-Grenzen inkl. Schalttag, DB-CHECKs, Bytegleichheit,
  Mandantentrennung), coverage 1474 vollständig (Changed ≥85/80), E2E
  16/16 (Passwort-Szenario 2,2 min im Budget) inkl. Ablauf
  Entwurf → Leistungsdatum 29.02.2020 + 14 Tage → finalisieren →
  gedruckte Zeilen/`due_date` = Mandantentag+14, Build grün.
- **Ehrlich notiert:** Service-Tag-Grenze „nicht nach dem Mandanten-Heute“
  (bewusst strenger als „Rechnungsdatum + 365“, später lockerbar);
  „überfällig“ bleibt offen (RG-08 = eigener nächster Slice); kein
  `due_date`-Index (kommt mit (e)-Filtern); ein Mandanten-Default für
  Zahlungsziele fehlt (spätere Einstellungen); AJV-Coercion-Falle
  (null vor String im `anyOf`) dokumentiert.

**Nächste Unter-Slices:** RG-07b (Bankverbindung drucken, 0048),
RG-08 („überfällig“ ableiten), (e) Fristen-/Statusfilter und Export;
dazu Pflichtangaben-Ausstattung RG-04, Annahme-Korrekturpfad,
Rückzahlungslogik, BKP020-Reste und BKP021+ (Mailkern bis BKP030).
Betrieb unverändert: verifiziert live **c21330c**, alleiniger Auto-Updater;
Checkpoint-/OCI-Nachweis weiterhin offen (Proxmox-Host 192.168.68.201 nicht
erreichbar).

## H070: BKP019.c3.2 – Schlussrechnung mit Verrechnung (RG-03), 26.10.2026

- **BKP019.c3.2 `4bcb851`** (inkl. Nachträgen b/c): die **Schlussrechnung**
  (`invoice_role='final'`, `RE-`-Nummer, genau eine Rechnung je Bestätigung –
  DB-garantiert über den unangetasteten Unique-Index) verrechnet geleistete
  Anzahlungen (RG-03): beim Finalisieren wird `deposit_applied_minor`
  eingefroren, der Verrechnungsblock zeigt „Anzahlungen gesamt / davon
  geleistet / Zu zahlender Betrag“, gedrucktes Brutto bleibt die volle
  Auftragssumme. Zahlungen auf die Schlussrechnung sind nur bis zum
  reduzierten Anspruch möglich. **Zwei Nachträge schärften die Semantik:**
  (b) Über-Verrechnung wird beim Finalisieren mit 409
  `deposits_exceed_order` abgelehnt (Entwurf unversehrt, Vorabwarnung in der
  UI) – ein negativer „Zu zahlender Betrag“ entsteht nie; (c) der
  Verrechnungsbetrag zählt **korrigierte Ansprüche** der Anzahlungen
  (`gross + debits − credits` je Beleg) statt bloßer Bruttosummen – der
  Nachtrag bewies, dass die ursprüngliche Bruttosummen-Regel die
  dokumentierte Lösung „per Korrektur reduzieren“ tot ließ (dauerhafte
  Falle) und korrigierte Anzahlungen unterverrechnete. Ohne Korrekturen
  bleibt die Regel identisch (das 1.690/1.300/390-Beispiel unverändert).
- **Abnahme:** RED je Schritt sauber beobachtet, dann grün: unit 274,
  component 742, integration 446 (Kopie/Rolle, Dublette seq.+parallel,
  exakter Verrechnungsbetrag, Einfrieren, 0-Anzahlungen, Grenzfall exakt/
  1 Cent, Entzerrung per Gutschrift, beide Kredit-Guard-Richtungen,
  DB-CHECKs), coverage vollständig (documents.ts 92,91% Statements), E2E
  16/16 inkl. Ablauf Bestätigung + Anzahlungen 30/10 + 20 gezahlt →
  Schlussrechnung Block 40/20/60 → Einfrieren 4.000 → Teilzahlung 30 →
  30,01 abgelehnt → Quell-PDFs bytegleich, Build grün.
- **Ehrlich notiert:** „davon geleistet“ bleibt live (nur der Abzug ist
  eingefroren); `deposit_applied_minor` ist `bigint` (bewusste Abweichung
  vom int4-Vorschlag, passend zu allen Geldspalten); eine Über-Verrechnung
  aus **voll bezahlten** Anzahlungen lässt sich weiterhin nicht per
  Gutschrift entzerren (Kredit-Guard begrenzt Gutschriften durch
  geleistetes Geld – die Rückzahlungslücke bleibt unverändert offen,
  ausdrücklich Nicht-Scope); keine Steuergruppenaufteilung des Abzugs
  behauptet.

**Nächste Unter-Slices BKP019:** (e) Fristen-/Statusfilter und Export,
RG-07 (Zahlungsziel/„überfällig“); dazu Pflichtangaben RG-04,
Annahme-Korrekturpfad, Rückzahlungslogik (eigene Entscheidung), BKP020-Reste
und BKP021+ (Mailkern bis BKP030). Betrieb unverändert: verifiziert live
**c21330c**, alleiniger Auto-Updater; Checkpoint-/OCI-Nachweis weiterhin
offen (Proxmox-Host 192.168.68.201 nicht erreichbar).

**Betriebsbefund (wachsend, dritte Abbruchart):** Der CI-Lauf zu `4bcb851`
(40440112521) ließ das Passwort-Auth-E2E in das **240-Sekunden-Testlimit**
laufen (Fehlerbeleg: „Test timeout of 240000ms exceeded“, Seite im
Anmeldebildschirm; lokal laufen beide Modi in ~2,1–3,5 min grün). Das
Szenario ist durch die vielen neuen Abläufe (Kontaktdetails-Matrix,
Editor-Matrix, Zahlungs-/Anzahlungs-/Schlussrechnungsreisen) spürbar
gewachsen – Budgetdruck, kein Verhaltensfehler. Kein Timeout wurde
verlängert; ein gezielter Re-Run verifiziert den Stand (Folgeabschnitt).
Für drei Abbrucharten sind damit Betriebsentscheidungen offen:
`timeout-minutes` der CI, Runner-Netzwerkflakes (`ERR_NETWORK_CHANGED`) und
das E2E-Zeitbudget des Passwort-Szenarios (Szenario teilen oder Budget
bewusst erhöhen). Der Re-Run ist komplett grün (quality 14m33s + images
1m53s – auf einem schnellen Runner, was die Budget-Hypothese stützt).

## H069: BKP019.c3.1 – Anzahlungsrechnung (RG-02/DV-02), 26.10.2026

- **BKP019.c3.1 `f15486e`** – aus einer finalen Auftragsbestätigung entsteht
  „Anzahlung erstellen“ eine Anzahlungsrechnung (`AZ-`-Nummernkreis, DV-02):
  Positionen 1:1 als Betragsmagnituden, Summen exakt wie die Quelle, Betreff
  „Anzahlungsrechnung für {{contact}}“, Entwurf bearbeitbar (Anzahlungshöhe
  entsteht durch Kürzen der Positionen – bewusst ohne Prozent-/Festbetrag-
  Parameter). **Mehrere Anzahlungen je Auftrag sind erlaubt** (Raten; kein
  Unique-Index, Doppelklick erzeugt per Guard genau eine). Vier bisherige
  Sperren wurden geöffnet: Anzahlungen sind **zahlbar** (Zahlungseingänge wie
  bei Rechnungen, Zahlungsstand/„Offener Betrag“), **korrigierbar**
  (c2-Korrekturbelege), quellenbezogen („Aus Auftragsbestätigung AB-…“) und
  entwurfsbearbeitbar (geteilte Editor-Komponente mit eigener Überschrift).
  Migration `0045` erweitert Quell-CHECK/Blanko-Regel additiv (Blanko-
  Anzahlung bleibt 23514). UI nennt ehrlich, dass die **Verrechnung in der
  Schlussrechnung (RG-03) mit c3.2** folgt.
- **Abnahme:** RED sauber beobachtet (37 Fehlschläge gegen zurückgenommene
  Kernstellen), dann grün: unit 274, component 735, integration 425
  (12 neue c3.1-Fälle + Zahlungsfälle auf Anzahlungen), coverage vollständig,
  E2E 16/16 inkl. Ablauf finale Bestätigung → Anzahlung `AZ-JJJJ-NNNN` →
  Teilzahlung 30,00 € → offen 70,00 € → Korrektur der Anzahlung →
  bytegleiche Quell-PDFs, axe-Audit 0 Verstöße, Build grün.
- **Für c3.2 verbindlich festgehalten:** Verrechnungsblock weist geleistete
  Anzahlungen aus; **Saldoabzug = abgerechnete Anzahlungs-Bruttosumme**
  (nur „geleistet“ abziehen wäre eine Doppelforderung – die Analyse rechnete
  1.690 € vs. 1.300 € durch); „davon geleistet“ nur Ausweis; dazu
  `invoice_role`, `deposit_applied_minor` (beim Finalisieren eingefroren),
  `order_invoiced`-Guard und die Zählung von Anzahlungszahlungen im
  Bestätigungs-Kredit-Guard.
- **Ehrlich notiert:** Storno-Stand/Restbetrag fehlen Anzahlungen noch
  (Projektion bewusst nur `payable`/`paymentState` erweitert); zwei parallele
  API-Aufrufe erzeugen zwei Anzahlungen (Raten gewollt); eine
  Vorlagen-Anzahlung ohne Quelle bleibt möglich, aber nicht verrechenbar.

**Nächste Unter-Slices BKP019:** c3.2 (Schlussrechnung mit Verrechnung),
(e) Fristen-/Statusfilter und Export, RG-07 (Zahlungsziel/„überfällig“);
dazu Pflichtangaben RG-04, Annahme-Korrekturpfad, BKP020-Reste und
BKP021+ (Mailkern bis BKP030). Betrieb unverändert: verifiziert live
**c21330c**, alleiniger Auto-Updater; Checkpoint-/OCI-Nachweis weiterhin
offen (Proxmox-Host 192.168.68.201 nicht erreichbar).

## H068: BKP019.d – Zahlungseingänge und offener Saldo (RG-09), 26.10.2026

- **BKP019.d `e5f9ac3`** – manuelle Erfassung von Zahlungseingängen gegen
  finale Rechnungen: Empfangsdatum (nie Zukunft), Betrag ≥ 1 Cent, Zahlweg
  (Überweisung/Bar/Karte/Sonstiges – eigene dokumentierte Konvention) und
  optionale Notiz; append-only (kein Ändern/Löschen), auditiert, mandanten-
  gebunden. **Überzahlung wird abgelehnt** (409 `overpaid`); der
  Über-Gutschrift-Guard aus c2 wurde um Zahlungen erweitert: bezahltes Geld
  wird nicht gutgeschrieben, solange es keine Rückzahlungslogik gibt
  (dokumentierter Zwischenzustand). Zahlungsstand `none|partial|paid` und
  offener Saldo (`Brutto + Σdebit − Σcredit − ΣZahlungen`) werden
  **abgeleitet** (nie gespeichert); „Bezahlt“ entsteht nur aus erfassten
  Zahlungen, nie aus Druck. UI: Zahlungsstand/„Offener Betrag“ auf der
  Rechnungszeile, kompakte Erfassung und Zahlungsliste je Rechnung.
  **Ehrlich offen:** „Überfällig“ fehlt, weil ein Zahlungsziel (RG-07)
  eigener Slice ist – nicht erfunden.
- **Abnahme:** echtes Produkt-RED beobachtet (14/15 Integrationstests gegen
  entfernte Migration; sechs Harness-/Testfehler ehrlich getrennt repariert),
  danach grün: unit 274, component 729, integration 410 (16 neue Fälle inkl.
  Teilzahlung→bezahlt ohne Versionssprung, Überzahlung, Parallelzahlung,
  kein PATCH/DELETE, erweiterter Kredit-Guard „50,00 € gezahlt → höchstens
  223,10 € gutgeschrieben“, Mandantentrennung, DB-CHECKs/FK/kein Cascade),
  coverage 1413 vollständig (Changed 91,8%/80,7%), E2E 16/16 inkl. Ablauf
  offen → 40,00 € → teilweise → 60,00 € bar → bezahlt/0,00 € →
  Überzahlung abgelehnt, PDF/Hash unverändert, Build grün.
- **Ehrlich notiert:** kein Idempotenzschlüssel für Zahlungen (UI blockt
  Doppelklick, Netz-Retry theoretisch möglich – Kandidat für den späteren
  Beleg-Mechanismus); Überzahlungsregel lebt unter `lockTenant`, nicht
  strukturell in der DB; ein vorbestehender testcontainers-Parallelitäts-
  Flake (worker-main.test.ts) fiel einmal aus, Wiederholungslauf grün.

**Nächste Unter-Slices BKP019:** c3 (Anzahlung/Schlussrechnung – jetzt mit
Zahlungsaussage sinnvoll), (e) Fristen-/Statusfilter und Export, RG-07
(Zahlungsziel/„überfällig“); dazu Pflichtangaben RG-04, Annahme-Korrekturpfad,
BKP020-Reste und BKP021+ (Mailkern bis BKP030). Betrieb unverändert:
verifiziert live **c21330c**, alleiniger Auto-Updater; Checkpoint-/OCI-
Nachweis weiterhin offen (Proxmox-Host 192.168.68.201 nicht erreichbar).

**Betriebsbefund (wachsend):** Der CI-Lauf zu `e5f9ac3` (40414170015) riss
zuerst an der 25-Minuten-Jobgrenze ab (drittes Mal dieser Grenztyp; alle
sichtbaren Phasen liefen, `images` blieb aus). Der erste Re-Run scheiterte
anschließend an einem **zweiten Mal** aufgetretenen transienten
`net::ERR_NETWORK_CHANGED` des Runner-Chromiums (diesmal auf
`/api/v1/access`, Konsolennachweis im Artefakt – die Zeile „Erste Anmeldung
ausstehend“ konnte deshalb nie erscheinen; die übrigen 404/409 im Log sind
die bewusst injizierten Negativfälle). Kein Produktfehler, kein Test
geändert; ein weiterer gezielter Re-Run verifiziert den Stand (siehe
Folgeabschnitt). Da beide Abbrucharten zunehmen, sind zwei Betriebs-
entscheidungen zu prüfen: `timeout-minutes` in `quality.yml` und der Umgang
mit Runner-Netzwerkflakes – beides wurde hier **nicht** eigenmächtig
geändert (keine Verhaltensänderung an Tests/Gates). Der zweite
Re-Run ist komplett grün (quality 18m08s + images 2m04s).

## H067: BKP019.c2 – Rechnungskorrektur/Storno mit Richtungsmodell (RG-02), 26.10.2026

- **BKP019.c2 `e0804c4`** (inkl. Nachtrag c2b): Rechnungskorrektur als eigener
  Beleg mit Richtung `Gutschrift`/`Lastschrift` und Bezug zu einer finalen
  Rechnung oder Auftragsbestätigung. **Richtungsmodell B′:** gespeicherte
  Beträge bleiben nicht-negative Ganzzahlen, die Vorzeichenwirkung entsteht
  beim Verrechnen exakt (`−1 ×` gespeicherte Summe) – die Analyse fand, dass
  Negieren mit der bestehenden Rundung ungenau wäre (5/5/0 → −4/−3/−1),
  weshalb negative Zeilenbeträge verworfen wurden; `document-totals`/DB-
  CHECKs blieben unangetastet. Über-Gutschrift-Guard beim Finalisieren
  (409 `credit_exceeds_invoice`), `KO-`-Nummer, Storno-Stand der Rechnung
  (`none|partial|full`) wird in der Projektion **abgeleitet** (RG-08 ohne
  Unveränderlichkeitsbruch), verbleibende kreditierbare Summe in der UI,
  Bezugszeile + Korrektur-Summenblock nur bei gesetztem Bezug (c1-
  Bytegleichheit bleibt). Ein halbfartiger, fachlich falscher Pfad
  (Korrektur aus Vorlage) wurde gesperrt: 400 `invalid_kind`, nur der
  Quellpfad erzeugt Korrekturen. Saldenformel für (d) dokumentiert:
  `offener Saldo = Brutto + Σ Lastschriften − Σ Gutschriften − Σ Zahlungen`.
- **Abnahme:** RED beobachtet (27 Fehlschläge gegen ausgeblendeten Kern),
  dann grün: unit 274, component 722, integration 393 (14 neue Fälle inkl.
  Über-Gutschrift, bytegleiche Originale, Vorlagenpfad-Ablehnung,
  Mandantentrennung, DB-CHECKs), coverage vollständig (Changed 93,3%),
  E2E 16/16 inkl. Ablauf finale Rechnung → Gutschrift → `KO-JJJJ-NNNN` →
  „storniert“/0,00 € → bytegleiche Quell-PDFs → zweite Gutschrift 409; im
  Nachtrag c2b: der Korrektur-Entwurf öffnet den geteilten Editor (eigene
  Überschrift/Verwerfen-Text), Positionsänderungen sind gespeicherbar und
  finalisierbar, Originale bleiben unverändert. Build grün.
- **Ehrlich notiert:** keine Kettenkorrekturen (Quelle `correction` = 400);
  Bezugsdaten reisen als reine Print-Option im Layout-Objekt (ohne Bezug
  bleibt das HTML zeichengleich); Bytegleichheit über hash-adressierte
  Artefakte geprüft; ein Vorlagenhinweis in der Verwaltung fehlt noch
  (Doku benennt es); `debit` ist absichtlich unbegrenzt, der E2E-Test deckt
  `credit` (derselbe Editorpfad).

**Nächste Unter-Slices BKP019:** c3 (Anzahlung/Schlussrechnung – sinnvoll
erst mit (d)), (d) Zahlungen/Teilzahlungen/offener Saldo, (e)
Fristen-/Statusfilter und Export; dazu Pflichtangaben RG-04/RG-07,
Annahme-Korrekturpfad, BKP020-Reste und BKP021+ (Mailkern bis BKP030).
Betrieb unverändert: verifiziert live **c21330c**, alleiniger Auto-Updater;
Checkpoint-/OCI-Nachweis weiterhin offen (Proxmox-Host 192.168.68.201 nicht
erreichbar).

## H066: BKP019.c1 – Rechnung aus Auftragsbestätigung (RG-01), 26.10.2026

- **BKP019.c1 `514723b`** – erster Rechnungsweg: aus einer finalen
  Auftragsbestätigung entsteht „Rechnung erstellen“ ein bearbeitbarer
  Rechnungsentwurf (Positionen 1:1, Summen exakt wie die Quelle, Betreff
  „Rechnung für {{contact}}“), finalisiert mit eigener Nummer im
  Rechnungsnummernkreis (NK-01/NK-05 bestehende Verträge). Migration `0042`
  weitet die Quellmechanik auf `invoice` aus (mandantengebundener FK,
  genau eine Rechnung je Quelle – Dublette 409 ohne Nummernverbrauch);
  Quellanzeige „Aus Auftragsbestätigung AB-…“. Keine Rechnung für
  zurückgezogene Aufträge; die Blanko-Sperre bleibt unverändert (ohne Quelle
  oder Vorlage gibt es keine Rechnung). **Ersatzbeleg-Entscheidung:**
  Dublettensperren bleiben endgültig; finalisierte Belege werden nie ersetzt,
  nur durch künftige Korrektur-/Storno-Folgedokumente ergänzt (c2 bringt das
  Vorzeichenmodell – negative Beträge sind heute auf vier Ebenen verboten).
- **Abnahme:** RED beobachtet (13 Integrationsfehler fehlender Methode,
  DB-Vertrag/Migration, 7 Component-/E2E-Feeler), dann grün: unit 274,
  component 716, integration 379 (Positions-/Summengleichheit, Dublette,
  Parallelität/Rollback, `RE-`-Nummer, Unveränderlichkeit, Mandantentrennung,
  DB-CHECKs; `:298–308` unantastbar), coverage 1369 vollständig (Changed
  93,24%/85,53%), E2E 16/16 inkl. Ablauf finale Bestätigung → Rechnung →
  Dublette → Finalisierung `RE-JJJJ-NNNN` → PDF, Quell-PDFs bytegleich,
  Build grün.
- **Ehrlich notiert:** „final“ heißt „eingefroren“, nicht „rechtlich
  vollständig“ – Pflichtangaben § 14 UStG (Leistungsdatum, Steuernummer,
  Zahlungsziel, Bankverbindung) fehlen; Anzahlungs-/Schluss-/Korrektur-
  rechnungen und Zahlungsverrechnung fehlen (eigene Folgeslices, in der UI
  sichtbar benannt); Doppelverrechnung über den Vorlagenpfad bleibt möglich
  (Unique deckt nur den Quellpfad, bewusst); MiMo-Reviewfix machte
  Editor-Überschrift/Verwerfen-Dialog auch für Rechnungen artabhängig.

**Nächste Unter-Slices BKP019:** c2 (Korrektur/Storno mit Vorzeichenmodell),
c3 (Anzahlung/Schlussrechnung – erst sinnvoll mit (d)), (d) Zahlungen/
Teilzahlungen/offener Saldo, (e) Fristen-/Statusfilter und Export; dazu
Pflichtangaben-Ausstattung RG-04/RG-07, Annahme-Korrekturpfad, BKP020-Reste
und BKP021+ (Mailkern bis BKP030). Betrieb unverändert: verifiziert live
**c21330c**, alleiniger Auto-Updater; Checkpoint-/OCI-Nachweis weiterhin
offen (Proxmox-Host 192.168.68.201 nicht erreichbar).

## H065: BKP019.b – Auftragsbestätigung ohne Positionsneueingabe (AG-05), 26.10.2026

- **BKP019.b `436fe54`** (inkl. Nachtrag b2): aus einem finalen, angenommenen
  Angebot entsteht „ohne erneute Positionserfassung“ eine Auftragsbestätigung
  – Positionen 1:1 (Bruttopreise, Steuer-/Rabatt-Basispunkte unverändert),
  Summen serverseitig exakt = Angebotsendsummen, Texte übernommen (Betreff
  „Auftragsbestätigung für {{contact}}“), Entwurf vollständig bearbeitbar
  (geteilte Editor-Komponente mit eigener Überschrift und artabhängigem
  Verwerfen-Dialog), Finalisierung mit eigener Nummer. Quellverknüpfung
  `source_document_id` (Migration `0041`, mandantengebundener FK, genau eine
  Bestätigung je Angebot per partiellem Unique-Index – Dublette 409 ohne
  Nummernverbrauch); Angebot und Bestätigung sind danach unabhängig.
  Zwei vor dem Bau gefundene Blockaden wurden behoben: der Blanko-CHECK
  erlaubte vorlagenlos nur Angebote, und `PUT /draft` verweigerte
  Nicht-Angebotsarten (eine Bestätigung hätte den Angebotstext unkorrigierbar
  gedruckt). Statusvertrag: nur `final`+`accepted`, Pflicht-`version`;
  `documents.test.ts:298–308` (Rechnung bleibt gesperrt) unantastbar.
- **Abnahme:** RED beobachtet (13 Integrationsfehler fehlender
  Methode/Route/UI, Migrationserwartung; Nachtrag: fehlende
  Bearbeiten-Aktion), dann grün: unit 274, component 707, integration 364
  (16 neue Pflichttests inkl. Übernahme-Gleichheit, Dublette, Parallelität/
  Rollback, Unabhängigkeit beide Richtungen, DB-CHECKs 23514/23503/23505),
  coverage 1343 vollständig (Changed ≥85/80), E2E 16/16 inkl. Ablauf
  angenommenes Angebot → Bestätigung (kopierte Positionen, kein Editor
  geöffnet) → Dublettenerklärung → Finalisierung mit eigener Nummer →
  Quellhinweis, Angebots-PDF bytegleich, Build grün.
- **Ehrlich notiert:** die Dublettensperre ist endgültig (ein Ersatzbeleg
  braucht eine Entscheidung in (c)); `validity_days` wird aus
  Vorlagengründen mitkopiert, fachlich inert für Bestätigungen; ein Angebot
  ohne Kontakt/Event wird mit `missing_reference` abgelehnt statt mit
  erfundenem Inhalt bestätigt; ein Coverage-Lauf flackerte einmal (1/113
  Dateien, zwei Wiederholungen grün).

**Nächste Unter-Slices BKP019:** (c) Rechnung/Anzahlung/Schlussrechnung/
Korrektur (inkl. Ersatzbeleg-Entscheidung), (d) Zahlungen/Salden, (e)
Fristen-/Statusfilter und Export; dazu Annahme-Korrekturpfad, BKP020-Reste
und BKP021+ (Mailkern bis BKP030). Betrieb unverändert: verifiziert live
**c21330c**, alleiniger Auto-Updater; Checkpoint-/OCI-Nachweis weiterhin
offen (Proxmox-Host 192.168.68.201 nicht erreichbar).

## H064: BKP019.a – Annahmedaten (AG-06/AG-08), 26.10.2026

- **BKP019.a `e9d72b3`** – die Angebotsannahme erfasst jetzt Kanal
  (E-Mail/Telefon/unterschriebenes PDF/Sonstiges, Pflicht), optionalen
  Annahmezeitpunkt (Vorgabe jetzt, nie Zukunft, Mandantenzeitzone), Notiz
  (≤2000) und optionalen Anhang (Verweis auf eine eigene verfügbare
  Bibliotheksdatei; „unverprüft“ bleibt sichtbar – kein Scan-Versprechen).
  Zwei Analysefunde wurden behoben: der Annahmezeitpunkt ist eine eigene
  Spalte `accepted_at` (ein `status_changed_at` ginge beim Rückzug verloren),
  und eine Wiederholung mit abweichenden Angaben wird mit 409
  `acceptance_conflict` abgewiesen statt still verschluckt (identische
  Wiederholung bleibt wirkungsloser No-op). Migration `0040` mit vier
  benannten CHECKs und zusammengesetztem mandantengebundenem Anhang-FK;
  Rückzug erhält die Annahmedaten unverändert lesbar (Regressionstest);
  finaler Inhalt/Nummer/PDF-Bytes bleiben unberührt.
- **Abnahme:** RED beobachtet (Typfehler + Component 10/35 gegen den
  Altstand), dann grün: unit 274, component 699, integration 348 (fünf
  ungültige Kanalwerte, Zukunfts-/Grenzzeitpunkte, Notizgrenzen, fremde/
  archivierte Anhang-ID, No-op vs. 409, DB-CHECKs + FK, Unveränderlichkeit
  finaler Artefakte), coverage vollständig (Changed 91,0%/85,8%), E2E
  16/16 inkl. echter Bibliotheksdatei als Anhang mit Byte-Download,
  Build grün, Impeccable-Detektor ohne Befund.
- **Ehrlich notiert:** eine gespeicherte Annahme ist im UI nicht
  korrigierbar (Korrekturpfad = eigener späterer Slice); der DB-CHECK
  erlaubt Annahmedaten bei `withdrawn` (nötig für den Regressionstest, die
  Domäne unterscheidet); der Anhang-Picker listet ohne Eventbezug alle
  eigenen Dateien (BKP020-Reste); `datetime-local` zählt als
  Mandanten-Wandzeit.

**Nächste Unter-Slices BKP019:** (b) Auftragsbestätigung aus angenommenem
Angebot ohne Positionsneueingabe, (c) Rechnung/Anzahlung/Schlussrechnung/
Korrektur, (d) Zahlungen/Salden, (e) Fristen-/Statusfilter und Export; dazu
Annahme-Korrekturpfad, BKP020-Reste und BKP021+ (Mailkern bis BKP030).
Betrieb unverändert: verifiziert live **c21330c**, alleiniger Auto-Updater;
Checkpoint-/OCI-Nachweis weiterhin offen (Proxmox-Host 192.168.68.201 nicht
erreichbar).

## H063: BKP019.0 – Angebotsgültigkeit und Statusübergänge, 26.10.2026

- **BKP019.0 `d60cad1`** – der erste Unter-Slice des kommerziellen
  Dokumentablaufs (Ticket verlangt zwingende Unterteilung). **Zweite
  Statusachse:** `state` (Inhaltsreife draft|final|withdrawn) bleibt
  unverändert, neu `offer_status` (versendet/angenommen/zurückgezogen) mit
  erlaubten Übergängen null→sent/withdrawn, sent→accepted/withdrawn,
  accepted→withdrawn; `withdrawn` terminal, ungültige Übergänge 409,
  erneute identische Aktion idempotent ohne zweiten Audit, versioniert,
  Audit in derselben Transaktion. Migration `0039`: `valid_until` wird beim
  Finalisieren einmalig fixiert (genau die gedruckte Frist – heutige
  Drucksemantik eingefroren, behebt den Drift gegen AG-02), datenerhaltender
  Backfill (bestehende finale Angebote behalten ihre gedruckte Frist,
  `offer_status` bleibt NULL = ehrlich „kein Anspruch“), CHECKs verweigern
  Status/Frist auf Nicht-Angeboten und halbe Angaben. „Abgelaufen“ wird in
  der Mandantenzeitzone **abgeleitet** (kein Worker, keine Schreibaktion).
  UI in der Event-Dateienansicht: Statuszeile mit Fachstatus/„Gültig bis“/
  Ablauf, Aktionen nur bei zulässigem Übergang, Bestätigung vor
  „Zurückziehen“. Keine Automatik aus E-Mail/Druck; keine Rechts-/
  Steuerbehauptungen (Referenz: nur „Status“/„Frist“-Spalten belegt).
- **Abnahme:** RED beobachtet (10/12 Integration + 8/8 Component gegen den
  zurückgesetzten Kern; DB-Tests migrationsabhängig ehrlich benannt), dann
  grün: unit 274, component 692, integration 336 (Übergangsmatrix,
  DST-Grenze Europe/Berlin, bytegleiche PDF über alle Statuswechsel,
  `state=sent` bleibt 400, Backfill gegen Vor-0039-Stand, CHECK-Verstoß
  23514), coverage 1302 vollständig (alle neuen Zeilen abgedeckt), E2E
  16/16 inkl. echtem Ablauf finalisieren → versendet → angenommen →
  zurückgezogen, Build grün.
- **Ehrlich notiert:** `AuditAction`-Union ohne die neuen Aktionen (eine
  dokumentierte Typverengung, `appendAudit` bleibt einziger Schreibpfad;
  Folgeslice erweitert die Union); neue Spalten für Drizzle unsichtbar
  (alte Antwortformen bewusst schlüsselgleich); die globale Dateiliste zeigt
  weiterhin nur die Inhaltsreife (Frist-/Statusfilter folgen in BKP019-(e));
  Bytegleichheit mit injiziertem Renderer belegt.

**Nächste Unter-Slices BKP019:** (a) Angebotsannahme mit Zeitpunkt/Kanal/
Notiz/Anhang, (b) Auftragsbestätigung aus angenommenem Angebot, (c)
Rechnung/Anzahlung/Schlussrechnung/Korrektur, (d) Zahlungen/Salden, (e)
Fristen-/Statusfilter und Export; dazu BKP020-Reste (Eventverknüpfung,
Kategorien, Ersetzen) und BKP021+ (Mailkern bis BKP030). Betrieb
unverändert: verifiziert live **c21330c**, alleiniger Auto-Updater;
Checkpoint-/OCI-Nachweis weiterhin offen (Proxmox-Host 192.168.68.201 nicht
erreichbar).

## H062: BKP020.1 – echte Dateibibliothek (Upload/Download/Archiv), 26.10.2026

- **Befund vorab:** BKP016/017/018 sind materiell über frühere Slices geliefert
  (Plan:941/:939/:937/:931/:929/:923–:842); BKP019/BKP020 waren unberührt.
  `FilesPanel` ist ein Geschäftsdokumentindex über `documents`, keine
  Dateibibliothek – der offene Kern war ein neuer Datenbestand.
- **BKP020.1 `5a6a176`** – vertikaler Slice mit Migration `0038_library_files`
  (+ Idempotenzbeleg-Tabelle nach Vorlagen-Muster): tenantgebundene
  Dateimetadaten (`display_name` nur Daten, Schlüssel ausschließlich
  UUID+Endung), `media_type` pdf/png/jpeg/zip mit serverseitiger
  Signaturprüfung (MIME-Spoofing → 415 ohne Zeile/Datei), einheitliche
  10-MiB-Grenze (exakt erlaubt, +1 → 413), Upload als JSON+Base64 (strenge
  Validierung, Name aus URL/Logs ferngehalten), autorisierter Download als
  Anhang mit `filename*`-Säuberung und `nosniff` (kein HTML/SVG im
  App-Origin), ZIP wird nie entpackt, idempotent-Archiv. **Kein Virenscan
  eingerichtet** – `scan_state='not_scanned'` ist sichtbar ausgewiesen;
  Mail-Anhänge müssen später daran gebunden bleiben. UI „Dateibibliothek“
  als eigene benannte Region neben „Geschäftsdokumente“ im `#files`-Bereich
  (bestehende Testverträge bleiben grün). Dokumentation neu:
  `docs/files.md`.
- **Abnahme:** RED beobachtet (Unit/Component gegen fehlende Module;
  Integration ehrlich als Mit-Entstehen benannt), dann grün: unit 274,
  component 681, integration 324 (Tenant/ID-Leak, Spoofing, Grenzgröße,
  bösartige Namen, Storage-Fehler ohne available-Zeile, requestId ohne
  Doppelzeile, Downloadheader, idempotent-Archiv, Auth/CSRF), coverage
  vollständig (Changed ≥85/80), E2E 16/16 mit echtem Upload-/Download-
  Byte-Vergleich, 320/1440 beiden Themes, Tastatur, axe 0 Verstöße,
  Impeccable-Detektor ohne Befund, Build grün.
- **Ehrlich notiert:** Auditzeilen `file.*` direkt in der Transaktion
  (Union in `appendAudit` ohne `file.*`, DB-CHECK sichert ab; späterer
  Refactor); Replay einer gespeicherten Upload-Antwort kann „available“
  zeigen, obwohl die Datei später archiviert wurde (Idempotenzbeleg-Muster);
  Liste ohne Suche/Paginierung; eine notwendige Zusatzzeile in
  `tests/integration/identity.test.ts` (Migrationserwartung) überschritt die
  Dateigrenze – ehrlich gemeldet und reviewt.

**Offene Bausteine BKP020:** Eventverknüpfung/Kategorien
(Upload/Standard/Mailanhang), Ersetzen/Versionierung, Mailanhangpicker,
DA-07-Standarddateien (Betreiberslice, echte Dateien außerhalb Git),
Retention/Löschung, Suche/Paginierung bei großen Beständen. **Weiterer
Backlog:** BKP019 (kommerzieller Dokumentablauf bis Zahlung), BKP021+
(Mailkern/Postfach/Verfassen/Vorlagen/Geplanter Versand), BKP026–BKP030.
Betrieb unverändert: verifiziert live **c21330c**, alleiniger Auto-Updater;
Checkpoint-/OCI-Nachweis weiterhin offen (Proxmox-Host 192.168.68.201 nicht
erreichbar).

## H061: BKP014.2 (Ressourcen in der Eventzusammenfassung), 26.10.2026

- **Befund vorab (wie schon bei BKP013.1):** BKP014.1 „scannbare Karten mit
  Datumsspalte“ war bereits am 23.10.2026 erledigt (Plan:917); die veralteten
  Statuszeilen in tasks-core/observations sind bereinigt. Offen war der
  eigentliche Kern des Tickets: echte Ressourcendaten in der Liste.
- **BKP014.2 `08449e0`** – jede Eventzeile von `GET /api/v1/events` trägt
  jetzt `resources`: zugewiesene physische Boxen/Einheiten (Name, Einheiten-
  nummer, `Gebucht`/`Vormerkung`) aus GENAU EINER mandantengebundenen
  Abfrage auf `reservations` für alle gelisteten IDs (Integrationstest hält
  auch bei 50 Events genau ein Statement fest – kein N+1); Konflikt nur bei
  echten überschneidenden aktiven Fremdbelegungen (korreliertes `exists`;
  `booked`/`blocked` sind per Exclusion-Constraint überlappungsfrei).
  Kompakte Kartenzeile: „Noch keine Ressource“ ohne Zuordnung, abgelaufene
  Vormerkungen/archivierte Einheiten ausdrücklich markiert, „Überschneidung
  offen“ nur bei gemeldetem Konflikt – bewusst ohne Verfügbarkeitsaussage
  (Referenz unbekannt; EV-04/RE-12 sind Lastenheft-IDs). Keine Migration;
  Antwort-Schema additiv erweitert, bestehende Felder unverändert.
  Abnahme: RED real beobachtet (Component/Integration/E2E), dann grün –
  component 669, integration 313 (Projektionsmatrix gegen echtes PostgreSQL,
  Mandantentrennung, Drahtschema), unit 265, coverage 1247 vollständig
  (events.ts 96,77% Statements), E2E 16/16, Build grün. `docs/event-search.md`
  beschreibt den neuen Vertrag.

**Betriebsbefund (ehrlich):** Zwei CI-Läufe (40284692007, 40317554236)
erreichten auf langsamen Runnern die 25-Minuten-Jobgrenze
(„The operation was canceled.“, ohne Testfehler); beide waren im gezielten
Re-Run komplett grün. Die Grenze ist bewusst NICHT angehoben worden; bei
anhäufigendem Auftreten ist `timeout-minutes` in `quality.yml` eine eigene,
bewusste Betriebsentscheidung. Ebenfalls notiert: `tests/unit/password.test.ts`
(scrypt) fiel einmal unter Last aus und war isoliert/im Wiederholungslauf grün
(vorbestehend flaky).

**Nächste offene Paritätsaufgaben:** BKP015+ (Dokumente/Mailreste laut
Tickets), Dateien, kommerzielle Dokumentabläufe, Mailkern, Postfach/Verfassen,
Aufgaben/Verträge/Fragebögen, Websiteformulare, BKP007-Folge nach
Referenzbeobachtung; notierte Kleinslices: BKP010.3 optional,
`registerUnsavedChanges` des Event-Editors, Platzhalter-Werkzeuge im
Angebotsentwurfs-Editor, BKP011-Landauswahl, Konflikt-Index bei sehr großen
Beständen. Betrieb unverändert: verifiziert live **c21330c**, alleiniger
Auto-Updater; Checkpoint-/OCI-Nachweis weiterhin offen (Proxmox-Host
192.168.68.201 nicht erreichbar).

## H060: BKP013.2 (Dokumententwurf bei Neuladefehler) und Statuskorrektur, 26.10.2026

- **Befund vorab:** BKP013.1 war bereits über `605f75b` (23.10.2026) umgesetzt,
  abgenommen und live ausgeliefert; ältere Statuszeilen in tasks-core/handoff
  führten es fälschlich als „nächsten“ Slice – korrigiert. Der tatsächliche
  Rest von BKP013 war das Kriterium „Dokumenterfolg bleibt bei Neuladefehler
  sichtbar“.
- **BKP013.2 `c3021ed`** – jede bestätigte Dokumentanlage (mit und ohne
  Vorlage) setzt die gespeicherte Zeile aus der POST-Antwort lokal in die
  Liste; ein fehlgeschlagenes Neuladen ist nur ein Reload-Problem mit
  GET-only-Wiederholung, kein blindes POST. Die zuvor blinde Mock-Struktur der
  Vertragstests ist durch getrennte Fixtures geschärft (echte Beweiskraft);
  RED real beobachtet (5 Komponententests + beide E2E-Szenarien gegen den
  unfixed Stand), danach grün: component 665, integration 311, unit 265,
  coverage vollständig, E2E 16/16 inklusive neuem Beweis (Vorlagenanlage →
  GET 503 → Entwurf sichtbar/bedienbar, genau ein POST, Retry nur GET),
  Build grün.

Bewusst offen in BKP013 (keine erfundenen Lösungen): Bereichs-Deep-Links
(Referenz unbekannt), Notizbearbeitung in der Akte (dokumentierter Weg über
„Stammdaten bearbeiten“), Kürzen der unteren Bereichsleiste; dazu die
notierten Folgeslices (BKP010.3 optional, `registerUnsavedChanges` des
Event-Editors, Platzhalter-Werkzeuge im Angebotsentwurfs-Editor,
BKP011-Landauswahl). **Nächster sinnvoller Slice: BKP014.1** (Eventliste mit
tatsächlichen Ressourcen – additive tenantgesicherte Projektion ohne N+1),
danach der weitere Backlog (Dateien, kommerzielle Dokumentabläufe, Mailkern,
Aufgaben/Verträge/Fragebögen, Websiteformulare, BKP007-Folge nach
Referenzbeobachtung).

Betrieb unverändert: verifiziert live **c21330c**, alleiniger Auto-Updater
ohne parallele manuelle Aktualisierung; Checkpoint-/OCI-Nachweis weiterhin
offen, solange der Proxmox-Host (192.168.68.201) nicht erreichbar ist.

## H059: Vorlagenrest abgeschlossen (Filter + Platzhalterwerkzeuge), 26.10.2026

Die beiden im Übergabeprompt gesondert offenen Vorlagen-Zusatzanforderungen
sind umgesetzt – ausdrücklich als **Nutzerwunsch**, nicht als belegte
Bookitup-Funktion (B35 sah keine Filter; die Platzhalterwelt ist unbeobachtet):

- **BKP015.9 `7bf9d0f`** – Suche über den Vorlagennamen, Art-Auswahl
  (fünf Gruppenlabels + „Weitere Dokumentarten“) und Zustandsauswahl
  (Alle/Aktiv/Inaktiv/Archiviert) als kompakte Werkzeugleiste über den
  Gruppen; clientseitig, `GET` bleibt querylos; Gruppierung aus der
  gefilterten Menge, getrennte Leerzustände mit „Filter zurücksetzen“,
  Filtererhalt über Editieren/Vorschau/Archivieren, additiv sichtbares
  „ – Inaktiv“. 11 Tests zuerst rot; E2E-Abnahme 320/390/1280 × light/dark
  (sechs Screenshots, axe 0 Verstöße).
- **BKP015.10 `efc04d1`** – Platzhalter-Einfügewerkzeuge an Betreff/
  Einleitung/Schluss: zweistufiger Picker (Umschalter + Klartextbeschreibung
  je der acht AK-Tokens + „Einfügen“) an der Cursorposition; Auswahl allein
  verändert nichts, Einfügen verwirft eine gültige Vorschau genau einmal
  (kein Doppelfeuer), Dirty-Baseline bleibt DOM-basiert, Längenwächter
  schützt die Feldgrenzen (kein halbes Token im Kunden-PDF: passt ein
  vollständiger Platzhalter nicht, wird nichts eingefügt). Drift-Test sichert
  die UI-Tokenliste gegen `templatePlaceholders` aus dem Kern. 10 Tests zuerst
  rot; kompakter Chromium-Beweis inkl. Tastaturpfad und PUT-Nutzlast.

Gates je Slice vollständig grün (zuletzt component 658, integration 311,
unit 265, coverage 1234 Tests, E2E auth+template-product-price 16/16,
Build). CI: 40303632178 (`7bf9d0f`) grün, 40308379097 (`efc04d1`) komplett
grün (quality 17m03s + images 1m44s).

**Nächste offene Paritätsaufgaben:** BKP013/BKP014 (Eventkontext gliedern,
Eventliste mit echten Ressourcen), danach der weitere Backlog (Dateien,
kommerzielle Dokumentabläufe, Mailkern, Aufgaben/Verträge/Fragebögen,
Websiteformulare); notierte Folgeslices: BKP010.3 optional,
`registerUnsavedChanges` des Event-Editors, Platzhalter-Werkzeuge auch im
Angebotsentwurfs-Editor (Nutzerwunsch), BKP011-Landauswahl. Betrieb
unverändert: verifiziert live **c21330c**, alleiniger Auto-Updater;
Checkpoint-/OCI-Nachweis weiterhin offen (Proxmox-Host nicht erreichbar).

## H058: BKP012.2 abgeschlossen – Welle BKP009–BKP012 komplett, 26.10.2026

- **BKP012.2 `999354f`** – Hauptkontakt im Event-Editor über den suchbaren
  Picker: gemeinsame `ContactPicker.tsx` (`useContactSearch()` mit
  Sequenzschutz) für Anlege-Dialog und Editor, „Kunde entfernen“ = „Kein
  Kunde ausgewählt“, archivierte historische Zuordnung lesbar/mitgesendet
  aber nicht erneut wählbar, Inline-Anlage als Ansichtswechsel in derselben
  Fläche (Evententwurf bleibt vollständig erhalten, kein zweiter Validator,
  keine zweite Dialogebene), Auswahl aus der bestätigten POST-Antwort inkl.
  Sichtungsliste (behebt echten Fehler: frisch angelegte Kontakte
  verschwanden nach Hauptkontaktwechsel aus „Weitere Kontakte“). Der Picker
  trennt `value`/`selected`, damit eine gespeicherte, nicht mehr gelistete
  Zuordnung beim Speichern nicht still auf `null` wird. 13 neue
  Editor-Verhaltenstests; Anlege-Dialog 29/29 verhaltenstreu; Nachtrags-
  abnahme 320/390/1280 × light/dark der Inline-Kontaktansicht (sechs
  Screenshots, axe 0 Verstöße). Gates: component 637, integration 311,
  unit 265, coverage grün, E2E 14/14, Build grün.

Damit ist die befohlene Welle **BKP009 (Ressourcen), BKP010 (Produkte),
BKP011 (Kontaktdetails) und BKP012 (Kontaktwahl im Event) vollständig in
nummerierten Unter-Slices umgesetzt** (siehe Implementierungsplan für die
vollständigen Abnahmen). Weiter geht es mit dem Paritätsbacklog BKP013+
(Vorschlag nächste: BKP013.1 Eventkontext gliedern oder Vorlagenrest
Suche/Archivfilter + Platzhalter-Einfügewerkzeuge) sowie den notierten
Folgeslices (BKP010.3 optional, `registerUnsavedChanges` des Event-Editors,
BKP011-Landauswahl).

Betrieb weiterhin wie H056/H057: zuletzt verifiziert live **c21330c**,
alleiniger Auto-Updater ohne parallele manuelle Aktualisierung; der
Checkpoint-/OCI-Nachweis bleibt offen, solange der Proxmox-Host
(192.168.68.201) nicht erreichbar ist.

## H057: Kontaktwelle BKP011/BKP012 abgeschlossen, 26.10.2026

Fortsetzung von H056 am selben Tag; gleiche Arbeitsweise (MiMo V2.6 Pro
koordiniert/reviewt, DeepSeek V4.1 Flash als Coding-Subagent über die
Hermes-CLI, Modellkennung in jedem der acht Delegats dieser Welle bestätigt:
zwei rein lesende Analysen, sechs Coding-Läufe).

- **BKP011.1 `57183a4`** – Lesende Kontaktakte inline in der Zeile
  (`#contact-<id>` bleibt Vertrag): Kopf mit Typ/Name/Archivzustand, Kontaktweg
  mit sichtbaren gespeicherten Werten und korrekt escaped `mailto:`/`tel:`
  (neue Helfer `contact-links.ts`, ohne Nummern-Normalisierung), Anschrift mit
  Land über `Intl.DisplayNames` + ISO-Fallback, zugehörige Events aus der
  vorhandenen tenantgesicherten Projektion (kein N+1) mit Lade-/Leer-/Fehler-
  zustand und GET-Wiederholung; „Events anzeigen“-Altplan entfernt; Schließen
  stellt Suche/Scroll/Fokus wieder her. Neu: `ContactDetails.tsx`,
  `contact-links.ts`, 15 Akten-Komponententests, Unit-Tests der Helfer,
  Tenant-Isolations-Integrationstest (zwei reale Mandanten).
- **BKP012.1 `8192229`** – Suchbarer Kundenpicker im Event-Anlege-Dialog
  (B30: „Kundensuche/neuen Kunden anbieten“) über `GET /api/v1/contacts?q=`
  mit Sequenzschutz gegen vertauschte Antworten, höchstens 20 sichtbare
  Treffer, archivierte Treffer nicht wählbar; bewusste Inline-Anlage als
  Ansichtswechsel in derselben Dialogbox (Evententwurf bleibt gemountet),
  gemeinsame `ContactDialog.tsx` mit dem EINEN vorhandenen Validator,
  Auswahl erst aus der bestätigten POST-Antwort, kein heimliches
  Gemeinschaftsspeichern, kontaktlos bleibt möglich. 10 neue
  Verhaltenstests inkl. aller Ticket-Negativfälle; zwei Vertragstests in
  `events.test.tsx` mussten als notwendige Aufrufer angepasst werden
  (Aussagen unverändert).
- **`344a10e`** – Test-Race-Korrektur: der Akten-Test griff Event-Links per
  `getByRole` an, bevor der Fetch-Auflöser sie renderte; lokal reproduziert
  (1/10 Läufe rot, exakte CI-Meldung von Lauf 40283185607), behoben durch
  konsequentes `findByRole` ohne abgeschwächte Assertions (20/20 + 5×15/15
  Wiederholungsläufe grün).

Beide Abnahmeprüfungen deckten echte bestehende a11y-Defekte auf (axe
`heading-order`): fehlende `h2`-Ebene unter der Seiten-`h1` in der Kontaktakte
und in den Dialogtiteln; behoben analog `EventDetails` mit angeglichenen
CSS-Selektoren und in Chromium gemessenen Stilwerten. Impeccable-Finish-Detektor
über alle geänderten Panels ohne Befund (`[]`).

Tests: `test:component` 624, `test:integration` 311, `test:unit` 265,
`test:coverage` vollständig grün (geänderter Code je ≥85/80), schnelle
Gates/`test:docs`/`test:workspace`/Build grün; E2E auth+template-product-price
14/14 inkl. Akten-Matrix 320/390/1280 × light/dark (sechs Screenshots) und
vier zusätzlicher axe-Audits, jeweils 0 Verstöße.

CI der Welle: 40277279353 (`57183a4`) grün, 40283185607 (`8192229`) rot wegen
des oben dokumentierten Test-Races, 40284692007 (`344a10e`) nach gezieltem
Re-Run komplett grün (quality 20m11s + images 1m55s; der Erstlauf erreichte
die 25-Minuten-Jobgrenze mit laufenden, zuvor grünen Phasen –
„The operation was canceled.“ in `test:ops`), ebenso zuvor 40268559954
(`e2b5646`) grün. Der langsame Erstlauf und die frühere
Jobgrenzenbeobachtung sind ein Grund, die CI-Laufzeiten im Blick zu behalten;
kein Test wurde geändert, um Zeit zu sparen.

Betrieb unverändert zu H056: zuletzt verifiziert live **c21330c**; der
alleinige Auto-Updater übernimmt grüne Heads der UX-Branch automatisch, keine
parallele manuelle Aktualisierung. Der Checkpoint-/OCI-/Drei-Container-Nachweis
weiterhin offen, weil der Proxmox-Host (192.168.68.201) von hier nicht
erreichbar ist.

Offen als Nächstes: BKP012.2 (Hauptkontakt/Bearbeiten im Event-Editor über den
Picker), optional BKP010.3 (Backend-Auftragsbeleg), BKP013/BKP014 und der
weitere Paritätsbacklog; weiterhin: Vorlagenfilter/Platzhalter,
BKP007-Folgeslices nach Referenzbeobachtung, Betriebsprüfung nachholen.
Keine vollständige Parität behaupten.

## H056: BKP009-/BKP010-Welle abgeschlossen, 26.10.2026

Vier nummerierte Unter-Slices auf `codex/ux-event-simplification`, einzeln committet
und gepusht; MiMo V2.6 Pro (Hermes) koordinierte und reviewte, DeepSeek V4.1 Flash
arbeitete als Coding-Subagent über die Hermes-CLI
(`hermes -z … -m deepseek-v4.1-flash --provider opencode-go`); die Modellkennung
war in jedem der acht Delegats (drei rein lesende Analysen, fünf Coding-Läufe)
bestätigt, Dateizuständigkeiten waren getrennt, jeder Commit wurde von MiMo nach
vollständigem Diff-Review und eigenen Gate-Läufen gestaged und gepusht.

- **BKP009.1 `5e6f7a8`** – Ressourcen liste-zuerst: kompakte Werkzeugleiste
  (Suche Name/Code/Kategorie, Kategorie- und Zustandsauswahl), Anlegen/Bearbeiten
  im accessiblen Dialog mit Fokusfalle/Dirtyschutz/Doppelklick-Guard,
  `code_exists`-Meldung, ehrliche Save-vs-GET-Trennung, getrennte Leerzustände.
  13 eigene Komponententests plus geteilte Vertragstests mitgezogen;
  320/390/768/1280 × light/dark Matrix mit Screenshots.
- **BKP009.2 `99e9eac`** – Zeitweise Sperren bewusst geöffnet (native
  Offenlegung „Sperrverwaltung öffnen/schließen“, bedingtes Rendern,
  Entwurfsschutz/Fokusrückkehr), Rahmenvertrag „eine Primäraktion pro Rahmen“
  mit gültigen Blockdaten echt geprüft; E2E-Tastaturbeweis (Enter/Space, kein
  Escape-Schließen), axe mit offener Sperrverwaltung, Matrix in beiden
  Offen-Zuständen (16 Screenshots).
- **BKP010.1 `442d19c`** – Produkte liste-zuerst: Dialog für Anlegen/Bearbeiten/
  Duplikat, Suche Name/Beschreibung/Einheit + Zustandsauswahl, Zeile mit
  Preisbasis/Steuer/Einheit, exakte Dezimalhelfer, feldbezogene Dezimalfehler,
  Save-vs-GET-Trennung, Sperre bei unklarem Ausgang ohne zweiten POST.
  `GET /api/v1/products` bleibt querylos.
- **BKP010.2 `f576235`** – Seltene Produktzeilenaktionen hinter benannter
  Offenlegung (BKP015.7-Vertrag), neue Archivaktion über PUT mit `version`;
  Integrationsnachweis: finalisierte Dokumentzeilen/-summen/Snapshot-Hash bleiben
  nach Produktarchivierung byte-identisch.

Tests je Slice zuerst rot beobachtet (Gesamt jetzt `test:component` 599,
`test:integration` 310, `test:unit` 260, `test:coverage` vollständig grün,
`test:workspace`/`test:docs`/schnelle Gates/Build grün; E2E auth + template-
product-price 14/14 mit Theme-/Breitenmatrizen und axe). Ehrlich vermerkt:
einzelne nachgereichte Tests waren nicht separat rot; der Dokument-Unverändertheits-
Nachweis charakterisiert bestehendes DB-Verhalten.

CI: 40256380963 (`5e6f7a8`) grün, 40259626189 (`99e9eac`) grün, 40262925543
(`442d19c`) grün nach gezieltem Re-Run – der Erstlauf scheiterte an einem
transienten `net::ERR_NETWORK_CHANGED` des Chromium-Stacks im Runner (Konsolen-
und Netzwerktrace im CI-Artefakt `chromium-evidence`; kein Produktfehler, kein
Test geändert), 40266669441 (`f576235`) grün. Jeweils quality+images.

Betrieb: zuletzt verifiziert live bleibt **c21330c**. Der alleinige Auto-Updater
auf dem Proxmox-Host übernimmt Heads der UX-Branch nach grünem quality-Lauf und
beiden Images automatisch; keine parallele manuelle Aktualisierung. Registry-
Nachweis aus den CI-Logs: beide Images mit
`org.opencontainers.image.revision` = jeweiliger SHA publiziert. Der
Checkpoint-/OCI-/Drei-Container-Nachweis für die neuen Stände war von hier
**nicht möglich**: SSH zum Proxmox-Host (192.168.68.201) antwortet nicht
(Timeout/Host down). Nachzuholen, sobald der Host erreichbar ist; vorher keine
Live-Aussage zu `5e6f7a8`–`f576235`.

Design: Impeccable-Kontext einmal geladen (Launcher ohne Exec-Bit, über `sh`
gestartet; `apps/admin/DESIGN.md` ist die Designwelt), Finish-Detektor über die
drei geänderten Panels ohne Befund (`[]`). Ponytail full für die kleinsten
vollständigen Lösungen; REA war für diese Slices ohne zusätzlichen
Referenzbedarf (B27/B28-Belege genügten), Taste v2 blieb außerhalb der
Adminscreens.

Offen als Nächstes: **BKP011** (lesende Kontaktdetails, kleinster Slice) und
**BKP012** (Kontaktpicker im Event); optional **BKP010.3** (Backend-Auftragsbeleg
für unklare Speicherausgänge); weiterhin offen: Vorlagenfilter/Platzhalter-
Einfügewerkzeuge, BKP007-Folge nach Referenzbeobachtung, Betriebsprüfung siehe
oben. Keine vollständige Parität behaupten.

## Abschluss und vorbereiteter Hermes-Goal, 26.10.2026

Funktionsstand: **45add395a201a98e179a4d8fc54c0a2d279714d5** auf
codex/ux-event-simplification, einzeln sofort gepusht. Davor24ea155 für BKP015.7.
Arbeitscheckout: `/Users/gp/Developer/GitHub/auftragskompass-bkp`.

- BKP015.7 öffnet seltene Vorlagenaktionen gezielt pro Zeile. Bearbeiten bleibt
  sichtbar; native Tastatur, Escape/Tab/Outside und sichtbare Fokusrückkehr sowie
  Sperren während unklarer Archivierung erhalten.1114 Tests und zehn Chromium-
  abläufe grün; geändert48/49 Zeilen und41/49 Branches.
- BKP015.8 ergänzt die fiktive Inhaltsvorschau des ungespeicherten Entwurfs mit
  demselben HTML-/PDF-Renderer wie echte Dokumente, neutralem Briefpapier ohne
  Logo und festen Beispieldaten. Strikter authentifizierter/CSRF-POST; keine
  Nummern, Vorlagen, Dokumente, Audit- oder Storage-Writes. UI prüft PDF-Typ,
  Signatur/10MiB, bewusster44px-Download; veraltete Antworten/URLs werden verworfen.
  Entwurf/Dirtyzustand und sichere Speicher-/Archivverträge bleiben erhalten.
  1126 Tests/Coverage,74 Panelkomponenten, zwölf Vorlagen-Chromiumabläufe und ein
  echter lokaler angemeldeter API-/PostgreSQL-/Chromium-PDF-Lauf grün. Geändert
  117/122 Zeilen und102/117 Branches, global97,06% Zeilen/93,05% Branches.
  Schnelle Gates/Build, unabhängige Luna-Reviews, Impeccable-Panelscan und visuelle
  Mobil-/Desktop-/Theme-/PDF-Prüfung grün. API-Integration allein injiziert PDF-
  Bytes; der zusätzliche document-layout.spec.ts-Lauf beweist echtes Chromium.

CI40251062521 zu45add39 war nach Push noch pending. H055 dokumentiert den Goal
als eigenen Folgecommit und erhält eine neue maßgebliche CI. **Neue Funktionen
noch nicht als live behaupten.** Erneut verifiziert läuft c21330c auf drei
gesunden Containern, Timer aktiv/Service inaktiv, kein needs-attention, Drain off.
Checkpoint CT/Host/Betreiber identisch:2853190 Bytes, SHA256
`35982b46689057711423436bb6946cd3284e3693b413d95688c966abac1c7f0a`.
Kein paralleles manuelles Update. Vor weiterem Implementierungspush grüne
quality+images abwarten, damit der laufende Lieferstand nicht ständig abgebrochen
wird; inzwischen rein lesende Ressourcenanalyse sinnvoll delegieren.

Der [vollständige aktuelle Hermes-Goal](bookitup-parity/hermes-handoff.md) ersetzt
den alten BKP001-Einstieg. Erste nächste Welle: BKP009–BKP012, jeweils kleinste
nummerierte Unter-Slices und getrennte Dateizuständigkeiten; danach tatsächliche
Lücken des gesamten Paritätsbacklogs weiterführen. Vorlagenfilter und auswählbare
Platzhalter bleiben Zusatzanforderungen, keine vollständige Parität behaupten.
MiMo V2.6 Pro koordiniert; DeepSeek V4.1 Flash übernimmt Coding-Subagents.
Ponytail full, Impeccable Operate, REA mit ehrlichen Werkzeuggrenzen, Tastev2
nur außerhalb der ausgeschlossenen Adminscreens; emil/animate nur passend.

Hermes ist erreichbar über die aktive lokale Build-Installation unter
`/Users/gp/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app`.
Die daneben installierte /Applications-Version war nicht erreichbar; das ist
kein Beweis einer Mac-Sperre. Neue leere Session mit MiMo ausgewählt vorbereitet.
**Dieser Dokumentationsstand enthält noch keinen Goal-Startnachweis.** Nach dem
Commit per Computer Use übergeben und tatsächlichen MiMo-/DeepSeek-Arbeitsstart
kontrollieren, sonst konkreten Blocker melden. Keine Zugangsdaten übertragen.
Die einmalige Codex-Automation anschließend löschen, keine Wiederaufnahme planen.
Bei73% begann der Übergabeabschluss, reguläre Nutzung verfügbar und Zusatzcredits
unverändert; das ist ein datierter Snapshot und kein neues dauerhaftes Limit.

## Wiederaufnahme und Auslieferungsnachweis, 26.10.2026

Neues reguläres Fünf-Stunden-Fenster tatsächlich geprüft: 0% bei Start,
resetsAt1792991455, Wochenlimit43%, ordinaryUsageAllowed=true. Zusatzcredits
unverändert. Werte sind datiert, vor Weiterarbeit erneut prüfen. Dies ist die
bereits autorisierte einmalige zusätzliche Phase. Nutzer verlangt am Ende eine
konkrete Hermes-Goal-Übergabe: MiMo koordiniert, DeepSeek-Coding-Subagents erhalten
getrennte Dateien und prüfbare Abnahme. Rechtzeitig vor Erschöpfung Reserve für
Prompt/Repo/Computer Use lassen; tatsächlichen Modell-/Arbeitsstart kontrollieren.
Hermes-native Erreichbarkeitsprüfung lieferte zunächst einen Timeout, keinen
Startnachweis und keinen sicheren Beleg für eine Mac-Sperre. Später erneut prüfen;
bei echtem Blocker fertigen Prompt dauerhaft sichern und ehrlich berichten.
Nach Abschluss dieser Phase die einmalige Codex-Automation löschen.

**Verifiziert ausgeliefert:** c21330c6967e2edb4da2607769f85f40a198c6cf.
CI40228205140 quality+images komplett grün. Alle drei App-Container gesund und
exakte OCI-Revision, Timer aktiv/Service inaktiv, kein needs-attention, Option-
Drain off. Vorab-Checkpoint CT114/Host/Betreiber identisch:2853190 Bytes,
SHA256 `35982b46689057711423436bb6946cd3284e3693b413d95688c966abac1c7f0a`.
Betreiberkopie und runtime-proof.json privat unter
`/Users/gp/Documents/AuftragsKompass-Sicherung/delivery-2026-10-25/c21330c/`.
Neun Chromium-Vorlagenabläufe gegen die wirklich ausgelieferten statischen Dateien
mit ausschließlich lokal synthetischen APIs und exaktem Versionslabel grün;
Ergebnisse privat unter delivery-2026-10-26/templates-live-c21330c. Keine echten
Geschäfts-API-Schreibtests. Damit sind auch sichere Speicherung und Gruppierung
BKP015.5b/.6 samt H053 im Testbetrieb angekommen. Keine vollständige Parität
oder Produktivfreigabe daraus ableiten.

## Abschluss dieses Fensters: H053, 25.10.2026

H053 wartet im bestehenden Sprachtest mit findByRole auf dieselbe exakte geladene
Eventüberschrift. Keine Assertion abgeschwächt, kein Skip/Retry/Timeoutaufschlag,
keine Produktänderung. Schnelle Gates/Build sowie gesamte Unit-/Komponentensuite
grün; unabhängiger Luna-Review klar. BKP015.5a/.5b/.6 einzeln gepusht, zuletzt
ed210a4 für die Gruppierung. Neuesten H053-Commit und zugehörige CI zuerst prüfen.
Keine neue Lieferung nach823a23f behaupten, solange quality+images nicht grün,
Auto-Updater/OCI/Checkpoint und Browser nicht verifiziert sind.

Bei94 Prozent nur noch Abschluss, keine weitere Entwicklung oder Zusatzcredits.
Genau eine Fortsetzung gegen26.10.2026 01:15 Europe/Berlin ist aktiv. Vor Start
neues echtes Fenster und ordinaryUsageAllowed prüfen (altes resetsAt1792972443).
Nach dieser einen zusätzlichen Phase Automation löschen, nicht erneut einplanen.
Nächste Arbeit: zuerst Lieferung abschließen, dann einen kleinen priorisierten
Vorlagen-Slice wählen; Such-/Archivfilter, Aktionsmenü und Vorschau bleiben offen.
B35 trennt aktuelle manuelle Referenzbeobachtung von früheren Planannahmen.

## BKP015.6: gruppierte Vorlagenliste, 25.10.2026

Neue manuelle Browserbeobachtung B35 in observations.md: Bookitup gruppiert
Vorlagen nach Dokumentart und zeigt ruhige Aktionsmenüs. Keine sichtbaren Such-/
Archivfilter auf genau dieser Desktopansicht. Nur lesend navigiert, Menü geöffnet
und ohne Aktion geschlossen; anschließend ursprüngliche Dokumentübersicht
wiederhergestellt. Kein REA-MCP/CLI gefunden, daher kein REA-Evidence-Datensatz.
Keine echten Namen, Originalscreenshots oder Geschäftsdaten in Git.

AuftragsKompass gruppiert jetzt vorhandene Arten, erhält unbekannte und archivierte
Einträge und zeigt einen Leerhinweis. Bestehende Texte/Aktionen bleiben erhalten;
Zeilen und Buttons sind ausgerichtet, mobil umbrechend. Kein Menü-/Filter-/API-
oder Mutationsumbau. Bei geänderter Art bleibt Fokus an der umgruppierten Zeile.
62 Panelkomponenten, insgesamt1113 Tests, neun Chromiumabläufe, axe/Überlauf bei
320/1280px in beiden Themes und Build grün. Geänderte Coverage26/26 Zeilen,
34/34 Branches. Unabhängiger Luna-Review klar, Root hat Screenshots geprüft;
Impeccable meldet nur61 vorhandene gemeinsame CSS-Hinweise, keinen neuen Befund.

**CI-Blocker vor weiterer Auslieferung:** UI-Commit249aa47, Lauf40227220526,
scheiterte in ui-language.test.tsx:88 an getByRole für eine noch nicht geladene
Eventüberschrift; Fehlerzustand zeigt aria-busy=true und Ladehinweis. Vorlagen-
prüfungen waren grün, Images übersprungen. Dies wird als eigener H053-Testfix
abgeschlossen, nicht durch Abschwächen oder Überspringen gelöst. Bis zu grünem
Folgelauf keine neue Lieferung behaupten. Zuletzt verifiziert live:823a23f.

## BKP015.5b: sichere Speicherrückmeldung in der Oberfläche, 25.10.2026

POST verwendet pro logischer Anlage eine UUID und eingefrorene JSON-Daten. Nach
unklarer Antwort kann nur derselbe Auftrag ausdrücklich wiederholt werden;
auch eine Ablehnung beim Wiederholen verliert seine Vorgangsidentität nicht.
Bestätigte POST-/PUT-Antwort schließt den Editor und übernimmt den Datensatz,
auch bei anschließendem GET-Fehler. GET-Wiederholung entfernt bestätigte Daten
weder bei leerem noch älterem Stand. Ein neuerer Serverstand wird ehrlich geladen.
Unklarer PUT/Konflikt erhält Entwurf und ursprüngliche Version; kein stilles CAS-
Upgrade. Initiale GET-Erfolge und Fehler können spätere Speicherstände nicht
überschreiben. Laufende Anlagen gelten auch bei unveränderten Feldern als dirty.

59 fokussierte Komponenten, insgesamt1110 Tests mit Coverage grün; gesamt97,07%
Zeilen/93,15% Branches, geändert170/185 und214/250. Acht synthetische Chromium-
Vorlagenabläufe grün, drei Wiederherstellungszustände mit axe/Überlaufprüfung bei
320/1280px in beiden Themes. Schnelle Gates/Build grün. Root hat die gerenderten
Zustände geprüft; unabhängiger Luna-Review nach Korrekturen klar. Impeccable-
Zielscan meldet[]; vorhandene Farben, Layout und Motion bleiben erhalten.
Fokus kehrt nach Abgleich nur bei lokal gebliebenem Fokus ins erhaltene Formular
oder zur Zeilenaktion zurück; externe Fokuswechsel bleiben erhalten und verlieren
keine veralteten Rückkehrziele an spätere Aufträge.

**Grenze:** Vorgangs-ID und Entwurf leben im gemounteten Panel. Bestehender
Dirtyschutz betrifft App-Navigation; Browser-Neuladen/-Schließen hat weder neue
Warnung noch persistente Wiederherstellung. Nicht als umfassende Offline-
Wiederherstellung bezeichnen. Suche/Art-/Archivfilter und Vorschau bleiben offen.
CI/Images und Auslieferung dieses neuen UI-Commits separat prüfen; zuletzt komplett
verifiziert ist823a23f im folgenden Abschnitt. Jeder Commit sofort auf
codex/ux-event-simplification pushen. Kontingent zuletzt67% im laufenden Fenster;
aktuell erneut prüfen, keine Zusatzcredits nutzen. Einmalige01:15-Fortsetzung
bleibt eingerichtet und muss nach dieser einen weiteren Phase gelöscht werden.

## Verifizierte Auslieferung: 823a23f, 25.10.2026 abends

CI40225057526 (quality und images) vollständig grün. Der alleinige Auto-Updater
hat ohne manuellen Eingriff auf823a23fba23389240333c605fd90891bec13f65e aktualisiert.
API, Worker und Admin gesund, OCI-Revision jeweils exakt gleich. Timer aktiv,
Updater-Service nach Abschluss inaktiv, keine needs-attention-Sperre; Option-
Drain weiterhin off. Damit sind auch BKP015.2–.4 und H051/H052 ausgeliefert.

Checkpoint vor dem Update auf CT114, Proxmoxhost und Betreiberrechner identisch
verifiziert: 2837765 Bytes, SHA256
`3cdf596f34722ad70205e69f4baed13fc406dbc6b4405220aae77c62a3ee96fd`.
Private Betreiberkopie unter
`/Users/gp/Documents/AuftragsKompass-Sicherung/delivery-2026-10-25/823a23f/`;
keine Sicherung oder realen Daten im Repo. Der ignorierte Verifier erwartet jetzt
explizit `AK_EXPECT_REVISION` als vollständigen SHA statt einer hartcodierten alten
Revision. Fünf Chromiumabläufe gegen die echten ausgelieferten statischen Dateien
bestehen mit lokal synthetischen API-Antworten und exaktem Versionslabel; keine
Schreibaufrufe gegen reale Geschäfts-APIs. Die neue BKP015.5b-Oberfläche ist davon
noch nicht umfasst; ihren Commit/CI/Lieferstatus separat prüfen.

## BKP015.5a: wiederholbare Vorlagenanlage, 25.10.2026

Optionale UUID `requestId` auf Vorlagen-POST; Migration0037 speichert tenant-
gebundenen Hash und ursprüngliche vollständige Antwort in derselben Transaktion
wie Vorlage, Positionen und Audit. Gleicher Schlüssel/Inhalt wiederholt201 ohne
Doppelanlage, anderer Inhalt409. Adminprüfung vor Lookup; PUT lehnt Schlüssel ab,
Versionsprüfung und alte unkeyed Clients bleiben erhalten. Replay nach späterem
Edit/Archiv liefert ursprüngliche Quittung, setzt aktuellen Datensatz nicht zurück.

RED mit zwei IDs bei gleichem Schlüssel belegt; neue API-/PG-Tests einschließlich
Parallelität, Neustart, tenantfremdem Zugriff, CSRF, Constraints und Rollback.
1087 Tests mit Coverage grün (gesamt97,21% Zeilen/93,36% Branches; geändert21/22
und22/22), schnelle Gates/Build und fünf Vorlagen-Chromiumabläufe grün.
38 Python-/zwei Node-Ops einschließlich echter Sicherung/isoliertem Restore grün.
Unabhängiger Luna-Review ohne Blocker. Der Schlüssel soll mit identischem
Eingabesnapshot wiederholt werden; keine freie semantische Umdeutung von UUIDs.

**Noch keine UI-Nutzung und kein Liefernachweis dieses Slices.** Nächster Schritt
BKP015.5b: bestätigte Speicherantwort von fehlgeschlagenem Listenabruf trennen,
unklare Anlage nur mit stabiler UUID und identischem Auftrag wiederholen; GET-
Retry bleibt ausschließlich lesend. Eingaben, Fokus und Dirtyschutz erhalten.
CI/Images und Auto-Updater weiter prüfen. Aktuell ausstehender H052-Lauf40224016542
zu19e482f; Home Lab zuletzt lesend e9fa074, Timer aktiv/Service inaktiv, keine
Aufmerksamkeitssperre. Keine parallelen manuellen Updates.

## Neue Fortsetzung: 25.10.2026, abends

Neues reguläres Fünf-Stunden-Fenster bei 0 Prozent geprüft, resetsAt=1792972443.
Aktuelle Nutzeranweisung ersetzt die frühere 85-Prozent-Obergrenze: sinnvoll
bis nahe zur Erschöpfung arbeiten, ab 85 nur kleine abschließbare Aufgaben und
ab 95 geordnet beenden; keine Zusatzcredits oder manuellen Resets. Genau eine
weitere Phase gegen 01:15 Europe/Berlin am 26.10.2026 ist als Thread-Heartbeat
`auftragskompass-einmalig-um-01-15-fortsetzen` eingerichtet. Vor Start echten
Reset/ordinaryUsageAllowed prüfen; nach dieser zweiten Phase Automation löschen.

H051-CI40197576242 hat Komponenten/Coverage bestanden, scheiterte danach im
Passwort-Chromiumablauf an der Sidebar-Togglemessung 43,999130249 statt44px.
Keine Images, keine neue Auslieferung. H052 untersucht tatsächliche Transition/
Browsergeometrie, ohne Touchvertrag oder Prüfungen pauschal abzuschwächen.
H052 ist lokal abgenommen: echte Styles+Space zeigen laufende transform-
Transition mit 43,9998627px, nach animation.finished exakt 44×44. Messung wartet
nur auf Toggleanimation; keine gelockerte 44px-Assertion oder feste Pause. Beide
HTTPS-Authmodi 2/2, 519 Komponenten-/260 Unit-Tests, schnelle Gates/Build und
unabhängiger Review grün. CI/Images und Lieferung danach erneut prüfen.
Danach BKP015.5 und weitere Paritätsslices.

## Abschlussreserve: CI-Fokusprüfung H051, 25.10.2026

Neue Funktionscommits auf UX gepusht:22144e6 (Archivierung), f26c137
(konsistente Liste),7747cb8 (Editor auf Aufruf). Lokal vollständige1082 Tests,
21 Chromiumabläufe und abschließend38 Python-/zwei Node-Ops grün.
CI40197096114 zu7747cb8 scheiterte im bestehenden Layout-Logo404-Test733:
DOM-Status vorhanden, Fokus noch body. Images wurden übersprungen, kein Update.
H051 wartet im Test mit vorhandenem waitFor/Standardbudget auf denselben exakten
Fokusvertrag; Produktcode fokussiert nach loading/busy im passiven Effekt.
Kein höheres Budget, Skip oder Produktwechsel; unabhängiger Luna-Review klar.
Nach H051 erneut519 Komponenten-/260 Unit-Tests und schnelle Gates/Build grün.

Bei83 Prozent nur noch Tests/Doku/Commit/Push abschließen; spätestens85 stoppen,
keine Zusatzcredits. **Auslieferung der drei neuen Slices bleibt offen.** Zuerst
neue CI quality+images tatsächlich prüfen, alleinigen Auto-Updater abwarten,
gesund/exakte OCI/Checkpoint CT+Host+Betreiber und Live-Assets verifizieren.
Zuletzt nur lesend e9fa074 auf drei gesunden Containern, Timer aktiv/Service
inaktiv, kein needs-attention, Option-Drain off; vollständiger früherer
Liefernachweis7ac0ba9 unten. Keine manuelle Aktualisierung/echten Datenänderungen.

Vorbereiteter ignorierter Harness `scratch/live-template-proof/` enthält
Static-only-Proxy und Kopie der fünf synthetischen Vorlagenabläufe samt exaktem
Versionslabel. **Noch nicht gegen neue Live-Assets ausgeführt.** Verifier hat
derzeit7747cb8 hardcodiert; vor Nutzung auf den wirklich freigegebenen vollständigen
SHA ändern. Keine Geschäfts-API-Aufrufe zur echten Domain. Danach BKP015.5 gemäß
ausführlichen Anweisungen unten. Keine neue automatische Wiederaufnahme geplant.

## BKP015.4: Vorlageneditor auf Aufruf, 25.10.2026

Zunächst nur Liste und „Vorlage anlegen“; Formular/Platzhalterhilfe erst auf
Anlegen/Bearbeiten/Duplizieren. Ein bestehender Inline-Editor, alle bisherigen
Felder und Preis-/Produkt-/Archivwege erhalten. Dirty-Rückfrage bei Abbrechen
und Wechsel; bestätigtes erneutes Öffnen derselben Vorlage verwirft tatsächlich
auch unkontrollierte Textfelder. Native Feldwerte bleiben beim Deaktivieren
lesbar, sodass unveränderte Entwürfe nicht fälschlich schmutzig werden. Fokus
beim Öffnen in Bezeichnung, nach Schließen zum verfügbaren Auslöser, ohne
asynchron anderweitig gesetzten Fokus oder inaktive Bereiche zu übersteuern.

36 fokussierte/519 gesamte Komponentenfälle, vollständige Coverage-Suite 1082
Tests und 21 Chromiumabläufe grün, schnelle Gates/Build ebenfalls. Panel 99,37
Prozent Zeilen/91,29 Prozent Zweige; Changed-Code 75/75 Zeilen und 79/82 Zweige.
Acht Mobil-/Desktopbilder beider Themes sowie axe/Overflow sauber; Luna sah
alle, Koordinator vier repräsentative Bilder. Impeccable null neue Funde bei
61 unveränderten gemeinsamen CSS-Funden; unabhängiger Review ohne Blocker.
Private Belege unter `delivery-2026-10-25/template-demand-local/`.

Ein erster paralleler Ops-Lauf scheiterte an der erwarteten Fehlermeldung der
leeren Restore-Datenbank; der ursprüngliche stderr wurde vom Test nicht
ausgegeben. Ein isolierter unveränderter synthetischer Test mit Zusatzdiagnose
bestand danach (83s) samt erwarteter Schemafehlermeldung. Ursache des ersten
Ausgangs unbekannt, nicht als behobener Produktfehler ausgeben. Vollständiger
abschließender Ops-Lauf danach grün:38 Python-/zwei Nodefälle samt realem
Compose-Backup/Restore. CI/Images und tatsächlicher Liefernachweis folgen separat.

**Nächster sinnvoller Slice: BKP015.5.** Der bestehende Speichervorgang verwechselt
bestätigten POST/PUT plus fehlgeschlagenen Listen-GET noch mit einem gescheiterten
Schreibauftrag. Blindes erneutes Anlegen kann duplizieren; POST hat keinen
Idempotenzschlüssel. Ausführliche sichere Anweisungen stehen in
[Dokument-/Mailtickets](bookitup-parity/tasks-documents-mail.md). Diese bekannte
Lücke wurde durch die Editorvereinfachung nicht umgebaut. Danach Suche/Art-/
Archivfilter und eigenständige Vorlagenvorschau, keine gesamte Mail-/Rechnungs-
Implementierung in einen Slice ziehen. BKP015 insgesamt bleibt offen.

Weiter Ponytail full/Impeccable und klar getrennte Luna-Dateizuständigkeiten.
REA nur für tatsächlichen Referenz-/Runtimeabgleich; Taste v2 schließt die
Verwaltungsoberfläche aus. Keine neue Referenzuntersuchung oder vollständige
Bookitup-Parität behaupten. Nutzerobergrenze 85 Prozent gilt weiterhin;
bei zuletzt 74 Prozent nur noch Abschluss/Reserve, keine neue Funktion.
Zusatzcredits unverändert, keine automatische Wiederaufnahme eingerichtet.

## BKP015.3: konsistente Vorlagenliste, 25.10.2026

Die getrennten Listenabfragen für Vorlage und Positionen verwenden jetzt einen
gemeinsamen lesenden Repeatable-Read-Snapshot. Der reale PostgreSQL-Test zeigte
vorher neue Version 2 mit alten Positionen A und einen akzeptierten veralteten
Schreibversuch. Nach Fix: konsistente Version 1/A, Konflikt beim alten Archivieren,
Version 2/B bleibt erhalten. Keine API-/Schema-/UI-Änderung, keine Schreibsperre.

Vier fokussierte Integrationsfälle und gesamte Coverage-Suite 1074 Tests grün
(97,20 Prozent Zeilen/93,31 Prozent Zweige), geänderte Zeilen 4/4. Schnelle
Gates/Build und unabhängiger Luna-Review klar. CI/Images und Deployment dieser
Änderung noch gesondert prüfen; letzte unten vollständig belegte Lieferung 7ac0ba9.
Fokussierter Vorlageneditor, Filter und Vorschau bleiben nächste UI-Arbeit.

## BKP015.2: Vorlagenarchivierung abgesichert, 25.10.2026

Archivieren prüft nun Ablehnung, Versionskonflikt, bestätigten Erfolg und
unklaren Ausgang. Vollständige gespeicherte Positionen/Produktbezüge bleiben
erhalten; ein offener Entwurf wird nicht zum Archivieren verwendet und bleibt
beim Abgleich unverändert. Weitere Änderungen bleiben bei unklarem Ausgang bis
zum ausdrücklichen GET gesperrt. Bestätigter Erfolg überlebt fehlgeschlagenen
Listenabruf; kein automatischer zweiter PUT. Neuere gültige Serverstände werden
übernommen. Fokus führt zum Abgleich und danach zu verfügbarer Aktion, ohne
bewusste Nutzerbewegung oder inaktive Arbeitsbereiche zu übersteuern.

Lokal grün: 28 fokussierte/511 gesamte Komponentenfälle, 260 Unit-Tests,
schnelle Gates/Build und vier betroffene Chromiumabläufe. Panel 99,24 Prozent
Zeilen/90,19 Prozent Zweige, Changed-Code 179/180 und 172/190. Sechs relevante
Mobil-/Desktop-/Fehlerbilder geprüft, axe/Overflow sauber; Impeccable null neue
Funde (61 unveränderte gemeinsame CSS-Funde), unabhängiger Luna-Review klar.
Diese Änderung ist vor CI-/Lieferabgleich noch nicht als deployed belegt.

Separat als nächster kleiner Slice behandeln: `documentTemplateRepository.list`
liest derzeit Vorlagen und Positionen in getrennten READ-COMMITTED-Abfragen.
Ein Interleaving kann neue Version mit alten Positionen koppeln und eine spätere
versionsgültige Archivierung neuere Positionen überschreiben lassen. Zuerst
deterministischer PostgreSQL-RED-Test, dann beide Listenabfragen in einem
konsistenten lesenden Snapshot; keine neue API, Migration oder UI-Erweiterung.
Fokussierter Editor, Filter und Vorlagenvorschau bleiben offen.

Aktuelle Nutzerobergrenze weiterhin 85 Prozent, keine Zusatzcredits nutzen.
Zuletzt regulär verfügbar, 36 Prozent im neuen Fenster; vor weiteren Slices
tatsächliche Limits prüfen. Keine automatische Wiederaufnahme neu beauftragt.

## H048 abgeschlossen: mobile Einstellungen und Logo ausgeliefert, 25.10.2026

Neues Fünf-Stunden-Fenster tatsächlich begonnen, reguläre Nutzung verfügbar.
Für diese Fortsetzung gilt die neue Nutzerobergrenze **85 Prozent**, nicht
frühere 93/95-Prozent-Werte. Ab etwa 75 Prozent keine große neue Aufgabe;
Reserve für Tests, Review, Commit, Push und Lieferabschluss halten.

**Tatsächlich ausgeliefert und geprüft: 7ac0ba912d7e181053a6f512b18a6d4405f40325.**
CI 40172043659 quality+images erfolgreich. Sole-Auto-Updater: last-success
exakt identisch, API/Worker/Admin gesund mit exakter OCI, Timer aktiv/Service
inaktiv, kein needs-attention, Website-Option-Drain off. Keine manuelle
Aktualisierung und keine echten Geschäftsdaten verändert.

Checkpoint `preupdate-7ac0ba912d7e-20261025T073231377975Z.dump` im CT, auf dem
Host und in privater Betreiberablage: 2.587.194 Bytes, identischer SHA-256
`046e1466e204fa420731652d5da0d5fcb7566a66a344bf063c601e1044e44375`.
Dateien 600, Betreiberordner 700. Dumpinhalte nicht ausgewertet.

Live-Assets mit sichtbarer Version7ac0ba9 geprüft: kompletter Layout-/Logoablauf,
PNG/JPEG, Fehler/Reload und nachfolgende versionsgesicherte Layoutspeicherung,
16 Bilder bei 320/390/768/1280 × Hell/Dunkel, axe und zwei echte einseitige
Chromium-PDFs mit sichtbarem fiktivem Logo. Luna prüfte alle Bilder und Seiten,
Koordinator zusätzlich Mobil/Desktop beider Themes und beide PDF-Seiten.
Nur allowlist-Static-GETs zur echten Domain, keine externen HTTP(S)-Requests
aus dem Browser; Auth/Geschäfts-API/DB/Renderer lokal fiktiv. Dies ist keine
Abnahme echter Kundendatenflüsse oder physischer Mobilgeräte. Private Rohbelege
unter `AuftragsKompass-Sicherung/delivery-2026-10-25/7ac0ba9/`.

Gesamte lokale Chromiumfolge auf aktuellem Funktionsstand nochmals 18/18 grün
(2,7 Minuten); bestehende unveränderte Ops-Suite zuvor 38 Python-/zwei Node-
Fälle samt realem Compose-Backup/Restore grün. Die vollständige Linux-CI hat
dieselben Releasegates erfolgreich durchlaufen. H048 ist damit geschlossen.

Die getrennte Dokumentationshistorie 39721f9 wurde nach tatsächlichem Liefer-
abgleich per Fast-forward in die lokale UX-Branch zurückgeführt. Nächster
Code-Slice: **BKP015.2 Archivierung von Dokumentvorlagen**, ausführlich in
[Dokument-/Mailtickets](bookitup-parity/tasks-documents-mail.md) beschrieben;
vor Coding als eigener Hauptplan-Slice aktivieren. Kein großes Vorlageneditor-
oder Rechnungsprojekt in diese Fehlerkorrektur ziehen. Ponytail/Impeccable und
klar getrennte Luna-Dateizuständigkeiten weiterverwenden.

## Kontingentabschluss H050: 25.10.2026

Bei zuletzt 92 Prozent geordnet mit Abschlussreserve beendet; Zusatzguthaben
unverändert, keine neue Automation oder manuelle Rücksetzung. Alle Luna-Aufgaben
beendet. Vor Fortsetzung tatsächliche Limits prüfen, keine Zusatzcredits nutzen.

Funktionsstand **7ac0ba912d7e181053a6f512b18a6d4405f40325** auf
`codex/ux-event-simplification` gepusht. Neue Einzelcommits: `38f3ccc`
(kompakte mobile Einstellungen), `c95be20` (Logo-Upload), `7c4b78f`
(Worker-Test), `7ac0ba9` (verlorenen URL-Wechsel abgleichen).
CI **40172043659 läuft noch**, kein neuer Image-/Liefernachweis. Tatsächlich
zuletzt gelesen: ae37b30, drei gesunde Container/exakte OCI, Timer aktiv,
kein needs-attention. **H048 bleibt offen**; kein manuelles Update angestoßen.

Lokale Nachweise: 260 Unit-/495 Komponententests, schnelle Gates/Build,
vorherige vollständige Coverage-Suite 1051 Tests plus zusätzliche Negativfälle,
18/18 Chromium und 38 Python-/zwei Node-Ops samt echtem Compose-Restore;
nach dem letzten Hookfix drei betroffene Chromiumabläufe nochmals grün.
Logo- und Navigationsbilder/PDFs nur privat unter
`AuftragsKompass-Sicherung/delivery-2026-10-25/`.

Fortsetzung: zuerst tatsächliche CI samt Images des Funktionsstands prüfen,
alleinigen Auto-Updater abwarten, Checkpoint CT/Host/Betreiber abgleichen und
Live-Assets mit sichtbarer neuer Revision abnehmen. Ignorierter vorbereiteter
Harness `scratch/live-proof-7ac0ba9/live.config.ts` wurde noch nicht gegen die
neuen Live-Assets ausgeführt; nur freigegebene statische Remote-GETs,
Geschäfts-APIs/DB/Renderer lokal fiktiv. Danach Doku-Historie von
`codex/branding-handoff-20261025` per geprüftem Fast-forward zurückführen,
kein Force-Push. Nächster Code-Slice BKP015.2 ist ausführlich in
[Dokument-/Mailtickets](bookitup-parity/tasks-documents-mail.md) vorbereitet,
noch nicht umgesetzt. Weiter Ponytail full/Impeccable und klar getrennte
Luna-Dateizuständigkeiten; REA nur bei echter Referenz-/Runtime-Untersuchung,
Taste v2 nicht auf Verwaltungsflächen erzwingen. Keine Paritätsvollständigkeit
oder echte Kundendaten-/Geräteabnahme behaupten.

## H049: nach Listenerinstallation aktuelle Route abgleichen, 25.10.2026

H047 ist als `7c4b78f` gepusht. Dessen CI 40171302012 wurde im bisherigen
Sprach-/Navigationstest rot: Suchüberschrift nach Hashwechsel nicht gefunden.
Lokal war die gesamte Komponentenfolge grün. Ein gezielter neuer Test belegt
jedoch eine echte Lücke im gemeinsamen `useWorkspaceRoute`: Hashwechsel in
`useLayoutEffect` nach initialem Render, aber vor passiver Listenerinstallation,
bleiben ohne erneuten Abgleich im alten Zustand. Ein Aufruf von `changed()`
nach dem Registrieren beider Listener behebt die deterministisch rote Regression.
Die Lücke passt zum CI-Symptom; der exakte CI-Ablauf ist damit nicht bewiesen.
Keine geänderten Wartebudgets, Wiederholungen oder entfernten Assertions.

Betroffene Aufrufer AuthPanel, Navigation und SettingsNavigation verwenden
denselben Hook; keine zusätzliche Historymutation/Eventauslösung. Bestehende
Legacy-Normalisierung bleibt erhalten. 28 fokussierte Navigations-/Sprachtests
und alle 495 Komponententests grün, Navigation 100 Prozent Zeilen/95,55 Prozent
Zweige. Unabhängiger Review ohne Blocker. Vollständige vorherige lokale
Chromiumfolge 18/18 und 38 Python-/zwei Node-Ops inklusive realem Compose-
Backup/Restore grün; nach H049 alle drei betroffenen Auth-/Layout-Chromiumabläufe erneut
grün (2,7 Minuten). Schnelle Gates und 260 Unit-Tests ebenfalls grün;
geänderte Zeile vollständig gedeckt. Die vollständige neue Linux-CI bleibt Auslieferungssperre.

H048 ist noch offen: am 25.10. zuletzt nur lesend geprüft läuft `ae37b30`
auf drei gesunden Containern mit exakter OCI, Timer aktiv, kein needs-attention.
Für diesen Zwischenstand wurde keine neue dreifache Betreiber-Sicherung oder
Live-Asset-Abnahme behauptet. Der letzte vollständige Liefernachweis bleibt
e9ca99d unten. Vor dem abschließenden Doku-Push prüfen, dass laufende Images
nicht ungewollt abgebrochen werden. Kein manueller Parallel-Updater.

## CI-Nachtrag H047: begrenzt auf tatsächliche Worker-Bereitschaft warten

BKP018.1b (`38f3ccc`) und BKP018.2 (`c95be20`) sind auf der UX-Branch
gepusht. Linux-CI 40170018957 scheiterte im bestehenden Worker-Starttest:
HTTP war schon erreichbar, Worker durfte während der Initialisierung noch
503 liefern. Der Helper gab diese erste Antwort sofort an die exakte
Ready-Assertion weiter. Das ist kein belegter Fehler der neuen Oberfläche.
H047 korrigiert ausschließlich diesen Testhelper: höchstens 100 Abholungen
mit bestehenden 200ms-Pausen, frühes Ende nur bei 200, letzte 503 bleibt am
Ende als fehlschlagende Diagnose erhalten. Kein Produkt-/Healthcheckwechsel,
kein Skip, kein höheres Testbudget oder automatischer Testretry.

Deterministische Fälle für 503→200, dauerhaft503 und Verbindungsfehler→200
sowie beide tatsächlichen PostgreSQL-/Worker-Start-/Shutdownfälle grün (5/5).
Unabhängiger Review ohne Blocker. Vollständige grüne Linux-CI samt Images
bleibt vor automatischer Auslieferung zwingend. Aktuelle Laufzeit nicht aus
diesem Dokument ableiten; zuletzt unabhängig verifiziert ist e9ca99d unten.

Bekannte nächste Lücke im Vorlagenbereich: Archivieren ignoriert bisher
HTTP-Fehler/409 und fängt Verbindungsfehler nicht. Als eigener kleiner
BKP015-Unter-Slice behandeln; fokussierter Vorlageneditor/Filter/Vorschau und
übrige Dokument-/Mailparität bleiben darüber hinaus offen.

## H046 abgeschlossen, tatsächlicher Betrieb: 25.10.2026

Das neue Fünf-Stunden- und Wochenfenster ist tatsächlich zurückgesetzt,
reguläre Nutzung verfügbar; Zusatzguthaben unverändert. Vor jeder Fortsetzung
weiterhin aktuelle Limits prüfen. Frühere Kontingentpausen unten sind Historie.

**Verifiziert ausgeliefert: e9ca99d04a858723140c9184efe7f38e11a39357.** CI
40134505361 quality+images erfolgreich. Der einzige automatische Updater hat
aktualisiert: API/Worker/Admin gesund mit exakt diesem OCI-Label, last-success
identisch, Timer aktiv/Service inaktiv, kein needs-attention, Drain off.
Checkpoint `preupdate-e9ca99d04a85-20261024T214540405895Z.dump` in CT, Host
und privater Betreiberablage: 2.384.655 Bytes, identischer SHA-256
`bc5efc03feccbde5ce8d11469e2ae721e9f0f60a6714428cdebbf0b6e4953164`.
Betreiberdatei 600, Ordner 700. Keine Dumpinhalte gelesen oder Updates manuell
angestoßen. Die getrennte Doku-Branch 8ed228b wurde per geprüftem Fast-forward
lokal in die UX-Branch zurückgeführt; weitere Arbeit erfolgt dort.

Live-Assets mit sichtbarer Version e9ca99d in acht Zuständen bei
320/390/768/1280 × Hell/Dunkel geprüft; axe bei 320/1280 in beiden Themes grün.
Der komplette Layoutablauf mit tatsächlicher Chromium-PDF, Save/Reload,
503-/404-/409-Zuständen und ohne Vorschau-Nebenwirkungen ist grün. Die beiden
Downloads sind identische einseitige A4-PDFs (47.164 Bytes), gerenderte Seite
lesbar mit „Seite 1 von 1“. Alle Auth-/Geschäfts-APIs, Datenbank und Renderer
waren lokal und fiktiv; keine Behauptung einer echten Geschäfts-API-/Kundendaten-
oder Geräteabnahme. Rohbelege ausschließlich privat unter
`AuftragsKompass-Sicherung/delivery-2026-10-24/e9ca99/`.

BKP018.1b setzt den kompakten mobilen Einstellungsbereichswähler um; der
aktuelle lokale Prüfstand und die Auslieferungsgrenze stehen im nächsten
Abschnitt. Die Logo-Uploadoberfläche ist im folgenden BKP018.2 dokumentiert;
die übrige Parität bleibt separat offen.

## BKP018.2: Logo im Dokumentlayout hochladen, 25.10.2026

Gespeicherte Layouts bieten „Logo hinzufügen“ beziehungsweise „Logo ersetzen“.
Nur bei Bedarf erscheinen native Dateiauswahl, PNG-/JPEG-Hinweis bis 512KiB,
Upload und Verwerfen; die übrigen Layoutaktionen sind solange verborgen.
Auswahl allein schreibt nichts. Inhaltsbearbeitung/Upload bleiben getrennt.
Die vorhandene raw-PUT-API erhält Datei und CSRF, eine bestätigte vollständige
Antwort aktualisiert die Version. Alte PDF-Vorschauen werden widerrufen.

Netzwerk-/5xx-/unplausible Antworten sperren erneutes Hochladen bis zum
bewussten GET-Abgleich. Die Auswahl bleibt bei fehlgeschlagenem GET erhalten;
der Abgleich benennt ihr Verwerfen. Fokus nach Upload/Abbruch/GET kehrt nur
im aktiven Bereich zum Auslöser beziehungsweise zur Einrichtung zurück.
Keine API-/Migrationsänderung: andere autorisierte Tabs bleiben zuletzt
schreibend maßgeblich, alte Logobytes werden absichtlich erhalten. Keine
Thumbnail-/Löschfunktion. Bereits finale PDF-Bytes/Hashes bleiben unverändert.

34 fokussierte Layout-Komponententests, 35 Dokumentintegrationstests und echte
synthetische HTTPS-/PostgreSQL-/Chromiumstrecke grün. Gesamte Coverage-Suite
1051 Tests; nach den letzten Fokus-/Textkorrekturen und zwei zusätzlichen
Netzwerk-/JSON-Fehlerfällen alle 494 Komponententests
mit Panel-Coverage 94,35 Prozent Zeilen/88,99 Prozent Zweige, Changed-Code
108/109 Zeilen und 105/116 Zweige. Unabhängiger Review ohne Blocker,
Impeccable ohne neue Befunde (61 Bestandshinweise). PDF mit sichtbarem
fiktivem Logo als einseitiges A4 tatsächlich gerendert und visuell geprüft.
Die Auslieferung bleibt bis zur finalen grünen CI samt Images und geprüftem
Checkpoint/OCI offen; dies ist kein Nachweis einer echten Geschäfts-API-Abnahme.

## BKP018.1b: kompakte mobile Einstellungsnavigation, 25.10.2026

Bis einschließlich 900px ersetzt ein beschrifteter nativer Select die zwölf
ständig sichtbaren Links; darüber bleiben die bisherigen Links erhalten.
Dieselbe Hash-Zuordnung, Direktlinks einschließlich Legacy-Aliassen, Query und
Browser-History bleiben maßgeblich. Panels bleiben montiert, ein schmutziger
Layoutentwurf bleibt beim Bereichswechsel erhalten. Keine neue Abhängigkeit,
Backendänderung, Animation oder Änderung der Palette.

Alle acht lokalen 320/390/768/1280 × Hell/Dunkel-Bilder visuell geprüft: bei
320px beginnt die Layoutüberschrift ungefähr bei y=226 statt zuvor y=535.
Bereichswähler und erstes Absenderfeld sind auf der ersten Arbeitsfläche
sichtbar; keine Wortbruch-Linkwand. Browserprüfungen umfassen auch 900/901px,
axe, Fokus und Entwurfserhalt. Native Buchstabenauswahl prüft die Tastatur;
Popup-Pfeilfolgen funktionieren in lokalem Headless-Chromium nicht zuverlässig
und sind keine behauptete Geräteabnahme. Lokale Geschäftsdaten ausschließlich
fiktiv. Neue Auslieferung erst nach grüner CI samt Images und geprüftem
Checkpoint/OCI bestätigen; letzter verifizierter Testbetrieb oben bleibt e9ca99d.

Der danach umgesetzte Slice BKP018.2 für den bestehenden sicheren
Logo-Upload ist oben dokumentiert. Nur gespeichertes Layout, ausdrückliche Aktion, keine parallele
Inhaltsbearbeitung; unklare Antwort vor Wiederholen abgleichen. Bestehende API
hat für Logos kein CAS, konkurrierende autorisierte Uploads bleiben zuletzt
schreibend maßgeblich. Keine Logo-Löschung oder neue Thumbnail-API erfinden.
Das Gesamtticket BKP018 bleibt bis zur vollständigen fachlichen Abnahme offen.

## Kontingentabschluss und ausstehender Liefernachweis: 24.10.2026

Bei tatsächlich 95 Prozent geordnet beendet; reguläre Nutzung noch verfügbar,
Zusatzguthaben unverändert. Keine neue Wiederaufnahme/Automation eingerichtet;
alle Luna-Subagents sind beendet. Keine weitere Entwicklung ohne erneute
Kontingentprüfung, kein Credit-/API-Key-Ausweichweg.

Funktionsstand **e9ca99d04a858723140c9184efe7f38e11a39357** auf
`codex/ux-event-simplification` gepusht. Vorherige Einzelcommits: 1b040b5
(Logo-Integrität), 40cef9a (echte Seitenzählung), 33066c4 (H045-Lieferabschluss).
Alle lokalen Gates einschließlich vollständiger Coverage-Suite 1033 Tests,
aller 18 Chromiumabläufe und 38 Python-/zwei Node-Betriebstests samt realer
Compose-Sicherung/isoliertem Restore grün. Keine Tests übersprungen.

CI **40134505361**: quality erfolgreich, images beim Abschluss noch aktiv
(„Publish API and worker image“). **Kein neuer Auslieferungsnachweis:** letzter
geprüfter Testbetrieb bleibt 132ace1, drei Container gesund, Timer aktiv,
kein needs-attention, Drain off. Kein Checkpoint für e9ca99d bestätigt und kein
solcher Dump als geliefert behauptet. H046 bleibt deshalb offen.

Dieser Dokuabschluss wird separat auf `codex/layout-delivery-handoff-20261024`
gepusht, um den laufenden freigegebenen Image-Build der UX-Branch nicht
abzubrechen. Die Testinstallation folgt weiterhin ausschließlich der UX-Branch.
Beim Fortsetzen zuerst diesen Übergabestand lesen; neue Funktionsarbeit weiter
auf der UX-Branch erst nach H046-Lieferabschluss. Dokumentation nach geprüftem
Historien-/Lieferabgleich zurückführen, kein Force-Push.

**H046 fortsetzen:** tatsächliche quality+images von e9ca99d prüfen, alleinigen
automatischen Updater abwarten, exakte OCI ×3/gesund und CT-/Host-/Betreiber-
Checkpoint mit identischem Hash/Größe nachweisen. Kein manueller Parallelupdate.
Dann vorbereiteten ignorierten Harness
`scratch/live-proof-e9ca99/live.config.ts` mit
`document-layout-live-assets.spec.ts` verwenden: echte Remote-Assets nur per
GET-Whitelist vom eigenen HTTPS-Origin, alle Auth-/Geschäfts-APIs und Daten lokal
fiktiv; sichtbare Version e9ca99d verlangen. Acht Themes/Breiten und echte PDF
prüfen. Harness ist vorbereitet, bewusst **nicht ausgeführt**. Rohbelege aus
`/tmp/ak-bkp018-layout/` und finalem `/tmp/ak-bkp018-final-e2e/` sind temporär;
vor Verlust bei Bedarf ausschließlich in private Sicherungsablage kopieren.
Nach Liefernachweis Matrix/H046 aktualisieren. Nächster kleiner UI-Slice ist
in `tasks-documents-mail.md` präzisiert: kompakte mobile Einstellungsnavigation;
Logo-Uploadoberfläche und übrige Bookitup-Parität weiterhin offen.

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
