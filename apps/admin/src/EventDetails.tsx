import { WebsiteInquiry } from './WebsiteInquiry.js';
import { ResourceAssignments } from './ResourceAssignments.js';
import { EventDocuments } from './EventDocuments.js';
import { EventLibraryFiles } from './EventLibraryFiles.js';
import {
  EventInlineEditor,
  canonicalEventRow,
  eventInput,
  validEventRow,
  type EventInlineHandle,
  type ConfirmedContact,
  type EventInlineSaveState,
} from './EventInlineEditor.js';
import type { VenueChoice } from './venue.js';
import type { ContactHit } from './ContactPicker.js';
import { useAutoRefresh } from './auto-refresh.js';
import { registerUnsavedChanges } from './unsaved-changes.js';
import { plainDateText } from './calendar-range.js';
import { useEffect, useRef, useState } from 'react';
import type { EventRow } from './EventPanel.js';
type Detail = {
  event: EventRow;
  websiteInquiryAvailable?: boolean;
  contacts: {
    id: string;
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
    mobile: string;
    role: string;
    detailsUnavailable?: boolean;
  }[];
  location: {
    id: string;
    name: string;
    street: string;
    postalCode: string;
    city: string;
    country: string;
  } | null;
  eventType: { id: string; name: string } | null;
  package: { id: string; name: string } | null;
  activities: {
    id: string;
    kind: string;
    eventVersion: number | null;
    occurredAt: string;
    description: string;
  }[];
};
// BKP013.1: the event file is one record with a stable head and five focused
// work areas. Details holds the main information, Ressourcen keeps the existing
// atomic assignment surface, Dateien owns the documents, Notizen and Logbuch
// stay directly reachable. There is deliberately no mail area while no mail
// module exists.
type Area = 'details' | 'resources' | 'files' | 'notes' | 'activity';
const areas: { value: Area; label: string }[] = [
  { value: 'details', label: 'Details' },
  { value: 'resources', label: 'Ressourcen' },
  { value: 'files', label: 'Dateien' },
  { value: 'notes', label: 'Notizen' },
  { value: 'activity', label: 'Logbuch' },
];
// A wide frame keeps contact and place beside the main information; the narrow
// frame offers the same context behind one deliberate disclosure, so the form
// stays the first thing. Without a media query the context stays visible
// instead of disappearing silently.
function useWideRecord() {
  const [wide, setWide] = useState(
    () =>
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(min-width: 64rem)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const viewport = window.matchMedia('(min-width: 64rem)');
    const changed = () => setWide(viewport.matches);
    viewport.addEventListener('change', changed);
    return () => viewport.removeEventListener('change', changed);
  }, []);
  return wide;
}
function clockText(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(instant));
}
// The head keeps the same stored values as the record body: the genuine
// schedule and the effective place. A date-only booking says so instead of
// inventing a clock time (H037), and a missing place stays open, not an error.
function headSchedule(event: Detail['event']) {
  if (!event.startsAt)
    return event.eventDate ? 'Tagesbuchung, ohne Uhrzeit' : '';
  return event.endsAt
    ? clockText(event.startsAt, event.timeZone) +
        '–' +
        clockText(event.endsAt, event.timeZone) +
        ' Uhr'
    : 'ab ' + clockText(event.startsAt, event.timeZone) + ' Uhr';
}
function safeNoteLink(value: string) {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:', 'mailto:'].includes(url.protocol)
      ? url.href
      : '';
  } catch {
    return '';
  }
}
function effectivePlace(event: Detail['event'], location: Detail['location']) {
  if (event.venueOverride)
    return (event.venue ?? '').trim().replace(/\s*\n\s*/g, ', ');
  if (!location) return '';
  return [
    location.name,
    location.street,
    [location.postalCode, location.city].filter(Boolean).join(' '),
  ]
    .filter((part) => Boolean(part?.trim()))
    .join(', ');
}
export function EventDetails({
  id,
  revision = 0,
  csrfToken,
  statuses,
  onChanged,
  onEdit,
  onClose,
  types = [],
  packages = [],
  locations = [],
  onRecordConfirmed,
  onResourceConfirmed,
  onRecordDirtyChange,
}: {
  id: string;
  revision?: number;
  csrfToken: string;
  statuses: { code: string; label: string }[];
  onChanged: (message?: string) => Promise<void>;
  onEdit: (event: EventRow) => void;
  onClose: () => void;
  types?: VenueChoice[];
  packages?: VenueChoice[];
  locations?: VenueChoice[];
  onRecordConfirmed?: (row: EventRow) => void;
  onResourceConfirmed?: (row: EventRow) => void;
  onRecordDirtyChange?: (dirty: boolean) => void;
}) {
  const [area, setArea] = useState<Area>('details');
  const wideRecord = useWideRecord();
  const heading = useRef<HTMLHeadingElement>(null),
    detailsPanel = useRef<HTMLDivElement>(null),
    resourcesPanel = useRef<HTMLDivElement>(null),
    filesPanel = useRef<HTMLDivElement>(null),
    notesPanel = useRef<HTMLDivElement>(null),
    notesEditor = useRef<HTMLDivElement>(null),
    notesSelection = useRef<Range | null>(null),
    notesComposing = useRef(false),
    activityPanel = useRef<HTMLDivElement>(null),
    focusedArea = useRef<Area>('details'),
    loadSequence = useRef(0),
    saving = useRef(false),
    resourceMutation = useRef(false),
    metadataDirty = useRef(false),
    metadataEditorDirty = useRef(false),
    notesDraftDirty = useRef(false),
    notesActiveDraft = useRef(false),
    inline = useRef<EventInlineHandle>(null),
    // A reload replaces the form values. Both refs mark unsaved input so a
    // retry can never discard it silently.
    dirty = useRef(false),
    resourcesDirty = useRef(false),
    loadedVersion = useRef<number | null>(null),
    loadedId = useRef<string | null>(null),
    attemptedRevision = useRef<number | null>(null);
  const [epoch, setEpoch] = useState(0),
    [data, setData] = useState<Detail | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [refreshDeferred, setRefreshDeferred] = useState(false),
    [reloadWarning, setReloadWarning] = useState(false);
  const [metaBlocked, setMetaBlocked] = useState(false),
    [legacyBlocked, setLegacyBlocked] = useState(false),
    [resourceVersion, setResourceVersion] = useState<number | null>(null),
    [statusUncertain, setStatusUncertain] = useState(false),
    [notesDraft, setNotesDraft] = useState(''),
    [notesLimitReached, setNotesLimitReached] = useState(false),
    [linkAddress, setLinkAddress] = useState(''),
    [hasNotesSelection, setHasNotesSelection] = useState(false),
    [notesSaveState, setNotesSaveState] = useState<EventInlineSaveState>({
      status: 'idle',
      error: '',
      dirty: false,
      notesHtml: '',
      confirmedNotesHtml: '',
      remoteNotesHtml: null,
    });
  const statusUncertainRef = useRef(false),
    resourceUncertainRef = useRef(false);
  function refreshMetadataDirty() {
    const value = metadataEditorDirty.current || notesDraftDirty.current;
    metadataDirty.current = value;
    setLegacyBlocked(value);
    onRecordDirtyChange?.(
      value ||
        dirty.current ||
        resourcesDirty.current ||
        saving.current ||
        resourceMutation.current ||
        statusUncertainRef.current ||
        resourceUncertainRef.current,
    );
  }
  function metadataChanged(value: boolean) {
    metadataEditorDirty.current = value;
    refreshMetadataDirty();
  }
  function notesSaveStateChanged(state: EventInlineSaveState) {
    setNotesSaveState(state);
    if (!notesActiveDraft.current) setNotesDraft(state.notesHtml);
    if (state.status === 'idle' && !state.dirty && !notesActiveDraft.current) {
      notesDraftDirty.current = false;
      refreshMetadataDirty();
    }
  }
  function discardNotesDraft(value: string) {
    notesActiveDraft.current = false;
    notesDraftDirty.current = false;
    setNotesLimitReached(false);
    setNotesDraft(value);
    refreshMetadataDirty();
  }
  function rememberNotesSelection() {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (
      selection &&
      range &&
      notesEditor.current &&
      rangeWithin(notesEditor.current, range)
    ) {
      notesSelection.current = range.cloneRange();
      setHasNotesSelection(!selection.isCollapsed);
    }
  }
  function rangeWithin(editor: HTMLElement, range: Range) {
    return [range.startContainer, range.endContainer].every(
      (node) => node === editor || editor.contains(node),
    );
  }
  function updateNotesEditor(element: HTMLDivElement) {
    const value = element.innerHTML;
    if (value.length > 20000) {
      element.innerHTML = notesDraft;
      setNotesLimitReached(true);
      return;
    }
    setNotesLimitReached(false);
    notesActiveDraft.current = true;
    notesDraftDirty.current = true;
    setNotesDraft(value);
    refreshMetadataDirty();
  }
  function notesLocked() {
    return (
      loading ||
      busy ||
      dirty.current ||
      resourcesDirty.current ||
      saving.current ||
      resourceMutation.current ||
      statusUncertainRef.current ||
      resourceUncertainRef.current
    );
  }
  function formatNotes(command: 'bold' | 'italic' | 'underline') {
    const editor = notesEditor.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection(),
      range = notesSelection.current;
    if (selection && range && rangeWithin(editor, range)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand(command);
    rememberNotesSelection();
    updateNotesEditor(editor);
  }
  function insertNotesLink() {
    const href = safeNoteLink(linkAddress),
      range = notesSelection.current,
      editor = notesEditor.current;
    if (!href || !range || !editor || !rangeWithin(editor, range)) return;
    const selection = window.getSelection();
    if (!selection) return;
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    anchor.append(range.extractContents());
    range.insertNode(anchor);
    range.selectNodeContents(anchor);
    selection.removeAllRanges();
    selection.addRange(range);
    notesSelection.current = range.cloneRange();
    updateNotesEditor(editor);
  }
  function insertNotesFragment(
    fragment: DocumentFragment,
    preferCurrent = false,
  ) {
    const editor = notesEditor.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection(),
      currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null,
      range =
        (preferCurrent && currentRange && rangeWithin(editor, currentRange)
          ? currentRange
          : notesSelection.current) ?? currentRange;
    if (!selection || !range || !rangeWithin(editor, range)) return;
    selection.removeAllRanges();
    selection.addRange(range);
    range.deleteContents();
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) range.setStartAfter(last);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    notesSelection.current = range.cloneRange();
    updateNotesEditor(editor);
  }
  function cancelNoteInput() {
    const value =
      inline.current?.getNotesValue() ?? data?.event.notesHtml ?? '';
    discardNotesDraft(value);
    notesSelection.current = null;
    setHasNotesSelection(false);
    if (notesEditor.current) notesEditor.current.innerHTML = value;
    notesEditor.current?.focus();
  }
  function legacyChanged() {
    onRecordDirtyChange?.(
      metadataDirty.current ||
        dirty.current ||
        resourcesDirty.current ||
        saving.current ||
        resourceMutation.current ||
        statusUncertainRef.current ||
        resourceUncertainRef.current,
    );
    setMetaBlocked(
      dirty.current ||
        resourcesDirty.current ||
        saving.current ||
        resourceMutation.current ||
        statusUncertainRef.current ||
        resourceUncertainRef.current,
    );
  }
  function applyConfirmed(
    row: EventRow,
    contact?: ContactHit,
    details?: ConfirmedContact[],
    known?: ContactHit[],
  ) {
    const chosenLocation = locations.find((item) => item.id === row.locationId);
    ++loadSequence.current;
    loadedVersion.current = row.version;
    loadedId.current = row.id;
    if (!resourceMutation.current && !resourceUncertainRef.current)
      setResourceVersion(row.version);
    setLoading(false);
    setData((current) =>
      current
        ? {
            ...current,
            event: row,
            contacts: [row.primaryContactId, ...row.additionalContactIds]
              .filter((id): id is string => id !== null)
              .map((id) => {
                const existing = (details ?? current.contacts).find(
                  (person) => person.id === id,
                );
                const searched = known?.find((person) => person.id === id);
                return {
                  id,
                  name:
                    existing?.name ??
                    ((searched ?? (contact?.id === id ? contact : undefined))
                      ? (searched ?? contact)!.name
                      : 'Zugeordneter Kontakt'),
                  contactPerson:
                    existing?.contactPerson ??
                    searched?.contactPerson ??
                    (contact?.id === id ? (contact.contactPerson ?? '') : ''),
                  email: existing?.email ?? '',
                  phone: existing?.phone ?? '',
                  mobile: existing?.mobile ?? '',
                  role: id === row.primaryContactId ? 'primary' : 'additional',
                  detailsUnavailable:
                    !existing ||
                    ('detailsUnavailable' in existing &&
                      existing.detailsUnavailable === true),
                };
              }),
            eventType: row.eventTypeId
              ? (types.find((item) => item.id === row.eventTypeId) ??
                (current.eventType?.id === row.eventTypeId
                  ? current.eventType
                  : null))
              : null,
            package: row.packageId
              ? (packages.find((item) => item.id === row.packageId) ??
                (current.package?.id === row.packageId
                  ? current.package
                  : null))
              : null,
            location:
              row.locationId === current.location?.id
                ? current.location
                : chosenLocation
                  ? {
                      id: chosenLocation.id,
                      name: chosenLocation.name,
                      street: chosenLocation.street ?? '',
                      postalCode: chosenLocation.postalCode ?? '',
                      city: chosenLocation.city ?? '',
                      country: chosenLocation.country ?? '',
                    }
                  : null,
          }
        : current,
    );
    onRecordConfirmed?.(row);
  }
  function adoptExternal(row: EventRow) {
    if (!inline.current?.adoptExternal(row)) throw Error('unconfirmed');
  }
  function mayReplaceDraft() {
    if (metadataDirty.current) return false;
    if (!dirty.current && !resourcesDirty.current) return true;
    if (!window.confirm('Ungespeicherte Eingaben verwerfen und neu laden?'))
      return false;
    dirty.current = false;
    resourcesDirty.current = false;
    legacyChanged();
    if (!statusUncertainRef.current && !resourceUncertainRef.current)
      setEpoch((current) => current + 1);
    return true;
  }
  async function load(ownMutation = false) {
    const current = ++loadSequence.current;
    attemptedRevision.current = revision;
    setLoading(true);
    try {
      const response = await fetch('/api/v1/events/' + id);
      if (!response.ok) throw Error('load');
      const next = (await response.json()) as Detail;
      if (!validEventRow(next.event, id)) throw Error('invalid event');
      next.event = canonicalEventRow(next.event);
      // A slower, older request must never overwrite a newer event state.
      if (current !== loadSequence.current) return false;
      // The user started editing while this request was in flight. Keep the
      // form untouched and offer the newer data explicitly instead.
      if (
        dirty.current ||
        resourcesDirty.current ||
        metadataDirty.current ||
        (!ownMutation && (saving.current || resourceMutation.current))
      ) {
        setRefreshDeferred(true);
        return false;
      }
      if (
        loadedVersion.current !== null &&
        loadedId.current === id &&
        next.event.version < loadedVersion.current
      ) {
        setRefreshDeferred(true);
        return false;
      }
      if (
        loadedId.current === id &&
        inline.current &&
        !inline.current.adoptExternal(next.event)
      ) {
        setRefreshDeferred(true);
        return false;
      }
      loadedVersion.current = next.event.version;
      loadedId.current = next.event.id;
      if (!resourceMutation.current && !resourceUncertainRef.current)
        setResourceVersion(next.event.version);
      setData(next);
      setLoadFailed(false);
      setRefreshDeferred(false);
      setReloadWarning(false);
      return true;
    } catch (error) {
      if (current === loadSequence.current) {
        setLoadFailed(true);
        throw error;
      }
      return false;
    } finally {
      if (current === loadSequence.current) setLoading(false);
    }
  }
  function backgroundLoad() {
    if (dirty.current || resourcesDirty.current || metadataDirty.current) {
      setRefreshDeferred(true);
      return;
    }
    void load().catch(() => {});
  }
  useAutoRefresh(backgroundLoad, () => loading || busy || saving.current);
  useEffect(
    () => () => {
      ++loadSequence.current;
      onRecordDirtyChange?.(false);
    },
    [],
  );
  useEffect(
    () =>
      registerUnsavedChanges(
        () =>
          dirty.current ||
          metadataDirty.current ||
          resourcesDirty.current ||
          saving.current ||
          resourceMutation.current ||
          statusUncertainRef.current ||
          resourceUncertainRef.current,
        true,
      ),
    [],
  );
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (
        !dirty.current &&
        !metadataDirty.current &&
        !resourcesDirty.current &&
        !saving.current &&
        !resourceMutation.current &&
        !statusUncertainRef.current &&
        !resourceUncertainRef.current
      )
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  useEffect(() => {
    void load().catch(() => {});
  }, [id]);
  useEffect(() => {
    if (loading || loadFailed) return;
    if (loadedId.current === id && loadedVersion.current === revision) return;
    // A successful response that still carries an older version must not turn
    // the revision check into a request loop.
    if (attemptedRevision.current === revision) return;
    if (dirty.current || resourcesDirty.current || metadataDirty.current) {
      setRefreshDeferred(true);
      return;
    }
    void load().catch(() => {});
  }, [revision, loading, loadFailed]);
  useEffect(() => {
    if (data) {
      heading.current?.scrollIntoView?.();
      heading.current?.focus({ preventScroll: true });
    }
  }, [data?.event.id]);
  useEffect(() => {
    const editor = notesEditor.current;
    if (editor && editor.innerHTML !== notesDraft)
      editor.innerHTML = notesDraft;
  }, [notesDraft]);
  // Switching the work area moves the keyboard focus into the chosen area.
  // Nothing is unmounted, so every draft keeps its value.
  useEffect(() => {
    if (focusedArea.current === area) return;
    focusedArea.current = area;
    const panel = {
      details: detailsPanel,
      resources: resourcesPanel,
      files: filesPanel,
      notes: notesPanel,
      activity: activityPanel,
    }[area];
    panel.current?.focus({ preventScroll: true });
  }, [area]);
  async function saveStatus(form: HTMLFormElement) {
    if (
      saving.current ||
      statusUncertainRef.current ||
      resourceUncertainRef.current ||
      resourceMutation.current ||
      resourcesDirty.current ||
      metadataDirty.current
    )
      return;
    saving.current = true;
    ++loadSequence.current;
    legacyChanged();
    setBusy(true);
    setMessage('');
    try {
      const status = String(new FormData(form).get('status'));
      const response = await fetch('/api/v1/events/' + id, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          ...eventInput(data!.event),
          version: data!.event.version,
          status,
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        if (response.status === 409) {
          statusUncertainRef.current = true;
          setStatusUncertain(true);
          dirty.current = true;
        }
        setMessage(
          error.error === 'conflict'
            ? 'Inzwischen geändert. Bitte Eingaben prüfen und den aktuellen Stand neu laden.'
            : error.error === 'import_review_required'
              ? 'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.'
              : 'Status konnte nicht gespeichert werden. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      const row: unknown = await response.json().catch(() => null);
      if (!validEventRow(row, id, data!.event.version + 1))
        throw Error('unconfirmed');
      adoptExternal(canonicalEventRow(row));
      // The PUT is confirmed; report it before reloading so a failing GET is
      // never mistaken for a failed save.
      setMessage('Status gespeichert.');
      dirty.current = false;
      setRefreshDeferred(false);
      try {
        await load(true);
        await onChanged();
      } catch {
        setReloadWarning(true);
      }
    } catch {
      statusUncertainRef.current = true;
      setStatusUncertain(true);
      dirty.current = true;
      setMessage(
        'Verbindung fehlgeschlagen. Aktuellen Stand vor einem erneuten Versuch laden.',
      );
    } finally {
      saving.current = false;
      legacyChanged();
      setBusy(false);
    }
  }
  async function reconcileStatus() {
    if (
      saving.current ||
      !window.confirm('Ungespeicherte Eingaben verwerfen und neu laden?')
    )
      return;
    saving.current = true;
    dirty.current = false;
    legacyChanged();
    try {
      if (!(await load(true))) throw Error('reload not adopted');
      statusUncertainRef.current = false;
      setStatusUncertain(false);
      setEpoch((current) => current + 1);
      setMessage('');
      legacyChanged();
    } catch {
      dirty.current = true;
    } finally {
      saving.current = false;
      legacyChanged();
    }
  }
  function retryLoad() {
    if (!mayReplaceDraft()) return;
    setRefreshDeferred(false);
    void load().catch(() => {});
  }
  function retryAfterSave() {
    if (!mayReplaceDraft()) return;
    setReloadWarning(false);
    setRefreshDeferred(false);
    void (async () => {
      try {
        await load();
        await onChanged();
      } catch {
        setReloadWarning(true);
      }
    })();
  }
  function discardDeferred() {
    if (!mayReplaceDraft()) return;
    setReloadWarning(false);
    setRefreshDeferred(false);
    void load().catch(() => {});
  }
  function time(value: string | null) {
    return value
      ? new Intl.DateTimeFormat('de-DE', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: data!.event.timeZone,
        }).format(new Date(value))
      : 'Noch offen';
  }
  const schedule = data ? headSchedule(data.event) : '',
    place = data ? effectivePlace(data.event, data.location) : '';
  return (
    <section
      className="event-record"
      aria-label="Event-Details"
      aria-busy={loading}
    >
      <button
        className="tertiary-action"
        type="button"
        onClick={() => {
          if (
            (metadataDirty.current ||
              dirty.current ||
              resourcesDirty.current ||
              saving.current ||
              resourceMutation.current ||
              statusUncertainRef.current ||
              resourceUncertainRef.current) &&
            !window.confirm(
              'Bereich trotz ungespeicherter Eingaben verlassen? Laufende Speicherungen werden fortgesetzt.',
            )
          )
            return;
          onClose();
        }}
      >
        Event-Details schließen
      </button>
      <p role="status">{message}</p>
      {statusUncertain && (
        <button type="button" onClick={() => void reconcileStatus()}>
          Serverstand prüfen und Eingaben verwerfen
        </button>
      )}
      {refreshDeferred && (
        <div className="reload-warning">
          <p role="status">
            Eine Aktualisierung steht aus. Sie wird zurückgehalten, damit deine
            ungespeicherten Eingaben erhalten bleiben.
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={busy || loading}
            onClick={discardDeferred}
          >
            Neu laden und Eingaben verwerfen
          </button>
        </div>
      )}
      {loadFailed && !reloadWarning && !refreshDeferred && (
        <div className="reload-warning">
          <p role="alert">
            Event-Details konnte nicht geladen werden.{' '}
            {data
              ? 'Der zuletzt geladene Stand bleibt sichtbar.'
              : 'Bitte erneut versuchen.'}
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={busy || loading}
            onClick={retryLoad}
          >
            Event-Details erneut laden
          </button>
        </div>
      )}
      {reloadWarning && (
        <div className="reload-warning">
          <p role="alert">
            Gespeichert, aber die Event-Details konnten nicht neu geladen
            werden. Es wurde nichts doppelt angelegt.
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={retryAfterSave}
          >
            Event-Details erneut laden
          </button>
        </div>
      )}
      {loading && <p>Event-Details werden geladen …</p>}
      {data && (
        <>
          <header className="event-record-head" data-status={data.event.status}>
            <p className="event-record-when">
              <span className="event-record-date">
                {data.event.eventDate
                  ? plainDateText(data.event.eventDate)
                  : 'ohne Datum'}
              </span>
              {schedule && (
                <span className="event-record-time">{schedule}</span>
              )}
            </p>
            <h2 ref={heading} tabIndex={-1}>
              Event: {data.event.name}
            </h2>
            <p className="event-record-facts">
              <span className="event-status">
                <span className="event-status-mark" aria-hidden="true" />
                {statuses.find((status) => status.code === data.event.status)
                  ?.label ?? data.event.status}
              </span>
              <span className="event-record-type">
                {data.eventType?.name ?? 'Art offen'}
              </span>
              <span className="event-record-place">{place || 'Ort offen'}</span>
              {(data.event.source ?? '').startsWith('Website:') && (
                <span className="event-source-quiet">Website</span>
              )}
            </p>
          </header>
          <nav className="record-navigation" aria-label="Bereiche des Events">
            {areas.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="nav-action"
                aria-current={area === entry.value ? 'location' : undefined}
                onClick={() => {
                  setArea(entry.value);
                  heading.current?.scrollIntoView?.();
                }}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-details"
            tabIndex={-1}
            ref={detailsPanel}
            hidden={area !== 'details'}
          >
            <h3 id="event-panel-details">Details</h3>
            <div className="event-detail-layout">
              <div className="event-detail-main">
                <h4>Termin</h4>
                <dl>
                  <dt>Datum</dt>
                  <dd>
                    {data.event.eventDate
                      ? data.event.eventDate.split('-').reverse().join('.')
                      : 'Ohne Datum'}
                  </dd>
                  {/* H037: a date-only booking says so; a real midnight start
                      keeps its genuine clock time from the stored timestamp. */}
                  <dt>Beginn</dt>
                  <dd>
                    {data.event.startsAt
                      ? time(data.event.startsAt)
                      : 'Tagesbuchung, ohne Uhrzeit'}
                  </dd>
                  <dt>Ende</dt>
                  <dd>
                    {data.event.endsAt
                      ? time(data.event.endsAt)
                      : 'Ohne Uhrzeit'}
                  </dd>
                </dl>
                <EventInlineEditor
                  ref={inline}
                  key={'inline:' + data.event.id}
                  event={data.event}
                  csrfToken={csrfToken}
                  types={types}
                  packages={packages}
                  locations={locations}
                  contacts={data.contacts}
                  locked={metaBlocked || loading}
                  canEdit={() =>
                    !dirty.current &&
                    !resourcesDirty.current &&
                    !saving.current &&
                    !resourceMutation.current &&
                    !statusUncertainRef.current &&
                    !resourceUncertainRef.current
                  }
                  onDirtyChange={metadataChanged}
                  onSaveStateChange={notesSaveStateChanged}
                  onNotesReset={discardNotesDraft}
                  onConfirmed={applyConfirmed}
                />
                <h4>Allgemein</h4>
                <dl>
                  <dt>Eventart</dt>
                  <dd>{data.eventType?.name ?? 'Noch offen'}</dd>
                  <dt>Fotobox-Paket</dt>
                  <dd>{data.package?.name ?? 'Noch offen'}</dd>
                  <dt>Anfragequelle</dt>
                  <dd>{data.event.source || 'Noch offen'}</dd>
                  <dt>Beschreibung</dt>
                  <dd>{data.event.description || 'Keine Beschreibung'}</dd>
                </dl>
                {data.websiteInquiryAvailable && (
                  <WebsiteInquiry
                    key={id}
                    eventId={id}
                    timeZone={data.event.timeZone}
                  />
                )}
                <form
                  key={data.event.version + ':' + epoch}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveStatus(event.currentTarget);
                  }}
                >
                  <fieldset
                    disabled={
                      busy ||
                      loading ||
                      statusUncertain ||
                      resourceUncertainRef.current ||
                      legacyBlocked ||
                      resourcesDirty.current
                    }
                  >
                    <legend>Status ändern</legend>
                    <label>
                      Status des Events
                      <select
                        name="status"
                        defaultValue={data.event.status}
                        onChange={() => {
                          dirty.current = true;
                          legacyChanged();
                        }}
                      >
                        {statuses.map((status) => (
                          <option
                            key={status.code}
                            value={status.code}
                            disabled={status.code === 'booked'}
                          >
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="primary-action">Status speichern</button>
                  </fieldset>
                </form>
                <button
                  type="button"
                  className="icon-action tier-quiet-icon"
                  aria-label={`Stammdaten bearbeiten: ${data.event.name}`}
                  title="Event bearbeiten"
                  disabled={busy || loading}
                  onClick={() => {
                    if (
                      (metadataDirty.current ||
                        dirty.current ||
                        resourcesDirty.current ||
                        saving.current ||
                        resourceMutation.current ||
                        statusUncertainRef.current ||
                        resourceUncertainRef.current) &&
                      !window.confirm(
                        'Bereich trotz ungespeicherter Eingaben verlassen? Laufende Speicherungen werden fortgesetzt.',
                      )
                    )
                      return;
                    onEdit(data.event);
                  }}
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
              <aside className="event-detail-aside">
                <details className="event-aside" open={wideRecord}>
                  <summary>Kontakt und Ort</summary>
                  <h4>Kontakt</h4>
                  {/* A missing link is a normal open state of an option, not an
                      error and not a blocking step before the event exists. */}
                  {!data.contacts.some(
                    (person) => person.role === 'primary',
                  ) && <p>Kontakt noch offen.</p>}
                  <ul>
                    {data.contacts.map((person) => (
                      <li key={person.id}>
                        {person.role === 'primary'
                          ? 'Hauptkontakt'
                          : 'Weiterer Kontakt'}
                        : {person.name} {person.contactPerson}
                        {person.detailsUnavailable &&
                          ' (Kontaktdaten noch nicht geladen)'}{' '}
                        {person.email && (
                          <a
                            href={'mailto:' + encodeURIComponent(person.email)}
                          >
                            {person.email}
                          </a>
                        )}{' '}
                        {[person.phone, person.mobile]
                          .filter(Boolean)
                          .map((number, index) => (
                            <a
                              key={index}
                              href={'tel:' + number.replace(/[^+0-9]/g, '')}
                            >
                              {number}{' '}
                            </a>
                          ))}
                      </li>
                    ))}
                  </ul>
                  <h4>Ort / Adresse</h4>
                  {data.event.venueOverride ? (
                    data.event.venue?.trim() ? (
                      <p className="event-venue">{data.event.venue}</p>
                    ) : (
                      <p>Kein Veranstaltungsort hinterlegt.</p>
                    )
                  ) : data.location ? (
                    <>
                      <p>{data.location.name}</p>
                      <p>
                        {[
                          data.location.street,
                          data.location.postalCode,
                          data.location.city,
                          data.location.country,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    </>
                  ) : (
                    <p>Ort offen.</p>
                  )}
                </details>
              </aside>
            </div>
          </div>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-resources"
            tabIndex={-1}
            ref={resourcesPanel}
            hidden={area !== 'resources'}
          >
            <h3 id="event-panel-resources">Ressourcen</h3>
            <ResourceAssignments
              key={
                data.event.id +
                ':' +
                (resourceVersion ?? data.event.version) +
                ':' +
                epoch
              }
              event={data.event}
              csrfToken={csrfToken}
              onDirtyChange={(value) => {
                resourcesDirty.current = value;
                legacyChanged();
              }}
              locked={
                legacyBlocked ||
                dirty.current ||
                saving.current ||
                statusUncertain
              }
              canMutate={() =>
                !metadataDirty.current &&
                !dirty.current &&
                !saving.current &&
                !resourceMutation.current &&
                !statusUncertainRef.current &&
                !resourceUncertainRef.current
              }
              onUnconfirmedChange={(value) => {
                resourceUncertainRef.current = value;
                legacyChanged();
              }}
              onMutationChange={(value) => {
                resourceMutation.current = value;
                if (!value && loadedVersion.current !== null)
                  setResourceVersion(loadedVersion.current);
                legacyChanged();
              }}
              onConfirmed={(row) => {
                adoptExternal(row);
                onResourceConfirmed?.(row);
                setMessage('Ressourcen und Termin gespeichert.');
              }}
              onReconcile={async () => {
                if (!(await load(true))) throw Error('reload not adopted');
                await onChanged('Serverstand aktualisiert.');
                setEpoch((current) => current + 1);
              }}
              onChanged={async () => {
                try {
                  if (!(await load(true))) throw Error('reload not adopted');
                  await onChanged('Ressourcen und Termin gespeichert.');
                } catch (error) {
                  setReloadWarning(true);
                  throw error;
                }
              }}
            />
          </div>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-files"
            tabIndex={-1}
            ref={filesPanel}
            hidden={area !== 'files'}
          >
            <h3 id="event-panel-files">Dateien</h3>
            <p className="event-panel-hint">
              Dokumente dieses Events, nach ihrer Art getrennt. Was hier fehlt,
              ist noch nicht angelegt.
            </p>
            <EventLibraryFiles
              key={'library:' + data.event.id}
              eventId={data.event.id}
              csrfToken={csrfToken}
              active={area === 'files'}
            />
            <EventDocuments
              key={'documents:' + data.event.id}
              eventId={data.event.id}
              contactId={data.event.primaryContactId}
              timeZone={data.event.timeZone}
              csrfToken={csrfToken}
            />
          </div>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-notes"
            tabIndex={-1}
            ref={notesPanel}
            hidden={area !== 'notes'}
          >
            <h3 id="event-panel-notes">Interne Notizen</h3>
            <div
              className="event-note-composer"
              onBlurCapture={(event) => {
                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  ) ||
                  !notesActiveDraft.current
                )
                  return;
                notesActiveDraft.current = false;
                inline.current?.commitNotes(notesDraft);
              }}
              onKeyDownCapture={(event) => {
                if (event.key !== 'Escape' || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                event.stopPropagation();
                cancelNoteInput();
              }}
            >
              <div
                className="event-note-toolbar"
                role="group"
                aria-label="Notizen formatieren"
              >
                <button
                  type="button"
                  className="secondary-action"
                  disabled={notesLocked()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => formatNotes('bold')}
                >
                  Fett
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={notesLocked()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => formatNotes('italic')}
                >
                  Kursiv
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={notesLocked()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => formatNotes('underline')}
                >
                  Unterstrichen
                </button>
                <details className="event-note-link">
                  <summary>Link</summary>
                  <label>
                    Linkadresse
                    <input
                      value={linkAddress}
                      onChange={(event) =>
                        setLinkAddress(event.currentTarget.value)
                      }
                      placeholder="https://… oder mailto:…"
                      disabled={notesLocked()}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={
                      !safeNoteLink(linkAddress) ||
                      !hasNotesSelection ||
                      notesLocked()
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={insertNotesLink}
                  >
                    Link einfügen
                  </button>
                </details>
              </div>
              <div
                ref={notesEditor}
                role="textbox"
                aria-label="Interne Notizen"
                aria-multiline="true"
                aria-disabled={notesLocked()}
                contentEditable={!notesLocked()}
                data-placeholder="Interne Notizen …"
                className="event-note-editor"
                onMouseUp={rememberNotesSelection}
                onKeyUp={rememberNotesSelection}
                onCompositionStart={() => {
                  notesComposing.current = true;
                }}
                onCompositionEnd={(event) => {
                  notesComposing.current = false;
                  updateNotesEditor(event.currentTarget);
                }}
                onInput={(event) => {
                  if (!notesComposing.current)
                    updateNotesEditor(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  )
                    return;
                  const editor = event.currentTarget,
                    selection = window.getSelection(),
                    range = selection?.rangeCount
                      ? selection.getRangeAt(0)
                      : null;
                  if (!selection || !range || !rangeWithin(editor, range))
                    return;
                  event.preventDefault();
                  range.deleteContents();
                  const breakNode = document.createElement('br');
                  range.insertNode(breakNode);
                  range.setStartAfter(breakNode);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);
                  notesSelection.current = range.cloneRange();
                  updateNotesEditor(editor);
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  const text = event.clipboardData.getData('text/plain');
                  if (notesLocked() || !text) return;
                  const template = document.createElement('template');
                  template.content.append(document.createTextNode(text));
                  insertNotesFragment(template.content, true);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const text = event.dataTransfer.getData('text/plain');
                  if (notesLocked() || !text) return;
                  const template = document.createElement('template');
                  template.content.append(document.createTextNode(text));
                  insertNotesFragment(template.content, true);
                }}
              />
            </div>
            <p className="event-panel-hint">
              Einfügen als Text. Änderungen werden beim Verlassen gespeichert.
            </p>
            {notesLimitReached && (
              <p role="status">
                Die Notiz ist zu lang. Die letzte Änderung wurde nicht
                übernommen.
              </p>
            )}
            {notesSaveState.status === 'saving' && (
              <p role="status">Notizen werden gespeichert …</p>
            )}
            {notesSaveState.status === 'paused' && (
              <div role="alert">
                <p>{notesSaveState.error}</p>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => inline.current?.reconcile()}
                >
                  Aktuellen Stand laden
                </button>
              </div>
            )}
            {notesSaveState.status === 'checking' && (
              <p role="status">Aktueller Stand wird geladen …</p>
            )}
            {notesSaveState.status === 'review' && (
              <div role="alert">
                <p>Der aktuelle Stand unterscheidet sich von deiner Eingabe.</p>
                <dl>
                  <dt>Deine Eingabe</dt>
                  <dd>
                    Dein Entwurf bleibt erhalten, bis du einen Stand auswählst.
                  </dd>
                  <dt>Serverstand</dt>
                  <dd>
                    {notesSaveState.remoteNotesHtml ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: notesSaveState.remoteNotesHtml,
                        }}
                      />
                    ) : (
                      'Leer'
                    )}
                  </dd>
                </dl>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Deine ungespeicherten Änderungen verwerfen?',
                      )
                    )
                      inline.current?.useRemote();
                  }}
                >
                  Serverstand übernehmen
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => inline.current?.reapply()}
                >
                  Meine abgeschlossenen Änderungen anwenden
                </button>
              </div>
            )}
          </div>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-activity"
            tabIndex={-1}
            ref={activityPanel}
            hidden={area !== 'activity'}
          >
            <h3 id="event-panel-activity">Logbuch</h3>
            {!data.activities.length && <p>Noch keine Aktivitäten.</p>}
            <ol>
              {data.activities.map((activity) => (
                <li key={activity.id}>
                  <time dateTime={activity.occurredAt}>
                    {time(activity.occurredAt)}
                  </time>{' '}
                  {activity.description}
                  {activity.eventVersion === null
                    ? ' (Historischer Eintrag; frühere Details unbekannt)'
                    : ''}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
