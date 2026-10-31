# Lokale Anfrageübernahme (E004.8)

`receiveWebsiteInquiry` verarbeitet genau einen zuvor authentifiziert
abzuholenden Eintrag. Der Dienst öffnet selbst keinen HTTP-Endpunkt und startet
keinen Job. Signierte Netzwerkabholung, lokale Fehleranzeige und öffentliche
Aktivierung folgen getrennt. Es werden ausschließlich fiktive Daten getestet.

## Atomare Wirkung

Der Aufrufer übergibt die lokale Mandanten-/Betreiberkennung, den vollständigen
Eintrag und die Prüfzeit. Die bestehende aktive Kontofreigabe wird innerhalb der
Mandantensperre geprüft, auch bei Wiederholungen. Ein eingegangener Eintrag enthält
UUID, unveränderte Empfangs-/Ablaufzeit, versionierte Formulardaten und den damals
angezeigten Datenschutzhinweis samt HTTPS-Link. Zusätzliche Felder, ungültige Daten,
Zeiten, Unicodezeichen und übergroße Inhalte werden neutral abgewiesen.

Kontakt, Event, vollständige Originalangaben, Herkunftsbeleg, Audit und Logbuch
werden gemeinsam committet. Ein Fehler rollt sämtliche Wirkungen einschließlich
verschachtelter Repository-Aufrufe zurück. Die neue vorwärts gerichtete Migration
`0023_website_inquiries.sql` ergänzt nur die lokale Belegtabelle und den
Website-Herkunftseintrag im bestehenden unveränderbaren Eventlogbuch.

Die öffentliche Anfrage-ID ist je Mandant einmalig. Gleicher Inhalt liefert auch
nach Neustart oder Ablauf der Gateway-Aufbewahrung dieselben Zuordnungen zurück;
geänderter Inhalt zu dieser ID scheitert. Objektschlüssel-Reihenfolge ist dabei
unerheblich. Unterschiedliche Anfrage-IDs bleiben unterschiedliche Vorgänge,
selbst bei gleichen Formularwerten. Parallele Eingänge werden mit der vorhandenen
Mandantensperre serialisiert. Fremde Kontakt-/Eventreferenzen verhindern zusätzlich
die SQL-Fremdschlüssel. Eine SQL-Prüfung bindet den Fingerabdruck zusätzlich an
den gespeicherten Originalinhalt; ein versehentlich veränderter Inhalt kann nicht
mit einem unveränderten Empfangsbeleg bestehen bleiben.

## Konservative Zuordnung

- Nur ein einzelner aktiver privater Kontakt mit gleicher normalisierter E-Mail
  und gleichem Namen wird automatisch wiederverwendet. Vorhandene Angaben werden
  nicht überschrieben; die neue Telefonnummer bleibt im Originaleingang erhalten.
- Mehrdeutige Treffer, reine Telefonübereinstimmungen, abweichende Namen,
  Firmenkontakte oder archivierte Treffer ergeben `contact_review`. Es wird weder
  still zusammengeführt noch ein neuer Kontakt daneben angelegt.
- Neue Kontakte benötigen ein ausdrücklich übergebenes `newContactCountry`.
  Ohne Betreiberentscheidung wird kein Land erfunden. Das öffentliche Formular
  kann diese interne Einstellung nicht setzen.
- Das Event startet ausschließlich als `inquiry`, mit dem angegebenen Datum und
  ohne Uhrzeiten, Reservierungen oder feste Buchung. Name aus Vor-/Nachname und
  Formular-ID/Version als Quelle sind nachvollziehbar abgeleitet.
- Veranstaltungsort und Paketwunsch werden als Originalangaben erhalten. Der Ort
  wird seit H034 als Freitext (`venue`, `venueOverride=true`) am Event geführt,
  nicht als Location-Stammdatensatz; es gibt weiterhin keine automatische
  Location-/Paket-Stammdatenzuordnung. Die generierte Eventbeschreibung enthält
  deshalb keine Zeile „Veranstaltungsort“ mehr, nur Paketwunsch und Kommentar.
  Alte Beschreibungen bleiben unverändert; die vollständige Originalanfrage steht
  unabhängig davon im Anfrage-Payload. Überschreitet der Kommentar die Grenze der
  Beschreibung, verweist diese auf die vollständig gespeicherte Originalanfrage.

## Betriebsgrenzen

Die lokale Tabelle gehört zum privaten Core und enthält personenbezogene Daten,
wie die bestehenden Kontakte und Events. Nur berechtigte lokale Dienste dürfen
sie lesen; Sicherungen bleiben verschlüsselt und außerhalb Git. Die
Gateway-Ablaufzeit ist ein Zustelllimit, **keine lokale Löschfrist**. Lokale
Aufbewahrung und spätere datenschutzgerechte Bereinigung bleiben gesondert
festzulegen. Es wird hier kein automatischer Löschprozess eingerichtet.

Ein neuer bereits abgelaufener Eingang wird nicht übernommen. Eine erfolgreich
verarbeitete Wiederholung bleibt dagegen nachweisbar, damit ein späterer
Zustellversuch sicher quittiert werden kann. Quittierung darf erst nach lokalem
Commit erfolgen; dieser Dienst quittiert oder löscht im Gateway selbst nichts.
Fehlertexte enthalten feste Gründe ohne Eingaben, Adressen oder interne Ursachen.
Vor echter Aktivierung müssen ausstehende Prüfentscheidungen sichtbar und
wiederaufnehmbar sein. Seit E004.13 sind vollständig lokal gesicherte Originale
im Prüfbereich sichtbar; deren Transportquittierung ist von der noch offenen
Kontaktzuordnung getrennt. Ein `contact_review` allein ist niemals ein
Zustellnachweis und darf keine Quittierung auslösen.

