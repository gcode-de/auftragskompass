# Signierter Anfrage-Übergabevertrag (E004.3)

Dies ist der Authentifizierungsteil von C028 für die vorgezogenen
[Website-Anfragen](website-inquiries.md). Es existiert damit noch kein öffentlicher
Empfang, kein Synchronisationsdienst und keine vollständige C028-Abnahme.
Vor jeder Wirkung sind persistenter Replay-/Operationsschutz und die jeweils
konkrete fachliche Payload-Prüfung erforderlich. Bis dahin wird kein Endpunkt
aktiviert. Eine gültige Signatur ist keine Buchungsfreigabe.

## Format und Bindung

Ein Paket enthält ausschließlich `keyId`, `body` und `signature`. `body` ist der
**unveränderte JSON-String** einer Version-1-Nachricht mit:

- `tenantId`: zugeordneter Mandant als kleingeschriebene UUID;
- `messageId`: frische UUID je Übertragungsversuch, später dauerhaft gegen Replay geprüft;
- `operationId`: stabile UUID der fachlichen Operation für sichere Wiederholungen;
- `issuedAt`: ganzzahlige UTC-Unixsekunden;
- `kind`: `inquiries.pull`, `inquiries.batch` oder `inquiries.ack`;
- `payload`: JSON-Objekt; seine konkrete fachliche Prüfung folgt am Empfänger.

Pull und Quittierung dürfen nur in Richtung `core-to-gateway`, Antworten nur in
Richtung `gateway-to-core` laufen. Der Empfänger setzt erwarteten Mandanten,
Richtung und Zweck aus seiner eigenen Konfiguration beziehungsweise Route;
Clientangaben dürfen diesen Kontext nicht festlegen.

Der HMAC-SHA-256 umfasst UTF-8-Bytes folgender Verkettung:

```text
AK-GATEWAY-V1\n<direction>\n<keyId>\n<body>
```

Die drei `\n` sind jeweils ein echtes LF-Zeichen. Nach `body` wird kein weiteres
Zeichen angehängt. Keine Neusortierung, Normalisierung oder erneute JSON-Serialisierung
vor der Verifikation. Die Signatur verwendet kanonisches Base64url ohne Padding;
der Vergleich erfolgt mit Nodes `timingSafeEqual`. Ungültige Signaturen,
Zusatzfelder, falsche Versionen, Ziele oder Zwecke werden neutral abgewiesen.

Implementiert werden ausschließlich die vorhandenen
[Node-Kryptofunktionen](https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options),
kein zusätzlicher Kryptografiebaustein. Die Nachrichten sind signiert, **nicht
verschlüsselt**. TLS und die spätere verschlüsselte Zwischenablage bleiben nötig.
Pakete, Schlüssel und Payloads dürfen weder in Logs noch in Fehlertexte gelangen.

## Schlüssel, Rotation und Grenzen

Jeder Schlüssel besitzt eine eindeutige ID, Mandant, genau eine Richtung,
32 geheime zufällig erzeugte Bytes sowie `notBefore` und `expiresAt` als
ganzzahlige Unixsekunden. Das gilt für neue reale Schlüssel; die Tests verwenden
ausdrücklich fiktive feste Bytes. Je Umgebung und Richtung unterschiedliche Schlüssel außerhalb
von Git verwahren. IDs bestehen aus maximal 64 ASCII-Buchstaben/Ziffern sowie
Punkt, Bindestrich oder Unterstrich, beginnend mit einem Buchstaben oder einer Ziffer.

Zur Rotation können alter und neuer Schlüssel zeitweise gleichzeitig konfiguriert
sein. Die eigene Schlüssel-ID bestimmt den Signierer. Ein Empfänger akzeptiert nur
einen eindeutigen passenden Schlüssel; entfernte, abgelaufene, noch nicht aktive
oder mehrdeutige Schlüssel scheitern. Sowohl Empfangs- als auch Ausgabezeit müssen
im Schlüsselintervall liegen (`notBefore` einschließlich, `expiresAt` ausschließlich).

Die Nachricht darf maximal 300 Sekunden alt und höchstens 30 Sekunden in der
Zukunft sein. Eine synchronisierte Hostuhr ist Voraussetzung. Der signierte
UTF-8-Body ist auf 65.536 Bytes begrenzt; das HTTP-Limit für das spätere äußere
JSON-Paket muss dessen zusätzliche String-Escapes berücksichtigen und ebenfalls
eng begrenzt werden. Es gibt keine implizite Typkonvertierung oder Algorithmenwahl
durch den Absender.

## Wiederholungen vor Betriebsaufnahme ergänzen

Das Zeitfenster allein verhindert keinen Replay innerhalb von fünf Minuten.
Vor einem empfangenden Handler müssen deshalb Nachrichten-ID und fachliche
Operations-ID transaktional und mandantengebunden verarbeitet werden:

1. Nachricht prüfen, dann Nachricht-ID dauerhaft einmalig erfassen.
2. Neue Operations-ID und Payload-Fingerabdruck gemeinsam mit der fachlichen
   Änderung committen; Fehler dürfen keine halbe Änderung hinterlassen.
3. Derselbe fachliche Inhalt mit frischer Nachrichten-ID darf dieselbe Operation
   nicht erneut ausführen. Dieselbe Operations-ID mit abweichendem Inhalt muss
   scheitern. Wiederholungen/Neustarts/Parallelität benötigen Datenbanktests.

Ein Transport-Retry erhält eine neue Nachrichten-ID und aktuelle Zeit, aber
dieselbe Operations-ID. Aufbewahrung und Bereinigung der Replay-Belege werden
erst mit diesem persistenten Teil festgelegt. Dieser Vertrag sendet nichts und
übernimmt weder echte Kontakte noch Events.
