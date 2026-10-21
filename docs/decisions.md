# Präzisierungen aus der Planprüfung

Stand: 18.09.2026. Ergänzung zum [Lastenheft](../Lastenheft_Fotobox-Verwaltung_MVP.md) und zum [Implementierungsplan](../IMPLEMENTATION_PLAN.md). Dies sind umzusetzende Regeln, keine Behauptung bereits bestandener Produkttests.

**Übersteuerung am 16.10.2026:** Der [Ausstiegsplan](bookitup-exit.md) erlaubt
einen früheren Erststart mit geprüften externen Mail-/Dokumentprozessen und
vorgezogenen Migrations-/Betriebsabnahmen. Frühere Aussagen unten über M7 als
einzigen Ablösezeitpunkt und den Ausschluss historischer Archive/E-Mails gelten
nicht mehr für die Datensicherung. Benötigte Historie muss unabhängig von
Bookitup erhalten bleiben; der operative Erstimport bleibt klein. Die übrigen
fachlichen Sicherheitsregeln gelten weiterhin.

## Lieferumfang und Abhängigkeiten

Die Planprüfung bezog sich auf den damaligen reinen Dokumentationsstand nach C001. Den aktuellen Umsetzungsstand führt der Implementierungsplan. M1 ermöglicht interne Disposition, M7 erst die vollständige Ablösung. Vor echten Geschäftsdaten sind Zugriffsschutz, tägliche Sicherung mit geprüftem Restore und kontrollierte Übernahme der betreffenden Bestandsdaten erforderlich. Insbesondere darf ein leerer Kalender nicht als freie Kapazität veröffentlicht werden, solange zukünftige Bestandsbuchungen noch fehlen (C027, C037, C076).

Die bisherige Dateispeicherung C046 wird C038, die bisherigen C038–C045 werden C039–C046. Damit stehen Storage, Quarantäne und unveränderbare Dateiversionen vor SMTP-Anhängen, Vorlagen und Editor bereit. Diese Änderung betrifft ausschließlich noch nicht implementierte Schritte. Signaturabschluss und automatische Buchung werden erst gemeinsam mit C061 freigegeben; C060 allein schaltet diesen Weg nicht produktiv frei.

## Reservierung, Zeit und parallele Bearbeitung

C021–C024 verwenden halboffene Intervalle `[Beginn, Ende)` mit `Beginn < Ende`. Angrenzende Intervalle dürfen sich berühren. Puffer werden genau einmal auf den ausdrücklich gespeicherten Dispositionszeitraum angewandt. Standardmäßig wird dieser aus dem Eventtermin abgeleitet; eine manuelle Abweichung ist sichtbar und wird bei Terminänderung ausdrücklich überprüft.

Ein Puffertag bedeutet einen Kalendertag in der Mandantenzeitzone, nicht stets 24 Stunden. UTC speichert die resultierenden Zeitpunkte. Tests umfassen beide Zeitumstellungen, mehrtägige Events, fehlende Termine und direkt angrenzende Belegungen. Events ohne belastbaren Zeitraum können nicht fest gebucht werden.

Jede physische Box und jedes Zubehörstück ist eine eigene disponierbare Einheit. Ein Bestand größer eins bedeutet mehrere Einheiten; ein Exclusion Constraint auf einer einzigen Sammelressource würde diese Kapazität falsch modellieren. Wartungssperren und feste Buchungen unterliegen demselben Überlappungsschutz. Bestandsreduzierung oder Archivierung darf zugesagte zukünftige Belegungen nicht stillschweigend entfernen.

Der Wechsel auf „Gebucht“, das Zuweisen aller erforderlichen Einheiten und das Freigeben alter Belegungen erfolgen atomar. Scheitert eine Termin- oder Ressourcenänderung, bleibt die alte Buchung erhalten. Änderungen an Standardpuffern verändern bestehende Zusagen nicht rückwirkend ohne Konfliktprüfung und Bestätigung. Wechsel zurück auf Anfrage/Option lösen feste Belegungen bewusst in Vormerkungen auf; Annullieren/Nicht verfügbar hebt zukünftige Reservierungen auf und erhält die Historie. Alle Schreibwege, auch Import und Signatur, nutzen dieselben Regeln.

