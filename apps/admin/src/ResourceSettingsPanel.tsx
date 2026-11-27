import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ModalDialog } from './ModalDialog.js';
import { resourceSettingsEvent } from './resource-settings-event.js';
import {
  menuPanelProps,
  menuRendered,
  menuToggleProps,
  rowMenuState,
} from './popover-menu.js';

// RES-BKP-01: Bookitup's resource settings (screens of 31.10.2026): one card
// with the switch that hides the resources entry in the main navigation and
// the managed categories - optionally nested ("Innerhalb Kategorie"), each
// with a ⋯ menu to edit or delete it.

export type ResourceCategory = {
  id: string;
  name: string;
  parentId: string | null;
  version: number;
  usage: number;
};

const errors: Record<string, string> = {
  category_in_use:
    'Die Kategorie ist noch Ressourcen zugeordnet. Ordne sie zuerst neu zu.',
  category_has_children:
    'Die Kategorie enthält noch Unterkategorien. Verschiebe oder lösche sie zuerst.',
  name_exists: 'Eine Kategorie mit diesem Namen gibt es schon.',
  conflict:
    'Die Kategorie wurde inzwischen geändert. Die Liste ist neu geladen.',
  parent_cycle: 'Eine Kategorie kann nicht in sich selbst liegen.',
  parent_not_found: 'Die gewählte Oberkategorie gibt es nicht mehr.',
  not_found: 'Die Kategorie gibt es nicht mehr. Die Liste ist neu geladen.',
};
const failed = 'Speichern fehlgeschlagen. Bitte erneut versuchen.';
const loadFailed = 'Die Ressourcen-Einstellungen konnten nicht geladen werden.';