Der isolierte Compose-Dump-/Restore-Probelauf prüft zusätzlich die vollständige
Originalanfrage, ihren Herkunftseintrag und eine idempotente Wiederholung gegen
die tatsächlich wiederhergestellte Datenbank.

## Originalanfrage in den Event-Details (E004.9)

`GET /api/v1/events/:id/website-inquiry` liefert ausschließlich für den
angemeldeten, weiterhin freigegebenen Betreiber des lokalen Mandanten die acht
beschrifteten Originalwerte, Formularversion, Eingangszeit und den damaligen
Datenschutzhinweis. Fehlende optionale Werte bleiben leer; Paketwerte werden mit
ihrer ursprünglichen Versionsbezeichnung dargestellt. Nicht vorhandene Eingänge
liefern 404, beschädigte gespeicherte Inhalte eine neutrale 503-Antwort.
Antworten sind mit `no-store` gekennzeichnet und enthalten keine internen
Kontaktkennungen oder Fingerabdrücke.

Die Eventdetailantwort enthält `websiteInquiryAvailable`. Nur bei vorhandenem
Eingang erscheint in der Übersicht die zunächst geschlossene „Originalanfrage
der Website“. Erst ihr Öffnen lädt die Daten. Ladefehler bieten einen erneuten
Abruf; erfolgreich geladene Angaben bleiben innerhalb dieser Eventansicht
verfügbar. Spätere Kontakt- oder Eventänderungen verändern diese Anzeige nicht.
Kommentare erscheinen vollständig als Text, einschließlich Zeilenumbrüchen und
HTML-Zeichen. Die Darstellung ist in mobilem und breitem Hell/Dunkel geprüft.
Es gibt hier keine Bearbeitung oder öffentliche Aktivierung.

## Dauerhafter lokaler Eingang vor Zuordnung (E004.10)

`stageWebsiteInquiry` sichert einen zuvor authentifiziert abgeholten Originaleintrag
in `website_inquiry_deliveries`, ohne Kontakt, Event oder Reservierung anzulegen.
Der ausschließlich intern aufrufbare Dienst prüft vollständigen Inhalt,
Mandant und aktive Betreiberberechtigung. Neue Einträge müssen noch innerhalb
ihrer Gateway-Laufzeit liegen; ein zu weit in der Zukunft liegender Eingang wird
abgelehnt. Die Prüfzeit wird beim Aufruf eingefroren und zusammen mit der
Betreiberkennung gespeichert. Migration `0024_website_inquiry_deliveries.sql`
sichert Zuordnung, Inhaltshash und Zeitgrenzen zusätzlich in PostgreSQL ab.

Identische Wiederholungen, auch parallel oder nach Pool-Neustart, verändern den
Originalbeleg und seine erste lokale Eingangszeit nicht. Bereits gesicherte
Einträge bleiben nach Gateway-Ablauf erhalten und als identische Wiederholung
erkennbar; abweichender Inhalt derselben Anfrage-ID scheitert. Ein äußerer
Transaktionsfehler rollt auch diesen Eingang vollständig zurück. Der echte
Dump-/Restore-Probelauf erhält einen noch nicht fachlich zugeordneten Eingang
und prüft seine Wiederholung nach Ablauf.

Diese private Zwischensicherung erlaubt später eine Kontaktprüfung ohne Verlust
des Originals. Sie führt selbst keine Quittierung, automatische Eventanlage,
Netzwerkabholung oder Löschung aus. Signierte Zustellung, sichtbare Prüfliste und
wiederanlaufbare Quittierung folgen getrennt vor öffentlicher Aktivierung.
Die lokale Aufbewahrungsentscheidung bleibt offen; die Gateway-Ablaufzeit löscht
diesen privaten Eingang nicht.

## Signierte Batch-Zustellung (E004.11)

`receiveWebsiteInquiryBatch` verbindet den bestehenden Signatur-/Replay-Vertrag
mit der lokalen Zwischensicherung. Der lokale Aufrufer muss die Nachrichten-ID
seines eigenen Pull-Aufrufs als `requestId` übergeben. Nur dazu passende,
zeitlich gültige `gateway-to-core`-Antworten mit Zweck `inquiries.batch` werden
angenommen. Batch und einzelne Originaleinträge sind strikt geprüft: höchstens
100 unterschiedliche Anfrage-IDs und höchstens 50.000 UTF-8-Bytes im Array.
Signatur und Payload werden vor Datenbankwirkungen geprüft; Schlüssel, Paket und
Prüfzeit können während Datenbankwartezeiten nicht nachträglich geändert werden.

Aktive Betreiberfreigabe, vollständiger Batch, Nonce und Operationsbeleg committen
zusammen. Auch Wiederholungen mit bereits vorhandenem Operationsbeleg prüfen
die Berechtigung erneut. Identische Nachrichten sind Replay; derselbe Vorgang
mit frischer Nachricht ist eine Wiederholung mit gespeichertem Zähler.
Abweichende Inhalte derselben Operations-ID scheitern. Ein einzelner neuer
abgelaufener oder widersprüchlicher Eingang rollt den gesamten Batch zurück,
einschließlich aller Transportbelege. Technische Zähler bestätigen nur lokal
vorhandene Originaleingänge, keine Kontaktzuordnung oder Buchung.