Öffentliche Vormerkungen erhalten eine konfigurierbare Ablaufzeit. Ablauf wird bereits in jeder Verfügbarkeitsabfrage berücksichtigt; ein ausgefallener Bereinigungsjob darf keine Kapazität dauerhaft blockieren. Vormerkungen sind keine feste Zusage, konkurrierende Optionen bleiben sichtbar. Wiederholung derselben Anfrage verlängert die Frist nicht automatisch. C018 und C023 verwenden Versionsprüfungen, damit parallele Browserfenster Änderungen nicht unbemerkt überschreiben.

## Gateway, Signatur und Dateibereitstellung

C028–C036 trennen öffentliche anonymisierte Verfügbarkeit von persönlichen, token-geschützten Vorgängen. Widget-Kennungen und Origin-Listen sind kein Ersatz für Authentifizierung oder Spam-Schutz. Signierte Nachrichten benötigen Mandantenbindung, Nachrichten-ID, Schema-Version, begrenzte Gültigkeit und Schutz gegen Wiederholung. Ältere Snapshot-Versionen dürfen neuere nicht überschreiben. Im Normalbetrieb gilt eine Aktualisierung binnen 60 Sekunden; bei Überschreitung zeigt das Widget den Stand als veraltet.

Ein Gateway bestätigt zunächst nur den Eingang einer Anfrage. Erst nach lokaler Transaktion sind Kontakt, Event und Vormerkung übernommen. Abholung, lokale Speicherung und Quittierung müssen nach Abstürzen ohne Doppelanlage wiederholbar sein. Zwischenablagen sind verschlüsselt, zugriffsbeschränkt und nach bestätigter Übernahme zu löschen; eine konfigurierbare Maximalfrist mit Fehleranzeige begrenzt auch nicht abgeholte Einsendungen. Abgelaufene Einträge werden nicht stillschweigend als übernommen dargestellt.

C058–C061 übertragen Signaturen als idempotente Abschlussaufträge an den lokalen Kern. Während dieser offline ist, zeigt die Kundenseite „Abschluss ausstehend“ und keine Buchungsbestätigung. Der Kern prüft Token, Version, Pflichtfelder und gegebenenfalls Ressourcen erneut. Abschlussdaten, Dokumentinhalt/Hash, Ressourcen, Status und Outbox werden in einer lokalen Transaktion festgeschrieben. Die automatische Buchung bleibt pro Event optional.

PDF-Rendering, Dateisystem und SMTP sind nicht Teil einer PostgreSQL-Transaktion. Deshalb wird der endgültige Dokumentinhalt unveränderbar gespeichert; ein wiederanlaufbarer Job erzeugt daraus das Artefakt, prüft dessen Hash und stellt es erst nach erfolgreicher Speicherung bereit. Ein Speicher-/Rendererfehler ist sichtbar, bewirkt keine erneute Signatur oder Buchung und keinen vorzeitigen Versand. Tests simulieren Crash vor/nach Commit, verlorene Quittierung, doppelte Signatur, geänderte Vertragsversion, Ressourcenverlust und fehlgeschlagenes Rendering. Kann die Ressourcenprüfung nicht bestehen, entsteht kein abgeschlossener Vertrag mit zugesagter Buchung.

Persönliche Vertragskopien, Fragebögen und Downloads im Gateway haben dokumentierte Aufbewahrungsfristen, widerrufbare Zugriffe und keine öffentlichen Cache-Einträge. Tokens werden nicht protokolliert oder über Referrer weitergegeben. C026 benötigt ebenfalls einen dokumentierten extern erreichbaren TLS-Feed-Endpunkt; die Admin-API bleibt lokal. Ein ausgehender Feed-Abgleich verwendet ausschließlich den geschützten Kalender-Endpunkt, niemals den anonymisierten Widget-Datensatz.

## E-Mail und Hintergrundjobs

C030 etabliert die gemeinsame Job-/Outbox-Grundlage vor Versand und geplanten Aktionen: atomare Joberzeugung, eindeutiger fachlicher Schlüssel, begrenzte Retries, Lease-Verlängerung, Übernahme nach Worker-Absturz und sichtbare endgültige Fehler. Zustellung mindestens einmal verlangt idempotente Empfänger.