/** Parents first, each followed by its own sub-categories. */
export function categoryTree(rows: readonly ResourceCategory[]) {
  const known = new Set(rows.map((row) => row.id));
  const children = (parentId: string | null) =>
    rows.filter(
      (row) =>
        (row.parentId && known.has(row.parentId) ? row.parentId : null) ===
        parentId,
    );
  const out: { row: ResourceCategory; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const row of children(parentId)) {
      out.push({ row, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function below(rows: readonly ResourceCategory[], id: string) {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows)
      if (row.parentId && found.has(row.parentId) && !found.has(row.id)) {
        found.add(row.id);
        grew = true;
      }
  }
  return found;
}

export function ResourceSettingsPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<ResourceCategory[]>([]),
    [hidden, setHidden] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [openMenu, setOpenMenu] = useState(''),
    [editing, setEditing] = useState<ResourceCategory | 'new' | null>(null),
    [name, setName] = useState(''),
    [parentId, setParentId] = useState('');
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [categories, settings] = await Promise.all([
        fetch('/api/v1/resource-categories'),
        fetch('/api/v1/settings/resources'),
      ]);
      if (!categories.ok || !settings.ok) throw Error('load');
      setRows((await categories.json()) as ResourceCategory[]);
      setHidden(
        ((await settings.json()) as { hideNavigation?: boolean })
          .hideNavigation === true,
      );
      // A reload never hides why it happened (e.g. a conflict).
      setError((current) => (current === loadFailed ? '' : current));
    } catch {
      setError(loadFailed);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (editing) nameField.current?.focus();
  }, [editing]);

  async function send(url: string, method: string, body?: unknown) {
    const response = await fetch(url, {
      method,
      headers: {
        'x-csrf-token': csrfToken,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.ok) return response;
    const code = (
      (await response.json().catch(() => ({}))) as { error?: string }
    ).error;
    throw Error(code && errors[code] ? code : 'failed');
  }
  function report(code: string) {
    setMessage('');
    setError(errors[code] ?? failed);
    if (code === 'conflict' || code === 'not_found') void load();
  }

  async function toggle(next: boolean) {
    setBusy(true);
    setHidden(next);
    try {
      await send('/api/v1/settings/resources', 'PUT', {
        hideNavigation: next,
      });
      window.dispatchEvent(new Event(resourceSettingsEvent));
      setError('');
      setMessage(
        next
          ? 'Ressourcen sind in der Navigation ausgeblendet.'
          : 'Ressourcen stehen wieder in der Navigation.',
      );
    } catch {
      setHidden(!next);
      report('failed');
    } finally {
      setBusy(false);
    }
  }

  function open(target: ResourceCategory | 'new', origin: HTMLElement) {
    returnFocus.current = origin;
    setEditing(target);
    setName(target === 'new' ? '' : target.name);
    setParentId(target === 'new' ? '' : (target.parentId ?? ''));
    setError('');
  }
  function close() {
    setEditing(null);
    const target = returnFocus.current;
    returnFocus.current = null;
    (target?.isConnected ? target : createTrigger.current)?.focus();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy || !name.trim()) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), parentId: parentId || null };
      await (editing === 'new'
        ? send('/api/v1/resource-categories', 'POST', body)
        : send(`/api/v1/resource-categories/${editing.id}`, 'PUT', {
            ...body,
            version: editing.version,
          }));
      setMessage(
        editing === 'new' ? 'Kategorie angelegt.' : 'Kategorie gespeichert.',
      );
      setError('');
      setEditing(null);
      await load();
      focusAfterBusy(returnFocus.current);
      returnFocus.current = null;
    } catch (failure) {
      report((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // The controls are disabled while busy; hand the focus back once React has
  // enabled them again.
  function focusAfterBusy(target: HTMLElement | null) {
    setTimeout(() =>
      (target?.isConnected ? target : createTrigger.current)?.focus(),
    );
  }
  async function remove(row: ResourceCategory) {
    setOpenMenu('');
    if (!window.confirm(`Kategorie „${row.name}“ löschen?`)) return;
    setBusy(true);
    try {
      await send(`/api/v1/resource-categories/${row.id}`, 'DELETE');
      setMessage('Kategorie gelöscht.');
      setError('');
      await load();
      focusAfterBusy(null);
    } catch (failure) {
      report((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tree = categoryTree(rows);
  const excluded =
    editing && editing !== 'new' ? below(rows, editing.id) : new Set<string>();
  return (
    <section
      id="resource-settings"
      className="resource-settings"
      aria-label="Ressourcen-Einstellungen"
      aria-busy={loading || busy}
    >
      <h2>Ressourcen</h2>
      <p className="muted">
        Lege fest, wie du deine Ressourcen in AuftragsKompass verwaltest.
      </p>
      <label className="switch-row">
        <span>
          <strong>Ressourcen-Modul in Navigation ausblenden</strong>
          <span className="muted">
            Blendet den Menüpunkt „Ressourcen“ in der Hauptnavigation aus. Das
            Modul und diese Einstellungen bleiben erreichbar.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={hidden}
          disabled={loading || busy}
          onChange={(event) => void toggle(event.currentTarget.checked)}
        />
      </label>
      <section className="settings-subcard" aria-labelledby="category-heading">
        <div className="card-head">
          <h3 id="category-heading">Kategorien</h3>
          <button
            ref={createTrigger}
            type="button"
            className="icon-action tier-primary-icon"
            aria-label="Kategorie anlegen"
            title="Kategorie anlegen"
            disabled={loading || busy}
            onClick={(event) => open('new', event.currentTarget)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        {loading && <p role="status">Kategorien werden geladen …</p>}
        {!loading && !rows.length && (
          <p className="muted">Noch keine Kategorien.</p>
        )}
        <ul className="category-list">
          {tree.map(({ row, depth }) => (
            <li
              key={row.id}
              className="category-row"
              style={{ paddingInlineStart: `${0.85 + depth * 1.25}rem` }}
            >
              <span>
                {row.name}
                <span className="sr-only">
                  {depth ? `, Unterkategorie` : ''}
                </span>
                {row.usage > 0 && (
                  <span className="muted category-usage">
                    {' '}
                    · {row.usage} {row.usage === 1 ? 'Ressource' : 'Ressourcen'}
                  </span>
                )}
              </span>
              <span className="row-menu">
                <button
                  type="button"
                  className="icon-action tier-quiet-icon row-menu-toggle"
                  aria-label={`Weitere Aktionen: ${row.name}`}
                  title="Weitere Aktionen"
                  aria-haspopup="true"
                  disabled={busy}
                  {...menuToggleProps(
                    'category-menu-' + row.id,
                    openMenu === row.id,
                    (next) => setOpenMenu(rowMenuState(row.id, next, '')),
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
                {menuRendered(openMenu === row.id) && (
                  <span
                    className="popover-menu"
                    role="group"
                    aria-label={`Aktionen für ${row.name}`}
                    {...menuPanelProps(
                      'category-menu-' + row.id,
                      openMenu === row.id,
                      (next) => setOpenMenu(rowMenuState(row.id, next, '')),
                    )}
                  >
                    {openMenu === row.id && (
                      <>
                        <button
                          type="button"
                          className="tertiary-action"
                          aria-label={`Kategorie bearbeiten: ${row.name}`}
                          onClick={(event) => {
                            setOpenMenu('');
                            open(
                              row,
                              event.currentTarget.parentElement!
                                .previousElementSibling as HTMLElement,
                            );
                          }}
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          className="tertiary-action danger"
                          aria-label={`Kategorie löschen: ${row.name}`}
                          onClick={() => void remove(row)}
                        >
                          Löschen
                        </button>
                      </>
                    )}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {error && <p role="alert">{error}</p>}
      <p role="status">{message}</p>
      {editing && (
        <ModalDialog
          className="form-dialog category-dialog"
          aria-labelledby="category-dialog-title"
          busy={busy}
          onDismiss={close}
        >
          <header className="form-dialog-header">
            <h3 id="category-dialog-title">
              {editing === 'new' ? 'Kategorie anlegen' : 'Kategorie bearbeiten'}
            </h3>
            <button
              type="button"
              className="tertiary-action form-dialog-close"
              aria-label="Dialog schließen"
              title="Dialog schließen"
              disabled={busy}
              onClick={close}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <form onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy}>
              <legend className="sr-only">Kategorie</legend>
              <label>
                Name
                <input
                  ref={nameField}
                  value={name}
                  maxLength={120}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Innerhalb Kategorie
                <select
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                >
                  <option value="">Keine (oberste Ebene)</option>
                  {tree
                    .filter(({ row }) => !excluded.has(row.id))
                    .map(({ row, depth }) => (
                      <option key={row.id} value={row.id}>
                        {'\u00a0\u00a0'.repeat(depth) + row.name}
                      </option>
                    ))}
                </select>
              </label>
            </fieldset>
            <div className="form-dialog-footer">
              <button
                className="primary-action"
                disabled={busy || !name.trim()}
              >
                Speichern
              </button>
              <button
                type="button"
                className="tertiary-action"
                disabled={busy}
                onClick={close}
              >
                Abbrechen
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
    </section>
  );
}
