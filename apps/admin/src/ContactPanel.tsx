import { useEffect, useRef, useState } from 'react';
import { ContactDetails, type ContactRecord } from './ContactDetails.js';
import { ContactDialog } from './ContactDialog.js';
import { mailtoHref, telHref } from './contact-links.js';
import {
  menuPanelProps,
  menuToggleProps,
  rowMenuState,
} from './popover-menu.js';
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
    [editedSearchRecord, setEditedSearchRecord] = useState(false),
    [openMenu, setOpenMenu] = useState('');
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
    <section
      id="contacts"
      aria-label="Kontakte"
      aria-busy={loading}
      // Plain attributes instead of :has() rules: a 500-row list must not
      // pay for selector invalidation on every change (PERF-MENU-01).
      data-record={detailId ? '' : undefined}
    >
      {showHeading && <h2>Kontakte</h2>}
      {/* UI-BKP-09: Bookitup's contacts frame - a context column with the
          title, the plus and the search; the list fills the canvas. */}
      {/* In the global search the contacts follow the events as a plain
          block; only the Kontakte page itself gets the column. */}
      <div
        className="contacts-layout"
        data-column={showHeading ? undefined : ''}
      >
        <aside className="contacts-context" aria-label="Kontaktsuche">
          <div className="section-heading">
            {/* The column names the page visually; the h1 stays the one
                heading for assistive technology. */}
            <span className="context-title" aria-hidden="true">
              Kontakte
            </span>
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
                placeholder="Kontakt durchsuchen"
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
          <a
            className="secondary-action contacts-export"
            href="/api/v1/contacts/export.csv"
            download
          >
            Kontakte als CSV exportieren
          </a>
        </aside>
        <div className="contacts-results">
          {loading && <p role="status">Kontakte werden geladen …</p>}
          {!loading && !loadFailed && !rows.length && (
            <p>Keine Kontakte gefunden.</p>
          )}
          {rows.length > 0 && (
            <div className="contact-list-head" aria-hidden="true">
              <span>Name</span>
              <span>E-Mail</span>
              <span>Telefonnummer</span>
            </div>
          )}
          <ul className="contact-list">
            {rows.map((row) => {
              const shown = detailId === row.id;
              return (
                <li
                  key={row.id}
                  id={'contact-' + row.id}
                  data-other={detailId && !shown ? '' : undefined}
                >
                  {/* The summary steps aside while the record is open; the row
              itself stays mounted so search, scroll and focus survive. */}
                  <div
                    className="contact-row"
                    hidden={shown}
                    data-meta={
                      row.state === 'archived' || row.contactPerson
                        ? ''
                        : undefined
                    }
                  >
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
                    <span className="contact-cell-meta">
                      {row.state === 'archived' && (
                        <span className="contact-archived">Archiviert</span>
                      )}{' '}
                      {row.contactPerson && <span>{row.contactPerson}</span>}
                    </span>
                    <span className="contact-cell-mail">
                      {row.email && (
                        <a href={mailtoHref(row.email)}>{row.email}</a>
                      )}
                    </span>
                    <span className="contact-cell-phone">
                      {(row.phone || row.mobile) && (
                        <a href={telHref(row.phone || row.mobile)}>
                          {row.phone || row.mobile}
                        </a>
                      )}
                    </span>
                    <span className="contact-cell-menu">
                      <button
                        type="button"
                        className="icon-action tier-quiet-icon row-menu-toggle"
                        disabled={busy}
                        title="Weitere Aktionen"
                        aria-label={`Weitere Aktionen: ${row.name}`}
                        aria-haspopup="true"
                        {...menuToggleProps(
                          'contact-menu-' + row.id,
                          openMenu === row.id,
                          (open) => setOpenMenu(rowMenuState(row.id, open, '')),
                        )}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="currentColor"
                        >
                          <circle cx="5" cy="12" r="1.7" />
                          <circle cx="12" cy="12" r="1.7" />
                          <circle cx="19" cy="12" r="1.7" />
                        </svg>
                      </button>
                      <span
                        className="popover-menu"
                        role="group"
                        aria-label={`Aktionen für ${row.name}`}
                        onKeyDown={(event) => {
                          if (event.key !== 'Escape') return;
                          event.preventDefault();
                          setOpenMenu('');
                          event.currentTarget.parentElement
                            ?.querySelector<HTMLElement>('.row-menu-toggle')
                            ?.focus();
                        }}
                        {...menuPanelProps(
                          'contact-menu-' + row.id,
                          openMenu === row.id,
                          (open) => setOpenMenu(rowMenuState(row.id, open, '')),
                        )}
                      >
                        {/* Only the open menu renders its action. */}
                        {openMenu === row.id && (
                          <button
                            type="button"
                            className="tertiary-action"
                            disabled={busy}
                            aria-label={`Kontakt bearbeiten: ${row.name}`}
                            onClick={(event) => {
                              // The toggle, not the closing menu, gets the focus back.
                              event.currentTarget.parentElement?.parentElement
                                ?.querySelector<HTMLElement>('.row-menu-toggle')
                                ?.focus();
                              setOpenMenu('');
                              openEdit(row);
                            }}
                          >
                            Bearbeiten
                          </button>
                        )}
                      </span>
                    </span>
                  </div>
                  {shown && (
                    <>
                      {editedSearchRecord && (
                        <p role="status">
                          Der geänderte Kontakt bleibt bis zum Schließen
                          geöffnet. Die Trefferliste wird nach dem Schließen
                          aktualisiert.
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
        </div>
      </div>
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
