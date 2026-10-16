# Bookitup sichern und AuftragsKompass früher starten

Stand: 16.10.2026. Neue Priorität des Inhabers: mögliche kurzfristige Beendigung
von Bookitup. Diese Lieferentscheidung ergänzt den
[Implementierungsplan](../IMPLEMENTATION_PLAN.md) und hat für den ersten Livegang
Vorrang vor dem bisherigen Vollumfang. Sie ist keine Produktivfreigabe.

## Entscheidung

AuftragsKompass startet als interne Auftrags- und Ressourcenverwaltung. M5
(Online-Verträge/Fragebögen) und M6 (Aufgaben/Auswertungen) folgen später. Für den
schnellsten Ausstieg werden zunächst auch M3 (integrierte E-Mail), M4
(Geschäftsdokumente) und M2 (öffentliches Widget/Gateway) zurückgestellt.
Die bisherigen Module und Slice-IDs bleiben als Ausbauplan erhalten.

Das spart Funktionen, aber keine notwendigen Betriebsabläufe: E-Mail, Anfragen,
Angebote, Rechnungen, Zahlungen, Kundentermine und bestehende Zusagen benötigen
vor der Umschaltung jeweils einen geprüften Ersatz. Die unten genannten
Übergangslösungen sind Vorschläge; ihre tatsächliche Verfügbarkeit ist noch offen.

**Aktuell kein kündigungssicherer Datenstand:** Chrome zeigt die Bookitup-Anmeldung.
Es wurden für diesen Auftrag noch keine Kontodaten oder Originalbelege exportiert.
Zugriffsende und Exportumfang sind unbekannt. Ein vorbereiteter Sicherungsordner
ist keine Datensicherung. Kündigung, Kontolöschung und Nachrichtenversand sind
nicht Bestandteil dieses Auftrags.

## Sofort: Daten sichern, danach gezielt importieren

Das bisherige Lastenheft schloss historische Belege und E-Mails vom Import aus.
Für den Ausstieg gilt stattdessen: Alle noch benötigten historischen, laufenden
und zukünftigen Geschäftsdaten werden unabhängig von späteren App-Modulen
gesichert. Nur der operative Teil muss für den ersten Livegang in die Datenbank.
Ein offline lesbares Archiv darf daher umfangreicher sein als der Erstimport.

Reihenfolge bei knappem Zugang: laufende/zukünftige Zusagen und offene Finanzen,
Originalbelege, vollständiger Bestand, Vorlagen/Einstellungen. Dabei den
Gesamtexport früh starten, sofern angeboten. Zeitraumfilter müssen die gesamte
Historie und Zukunft einschließen; zusätzlich undatierte, archivierte,
annullierte und stornierte Vorgänge prüfen. Kein Export darf Quelldaten verändern.

| Datenbereich | Zu sichern | Kontrolle und Verwendung |
|---|---|---|
| Kontakte/Firmen/Ansprechpartner | Alle benötigten Kontaktdaten, Adressen, Beziehungen, eigene Felder, Alt-IDs, Archivkennzeichen | Anzahl mit Quelle abgleichen; bekannte Dubletten erhalten und melden; aktive Beziehungen importieren |
| Events sämtlicher Zeiträume | Status, Datum/Uhrzeit/Zeitzone, Ort, Paket, Ansprechpartner, Notizen, eigene Felder, Produkte, Anhänge und Alt-ID | Alle Seiten/Status/Zeiträume prüfen; undatierte Vorgänge getrennt zählen; aktive und zukünftige Aufträge importieren |
| Zusagen und Disposition | Optionen, Fristen, Abhol-/Rückgabe-/Aufbauzeiten, Zubehör und tatsächliche Box | Jeden zukünftigen Auftrag persönlich FB1/FB2 zuordnen; fehlende Zuordnungen niemals als frei behandeln |
| Angebote/Aufträge/Verträge | Entwürfe, gültige/angenommene/abgelehnte/abgelaufene Angebote, Auftragsbestätigungen, unterschriebene Originale und verfügbare Nachweise | Historische Originale behalten; offene Zusagen samt Bedingungen und Fristen separat erfassen |
| Rechnungen und Zahlungen | Alle Originalrechnungen, Anzahlungen, Schlussrechnungen, Korrekturen/Stornos, Positionen, Steuer, Zahlungsdaten, Fälligkeiten und Salden | Anzahl und Summen je Jahr/Belegart/Status vergleichen; Belegketten und offene Posten abstimmen; keine Belege neu ausstellen |
| Nummernkreise | Schema, letzter verwendeter Wert, reservierte/vergebene Nummern und Entwürfe | Abgleich gegen Belegbestand; neue Ausgabe erst nach Festlegung kollisionsfreier Fortsetzung im Rechnungssystem |
| E-Mail | Benötigte ein-/ausgehende Nachrichten mit Datum, Headern und Anhängen, Entwürfe, geplante Nachrichten, Bookitup-Zuordnungen und Unerledigt-Status | IMAP-Postfach unabhängig prüfen: Nur dort nachweislich vorhandene Nachrichten gelten dort als gesichert; Bookitup-exklusive Inhalte zusätzlich exportieren |
| Dateien und Kundenportal | Eventdateien, Standarddateien, Logos, bereitgestellte Dokumente, Antworten/Uploads und Signaturnachweise | Originaldateien herunterladen; Links oder Bildschirmansichten ersetzen keine Originale; ausstehende Portalvorgänge erfassen |
| Stammdaten/Vorlagen | Produkte mit exakten Preisen/Steuern/Einheiten, Pakete, Eventarten, Orte, Ressourcen, Absagegründe, E-Mail-/Dokument-/Vertrags-/Fragebogenvorlagen | Inhalt, Platzhalter, Formatierung und Standardanhänge erhalten; echte Werte übernehmen, fehlende nicht erfinden |
| Aufgaben/Logbuch/Automationen | Offene Aufgaben/Fälligkeiten, relevante Historie, Erinnerungsregeln, geplante Aktionen | Offene Verpflichtungen in Übergangscheckliste übernehmen; automatische Kundennachrichten zum Stichtag kontrolliert umstellen |
| Integrationen und Gestaltung | Vier bisher erfasste Website-Anbindungen, Kalender, Absender/Signatur, Dokumentgestaltung, Portal- und Formularverweise | Abhängigkeiten inventarisieren; Zugangsdaten getrennt halten; Ersatz testen, bevor Verbindungen abgeschaltet werden |

