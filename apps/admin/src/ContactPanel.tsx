import { useEffect, useRef, useState } from 'react';
import { ContactDetails, type ContactRecord } from './ContactDetails.js';
import { ContactDialog } from './ContactDialog.js';
import { mailtoHref, telHref } from './contact-links.js';
type Contact = ContactRecord & { version: number };
const loadFailureMessage = 'Kontakte konnten nicht geladen werden.';
const reloadFailureMessage =
  'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.';
export function ContactPanel({
  csrfToken,
  showHeading = true,
}: {
  csrfToken: string;
  showHeading?: boolean;
}) {
  const sequence = useRef(0);
  const inlineDirty = useRef(false);
  const editedSearchId = useRef<string | null>(null);
  const scrolledDetail = useRef<string | null>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const query = new URLSearchParams(window.location.search).get('q') ?? '';
  const appliedSearch = useRef(query);
  const [rows, setRows] = useState<Contact[]>([]),
    [editing, setEditing] = useState<Contact | null>(null),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState(query),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [reloadFailed, setReloadFailed] = useState(false),
    [editorEpoch, setEditorEpoch] = useState(0),
    [detailId, setDetailId] = useState<string | null>(null),
    [editedSearchRecord, setEditedSearchRecord] = useState(false);
  async function refresh(query = '') {
    const current = ++sequence.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch(
        '/api/v1/contacts' + (query ? '?q=' + encodeURIComponent(query) : ''),
      );
      if (!response.ok) throw Error('load');
      const rows = (await response.json()) as Contact[];
      if (current === sequence.current) {
        if (inlineDirty.current) return;
        setRows(rows);
        appliedSearch.current = query;
        editedSearchId.current = null;
        setEditedSearchRecord(false);
        setEditorEpoch((value) => value + 1);
        setReloadFailed(false);
        setMessage((text) => (text === loadFailureMessage ? '' : text));
      }
    } catch (error) {
      if (current === sequence.current) {
        setLoadFailed(true);
        throw error;
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    // A fragment navigation (for example opening a contact record) carries no
    // new query, so it must never throw away a local search. A deliberate
    // re-application through `updateUrlSearch` keeps the whole address and
    // still resets the local search, as before.
    let seen = window.location.href;
    const changed = () => {
      const href = window.location.href;
      if (href !== seen && new URL(href).search === new URL(seen).search) {
        seen = href;
        return;
      }
      seen = href;
      const value = new URLSearchParams(window.location.search).get('q') ?? '';
      setSearch(value);
      void refresh(value).catch(() => setMessage(loadFailureMessage));
    };
    changed();
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  useEffect(() => {
    // BKP011.1: the hash selects the reading record, exactly like the event
    // panel. A hash without a loaded row stays silent – no stale editor.
    const changed = () => {
      const id = window.location.hash.slice(1);
      if (
        editedSearchId.current &&
        id !== 'contact-' + editedSearchId.current &&
        !inlineDirty.current
      ) {
        void refreshEditedSearch();
      }
      if (!id.startsWith('contact-')) {
        scrolledDetail.current = null;
        setDetailId(null);
        return;
      }
      if (rows.some((row) => 'contact-' + row.id === id)) {
        setDetailId(id.slice('contact-'.length));
        if (scrolledDetail.current !== id) {
          scrolledDetail.current = id;
          document.getElementById(id)?.scrollIntoView?.();
        }
      } else setDetailId(null);
    };
    changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [rows]);
  function restoreFocus() {
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else createTrigger.current?.focus({ preventScroll: true });
  }
  function openNew() {
    if (open || busy) return;
    if (inlineDirty.current) {
      setMessage(
        'Bitte die Kontaktänderungen zuerst speichern oder abgleichen.',
      );
      return;
    }
    returnFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : createTrigger.current;
    setEditing(null);
    setMessage('');
    setOpen(true);
  }
  function openEdit(row: Contact) {
    if (open || busy) return;
    if (inlineDirty.current) {
      setMessage(
        'Bitte die Kontaktänderungen zuerst speichern oder abgleichen.',
      );
      return;
    }
    returnFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    setEditing(row);
    setMessage('');
    setOpen(true);
  }
  function closeDialog() {
    setOpen(false);
    setEditing(null);
    restoreFocus();
  }
  function adoptContact(row: Contact) {
    ++sequence.current;
    setLoading(false);
    setRows((current) =>
      current.some((entry) => entry.id === row.id)
        ? current.map((entry) => (entry.id === row.id ? row : entry))
        : [row, ...current],
    );
  }
  function refreshEditedSearch() {
    if (!editedSearchId.current) return Promise.resolve();
    editedSearchId.current = null;
    setEditedSearchRecord(false);
    return refresh(appliedSearch.current).catch(() => {
      setReloadFailed(true);
    });
  }
  function savedContact(row: Contact) {
    adoptContact(row);
    setEditorEpoch((value) => value + 1);
    setOpen(false);
    setEditing(null);
    setMessage('Kontakt gespeichert.');
    setTimeout(
      () =>
        void (async () => {
          try {
            await refresh(search);
          } catch {
            setReloadFailed(true);
          }
          // The list actions are disabled while busy; restore focus after React
          // has re-enabled them instead of dropping it onto the document body.
          setTimeout(restoreFocus, 0);
        })(),
      0,
    );
  }
  async function retryList() {
    if (inlineDirty.current) {
      setMessage(
        'Bitte die Kontaktänderungen zuerst speichern oder abgleichen.',
      );
      return;
    }
    try {
      await refresh(search);
    } catch {
      setMessage(loadFailureMessage);
    }
  }
  // Closing the record returns to the list without touching the local search,
  // the loaded rows or the scroll position: only the hash changes.
  function closeDetail(id: string) {
    if (inlineDirty.current) {
      setMessage(
        'Bitte die Kontaktänderungen zuerst speichern oder abgleichen.',
      );
      return;
    }
    window.location.hash = 'contacts';
    setDetailId(null);
    function focusList() {
      requestAnimationFrame(() => {
        const link = document
          .getElementById('contact-' + id)
          ?.querySelector<HTMLAnchorElement>('.contact-name-link');
        if (link) link.focus({ preventScroll: true });
        else createTrigger.current?.focus({ preventScroll: true });
      });
    }
    if (editedSearchRecord) {
      void refreshEditedSearch().finally(focusList);
    } else focusList();
  }
  return (
    <section id="contacts" aria-label="Kontakte" aria-busy={loading}>
      {showHeading && <h2>Kontakte</h2>}
      <div className="contact-toolbar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (inlineDirty.current) {
              setMessage(
                'Bitte die Kontaktänderungen zuerst speichern oder abgleichen.',
              );
              return;
            }
            void refresh(search).catch(() => setMessage(loadFailureMessage));
          }}
        >
          <label>
            Kontakte suchen
            <input
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="icon-action tier-quiet-icon"
            aria-label="Kontakte durchsuchen"
            title="Kontakte durchsuchen"
            disabled={busy}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 5 5" />
            </svg>
          </button>
        </form>
        <div className="section-actions">
          <a
            className="secondary-action"
            href="/api/v1/contacts/export.csv"
            download
          >
            Kontakte als CSV exportieren
          </a>
          <button
            ref={createTrigger}
            type="button"
            className="icon-action tier-primary-icon"
            aria-label="Kontakt anlegen"
            title="Kontakt anlegen"
            disabled={busy}
            onClick={openNew}
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
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
      {loading && <p role="status">Kontakte werden geladen …</p>}
      {!loading && !loadFailed && !rows.length && (
        <p>Keine Kontakte gefunden.</p>
      )}
      <ul className="contact-list">
        {rows.map((row) => {
          const shown = detailId === row.id;
          return (
            <li key={row.id} id={'contact-' + row.id}>
              {/* The summary steps aside while the record is open; the row
              itself stays mounted so search, scroll and focus survive. */}
              <div className="contact-row" hidden={shown}>
                <a
                  className="contact-name-link"
                  href={'#contact-' + row.id}
                  onClick={(event) => {
                    if (
                      detailId &&
                      detailId !== row.id &&
                      inlineDirty.current
                    ) {
                      event.preventDefault();
                      setMessage(
                        'Bitte die Kontaktänderungen zuerst speichern oder abgleichen.',
                      );
                    }
                  }}
                >
                  {row.name}
                </a>{' '}
                {row.state === 'archived' && (
                  <span className="contact-archived">Archiviert</span>
                )}{' '}
                {row.contactPerson && <span>{row.contactPerson} </span>}
                {row.email && (
                  <a
                    aria-label={`E-Mail: ${row.name}`}
                    href={mailtoHref(row.email)}
                  >
                    E-Mail
                  </a>
                )}{' '}
                {(row.phone || row.mobile) && (
                  <a
                    aria-label={`Anrufen: ${row.name}`}
                    href={telHref(row.phone || row.mobile)}
                  >
                    Anrufen
                  </a>
                )}{' '}
                <button
                  type="button"
                  className="icon-action tier-quiet-icon"
                  disabled={busy}
                  title="Kontakt bearbeiten"
                  aria-label={`Kontakt bearbeiten: ${row.name}`}
                  onClick={() => openEdit(row)}
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
              </div>
              {shown && (
                <>
                  {editedSearchRecord && (
                    <p role="status">
                      Der geänderte Kontakt bleibt bis zum Schließen geöffnet.
                      Die Trefferliste wird nach dem Schließen aktualisiert.
                    </p>
                  )}
                  <ContactDetails
                    contact={row}
                    csrfToken={csrfToken}
                    onConfirmed={(confirmed) => {
                      adoptContact(confirmed);
                      if (appliedSearch.current) {
                        editedSearchId.current = confirmed.id;
                        setEditedSearchRecord(true);
                      }
                    }}
                    editorEpoch={editorEpoch}
                    inlineVisible={!open}
                    onDirtyChange={(dirty) => {
                      inlineDirty.current = dirty;
                    }}
                    onEdit={() => openEdit(row)}
                    onClose={() => closeDetail(row.id)}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p role="status">{message}</p>
      {reloadFailed && (
        <div className="reload-warning">
          <p role="status">{reloadFailureMessage}</p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy}
            onClick={() => void retryList()}
          >
            Kontakte erneut laden
          </button>
        </div>
      )}
      {!reloadFailed && loadFailed && (
        <button
          type="button"
          className="tertiary-action"
          disabled={busy}
          onClick={() => void retryList()}
        >
          Kontakte erneut laden
        </button>
      )}
      {open && (
        <ContactDialog
          csrfToken={csrfToken}
          contact={editing}
          onBusyChange={setBusy}
          onClose={closeDialog}
          onSaved={savedContact}
        />
      )}
    </section>
  );
}
