import { Fragment, useEffect, useRef, useState } from 'react';
import { addressLines, mailtoHref, telHref } from './contact-links.js';
import { emptyEventFilters, updateUrlSearch } from './url-state.js';
import { ContactInlineEditor } from './ContactInlineEditor.js';
import type { Contact } from './ContactDialog.js';

/** The stored contact as the list delivers it (`GET /api/v1/contacts`). */
export type ContactRecord = {
  id: string;
  kind: string;
  name: string;
  contactPerson: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  mobile: string;
  state: string;
};

type LinkedEvent = {
  id: string;
  name: string;
  eventDate: string | null;
  status: string;
};

const kinds: Record<string, string> = {
  company: 'Firma',
  private: 'Privatperson',
};
// The stored status code stays the fallback, exactly like the event list does.
const statusLabels: [string, string][] = [
  ['inquiry', 'Anfrage'],
  ['option', 'Option'],
  ['booked', 'Gebucht'],
  ['unavailable', 'Nicht verfügbar'],
  ['cancelled', 'Annulliert'],
];

function dateText(value: string): string {
  const [year, month, day] = value.split('-');
  return day && month && year ? [day, month, year].join('.') : value;
}

/** BKP011.1: the reading contact file. It lives inside its list row, shows the
 * stored values without a second dialog and fetches only the related events.
 * Notes, files and mail folders are deliberately absent (BKP020/BKP022). */
export function ContactDetails({
  contact,
  onEdit,
  onClose,
  csrfToken,
  onConfirmed,
  editorEpoch,
  inlineVisible,
  onDirtyChange,
}: {
  contact: Contact;
  onEdit: () => void;
  onClose: () => void;
  csrfToken: string;
  onConfirmed: (row: Contact) => void;
  editorEpoch: number;
  inlineVisible: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [events, setEvents] = useState<LinkedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Opening the record moves the focus off the now hidden name link; closing
  // hands it back. The list itself stays mounted, so search text, scroll
  // position and the anchor contract survive.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [contact.id]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(
          '/api/v1/contacts/' + contact.id + '/events',
        );
        if (!response.ok) throw Error('load');
        const rows = (await response.json()) as LinkedEvent[];
        if (!cancelled) setEvents(rows);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // A stale answer for a previously opened contact can never fill this one.
    return () => {
      cancelled = true;
    };
  }, [contact.id, attempt]);

  const kind = kinds[contact.kind] ?? contact.kind,
    // A private contact has no meaningful contact person; an empty field never
    // shows up as an empty row.
    showPerson = contact.kind === 'company' || contact.contactPerson !== '',
    email = mailtoHref(contact.email),
    address = addressLines(contact);
  const phones: [string, string][] = [];
  if (contact.phone.trim()) phones.push(['Telefon', contact.phone]);
  if (contact.mobile.trim()) phones.push(['Mobil', contact.mobile]);
  return (
    <section
      className="contact-record"
      aria-label="Kontakt-Details"
      aria-busy={loading}
    >
      <header className="contact-record-head" data-state={contact.state}>
        <p className="contact-record-kind">
          <span>{kind}</span>
          <span className="contact-record-state">
            {contact.state === 'archived' ? 'Archiviert' : 'Aktiv'}
          </span>
        </p>
        {/* BKP011.1c: the record is a second-level heading like the event
        record (EventDetails.tsx), because the contacts route carries only the
        page h1. The sections below follow one level up, so the outline never
        skips a level on either route. */}
        <h2 ref={heading} tabIndex={-1}>
          {contact.name}
        </h2>
      </header>
      <dl>
        {showPerson && (
          <Fragment>
            <dt>Ansprechpartner</dt>
            <dd>{contact.contactPerson || 'Nicht angegeben'}</dd>
          </Fragment>
        )}
        <dt>E-Mail</dt>
        <dd>
          {email ? <a href={email}>{contact.email}</a> : 'Nicht angegeben'}
        </dd>
        {phones.length ? (
          phones.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>
                <a href={telHref(value)}>{value}</a>
              </dd>
            </Fragment>
          ))
        ) : (
          <Fragment>
            <dt>Telefon</dt>
            <dd>Nicht angegeben</dd>
          </Fragment>
        )}
      </dl>
      <section className="contact-record-address" aria-label="Anschrift">
        <h3>Anschrift</h3>
        {address.length ? (
          <address>
            {address.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </address>
        ) : (
          <p>Keine Anschrift hinterlegt.</p>
        )}
      </section>
      {inlineVisible && (
        <ContactInlineEditor
          key={contact.id + ':' + editorEpoch}
          contact={contact}
          csrfToken={csrfToken}
          onConfirmed={onConfirmed}
          onDirtyChange={onDirtyChange}
        />
      )}
      <section className="contact-record-events">
        <h3>Zugeordnete Events</h3>
        {loading && <p>Zugeordnete Events werden geladen …</p>}
        {!loading && failed && (
          <div className="reload-warning">
            <p role="alert">Zugeordnete Events konnten nicht geladen werden.</p>
            <button
              type="button"
              className="tertiary-action"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Zugeordnete Events erneut laden
            </button>
          </div>
        )}
        {!loading && !failed && !events.length && (
          <p>Keine zugeordneten Events.</p>
        )}
        {!failed && events.length > 0 && (
          <ul className="contact-event-list">
            {events.map((event) => (
              <li key={event.id}>
                <a
                  href={'#event-' + event.id}
                  onClick={() => updateUrlSearch(emptyEventFilters)}
                >
                  {event.name}
                </a>
                <span className="contact-event-date">
                  {event.eventDate ? dateText(event.eventDate) : 'Ohne Datum'}
                </span>
                <span className="contact-event-status">
                  {statusLabels.find(([code]) => code === event.status)?.[1] ??
                    event.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="contact-record-actions">
        <button type="button" className="secondary-action" onClick={onEdit}>
          Kontakt bearbeiten: {contact.name}
        </button>
        <button type="button" className="tertiary-action" onClick={onClose}>
          Kontakt-Details schließen
        </button>
      </div>
    </section>
  );
}