Die frühere Bestandsaufnahme nennt 226 Kontakte, elf Mailvorlagen, acht
Standarddateien und vier Website-Anbindungen. Das sind Suchhinweise, keine
aktuellen Sollzahlen. Aktuelle Mengen müssen im angemeldeten Konto ermittelt
werden. Die fünf bestätigten Eventarten bleiben Startwerte; zusätzliche echte
Bestandswerte werden beim Abgleich erhalten.

### Sicherungsablauf und Abnahme

1. Außerhalb des Git-Verzeichnisses einen privaten datierten Ordner verwenden,
   beispielsweise `/Users/gp/Documents/AuftragsKompass-Sicherung/bookitup-2026-10-16`.
   Ordnerrechte 700, Dateirechte 600; keine Exporte in Repository, GitHub,
   Testdaten oder öffentliche Protokolle. Browser-Zwischendownloads ebenfalls
   schützen. Freier lokaler Speicher wurde geprüft; Umfang ist noch unbekannt.
2. Exportmöglichkeiten im Konto prüfen. Native CSV/JSON/ZIP/PDF/EML-Exporte und
   Originaldownloads bevorzugen. Kalender-ICS nur ergänzend sichern: Es ersetzt
   weder Kontakte noch Belege noch die vollständige Eventhistorie.
3. Pro Bereich Quelle/Filter, Abrufzeit, Format, Anzahl, Zeitraum, Dateigröße,
   SHA-256 und offene Lücken in einem **privaten** Manifest festhalten. Fehlende
   Exportwege ausdrücklich als offen markieren. Keine Vollständigkeit behaupten,
   wenn nur die aktuelle Listenseite gespeichert wurde.
4. Exportdateien öffnen/parsen, Archive auf Lesbarkeit prüfen und Referenzen
   abgleichen. Stichproben: ältester/neuster, laufender/zukünftiger, undatierter,
   annullierter Auftrag, Teilzahlung/Korrektur und signiertes Original. Anhänge
   dürfen keine ablaufenden URLs anstelle der Dateien sein.
5. Falls die Oberfläche Bereiche nicht exportiert: Download je Vorgang oder
   Anbieter-Gesamtexport als nächste Möglichkeit festhalten. Eine Supportanfrage
   wird erst nach ausdrücklichem Versandauftrag versendet. Unexportierbare Inhalte
   bleiben bis zum geprüften Erhalt eine offene Lücke.
6. Zweite verschlüsselte Kopie auf einem vom Inhaber bestimmten unabhängigen
   Ziel erstellen und daraus testweise Dateien wiederherstellen. Ein zweiter
   Ordner auf derselben SSD erfüllt das nicht. Keine unbestätigte Cloudfreigabe.
   Dateirechte und Prüfsummen allein sind keine Verschlüsselung oder revisionssichere Archivierung.
7. Beim späteren Stichtag erneuten Export/Delta inklusive Änderungen, neuer
   Belege, Zahlungen und gelöschter/archivierter Zuordnungen erfassen. Initialexport
   unverändert behalten. Nur geprüfte Daten in den operativen Kern übernehmen.

## Was zum ersten Livegang gehört