Der private Synchronisationsstart muss zusätzlich zu `migrate` einmalig
`migrateGateway` gegen die **lokale** Datenbank ausführen, bevor er den Dienst
verwendet. Dies installiert die vorhandenen technischen Replay-/Operations-
Tabellen über denselben Prüfsummenlauf; die dabei angelegte verschlüsselte
Gateway-Inboxtabelle wird lokal nicht verwendet. Die getrennte öffentliche
Gateway-Datenbank erhält weiterhin ausschließlich `migrateGateway`, niemals
Core-Migrationen oder Zugang zur lokalen Datenbank. Keine Initialisierung wird
hier automatisch beim App-Start aktiviert.

Ein Integrationstest führt das echte Gateway mit eigener Datenbank durch:
öffentlicher synthetischer Eingang → signierter Pull → lokale Batch-Prüfung →
dauerhafte Originalablage. Der Gateway-Eingang bleibt danach absichtlich
unquittiert. Netzwerktransport, persistente Quittierungs-Outbox und sichtbare
Bearbeitung ausstehender Eingänge bleiben nächste Schritte vor Freischaltung.

## Automatische Option statt manueller Anfrage (H032)

Seit H032 wandelt der Worker gesicherte Eingänge selbstständig in eine
unverbindliche **Option** um. Der interne Dienst `receiveWebsiteInquiry` erhält
dafür einen optionalen Status `'inquiry' | 'option'` (Standard `'inquiry'` für
bestehende direkte Aufrufe). Beide Werte durchlaufen exakt denselben Pfad:
Inhaltsprüfung, Fingerabdruck, Mandantensperre, Betreiberfreigabe,
Kontaktzuordnung, Event, Herkunftsbeleg und Logbucheintrag
`website_received`, jeweils in einer Transaktion. Unterschiedlich sind nur
`events.status` und `nextStatus`. Uhrzeiten bleiben leer, es entsteht keine
Reservierung, keine Mail und keine Paket-/Eventartzuordnung. Das Original bleibt
unverändert in `website_inquiries.payload` gespeichert.

`startWebsiteOptionDrain` (`packages/core/src/website-option-worker.ts`) arbeitet
pro Takt den **vollständigen** noch nicht übernommenen Bestand ab: Seiten von
höchstens zehn Eingängen (`NOT EXISTS`, sortiert nach lokalem Eingang und ID),
fortgesetzt über einen Keyset-Cursor `(staged_at, id)` bis eine leere Seite
kommt. Jeder Eintrag läuft in einer eigenen Transaktion; ein scheiternder
Eintrag beendet den Lauf nicht und blockiert seine Nachbarn nicht, auch wenn
zehn ältere Eingänge dauerhaft fehlschlagen. Scheitert ein Eintrag an seinen
eigenen Daten (`contact_review`, `expired`, `conflict`, `invalid`), wird er
genau einmal mit einem festen Code (`website_option_contact_review` und
ähnlich) protokolliert und danach im laufenden Prozess zurückgehalten, statt
taktweise heiß wiederholt zu werden; ein Neustart setzt den Rückhalt zurück, und
eine manuelle Übernahme in der Oberfläche nimmt den Eingang aus dem
Pending-Bestand. Vorübergehende und Infrastrukturfehler werden im nächsten
zulässigen Takt erneut versucht, ohne Neustart; ein Listen- oder
Infrastrukturfehler setzt die Ready-Anzeige für diesen Takt auf „nicht bereit“.
`ready` meldet damit nur die Gesundheit des Laufs, nicht einen erledigten
Geschäftseingang. Einen persistenten Versuchszähler, Sperrtabelle oder Backoff
gibt es bewusst nicht; höchstens ein Takt läuft gleichzeitig, `stop()` wartet
ihn ab, und ein Abbruch hinterlässt über den Pending-Bestand einen
wiederaufnehmbaren Zustand. Der Worker startet in `apps/worker/src/worker-start.ts`; beim
Herunterfahren stoppt zuerst dieser Lauf, dann Abfrage/Quittierung, Ablaufjob
und zuletzt der Datenbankpool.

**Land für neue Kontakte:** Ohne ausdrückliche Konfiguration wird kein Land
erfunden. `loadWebsiteOptionConfig` liest `AK_INQUIRY_DEFAULT_CONTACT_COUNTRY`
(Muster `^[A-Z]{2}$`) und `AK_INQUIRY_OPTION_INTERVAL_MS` (5.000–600.000 ms,
Standard 30.000). Seit BKP002 erzeugt der Optionpfad auch ohne Landvariable
eine Option ohne Kontaktzuordnung („Kontakt noch offen“) statt einer Ausnahme;
ein neuer Kontakt entsteht nur mit der Betreiber-/Deployment-Vorgabe. Der
direkte Legacy-Aufruf (`status: 'inquiry'`) lässt fehlendes Land weiterhin als
sichtbare Ausnahme `contact_review` stehen; bestehende exakte Kontakte werden in
beiden Modi automatisch wiederverwendet. Die Entscheidung
vom 19.10.2026 (Deutschland als Vorbelegung) ist damit eine
Betriebseinstellung des Deployments, kein fest verdrahteter Domänenwert und
keine Formularangabe: `AK_INQUIRY_DEFAULT_CONTACT_COUNTRY=DE` ist der
beabsichtigte Betreiberstandard, steht aber bewusst nicht im Domänencode.

