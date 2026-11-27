import { WebsiteInquiry } from './WebsiteInquiry.js';
import { ResourceAssignments } from './ResourceAssignments.js';
import { EventDocuments } from './EventDocuments.js';
import { EventMails } from './EventMails.js';
import { EventLibraryFiles } from './EventLibraryFiles.js';
import { EventNotes } from './EventNotes.js';
import { EventLocationDialog } from './EventLocationDialog.js';
import {
  EventInlineEditor,
  canonicalEventRow,
  eventInput,
  validEventRow,
  type EventInlineHandle,
  type ConfirmedContact,
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
    // UI-BKP-03: the target status colours a status change in the logbook.
    nextStatus?: string | null;
    eventVersion: number | null;
    occurredAt: string;
    description: string;
  }[];
};
// BKP013.1, UI-PARITY-02: the event file is one record with a stable head and
// the work areas of Bookitup's event record (observed 31.10./24.11.2026):
// Details also holds the notes and the logbook, Ressourcen keeps the atomic
// assignment surface, Dateien owns the documents and E-Mails the event's mail.
type Area = 'details' | 'resources' | 'files' | 'mails';
const areas: { value: Area; label: string }[] = [
  { value: 'details', label: 'Details' },
  { value: 'resources', label: 'Ressourcen' },
  { value: 'files', label: 'Dateien' },
  { value: 'mails', label: 'E-Mails' },
];
const correctableStatusConflicts = new Set([
  'import_review_required',
  'reservations_need_review',
  'resource_conflict',
  'unit_unavailable',
]);
const resourceStatusConflicts = new Set([
  'reservations_need_review',
  'resource_conflict',
  'unit_unavailable',
]);
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
  onDuplicate,
  onClose,
  onRemoved,
  types = [],
  packages = [],
  locations = [],
  onLocationCreated,
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
  onDuplicate?: (event: EventRow) => void;
  onClose: () => void;
  onRemoved?: (message?: string) => void;
  types?: VenueChoice[];
  packages?: VenueChoice[];
  locations?: VenueChoice[];
  onLocationCreated?: (location: VenueChoice) => void;
  onRecordConfirmed?: (row: EventRow) => void;
  onResourceConfirmed?: (row: EventRow) => void;
  onRecordDirtyChange?: (dirty: boolean) => void;
}) {
  // UI-BKP-10: a link from the document overview names one document; the
  // file then opens in "Dateien" with that document.
  const [openDocumentId] = useState(() => {
    const doc = new URLSearchParams(window.location.search).get('doc');
    return doc &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        doc,
      )
      ? doc
      : null;
  });
  // A notification link "Antwort in der App" (`?mail=new`) opens the record
  // in E-Mails with the composer, once.
  const [mailRequested] = useState(
    () => new URLSearchParams(window.location.search).get('mail') === 'new',
  );
  const [area, setArea] = useState<Area>(() =>
    openDocumentId ? 'files' : mailRequested ? 'mails' : 'details',
  );
  const newMailButton = useRef<HTMLButtonElement>(null),
    mailOpened = useRef(false);
  const [editingDocument, setEditingDocument] = useState(false);
  // MAIL-STATUS-01: raised by every send order so the mail list reloads.
  const [mailRevision, setMailRevision] = useState(0);
  // UI-PARITY-02: "Neue Mail schreiben" in the E-Mails area opens the
  // compose dialog the documents own.
  const [composeRequest, setComposeRequest] = useState<{
    id: number;
    trigger: HTMLElement;
  } | null>(null);
  useEffect(() => {
    if (!mailRequested || mailOpened.current || !newMailButton.current) return;
    mailOpened.current = true;
    setComposeRequest({ id: Date.now(), trigger: newMailButton.current });
  });
  const wideRecord = useWideRecord();
  const [locationTrigger, setLocationTrigger] =
    useState<HTMLButtonElement | null>(null);
  const [locationNotice, setLocationNotice] = useState('');
  const createdLocations = useRef<VenueChoice[]>([]);
  const availableLocations = [
    ...locations,
    ...createdLocations.current.filter(
      (created) => !locations.some((place) => place.id === created.id),
    ),
  ];
  function closeLocationDialog() {
    setLocationTrigger(null);
    locationTrigger?.focus();
  }
  function locationCreated(location: VenueChoice) {
    createdLocations.current.push(location);
    onLocationCreated?.(location);
    const assigning = inline.current?.assignLocation(location.id);
    setLocationNotice(
      assigning
        ? ''
        : 'Location angelegt. Bitte unter „Gespeicherter Ort“ zuordnen.',
    );
    closeLocationDialog();
  }
  const heading = useRef<HTMLHeadingElement>(null),
    detailsPanel = useRef<HTMLDivElement>(null),
    resourcesPanel = useRef<HTMLDivElement>(null),
    filesPanel = useRef<HTMLDivElement>(null),
    activityPanel = useRef<HTMLDivElement>(null),
    mailsPanel = useRef<HTMLDivElement>(null),
    focusedArea = useRef<Area>('details'),
    loadSequence = useRef(0),
    saving = useRef(false),
    resourceMutation = useRef(false),
    metadataDirty = useRef(false),
    metadataEditorDirty = useRef(false),
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
    [removing, setRemoving] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [refreshDeferred, setRefreshDeferred] = useState(false),
    [reloadWarning, setReloadWarning] = useState(false),
    // QW2: the tenant's cancellation reasons and the status the form shows.
    [reasons, setReasons] = useState<VenueChoice[]>([]),
    [statusChoice, setStatusChoice] = useState<string | null>(null);
  const [metaBlocked, setMetaBlocked] = useState(false),
    [legacyBlocked, setLegacyBlocked] = useState(false),
    [resourceVersion, setResourceVersion] = useState<number | null>(null),
    [statusUncertain, setStatusUncertain] = useState(false),
    [statusResourceCorrection, setStatusResourceCorrection] = useState(false);
  const statusUncertainRef = useRef(false),
    resourceUncertainRef = useRef(false),
    documentEditorProtected = useRef(false);
  function hasRecordChanges() {
    return (
      metadataDirty.current ||
      dirty.current ||
      resourcesDirty.current ||
      saving.current ||
      resourceMutation.current ||
      statusUncertainRef.current ||
      resourceUncertainRef.current ||
      documentEditorProtected.current
    );
  }
  function documentEditorProtectionChanged(value: boolean) {
    documentEditorProtected.current = value;
    onRecordDirtyChange?.(hasRecordChanges());
  }
  function refreshMetadataDirty() {
    const value = metadataEditorDirty.current;
    metadataDirty.current = value;
    setLegacyBlocked(value);
    onRecordDirtyChange?.(hasRecordChanges());
  }
  function metadataChanged(value: boolean) {
    metadataEditorDirty.current = value;
    refreshMetadataDirty();
  }
  function legacyChanged() {
    onRecordDirtyChange?.(hasRecordChanges());
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
    const chosenLocation =
      createdLocations.current.find((item) => item.id === row.locationId) ??
      locations.find((item) => item.id === row.locationId);
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
      if (!hasRecordChanges()) return;
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
    // Without the list the record still saves; the reason picker offers only
    // "no reason" and keeps a stored one.
    void fetch('/api/v1/master-data/cancellation_reason')
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: unknown) =>
        setReasons(Array.isArray(rows) ? (rows as VenueChoice[]) : []),
      )
      .catch(() => setReasons([]));
  }, []);
  useEffect(() => {
    setStatusChoice(null);
  }, [data?.event.version, epoch]);
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
  // Switching the work area moves the keyboard focus into the chosen area.
  // Nothing is unmounted, so every draft keeps its value.
  useEffect(() => {
    if (focusedArea.current === area) return;
    focusedArea.current = area;
    const panel = {
      details: detailsPanel,
      resources: resourcesPanel,
      files: filesPanel,
      mails: mailsPanel,
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
    setStatusResourceCorrection(false);
    legacyChanged();
    setBusy(true);
    setMessage('');
    try {
      const values = new FormData(form),
        status = String(values.get('status')),
        reason = String(values.get('cancellationReasonId') ?? '');
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
          ...(status === 'cancelled'
            ? { cancellationReasonId: reason || null }
            : {}),
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        const uncertain =
          response.status >= 500 ||
          (response.status === 409 &&
            !correctableStatusConflicts.has(error.error));
        if (uncertain) {
          statusUncertainRef.current = true;
          setStatusUncertain(true);
          dirty.current = true;
          setMessage(
            response.status >= 500
              ? 'Serverantwort unklar. Vor einem erneuten Versuch den Serverstand abgleichen.'
              : error.error === 'conflict'
                ? 'Inzwischen geändert. Bitte Eingaben prüfen und den aktuellen Stand neu laden.'
                : 'Antwort unklar. Vor einem erneuten Versuch den Serverstand abgleichen.',
          );
          return;
        }
        setStatusResourceCorrection(
          response.status === 409 && resourceStatusConflicts.has(error.error),
        );
        setMessage(
          error.error === 'conflict'
            ? 'Inzwischen geändert. Bitte Eingaben prüfen und den aktuellen Stand neu laden.'
            : error.error === 'import_review_required'
              ? 'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.'
              : error.error === 'resource_conflict'
                ? 'Die Ressourcenzuweisung kollidiert mit einer anderen Belegung. Bitte Zuweisungen prüfen.'
                : error.error === 'unit_unavailable'
                  ? 'Eine zugewiesene Ressource ist gesperrt oder nicht verfügbar. Bitte Zuweisungen prüfen.'
                  : error.error === 'reservations_need_review'
                    ? 'Der Termin hat sich geändert. Bitte Zuweisungen und Zeitraum prüfen.'
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
      setStatusResourceCorrection(false);
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
  async function removeEvent() {
    if (!data || busy || loading || editingDocument || hasRecordChanges())
      return;
    if (
      !window.confirm(
        'Event löschen? Aktive Ressourcen werden freigegeben. Finale Dokumente und Historie bleiben erhalten. Das Event kann später wiederhergestellt werden; frühere Buchungen werden dabei nicht reaktiviert.',
      )
    )
      return;
    saving.current = true;
    setBusy(true);
    setRemoving(true);
    setMessage('Event wird entfernt …');
    try {
      const response = await fetch('/api/v1/events/' + id, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ version: data.event.version, confirm: true }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (response.status >= 500) {
          onRemoved?.(
            'Entfernungsstatus unklar. Bitte den Eintrag in aktiver und entfernter Eventliste abgleichen.',
          );
          return;
        }
        setMessage(
          body?.error === 'conflict'
            ? 'Event wurde zwischenzeitlich geändert. Bitte neu laden.'
            : 'Event konnte nicht entfernt werden. Serverstand prüfen.',
        );
        return;
      }
      const result = (await response.json().catch(() => null)) as {
        id?: unknown;
        version?: unknown;
        deletedAt?: unknown;
      } | null;
      if (
        result?.id !== id ||
        result.version !== data.event.version + 1 ||
        typeof result.deletedAt !== 'string'
      ) {
        onRemoved?.(
          'Entfernungsstatus unklar. Bitte den Eintrag in aktiver und entfernter Eventliste abgleichen.',
        );
        return;
      }
      onRemoved?.();
    } catch {
      onRemoved?.(
        'Verbindung unklar. Bitte den Eintrag in aktiver und entfernter Eventliste abgleichen.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
      setRemoving(false);
    }
  }
  function discardStatusDraftAndCorrectResources() {
    if (
      saving.current ||
      metadataDirty.current ||
      resourcesDirty.current ||
      resourceMutation.current ||
      statusUncertainRef.current ||
      resourceUncertainRef.current
    )
      return;
    dirty.current = false;
    setStatusResourceCorrection(false);
    setEpoch((current) => current + 1);
    setArea('resources');
    setMessage(
      'Statusentwurf verworfen. Ressourcenzuweisung korrigieren und den Status erneut setzen.',
    );
    legacyChanged();
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
    place = data ? effectivePlace(data.event, data.location) : '',
    cancellationReason =
      data?.event.status === 'cancelled'
        ? reasons.find(
            (reason) => reason.id === data.event.cancellationReasonId,
          )?.name
        : undefined;
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
            hasRecordChanges() &&
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
        <div className="event-record-layout">
          {/* UI-BKP-03: Bookitup's record column - the head, the areas as a
              vertical list and the rare actions as quiet links at its foot. */}
          <div className="event-record-side">
            <header
              className="event-record-head"
              data-status={data.event.status}
            >
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
                {cancellationReason && (
                  <span className="event-record-reason">
                    Grund: {cancellationReason}
                  </span>
                )}
                <span className="event-record-place">
                  {place || 'Ort offen'}
                </span>
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
            <div className="event-record-actions">
              {/* A copy starts from the stored record, so unsaved edits block
                it instead of being silently left out. */}
              {onDuplicate && (
                <button
                  type="button"
                  className="tertiary-action"
                  disabled={busy || loading || hasRecordChanges()}
                  onClick={() => onDuplicate(data.event)}
                >
                  Event duplizieren
                </button>
              )}
              <button
                type="button"
                className="tertiary-action danger-link"
                disabled={
                  busy || loading || editingDocument || hasRecordChanges()
                }
                onClick={() => void removeEvent()}
              >
                Event löschen
              </button>
            </div>
          </div>
          <div className="event-record-body">
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
                  <div className="event-detail-overview">
                    <div className="card-head">
                      <h4>Allgemein</h4>
                      <button
                        type="button"
                        className="icon-action tier-quiet-icon"
                        aria-label={`Stammdaten bearbeiten: ${data.event.name}`}
                        title="Event bearbeiten"
                        disabled={busy || loading}
                        onClick={() => {
                          if (
                            hasRecordChanges() &&
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
                        {/* UI-BKP-03: Bookitup's status choice with its
                            coloured dot, following the current choice. */}
                        <label
                          className="event-status-field"
                          data-status={statusChoice ?? data.event.status}
                        >
                          Status des Events
                          <select
                            name="status"
                            defaultValue={data.event.status}
                            onChange={(event) => {
                              setStatusResourceCorrection(false);
                              setStatusChoice(event.currentTarget.value);
                              dirty.current = true;
                              legacyChanged();
                            }}
                          >
                            {statuses.map((status) => (
                              <option key={status.code} value={status.code}>
                                {status.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {(statusChoice ?? data.event.status) ===
                          'cancelled' && (
                          <label>
                            Absagegrund
                            <select
                              name="cancellationReasonId"
                              defaultValue={
                                data.event.cancellationReasonId ?? ''
                              }
                              onChange={() => {
                                dirty.current = true;
                                legacyChanged();
                              }}
                            >
                              <option value="">Kein Grund angegeben</option>
                              {reasons
                                .filter(
                                  (reason) =>
                                    reason.state === 'active' ||
                                    reason.id ===
                                      data.event.cancellationReasonId,
                                )
                                .map((reason) => (
                                  <option key={reason.id} value={reason.id}>
                                    {reason.name}
                                    {reason.state !== 'active' &&
                                      ' (archiviert)'}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        <button className="primary-action">
                          Status speichern
                        </button>
                      </fieldset>
                    </form>
                    {statusResourceCorrection && (
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={
                          busy ||
                          loading ||
                          metadataDirty.current ||
                          resourcesDirty.current ||
                          resourceMutation.current ||
                          statusUncertainRef.current ||
                          resourceUncertainRef.current
                        }
                        onClick={discardStatusDraftAndCorrectResources}
                      >
                        Statusentwurf verwerfen und Ressourcen korrigieren
                      </button>
                    )}
                  </div>
                  <div className="event-detail-primary">
                    <h4>Zeitplan</h4>
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
                      locations={availableLocations}
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
                      onConfirmed={applyConfirmed}
                    />
                  </div>
                  <div className="event-detail-stack">
                    {/* UI-PARITY-02/04, QW3: dated notes and the logbook belong to
                the details main column, like Bookitup's Notizen and Logbuch. */}
                    <EventNotes eventId={data.event.id} csrfToken={csrfToken} />
                    <div
                      className="event-detail-section"
                      role="region"
                      aria-labelledby="event-panel-activity"
                      tabIndex={-1}
                      ref={activityPanel}
                    >
                      <h4 id="event-panel-activity">Logbuch</h4>
                      {!data.activities.length && (
                        <p>Noch keine Aktivitäten.</p>
                      )}
                      {/* UI-PARITY-05: a timeline like Bookitup's logbook - the
                      newest entry first, what happened above when it did. */}
                      <ol className="event-logbook">
                        {[...data.activities].reverse().map((activity) => (
                          <li
                            key={activity.id}
                            data-kind={activity.kind}
                            data-status={activity.nextStatus ?? undefined}
                          >
                            <span>
                              {activity.description}
                              {activity.eventVersion === null
                                ? ' (Historischer Eintrag; frühere Details unbekannt)'
                                : ''}
                            </span>
                            <time dateTime={activity.occurredAt}>
                              {time(activity.occurredAt)}
                            </time>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>
                <aside className="event-detail-aside">
                  <details className="event-aside" open={wideRecord}>
                    <summary>Kontakt und Ort</summary>
                    <section className="event-aside-contact">
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
                            <a
                              href={'#contact-' + person.id}
                              aria-label={'Details anzeigen: ' + person.name}
                            >
                              Details anzeigen
                            </a>{' '}
                            {person.email && (
                              <a
                                href={
                                  'mailto:' + encodeURIComponent(person.email)
                                }
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
                    </section>
                    <section
                      className="event-aside-location"
                      aria-labelledby="event-location-heading"
                    >
                      <div className="card-head">
                        <h4 id="event-location-heading">Ort / Adresse</h4>
                        <button
                          type="button"
                          className="icon-action tier-quiet-icon"
                          aria-label="Location anlegen"
                          title="Location anlegen"
                          disabled={metaBlocked || loading}
                          onClick={(event) =>
                            setLocationTrigger(event.currentTarget)
                          }
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
                      {locationNotice && <p role="status">{locationNotice}</p>}
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
                    </section>
                  </details>
                  {locationTrigger && (
                    <EventLocationDialog
                      csrfToken={csrfToken}
                      onClose={closeLocationDialog}
                      onCreated={locationCreated}
                    />
                  )}
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
              <h3 id="event-panel-files" hidden={editingDocument}>
                Dateien
              </h3>
              <p className="event-panel-hint" hidden={editingDocument}>
                Dokumente dieses Events, nach ihrer Art getrennt. Was hier
                fehlt, ist noch nicht angelegt.
              </p>
              <EventDocuments
                key={'documents:' + data.event.id}
                eventId={data.event.id}
                contactId={data.event.primaryContactId}
                contactName={
                  data.contacts.find(
                    (contact) => contact.id === data.event.primaryContactId,
                  )?.name ?? null
                }
                // MAIL-DOC-01: the same stored contact that names the event also
                // prefills the recipient; without an address the field stays empty.
                contactEmail={
                  data.contacts.find(
                    (contact) => contact.id === data.event.primaryContactId,
                  )?.email ?? null
                }
                timeZone={data.event.timeZone}
                csrfToken={csrfToken}
                onEditingChange={setEditingDocument}
                recordRemoving={removing}
                onEditorProtectedChange={documentEditorProtectionChanged}
                onMailScheduled={() => setMailRevision((value) => value + 1)}
                composeRequest={composeRequest}
                openDocumentId={openDocumentId}

                eventName={data.event.name}
                eventDate={data.event.eventDate}
              />
              <div hidden={editingDocument}>
                <EventLibraryFiles
                  key={'library:' + data.event.id}
                  eventId={data.event.id}
                  csrfToken={csrfToken}
                  active={area === 'files'}
                />
              </div>
            </div>
            <div
              className="event-record-panel"
              role="region"
              aria-labelledby="event-panel-mails"
              tabIndex={-1}
              ref={mailsPanel}
              hidden={area !== 'mails'}
            >
              <h3 id="event-panel-mails">E-Mails</h3>
              <button
                ref={newMailButton}
                type="button"
                className="secondary-action"
                aria-haspopup="dialog"
                disabled={editingDocument || removing}
                onClick={(event) =>
                  setComposeRequest({
                    id: Date.now(),
                    trigger: event.currentTarget,
                  })
                }
              >
                Neue Mail schreiben
              </button>
              <EventMails
                key={'mails:' + data.event.id}
                eventId={data.event.id}
                csrfToken={csrfToken}
                active={area === 'mails'}
                revision={mailRevision}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