SMTP bietet keine allgemeine Exactly-once-Garantie. Bricht die Verbindung nach möglicher Annahme ab, darf C039 nicht blind erneut senden. Es speichert einen sichtbaren Zustand „Versand unklar“, eine stabile Message-ID und ermöglicht eine bewusste Klärung/Wiederholung; auch das verbleibende Doppelversandrisiko wird angezeigt. Tests unterscheiden sichere Ablehnung vor Übergabe von unklarer Annahme. Eine Message-ID allein verhindert keine Duplikate beim Empfänger.

C040 speichert UIDVALIDITY und UIDs je Ordner, definiert die Grenze zum Altbestand und prüft Wiederverbindung sowie UIDVALIDITY-Wechsel ohne unbemerkten Altimport. C045 erzeugt standardmäßig interne Erinnerungen, keine unaufgeforderten Kunden-Nachfassmails. Erfasste Antworten, Annahmen, Absagen und erledigte Erinnerungen stoppen die jeweilige Regel.

## Sicherheit, Datenschutz und Betriebsfähigkeit

C008 erzwingt Mandantenbindung auch in Fremdschlüsseln. C009/C010 benötigen PKCE, State/Nonce, sichere Cookies, CSRF-Schutz, erlaubte Redirects, einen lokalen Erstkonto-Bootstrap und Sitzungswiderruf nach Kontosperre. Ein Notfallzugang bleibt deaktiviert. Sicherheitsmaßnahmen und Tastaturbedienbarkeit gehören jeweils zum ausliefernden Feature; C079/C080/C082 prüfen später ihre Vollständigkeit.

C038 gibt Uploads erst nach Typ-/Größenprüfung und erfolgreicher Scan-Freigabe frei. Scanner-Ausfall belässt Dateien in Quarantäne. Originalnamen sind keine Speicherpfade; Archive werden nicht ungeprüft entpackt. Frühere Anhänge behalten beim Ersetzen ihren unveränderbaren Stand. HTML-Mail und Rich Text werden sanitisiert; externe Mailbilder werden nicht automatisch geladen (C042/C044).

C074 dokumentiert Auskunft, Export und Löschung/Anonymisierung samt Aufbewahrungssperren. Unveränderbare Belege und minimierte Audit-Ereignisse dürfen dabei nicht beiläufig gelöscht werden. Personenbezogene Inhalte gehören möglichst in referenzierte Fachdaten statt dauerhaft in freie Audittexte. Aufbewahrungsfristen sind vor Produktivstart fachlich/rechtlich zu bestätigen; Backups und Gateway-Kopien werden im Löschkonzept berücksichtigt. Dies ist keine rechtliche Freigabe.

C016/C075/C055 liefern offene Exporte für Kontakte, Events, Produkte, Dokumentmetadaten und Finanzdaten. Jeder CSV-Export berücksichtigt Tabellenformel-Injection. C005/C027 verlangen tägliche Sicherung und einen Restore-Test bereits vor realer interner Nutzung; C078 ergänzt Verschlüsselung, Rotation und vollständige Datei-/Datenbankkonsistenz. C083 darf bei vorwärtsgerichteten Migrationen keinen pauschalen Image-Rollback versprechen.

## Migration und noch offene Freigaben

C075 umfasst auch bisher im Plan nicht ausdrücklich zugeordnete Vorlagen, Logo, Dokumentgestaltung, Signatur und Standarddateien. C077 erhält Originalnummern und Originalbelege offener Vorgänge sowie die dazugehörigen Summen und Zahlungen. Historische Archive und E-Mails bleiben ausgeschlossen; offene Originalbelege werden nicht neu ausgestellt. Schnittstellen, Pflichtfelder und verfügbare Exportformate werden vor dem Import anhand lokal gehaltener Daten geprüft.

Vor vollständiger Produktivfreigabe bleiben Entscheidungen mit dem Betreiber erforderlich: endgültige Boxnamen, tatsächliche Importformate, öffentliche Gateway-/TLS-Adresse, Fristen für Vormerkungen und persönliche Gateway-Daten, Aufbewahrungskonzept sowie rechtliche Prüfung von Rechnungsvorgaben, Vertragstexten und Signaturverfahren. Diese Prüfung hat keine Rechtskonformität oder Funktionsfähigkeit einer noch nicht vorhandenen Anwendung nachgewiesen.