**Ohne Mandanten-/Betreiberkennung schläft der Lauf, der Worker bleibt gesund.**
`AK_INQUIRY_TENANT_ID` und `AK_INQUIRY_OPERATOR_ID` sind optional. Fehlen beide
(oder sind beide leer), liefert `loadWebsiteOptionConfig` `null`: Der Worker
startet dann **keinen** Takt, protokolliert einmal `website_option_drain_unconfigured`
als Warnung (kein Fehler) und bleibt bereit; Ablaufjob und Inquiry-Sync laufen
unverändert weiter. Alle Website-Eingänge bleiben dadurch als Ausnahmen in der
Eingangsliste sichtbar und lassen sich weiterhin von Hand übernehmen. Das ist
der sichere Zustand für eine frische Installation oder eine Wiederherstellung,
in der die Betreiber-ID (ein Bootstrap-Benutzer dieser Installation) nicht
bekannt ist - die Bereitschaftsanzeige darf nicht an einer optionalen
Einstellung hängen.

Ist genau eine der beiden Kennungen gesetzt oder eine vorhandene Kennung keine
UUID, gilt das als Konfigurationsfehler: `website_option_config_invalid`, der
Lauf bleibt aus und die Bereitschaft sinkt bewusst, weil hier ein Tippfehler
sonst unbemerkt bliebe. Die Bereitschaft lautet jetzt
`expiry && (!drain || drain.ready()) && (!sync || sync.ready())`. Eine kaputte
Sync-Konfiguration kann den Start nicht mehr abbrechen: Sie meldet
`inquiry_sync_config_invalid` und lässt nur den Transport aus.

Die manuelle Route `POST /api/v1/website-inquiries/:id/import` bleibt
unverändert erreichbar (Sitzung, Origin, CSRF, Mandant) und erzeugt jetzt
ebenfalls eine Option – dieselben Semantiken wie der Automatikpfad, damit ein
wiederholter Aufruf idempotent dieselbe Event-/Kontaktzuordnung liefert. Der
Webseiten-Eingang gilt damit nicht mehr als „Anfrage“, sondern als Option; das
ist eine bewusste Verhaltensänderung von API und Oberfläche, keine
Buchungsbestätigung und keine Quittierung im Gateway.

## Aktivierungsgrenze und Rollout (BKP004.1)

Der automatische Takt hat eine eigene, ausdrückliche Aktivierungsgrenze:
`AK_INQUIRY_OPTION_DRAIN`. Die beiden Inquiry-Kennungen allein starten keine
Arbeit mehr. Damit kann ein automatischer Updater zwar eine Version mit der
kontaktlosen Option-Semantik (BKP002) und dem fairen Drain (BKP003) ausrollen,
aber ein bereits konfigurierter Worker konvertiert echte Rückstände nicht ohne
Betreiberentscheid.

| Wert | Wirkung auf den automatischen Takt |
|---|---|
| fehlt | aus, einmalige Warnung `website_option_drain_inactive`, Worker bleibt bereit |
| `off` | wie „fehlt“ |
| `on` | startet wie bisher (BKP003-Semantik unverändert) |
| jeder andere Wert (`1`, `true`, `ON`, Leerstring, `on `) | Konfigurationsfehler `website_option_config_invalid`, kein Takt, nicht bereit |

Es wird bewusst nicht getrimmt und nicht groß-/kleingeschrieben ausgelegt:
`on ` ist ein Tippfehler, den der Betreiber sehen muss, keine stillschweigende
Pause.

**Prüfreihenfolge:** zuerst die bestehende Identitätsregel, dann die
Aktivierung. Fehlen beide Kennungen, bleibt es bei der bisherigen ruhigen
Abwesenheit (`website_option_drain_unconfigured`, bereit) – eine frische oder
wiederhergestellte Installation darf nicht an einer optionalen Einstellung
scheitern. Erst wenn Identitäten vorhanden sind, wird die Aktivierung geprüft;
ein unbrauchbarer Wert ist dann ein Fehler und senkt die Bereitschaft. Grund:
eine Aktivierungsangabe ist nur dort entscheidungsrelevant, wo der Takt
überhaupt laufen könnte.

**Nicht betroffen:** Gateway-Empfang, signierte Abholung, dauerhafte lokale
Ablage (`stageWebsiteInquiry`), Quittung und die manuelle Übernahme
(`POST /api/v1/website-inquiries/:id/import`) arbeiten unabhängig von der
Aktivierung weiter. Die Grenze pausiert ausschließlich den automatischen Takt.
Beide Deploymentvorlagen reichen den Wert inzwischen bewusst pausiert durch
(`compose.yaml` setzt `AK_INQUIRY_OPTION_DRAIN:-off`,
`infrastructure/podman/ak-test-worker.container` trägt `off` explizit; Vertrag:
`tests/ops/deployment-env.test.mjs`). Die Aktivierung `on` ist in keiner Vorlage
vorbelegt und bleibt eine bewusste Betreiberänderung.

**Rollout-Laufplan.** Vor einem Rollout gilt diese Reihenfolge:

1. Zuerst eine **rein lesende** Mengen-/Fehlerübersicht der vorhandenen Eingänge
   **außerhalb Git** und mit den echten Daten erstellen. Dieses Ticket hat eine
   solche Übersicht nicht erstellt und keine Bestandsdaten ausgewertet.