| Bereich | Entscheidung | Ersatz bzw. Freigabebedingung |
|---|---|---|
| M1 Datenkern/Disposition | Behalten; derzeit bis C021 vorbereitet | C022–C025: DB-Konfliktschutz, echte Buchung/Zubehör/Terminwechsel, Wartungssperren und nutzbarer Kalender |
| Smartphone-Kalender | C026 behalten, wenn bestehendes Abo weiter benötigt wird | TLS/Tokenzugriff testen; andernfalls ausdrücklich vereinbarter, gepflegter Übergangskalender; keine ungeschützte Admin-API |
| M2 Website/Widget | Später | Bestehende WordPress-Formulare direkt an eigenes Postfach liefern lassen; alle vier Pfade testen, manuelle Eventanlage; keine automatische Verfügbarkeitszusage |
| M3 Kommunikation | Für schnellen Ausstieg später | Vorhandener unabhängiger Mailclient samt Originalpostfach; lokale Vorlagentexte/Signatur, manuelle Zuordnung und tägliche Wiedervorlage |
| M4 Geschäftsdokumente | Nur mit geprüftem Ersatz später | Bereits vorhandene unabhängige Rechnungslösung, sofern vorhanden; sonst zuerst minimalen externen Ablauf festlegen und durchspielen. PDF-Archiv allein kann keine neuen Rechnungen erstellen |
| M5 Verträge/Fragebögen | Später | Bestehende unterschriebene Dokumente sichern; neue Vereinbarungen und benötigte Eventfragen über den freigegebenen bisherigen E-Mail-/PDF-Prozess; offene Kundenlinks gezielt ersetzen |
| M6 Aufgaben/Auswertungen | Später | Einfache vorhandene Aufgabenliste/Kalendererinnerungen; aktive Fristen übernehmen, keine neue Aufgaben-Engine bauen |
| M7 Migration/Betrieb | Notwendige Teile vorziehen | Mindestimport, Ressourcenabgleich, Zugriffsschutz, tägliche verschlüsselte Sicherung, unabhängige Kopie, Restore, Update-/Ausfallverfahren und Abnahme bleiben verpflichtend |

Keine neue Zwischenlösung für Mail, PDF-Rendering oder Signaturen programmieren.
Das wäre ein zweites Produkt. Reicht der bestehende externe Rechnungsablauf nicht,
ist M4 kein streichbarer Terminblocker, bevor ein nutzbarer Ersatz feststeht.
Später werden die verschobenen Module in der bisherigen fachlichen Reihenfolge
wieder aufgenommen; bereits implementierte Stammdaten bleiben erhalten.

## Verbindliche verkürzte Lieferfolge

Für diese Sonderstrecke bleibt jeder Code-Slice einzeln getestet, dokumentiert,
committet und unmittelbar gepusht. E-IDs sind zusätzliche Arbeitsaufträge, keine
Umnummerierung oder Erledigung der bisherigen C-Slices. Original-Slices werden
nur bei vollständiger Erfüllung ihrer eigenen Abnahme abgehakt.

| Auftrag | Umfang | Abnahme |
|---|---|---|
| E001 – Ausstiegsplanung | Sicherungsmatrix, reduzierter Umfang und Releasebedingungen dokumentieren | Dokumentationsprüfung grün; keine echten Kundendaten im Commit |
| E002 – Sicherung | Nach Anmeldung echten Gesamtbestand und Originaldateien sichern; private Mengen-/Lückenliste | Offline lesbar, Mengen/Summen geprüft, zweite verschlüsselte Kopie wiederhergestellt; Lücken sichtbar |
| C022 | Überlappungsschutz in PostgreSQL | Gleichzeitige Buchungsversuche, unterschiedliche Boxen, angrenzende Intervalle, Sperren, Rollback und Neustart |
| C023 | Ressourcen zuweisen, verbindlich buchen, Termin/Ressourcen atomar wechseln | API-/Komponenten-/Browserfälle; Konflikt erhält die alte Buchung; keine Doppelzusage |
| C024 | Wartungssperren | Konflikte, Freigabe und Historie |
| C025 | Interner Kalender | Nutzbare Disposition mit Boxen, Zubehör, Puffern, Optionen und Sperren |
| E003 – Minimalimport | Eigenständiger Teil aus C074/C075: Kontakte, Locations, Arten/Pakete und operative Events; Alt-ID-Mapping, Dry-run, Fehlerbericht, idempotente Wiederholung | Synthetischer Integrationstest inklusive Tenantbindung, Statusmapping, Dubletten, fehlenden Referenzen und Rollback; echter lokaler Abgleich getrennt von CI |
| C076 | Reale künftige Buchungen und Zubehör zuordnen | Jeder Auftrag vollständig geprüft oder als ungelöster Konflikt sichtbar; keine Freigabe bei ungeklärter Kapazität |
| E004 – Übergangsprozesse | Formulare, Postfach, Angebote/Rechnungen, Zahlungen, Aufgaben und Kundenlinks umstellen | Echter Betreiber-Probelauf; Originalbelege und Nummern bleiben erhalten; Eingang über alle Website-Pfade nachgewiesen |
| C026 | Kalender-Abo, sofern für den Start beibehalten | Auf dem verwendeten Smartphone getestet, Widerruf und Storno nachgewiesen |
| E005 – Betrieb | Auf kleinen Umfang begrenzte Vorziehung aus C078–C083: echte OIDC-Anmeldung/TLS, Benutzerfreigaben, Backup/Restore, Updates, Ausfallverfahren und Prüfung aller tatsächlich aktiven Endpunkte | Frische Umgebung aus Sicherung wiederhergestellt; fremder Mandant/unerlaubter Benutzer abgewiesen; täglicher Lauf mit Fehlerüberwachung und unabhängiger Kopie |
| E006 – Umschaltprobe/Release | Vorgezogener kleiner Umfang aus C027/C084/C085 mit Deltaimport und Betreiberabnahme | Gesamte Suite für enthaltene Module grün; Ablauf unten erfolgreich; dokumentierte Version und Rückfallpunkt |