## Konkretisierung der Eventarten (15.10.2026)

Der Inhaber hat Hochzeit, Geburtstag, Firmenfeier, Weihnachtsfeier und sonstiges
als Startwerte benannt. C012 legt genau diese fünf aktiven Werte pro Mandant an.
Die frühere pauschale Anzahl sieben im Lastenheft ist keine Obergrenze und kein
Anlass, zwei Namen zu erfinden. Weitere Werte werden in der Oberfläche ergänzt;
Paketwerte wurden noch nicht benannt und beginnen leer. Die spätere Bestandsübernahme
prüft und ergänzt die fachlich tatsächlich verwendeten Werte.

## Eigener Login für den Testbetrieb (16.10.2026)

Der Nutzer hat E-Mail oder Benutzername plus Passwort gewählt. Dies ersetzt die
frühere Google-Pflicht und das Verbot lokaler Passwörter. H005 verwendet vorhandene
Sitzungen und Kontosperren, scrypt aus Node und einen einmaligen externen Bootstrap;
keine offene Registrierung und kein zusätzlicher Maildienst. Google bleibt als
alternativer Modus erhalten. H008 ergänzt den eigenen Passwortwechsel mit Widerruf
aller Sitzungen. H009 ergänzt eine kontrollierte Wiederherstellung ausschließlich
über bestehenden SSH-/Podman-Betreiberzugriff, ohne HTTP-Endpunkt. Weitere lokale
Konten werden für den Solo-Betrieb nicht vorgezogen und folgen bei Bedarf.

## Externe Angebote und Rechnungen zum Erststart (18.10.2026)

Der Betreiber hat LibreOffice als externes Werkzeug für Angebote und Rechnungen
gewählt. Damit ist die Werkzeugwahl für den reduzierten Start festgelegt, nicht
bereits der vollständige Ersatzprozess abgenommen. AuftragsKompass erhält dafür
vorerst weder eine LibreOffice-Integration noch eine vorgezogene Rechnungsfunktion.

Vor Umschaltung bleibt der manuelle Gesamtprobelauf aus E004 erforderlich:
Angebot, Annahme, Anzahlung, Schlussrechnung, Teilzahlung und Korrektur;
Dokumentnummern, Originalbelege und Zahlungsübersicht müssen nachvollziehbar
bleiben. Bestehende Belege werden nicht neu ausgestellt. Konkrete Vorlagen,
Nummernfortführung, Ablage, Sicherung und fachliche Anforderungen sind gesondert
zu prüfen; aus der Werkzeugwahl wird keine steuerliche oder rechtliche Eignung
abgeleitet.

Der künftige Eingang neuer Website-Anfragen ist laut Betreiber noch unklar.
Bestehende Formulare oder Kundenlinks werden deshalb nicht abgeschaltet oder
ungeprüft ersetzt. E004 und die Produktivumschaltung bleiben offen.

## Ort als Zusatzinfo der Buchung, Locations nur noch Bestand (21.10.2026)

Der Betreiber hat entschieden, dass Buchungen keinen Ortsstammdatensatz und keinen
eigenen Menüpunkt benötigen: Der Ort ist eine optionale Freitextangabe am Event.
Die Umsetzung ergänzt `events.venue` (höchstens 1.000 Zeichen, mehrzeilig) und
`events.venue_override` additiv; Tabelle, Zeilen, IDs und API der bisherigen
Locations bleiben unverändert, werden aber nicht mehr in der Oberfläche verwaltet.
Das bewusste Leeren eines Ortes bleibt leer und fällt nicht auf einen Bestandsort
zurück. Bestandsorte werden weiterhin unverändert angezeigt, solange kein Freitext
gilt, und ein alter Client, der nur die Bestandsreferenz ändert, setzt die
wirksame Quelle auf den Bestand zurück, ohne den Freitext zu löschen. Es findet
keine Adressprüfung, -zerlegung oder Rückfüllung statt. Diese Entscheidung ersetzt
die frühere Annahme, H034 sei ohne Migration möglich.