2. Ergebnis als Betreiber prüfen: Wie viele Eingänge liegen noch ohne
   Übernahme, wie alt sind sie, wie viele Optionen sind ohne Kontakt?
3. Erst danach den Takt bewusst mit `AK_INQUIRY_OPTION_DRAIN=on` aktivieren und
   den ersten Lauf beobachten. Die UI-Änderung aus BKP004.2 autorisiert keine
   unbeaufsichtigte Massenübernahme echter Rückstände.

Beispielabfragen (nur lesend, gegen die lokale Core-Datenbank, Platzhalter für
den Mandanten; keine Schreiboperation, keine Ergebnisse gehören ins
Repository):

```sql
-- Eingänge gesamt, übernommen und noch offen, mit den Randzeiten des Rückstands.
SELECT
  count(*)                                      AS staged,
  count(*) FILTER (WHERE i.id IS NOT NULL)      AS converted,
  count(*) FILTER (WHERE i.id IS NULL)          AS pending,
  min(d.staged_at) FILTER (WHERE i.id IS NULL)  AS oldest_pending_staged_at,
  max(d.staged_at)                              AS newest_staged_at
FROM website_inquiry_deliveries d
LEFT JOIN website_inquiries i
  ON i.tenant_id = d.tenant_id AND i.id = d.id
WHERE d.tenant_id = :tenant_id;

-- Übernommene Optionen ohne Kontakt: Anreicherungsbedarf, kein Fehler.
SELECT count(*) AS options_without_contact
FROM website_inquiries
WHERE tenant_id = :tenant_id AND contact_id IS NULL;
```

## Weiterbearbeitung des lokalen Eingangs (E004.12)

`importStagedWebsiteInquiry` liest einen bereits gesicherten Eingang im eigenen
Mandanten und prüft die aktive Betreiberfreigabe erneut. Original-ID und
Empfangs-/Ablaufzeiten müssen mit den gespeicherten Metadaten übereinstimmen;
beschädigte Inhalte werden nicht als Event weiterverarbeitet. Die bestehende
atomare Übernahme verwendet den dokumentierten ersten lokalen Prüfzeitpunkt.
Damit verhindert ein inzwischen abgelaufener Gateway-Termin keine spätere
Kontaktprüfung. Die ursprüngliche Frist wird weder verschoben noch neu erfunden.

Neue Kontakte benötigen weiterhin das ausdrücklich übergebene Land; bei exaktem
bestehendem Kontakt ist kein Land erforderlich. Unklare Zuordnungen werden im
Optionpfad (BKP002) nicht geraten oder zusammengeführt: die Option entsteht
ohne Kontakt, ohne Teilanlage und ohne Veränderung des gesicherten Originals;
der direkte Legacy-Aufruf scheitert weiterhin mit `contact_review`. Eine
spätere Zuordnung erfolgt bewusst am Event; der
[Rückgabe- und Replayvertrag](website-inquiries.md) beschreibt, dass ein anfangs
offenes Receipt auch dann offen bleibt. Parallele
Verarbeitung und Wiederanlauf ergeben dasselbe Event mit derselben
Kontaktzuordnung. Die ursprüngliche Ablage bleibt erhalten; dieser Dienst
quittiert nicht im Gateway und wird noch nicht automatisch oder per HTTP
ausgelöst.

## Sichtbare Prüfung und manuelle Übernahme (E004.13, Heimat seit BKP004.2)

Seit BKP004.2 steht die Prüfoberfläche nicht mehr im Eventbereich, sondern als
ruhiger Einstellungsabschnitt `Einstellungen → Website-Eingänge`
(`#settings-website`, Bereich „Website-Eingänge (Diagnose)“). Sie zeigt nur noch
Eingänge, die nicht automatisch angelegt wurden, und erklärt, dass normale
Eingänge ohne Klick zur Option werden. Das Land ist leer; es ist nur für einen
neu anzulegenden Kontakt nötig. Der Bereich lädt beim Öffnen der Einstellungsseite
selbst und bei der Rückkehr in das Fenster einmal neu, ohne Polling.
Jeder Eintrag lässt sich einzeln mit seinen acht Originalangaben und dem damaligen
Datenschutzhinweis öffnen. Das Länderfeld bleibt leer: nur für einen neu
anzulegenden Kontakt muss der Betreiber ausdrücklich einen zweistelligen Code
angeben. Eine bewusste Übernahme erzeugt ausschließlich eine unverbindliche
Option (H032). Vorhandene Kontakte werden nicht überschrieben und Ressourcen nicht
reserviert. Nicht auflösbare Zuordnungen bleiben unverändert gespeichert und
können nach Prüfung erneut versucht werden. Erfolg wird erst nach bestätigter
Antwort angezeigt; ein anschließender Listenfehler behauptet keinen Rollback.

- `GET /api/v1/website-inquiries?offset=0` liefert ausschließlich im eigenen
  Mandanten noch nicht fachlich übernommene Originale, insgesamt gezählt und mit
  je 25 Einträgen nach lokalem Eingang/ID sortiert. Ein durch parallele Bearbeitung
  zu großer Offset wird auf die letzte vorhandene Seite begrenzt. `no-store`,
  aktuelle Betreiberberechtigung und strikte Queryprüfung sind verpflichtend.
