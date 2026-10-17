export function ExportPanel() {
  return (
    <section className="export-panel" aria-label="Datenexport">
      <h3>Daten exportieren</h3>
      <p>
        Die Downloads enthalten jeweils den gesamten eigenen Bestand, unabhängig
        von gesetzten Filtern. Inaktive, archivierte und annullierte Einträge
        bleiben enthalten.
      </p>
      <ul className="export-list">
        <li>
          <a href="/api/v1/contacts/export.csv">
            Kontakte als CSV herunterladen
          </a>
          <p>Kontaktangaben einschließlich archivierter Kontakte.</p>
        </li>
        <li>
          <a href="/api/v1/events/export.csv">
            Alle Events als CSV herunterladen
          </a>
          <p>Termine, Status, Referenz-IDs, Beschreibung und Notizen.</p>
        </li>
        <li>
          <a href="/api/v1/products/export.csv">
            Produktkatalog als CSV herunterladen
          </a>
          <p>
            Preise in Cent, Netto-/Bruttobasis und Steuer in
            Hundertstel-Prozent.
          </p>
        </li>
      </ul>
      <p>
        CSV-Dateien sind keine vollständige Datensicherung. Reservierungen,
        Logbuch und weitere Verknüpfungen bleiben in der verschlüsselten
        Datenbanksicherung. Exportdateien enthalten persönliche Daten; bitte
        privat und zugriffsgeschützt aufbewahren.
      </p>
    </section>
  );
}
