import { useEffect, useRef, useState } from 'react';
import { emptyEventFilters, updateUrlSearch } from './url-state.js';

// RES-BKP-03: Bookitup's resource record (screens of 31.10.2026): the
// context column names the resource and switches between Details, Bestand
// and Planung; the content shows cards. Editing reuses the resource dialog;
// planning happens in the event and is only read here.

export type RecordResource = {
  id: string;
  version: number;
  name: string;
  code: string;
  category: string;
  kind: string;
  description: string;
  quantity: number;
  beforeDays: number;
  afterDays: number;
  state: string;
  blocked: boolean;
};
export type RecordTab = 'details' | 'stock' | 'planning';
export const recordTabs: readonly [RecordTab, string][] = [
  ['details', 'Details'],
  ['stock', 'Bestand'],
  ['planning', 'Planung'],
];

type Plan = {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  eventStatus: string;
  startsAt: string;
  endsAt: string;
  quantity: number;
  confirmed: boolean;
};
type Planning = {
  timeZone: string;
  units: { id: string; ordinal: number; enabled: boolean }[];
  plans: Plan[];
};

const kindNames: Record<string, string> = {
  item: 'Item',
  set: 'Set',
  case: 'Case',
};
const stateNames: Record<string, string> = {
  active: 'Aktiv',
  inactive: 'Inaktiv',
  archived: 'Archiviert',
};
const statusNames: Record<string, string> = {
  inquiry: 'Anfrage',
  option: 'Option',
  booked: 'Gebucht',
  unavailable: 'Nicht verfügbar',
  cancelled: 'Annulliert',
};

function dateText(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function ResourceRecord({
  resource,
  tab,
  onEdit,
  onClose,
}: {
  resource: RecordResource;
  tab: RecordTab;
  onEdit: (origin: HTMLElement) => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [planning, setPlanning] = useState<Planning | null>(null),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [resource.id]);
  useEffect(() => {
    let current = true;
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/resources/${resource.id}/planning`,
        );
        if (!response.ok) throw Error('load');
        const value = (await response.json()) as Planning;
        if (current) setPlanning(value);
      } catch {
        if (current) setFailed(true);
      }
    })();
    return () => {
      current = false;
    };
    // A saved resource (new version) may have changed its units.
  }, [resource.id, resource.version, attempt]);

  const time = (iso: string) =>
    new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: planning?.timeZone ?? 'Europe/Berlin',
    }).format(new Date(iso));
  const loading = !planning && !failed;
  const retry = (
    <div className="reload-warning">
      <p role="alert">Planung und Bestand konnten nicht geladen werden.</p>
      <button
        type="button"
        className="tertiary-action"
        onClick={() => setAttempt((value) => value + 1)}
      >
        Erneut laden
      </button>
    </div>
  );
  const editButton = (label: string) => (
    <button
      type="button"
      className="icon-action tier-quiet-icon"
      aria-label={`${label}: ${resource.name}`}
      title={label}
      onClick={(event) => onEdit(event.currentTarget)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );

  return (
    <section
      className="resource-record"
      aria-label="Ressourcen-Akte"
      aria-busy={loading}
    >
      <nav className="record-crumbs" aria-label="Brotkrume">
        <button
          type="button"
          className="tertiary-action"
          aria-label="Ressourcen – Akte schließen"
          onClick={onClose}
        >
          Ressourcen
        </button>
        <span aria-hidden="true">/</span>
        <span className="record-crumb-current">{resource.name}</span>
      </nav>
      <h2 ref={heading} tabIndex={-1} className="sr-only">
        {resource.name}
      </h2>
      {tab === 'details' && (
        <section className="record-card" aria-labelledby="resource-master">
          <div className="card-head">
            <h3 id="resource-master">Stammdaten</h3>
            {editButton('Stammdaten bearbeiten')}
          </div>
          <dl className="record-facts">
            <dt>Name</dt>
            <dd>{resource.name}</dd>
            <dt>Typ</dt>
            <dd>{kindNames[resource.kind] ?? resource.kind}</dd>
            <dt>Kategorie</dt>
            <dd>{resource.category}</dd>
            <dt>Beschreibung</dt>
            <dd>{resource.description || 'Keine Beschreibung.'}</dd>
            <dt>Interner Code</dt>
            <dd>{resource.code}</dd>
            <dt>Puffer</dt>
            <dd>
              {resource.beforeDays} Tage vorher, {resource.afterDays} Tage
              nachher
            </dd>
            <dt>Zustand</dt>
            <dd>
              {stateNames[resource.state] ?? resource.state}
              {resource.blocked ? ', gesperrt' : ''}
            </dd>
          </dl>
        </section>
      )}
      {tab === 'stock' && (
        <section className="record-card" aria-labelledby="resource-stock">
          <div className="card-head">
            <h3 id="resource-stock">Bestand</h3>
            {editButton('Bestand bearbeiten')}
          </div>
          <p>
            <strong>{resource.quantity} Stück</strong> im Bestand
            {resource.state !== 'active' &&
              ` – ${stateNames[resource.state] ?? resource.state}, nicht planbar`}
          </p>
          {failed && retry}
          {planning && planning.units.length > 0 && (
            <ul className="record-units">
              {planning.units.map((unit) => (
                <li key={unit.id}>
                  {resource.name} · Einheit {unit.ordinal}
                  <span className="muted">
                    {unit.enabled ? ' – planbar' : ' – stillgelegt'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {planning && !planning.units.length && (
            <p className="muted">Noch nichts hinzugefügt.</p>
          )}
        </section>
      )}
      {tab === 'planning' && (
        <section className="record-card" aria-labelledby="resource-planning">
          <h3 id="resource-planning">Planung</h3>
          {loading && <p role="status">Planung wird geladen …</p>}
          {failed && retry}
          {planning && !planning.plans.length && (
            <p className="muted">Noch nichts eingeplant.</p>
          )}
          {planning && planning.plans.length > 0 && (
            <table className="record-planning">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Bestätigt</span>
                  </th>
                  <th scope="col">Zeitraum</th>
                  <th scope="col">Menge</th>
                  <th scope="col">Ereignis</th>
                </tr>
              </thead>
              <tbody>
                {planning.plans.map((plan) => (
                  <tr key={plan.eventId + plan.startsAt}>
                    <td>
                      <span
                        className="plan-state"
                        data-confirmed={plan.confirmed ? '' : undefined}
                        role="img"
                        aria-label={plan.confirmed ? 'Bestätigt' : 'Vorgemerkt'}
                      />
                    </td>
                    <td>
                      {time(plan.startsAt)} – {time(plan.endsAt)}
                    </td>
                    <td>{plan.quantity}</td>
                    <td>
                      <a
                        className="plan-event"
                        data-status={plan.eventStatus}
                        href={'#event-' + plan.eventId}
                        onClick={() => updateUrlSearch(emptyEventFilters)}
                      >
                        <span>{plan.eventName}</span>
                        <span className="muted">
                          {statusNames[plan.eventStatus] ?? plan.eventStatus}
                          {plan.eventDate
                            ? ` · am ${dateText(plan.eventDate)}`
                            : ''}
                        </span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </section>
  );
}