- `POST /api/v1/website-inquiries/:id/import` erwartet ein JSON-Objekt mit optionalem
  `newContactCountry` (zwei Großbuchstaben). Die echte API verlangt Sitzung,
  korrekten Origin und CSRF. Zusätzliche Felder werden abgewiesen. Gleiche
  Wiederholung liefert `duplicate` mit derselben Eventzuordnung und dem
  unveränderten Receipt; die Option kann dabei bewusst ohne Kontakt bleiben
  („Kontakt noch offen“). Nur der direkte Legacy-Aufruf meldet einen
  Zuordnungskonflikt weiterhin als `contact_review`. Unbekannte IDs liefern 404 und
  Speicherfehler eine neutrale 503-Antwort.

Die Darstellung übernimmt die vorhandenen nativen Disclosure-, Formular- und
Definitionlistenmuster. Ein älterer Listenabruf darf einen bereits übernommenen
Eintrag nach neuerem Abruf nicht wieder einblenden. Browserprüfungen umfassen
leeres Land, korrigierbaren Fehler, echte API-Übernahme, aktualisierte Eventliste
und Originalangaben in den Event-Details. Hell/Dunkel werden bei 1280 und 390
Pixeln mit synthetischen Daten und axe geprüft. Die Website selbst ist weiterhin nicht
an diesen lokalen Prüfbereich angeschlossen.

## Ausgehende HTTPS-Abholung (E004.14)

`pullWebsiteInquiries` ruft ausschließlich den festen Pfad
`/sync/v1/inquiries/pull` eines ausdrücklich konfigurierten HTTPS-Origins auf.
URL-Zugangsdaten, fremde Pfade, Querys und Fragmente sind unzulässig. Vor dem
Netzwerkaufruf wird die lokale Betreiberberechtigung geprüft. Jede reine Abholung
bekommt frische Nachrichten-/Operations-IDs und fordert höchstens 100 Eingänge an.
Cookies werden nicht gesendet; Redirects sind verboten. Ziel, Signaturpaket und
Prüfschlüssel werden vor der ersten Wartezeit eingefroren.

Der Abruf verwendet ein festes Zehn-Sekunden-Abbruchsignal für Fetch und Body.
Nur HTTP 200 mit JSON-Inhalt wird verarbeitet. Sowohl angekündigte als auch
wirklich gelesene Antwortbytes sind auf 132.096 begrenzt; Streams werden nach
Abschluss oder Fehler geschlossen. Ungültiges UTF-8 oder JSON und interne
Transportfehler führen zu neutralen Fehlern ohne Eingangsdaten, URLs oder
Schlüssel in Fehlermeldungen. Anschließend prüft der bestehende Batch-Dienst
Signatur, Bezug zum eigenen Pull-Aufruf und aktuelle Zeit nochmals, bevor er
Originale atomar lokal sichert. Eine während des Abrufs abgelaufene Signatur wird
nicht mit der alten Startzeit akzeptiert.

Tests decken signierte Requests/Antworten, echte Gateway-Routen über einen
synthetischen Fetch-Adapter, Rechteprüfung, kaputte/übergroße Streams,
Abbruchsignal, falsch zugeordnete Antworten, Zeitablauf und Wiederholung ab.
Eine öffentliche HTTPS-Installation ist hier noch nicht getestet oder verbunden.
Der Dienst startet keinen Worker und quittiert keine Eingänge. Wiederholtes
Abholen ist lesend und kann bereits gesicherte Originale nicht duplizieren;
Quittierungen benötigen weiterhin eine persistente Outbox und einen eigenen
signierten Empfangsbeleg.

## Dauerhafte Quittierungs-Outbox (E004.15)

Migration `0025_website_inquiry_acknowledgements.sql` ergänzt getrennte Operationen,
Original-Zuordnungen und Versandversuche. `prepareWebsiteInquiryAcknowledgement`
prüft erneut den aktiven Betreiber und erstellt je Mandant höchstens eine offene
Operation mit maximal 100 **bereits vollständig lokal gesicherten** Eingängen.
Fremdschlüssel verhindern die Zuordnung unbekannter oder fremder Originale;
Eindeutigkeit verhindert eine zweite Operation für denselben Eingang. Sortierte
IDs und Operations-ID bleiben bei Wiederholung, Parallelität und Neustart gleich.
Jeder Versuch erhält vor einem späteren Versand eine neue persistente Nachrichten-ID.
Neue Originale warten auf die nächste Operation, statt einen laufenden Batch zu ändern.

`receiveWebsiteInquiryAcknowledgement` akzeptiert ausschließlich zeitgültige,
signierte `inquiries.receipt`-Pakete. Der Bezug muss zu einem dauerhaft gespeicherten
eigenen Versuch gehören; der Zähler muss zwischen null und dessen Batchgröße liegen.
Null ist nach zwischenzeitlichem Gateway-Ablauf zulässig: Die Originale sind bereits
lokal vollständig vorhanden. Fehlende, unpassende, fremde oder ungültige Belege
schließen keine Operation ab. Technischer Replay-Beleg und Abschluss werden atomar
geschrieben. Ein verspäteter Beleg kann niemals eine neuere Operation abschließen.
Lokale Originale bleiben einschließlich ungeklärter Kontaktzuordnung erhalten.

