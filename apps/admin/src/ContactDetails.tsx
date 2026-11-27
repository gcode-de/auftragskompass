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
  firstName: string;
  contactPerson: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  addressAttribution?: string | null;
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
  onRemove,
  onClose,
  csrfToken,
  onConfirmed,
  editorEpoch,
  inlineVisible,
  onDirtyChange,
}: {
  contact: Contact;
  onEdit: () => void;
  onRemove?: ((trigger: HTMLElement) => void) | undefined;
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
  // UI-BKP-13: Bookitup's two event tabs - dated events in date order, the
  // undated ones on their own.
  const [undated, setUndated] = useState(false);

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
  const dated = events
      .filter((event) => event.eventDate)
      .sort((a, b) => a.eventDate!.localeCompare(b.eventDate!)),
    withoutDate = events.filter((event) => !event.eventDate),
    shownEvents = undated ? withoutDate : dated;
  return (
    <section
      className="contact-record"
      aria-label="Kontakt-Details"
      aria-busy={loading}
    >
      {/* UI-BKP-13: like Bookitup the record opens with its breadcrumb back
          to the list; it is the record's close action. */}
      <nav className="contact-record-crumbs" aria-label="Brotkrume">
        <button
          type="button"
          className="tertiary-action"
          aria-label="Kontakte – Kontakt-Details schließen"
          onClick={onClose}
        >
          Kontakte
        </button>
        <span aria-hidden="true">/</span>
        <span className="contact-record-crumb-current">{contact.name}</span>
      </nav>
      <div className="contact-record-card">
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
          <button
            type="button"
            className="icon-action tier-quiet-icon contact-record-edit"
            aria-label={`Kontakt bearbeiten: ${contact.name}`}
            title="Kontakt bearbeiten"
            onClick={onEdit}
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
        </header>
        <dl>
          {/* MAIL-EDITOR-01a: the stored first name only; an empty one is an
        omitted optional row, never a name guessed from the full name. */}
          {!!contact.firstName && (
            <Fragment>
              <dt>Vorname</dt>
              <dd>{contact.firstName}</dd>
            </Fragment>
          )}
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
          {contact.addressAttribution && (
            <small>{contact.addressAttribution}</small>
          )}
        </section>
      </div>
      {inlineVisible && (
        <ContactInlineEditor
          key={contact.id + ':' + editorEpoch}
          contact={contact}
          csrfToken={csrfToken}
          onConfirmed={onConfirmed}
          onDirtyChange={onDirtyChange}
        />
      )}
      <section className="contact-record-events" aria-label="Events">
        <h3>Events</h3>
        <div
          className="contact-event-tabs"
          role="group"
          aria-label="Events zeigen"
        >
          <button
            type="button"
            className="tertiary-action"
            aria-pressed={!undated}
            onClick={() => setUndated(false)}
          >
            Chronologisch
          </button>
          <button
            type="button"
            className="tertiary-action"
            aria-pressed={undated}
            onClick={() => setUndated(true)}
          >
            Ohne Datum
          </button>
        </div>
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
        {!loading && !failed && !shownEvents.length && (
          <p>
            {events.length
              ? undated
                ? 'Keine Events ohne Datum.'
                : 'Keine datierten Events.'
              : 'Keine zugeordneten Events.'}
          </p>
        )}
        {!failed && shownEvents.length > 0 && (
          <ul className="contact-event-list">
            {shownEvents.map((event) => (
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
      {onRemove && (
        <button
          type="button"
          className="tertiary-action danger-link"
          onClick={(event) => onRemove(event.currentTarget)}
        >
          Kontakt löschen
        </button>
      )}
    </section>
  );
}