E002 kann während der Dispositionsentwicklung weiterlaufen; es werden trotzdem
keine zwei Implementierungs-Slices vermischt. Als Nächstes: zuerst sichern,
dann C022, dann C023. Nach der Anmeldung und Sichtung der tatsächlichen Exporte
wird der Importumfang präzisiert. Ohne Zugang, Zugriffsende, Exportformate und
Rechnungsersatz ist ein belastbarer Live-Termin noch nicht ableitbar.

## Umschaltprobe und Freigabe

1. Kontakt und Anfrage über jeden noch aktiven Websiteweg empfangen und in
   AuftragsKompass anlegen; zwei parallele Termine auf FB1/FB2 buchen, dritte
   Buchung ablehnen; Zubehör, Puffer, Wartung und Terminwechsel prüfen.
2. Angebot, Annahme, Anzahlung, Schlussrechnung, Teilzahlung und Korrektur im
   gewählten externen Prozess durchführen; Verantwortlichkeit und Nummernkreise
   dokumentieren. Reale Altbelege bleiben unverändert.
3. Alle laufenden Kundenfälle einschließlich offener Angebote, unbeantworteter
   Anfragen, Fristen, Forderungen und zugesagter Leistungen abgleichen. Alle
   zukünftigen Buchungen mit physischer Ressource und Zubehör bestätigen.
4. Restore, reale Anmeldung und vereinbarte Kalendernutzung testen. Zugriff auf
   historische Originale ohne Bookitup und unabhängig von Online-Links nachweisen.
5. Zeitpunkt mit kurzer Schreibpause festlegen, letztes Delta übernehmen,
   Summen/Zuordnungen bestätigen und danach nur noch im neuen führenden System
   buchen. Währenddessen eingehende Anfragen separat nachtragen. Kein paralleler
   unkontrollierter Buchungsbetrieb. Alte Automationen erst kontrolliert stoppen,
   wenn der Ersatz funktioniert; Anbieterzugang nicht vorschnell löschen.
6. Bei Fehlversuch Umschaltung abbrechen: solange verfügbar Bookitup weiter als
   führendes System verwenden; andernfalls geprüfte private Auftragsliste und
   Originalarchiv als dokumentierten Notbetrieb nutzen, keine ungeprüften
   Kapazitätszusagen. Neue Vorgänge seit der Probe müssen erhalten bleiben.

**Freigabe:** Archiv vollständig genug für die benötigten Geschäftsvorgänge,
operative Bestände/Summen abgeglichen, Ersatzprozesse nutzbar und Betrieb geprüft.
Vertragsende und Datenzugriffsende sind getrennt festzustellen. Der Plan beweist
weder verbleibenden Anbieterzugriff nach Kündigung noch eine gesetzeskonforme
Langzeitarchivierung; Aufbewahrungs- und Rechnungsanforderungen bleiben fachlich
zu bestätigen. Es wird weder eine automatische Kündigung noch eine Löschung
ausgelöst.

## Geprüfte externe Hinweise

Die öffentliche [Bookitup-Hilfe](https://bookitup.de/hilfe/) und die
[Dokumentvorlagen-Hilfe](https://bookitup.de/hilfe/dokument-vorlagen/) belegen
getrennte Vorlagenbereiche; sie belegen keinen vollständigen Kontogesamtexport.
Die [Kalender-Hilfe](https://bookitup.de/hilfe/kalender-verbinden/) beschreibt
Eventübertragung mit Status, Ort und Notizen sowie Entfernung annullierter
Events. Ein Kalenderabzug allein ist deshalb kein vollständiges Archiv.