Der Dienst führt keinen HTTP-Aufruf aus und ist noch nicht automatisch aktiviert.
Der Sender muss einen vorbereiteten Versuch **erst nach Commit** versenden; nach
verlorener Antwort wird dieselbe Operation mit frischer Versuch-ID erneut gesendet.
Migration ist rein additiv. Bestehender Backup-/Restore-Probelauf prüft nun auch den
offenen Quittierungsauftrag samt unveränderter Originalzuordnung und erneutem Versuch.
Aufbewahrung/Bereinigung technischer Belege bleibt vor öffentlichem Dauerbetrieb
festzulegen; hier werden keine Daten automatisch entfernt.

## Quittierungsversand über HTTPS (E004.16)

`acknowledgeWebsiteInquiries` bereitet genau einen Versuch vor und wartet auf dessen
lokalen Commit, bevor `/sync/v1/inquiries/ack` aufgerufen wird. Ungültige
Transportkonfiguration oder fehlende Betreiberrechte öffnen keine Verbindung.
Ohne offenen Eingang bleibt der Lauf ohne HTTP-Aufruf. Abruf und Quittierung teilen
dieselbe HTTPS-Origin-Prüfung, Schlüsselkopie und begrenzte JSON-Übertragung:
keine URL-Zugangsdaten/Querys/Redirects/Cookies, zehn Sekunden und 132.096 Antwortbytes.

Jeder Versand wird frisch signiert; die Operations-ID und sortierten Original-IDs
bleiben für denselben offenen Auftrag erhalten. Die Antwort muss zusätzlich zum
persistenten Versuch **genau zum aktuellen HTTP-Aufruf** gehören und zur aktuellen
Empfangszeit gültig signiert sein. Erst der bestehende transaktionale Empfangsdienst
schließt den Auftrag ab. Transport-, Signatur-, Zuordnungs- oder lokale Fehler
lassen ihn wiederaufnehmbar. Ein bereits im Gateway bestätigter, aber lokal wegen
verlorener Antwort offener Auftrag wird mit derselben Operation erneut versucht.

Der Vertragstest verwendet die echten getrennten Gateway-Routen und eine eigene
Gateway-Datenbank: Nach verlorenem Empfangsbeleg ist dort der verschlüsselte Inhalt
bereits entfernt; nach lokalem Pool-Neustart liefert der Retry den persistenten
Gateway-Beleg ohne zweite ACK-Wirkung. Das vollständige lokale Original bleibt
unverändert und es wird kein Event automatisch angelegt. Zusätzliche Tests prüfen
unter anderem unpassende signierte Belege, Zeitablauf während des Transfers,
Timeouts und fehlende Rechte. Es ist weiterhin kein öffentlicher HTTPS-Dienst
angeschlossen und kein automatischer Worker gestartet.

## Öffentlicher Browser-Client (E004.17)

Die unveränderte Formularbeschreibung und ihr Einsendungstyp liegen jetzt in
`inquiry-form-definition.ts`. Servervalidierung und Widget verwenden dieselben
acht Felder, Paketwerte und Datenschutzangaben. Der eigene Paket-Unterpfad enthält
keine Datenbank-, Node- oder Validierungsserver-Importe. Vite baut daraus ein
kleines ES-Modul unter `apps/widget/dist/inquiry-widget.js`; es ist noch kein
installiertes WordPress-Formular.

`createInquirySubmission` friert eine Einsendung einschließlich zufälliger ID und
Honeypot als Request-Text im Arbeitsspeicher ein. Änderungen am ursprünglichen
Objekt ändern diesen Versuch nicht. Parallele Aufrufe teilen denselben laufenden
Request; nach verlorener Antwort verwendet ein erneuter Aufruf dieselbe ID und
denselben Inhalt. Erst eine streng geprüfte HTTP-202-Antwort mit ausschließlich
`status: received` gilt als Eingang. Danach sendet derselbe Versuch nicht erneut
und gibt den gespeicherten Request-Text frei. Das ist keine Buchungsbestätigung.

Ziel ist ausschließlich die feste versionierte Formularroute eines HTTPS-Origins
ohne Zugangsdaten, weitere Pfade, Query oder Fragment. Cookies und Redirects sind
ausgeschlossen; Antwortzeit und -größe sind auf zehn Sekunden beziehungsweise
4.096 Bytes begrenzt. Fehler enthalten keine Servertexte oder Eingaben. Der Client
speichert nichts in URLs, Browserstorage oder Logs. Er ersetzt nicht die weiterhin
maßgebliche serverseitige Prüfung. Ein unklarer Sendeversuch muss in der Oberfläche
unverändert erneut versucht werden, statt nach Bearbeitung eine neue ID zu erzeugen.
Die bedienbare Einbettung und Browserabnahme folgen getrennt; keine echte Anfrage
wurde versandt und die bestehende Website bleibt unverändert.

## Einbettbare Formular-Komponente (E004.18)

FORM-UI-01: Das Websiteformular verwendet unabhängig vom Geräteschema die
helle Darstellung. Das optionale Kommentarfeld heißt sichtbar „Details zur
Veranstaltung“; sein technischer Feldname bleibt unverändert. Das gewählte
Paket wird nur im Auswahlfeld gezeigt. Die Eingangsbestätigung kündigt die vom
Betreiber gewünschte Rückmeldung innerhalb von 24 Stunden an.

`mountInquiryForm(element, { gatewayOrigin })` rendert genau die bisherigen acht
Felder in einem offenen Shadow DOM. Externe Website-Regeln verändern die Eingaben
nicht; ein vom Modulstandort aufgelöstes externes Stylesheet wird vor dem Formular
abgewartet. Es braucht keine Inline-Styles. Ladenfehler erhalten eine neutrale
zugängliche Meldung. Der Rückgabewert bietet `unmount()`; ein belegter fremder
Shadow-Bereich wird nicht überschrieben. `InquiryForm` ist zusätzlich als
React-Komponente exportiert; die Stylesheet-Regeln erwarten ihre isolierte Einbettung.

Native Pflichtfeld-/E-Mail-/Datumsprüfung, ursprüngliche Paketwerte und der vorhandene
Datenschutzhinweis bleiben bestehen. Ein unsichtbares Honeypot-Feld ist keine weitere
Kundenangabe. Der Datepicker folgt der Browsersprache. Lange ausgewählte Pakettexte
werden zusätzlich umbrechend lesbar. Während des Sendens sind Kontrollen gesperrt;
bei unklarem Ergebnis bleiben Texte schreibgeschützt kopierbar und derselbe Versuch
wird erneut gesendet. Nur eine ausdrückliche Serverablehnung gibt die Angaben zur
Korrektur frei. Die Bestätigung nennt keine persönlichen Daten und verspricht keine
Buchung. Fehler beziehungsweise Erfolg erhalten Fokus; nach einer Wiederholung
gehen keine Eingaben in eine neue ID über. Eingaben bleiben nur im Arbeitsspeicher
dieser Seite; Neuladen beginnt einen neuen Versuch.

Das Admin-Image enthält die beiden öffentlichen statischen Dateien unter
`/inquiry-widget/inquiry-widget.js` und `/inquiry-widget/inquiry-widget.css`.
Nur diese zwei statischen Dateien erlauben fremden Origins lesenden Zugriff ohne
Credentials; private App-Routen erhalten keine solche CORS-Freigabe. Der isolierte
Container-Probelauf prüft MIME-Typen, die begrenzte CORS-Freigabe und bestehende
Sicherheitsheader. Diese Dateien enthalten
keinen Mandantenschlüssel, private API-URL oder Zugangsdaten. Beispiel für eine
**später zu konfigurierende** Einbettung, nicht auf der echten Website installiert:

```html
<div id="fotobox-anfrage"></div>
<script type="module">
  import { mountInquiryForm } from '/inquiry-widget/inquiry-widget.js';
  mountInquiryForm(document.getElementById('fotobox-anfrage'), {
    gatewayOrigin: 'https://gateway.example.invalid',
  });
</script>
```

Für WordPress müssen Script-/Stylesheet-Hosting, dessen CSP und der tatsächlich
betriebene öffentliche Gateway samt erlaubtem Website-Origin zusammenpassen.
`gateway.example.invalid` ist absichtlich kein erreichbares Ziel. Der lokale
Core wird nicht als öffentliche Formular-API verwendet. Ein automatischer lokaler
Abhol-/Quittierungslauf ist weiterhin separat einzurichten. Die echte Website
bleibt unverändert; es wurden ausschließlich synthetische Einsendungen geprüft.

Chromium prüft native Pflichtangaben, alle acht übermittelten Werte, echten
verschlüsselten Gateway-Eingang, verlorenen Empfangsbeleg ohne Dublette,
Tastatur/Fokus, unveränderten Retry und leeren Browserstorage. Hell/Dunkel bei
390/768/1440 Pixeln sowie Fehler/Erfolg sind mit axe und Screenshot abgenommen.
Die Gestaltung erweitert die bestehende Formularvorschau mit deren Systemschrift
und Farbrollen. Formulare bearbeiten und mehrere Formulartypen bleiben spätere
Ausbauschritte. Physische iOS-/Android-Geräte sind damit noch nicht geprüft.

Design-/Review-Nachweis: Die endgültige Widget-CSS wurde mit
`apps/admin/src/styles.css`, `apps/admin/DESIGN.md` und dessen
`.impeccable/design.json` verglichen. Hell-/Dunkel-Farbpaare für Flächen, Text,
Aktionen, Felder, Fokus und Fehler sowie Systemschrift, Kontrollradius,
Mindesthöhe und Druckimpuls übernehmen die bestehende Sprache. Das eigene
52rem-Formular, die Legende und der Wechsel auf eine Spalte bis 600px sind lokale
Komponentenvarianten. Die beiden bestehenden Design-Systemdateien bleiben
unverändert; daraus entstehen keine neuen globalen Regeln.

Der unabhängige Finish-Review lautet `ship` für den vorliegenden Komponenten- und
Captureumfang, ohne materielle Korrekturen. Acht vorhandene axe-Prüfungen meldeten
keine Befunde; vier Chromium-Abläufe einschließlich synthetischer Einsendung am
öffentlichen Test-Gateway waren grün. Der Impeccable-Detector lieferte beim
endgültigen UI-Quellstand `[]`, das Taste-Quelllint 0 FAIL/0 WARN. Der zusätzliche
Taste-Browserinspektor erfasste nur die private Vorschauhülle außerhalb des
Shadow DOM; seine Auswertung belegt deshalb keine automatische Prüfung der
Formularkomponente. Die Komponenten-Captures wurden separat visuell geprüft.
Physische Geräte und eine echte WordPress-Anbindung bleiben offen. Der
Impeccable-Launcher war nicht direkt ausführbar; der Kontext wurde direkt gelesen,
die Documenter-Rolle durch einen generischen Ersatzagenten übernommen.
