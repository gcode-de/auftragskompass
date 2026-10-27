import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { OfferDraftEditor } from './OfferDraftEditor.js';
import { exactMinorUnits } from './FilesPanel.js';
import { parseHundredths } from './decimal.js';

type DocumentRow = {
  id: string;
  kind: string;
  templateId: string | null;
  eventId: string | null;
  contactId: string | null;
  number: string | null;
  state: 'draft' | 'final' | 'withdrawn';
  issuedAt: string;
  finalizedAt: string | null;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  version: number;
  // BKP019.0: the business axis of an offer, only present with include=offer.
  offerStatus?: OfferStatus | null;
  validUntil?: string | null;
  offerExpired?: boolean;
  // BKP019.a: how and when the customer accepted; it outlives a withdrawal.
  acceptedAt?: string | null;
  acceptanceChannel?: AcceptanceChannel | null;
  acceptanceNote?: string | null;
  acceptanceFileId?: string | null;
  acceptanceFileName?: string | null;
  acceptanceFileState?: 'available' | 'archived' | null;
  // BKP019.b: the offer a confirmation was copied from, only present with the
  // offer projection.
  sourceDocumentId?: string | null;
  sourceNumber?: string | null;
  // BKP019.c2: the direction of a correction and the state derived for a
  // finalized invoice or confirmation. Never stored on the row itself.
  correctionDirection?: 'credit' | 'debit' | null;
  correctionState?: 'none' | 'partial' | 'full' | null;
  remainingCredit?: number | null;
  // BKP019.d: how much money arrived and what is still open on a finalized
  // invoice. Both are derived on the server and never stored on the row.
  paymentState?: 'none' | 'partial' | 'paid' | null;
  openMinor?: number | null;
  // BKP019.c3.2: the role of an invoice (`final` = Schlussrechnung), the frozen
  // deduction of that finale and what arrived on the settled advances.
  invoiceRole?: 'final' | null;
  depositAppliedMinor?: number | null;
  depositPaidMinor?: number | null;
  // RG-07: the invoice dates. `dueDate` only exists once the document is final;
  // outside the invoice family all three are null.
  serviceDate?: string | null;
  paymentTermDays?: number | null;
  dueDate?: string | null;
  // RG-07b: the account the invoice prints, printed word for word.
  bankAccount?: string | null;
};
type OfferStatus = 'sent' | 'accepted' | 'withdrawn';
type CorrectionDirection = 'credit' | 'debit';
type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'other';
type PaymentRow = {
  id: string;
  documentId: string;
  receivedOn: string;
  amountMinor: number;
  method: PaymentMethod;
  note: string | null;
  recordedAt: string;
};
type AcceptanceChannel = 'email' | 'phone' | 'pdf' | 'other';
type TemplateRow = { id: string; kind: string; name: string; state: string };
type LibraryFileRow = {
  id: string;
  displayName: string;
  state: 'available' | 'archived' | 'rejected';
};
const stateLabels: Record<DocumentRow['state'], string> = {
  draft: 'Entwurf',
  final: 'Finalisiert',
  withdrawn: 'Zurückgezogen',
};
// The business status is a second, independent line: a finalized offer can be
// sent, accepted or withdrawn and keeps its number and its PDF unchanged.
const offerStatusLabels: Record<OfferStatus | 'unset', string> = {
  unset: 'Noch nicht versendet',
  sent: 'Versendet',
  accepted: 'Angenommen',
  withdrawn: 'Zurückgezogen',
};
// AG-06 names the four channels a customer can say yes through.
const acceptanceChannelLabels: Record<AcceptanceChannel, string> = {
  email: 'E-Mail',
  phone: 'Telefon',
  pdf: 'Unterschriebenes PDF',
  other: 'Sonstiges',
};
// BKP019.c2: the cancellation state of an invoice is derived on the server from
// its finalized credit notes - the invoice itself is never rewritten.
const correctionStateLabels: Record<'none' | 'partial' | 'full', string> = {
  none: 'Nicht storniert',
  partial: 'Teilweise storniert',
  full: 'Storniert',
};
const correctionDirectionLabels: Record<CorrectionDirection, string> = {
  credit: 'Gutschrift (mindert den Betrag)',
  debit: 'Nachberechnung (erhöht den Betrag)',
};
const acceptanceChannels = Object.keys(
  acceptanceChannelLabels,
) as AcceptanceChannel[];
// BKP019.d: money that arrived is a record, not a status. "Offen" is the absence
// of a payment; "bezahlt" only exists because payments were entered. "Überfällig"
// is deliberately absent - without a payment term there is no honest due date.
const paymentStateLabels: Record<'none' | 'partial' | 'paid', string> = {
  none: 'Offen',
  partial: 'Teilweise bezahlt',
  paid: 'Bezahlt',
};
// Our own documented value set: the requirement names "Zahlweg" without a list.
const paymentMethodLabels: Record<PaymentMethod, string> = {
  bank_transfer: 'Überweisung',
  cash: 'Bar',
  card: 'Karte',
  other: 'Sonstiges',
};
const paymentMethods = Object.keys(paymentMethodLabels) as PaymentMethod[];
// The default of the date field is the tenant's own calendar day, never the
// browser's zone: a payment entered after midnight must not land on "tomorrow".
function tenantToday(timeZone: string): string {
  return Temporal.Now.instant()
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}
// One wording per rejected payment; a 409 is never silently retried.
function paymentFailureMessage(error: string): string {
  switch (error) {
    case 'overpaid':
      return 'Der Betrag übersteigt den offenen Restbetrag. Bitte Betrag prüfen.';
    case 'invalid_date':
      return 'Das Zahlungsdatum ist ungültig oder liegt in der Zukunft.';
    case 'invalid_amount':
      return 'Bitte einen Betrag größer als 0 eingeben.';
    case 'invalid_method':
      return 'Bitte einen gültigen Zahlweg wählen.';
    case 'invalid_note':
      return 'Die Notiz ist zu lang oder enthält unzulässige Zeichen.';
    case 'invalid_state':
    case 'invalid_kind':
      return 'Nur eine finalisierte Rechnung oder Anzahlungsrechnung nimmt Zahlungen an. Bitte Liste aktualisieren.';
    case 'not_found':
      return 'Die Rechnung wurde nicht gefunden. Bitte Liste aktualisieren.';
    default:
      return 'Zahlung konnte nicht erfasst werden. Bitte Angaben prüfen.';
  }
}
// One wording per rejected status change, shared by send/withdraw and accept.
function statusChangeMessage(error: string): string {
  switch (error) {
    case 'conflict':
      return 'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.';
    case 'invalid_transition':
      return 'Dieser Statuswechsel ist nicht zulässig.';
    case 'invalid_kind':
      return 'Nur ein finalisiertes Angebot hat einen Angebotsstatus.';
    case 'acceptance_conflict':
      return 'Für dieses Angebot ist bereits eine andere Annahme gespeichert. Bitte Liste aktualisieren.';
    case 'invalid_channel':
      return 'Bitte einen gültigen Annahmekanal wählen.';
    case 'invalid_time':
      return 'Der Annahmezeitpunkt ist ungültig oder liegt in der Zukunft.';
    case 'invalid_note':
      return 'Die Notiz ist zu lang oder enthält unzulässige Zeichen.';
    case 'invalid_attachment':
      return 'Der Anhang ist nicht mehr verfügbar. Bitte eine andere Datei wählen.';
    case 'not_found':
      return 'Die Datei wurde nicht gefunden. Bitte Liste aktualisieren.';
    default:
      return 'Statuswechsel nicht möglich.';
  }
}
// BKP013.1: the event file owns one card per document kind that actually
// exists. The offer card is always shown because it also carries the existing
// creation surface; any other kind appears only with real stored rows, so no
// empty contract or questionnaire card is invented.
const kindOrder = [
  'offer',
  'order_confirmation',
  'deposit_invoice',
  'invoice',
  'correction',
] as const;
const kindLabels: Record<string, string> = {
  offer: 'Angebote',
  order_confirmation: 'Auftragsbestätigungen',
  deposit_invoice: 'Anzahlungsrechnungen',
  invoice: 'Rechnungen',
  correction: 'Rechnungskorrekturen',
};
const otherKindLabel = 'Weitere Dateien';
const knownKinds = new Set<string>(kindOrder);
// BKP019.b: every action label names the kind of its own row, so a confirmation
// is never read out as an offer. Offer wordings stay unchanged.
const kindSingular: Record<string, string> = {
  offer: 'Angebot',
  order_confirmation: 'Auftragsbestätigung',
  deposit_invoice: 'Anzahlungsrechnung',
  invoice: 'Rechnung',
  correction: 'Rechnungskorrektur',
};
function kindName(entry: { kind: string; invoiceRole?: 'final' | null }) {
  // BKP019.c3.2: a final invoice names its role in every label it owns, so no
  // action of it is read out as a standard invoice.
  if (entry.kind === 'invoice' && entry.invoiceRole === 'final')
    return 'Schlussrechnung';
  return kindSingular[entry.kind] ?? 'Dokument';
}
// BKP019.b2: a confirmation draft owns its texts and positions exactly like an
// offer draft, so both open the one editor.
// BKP019.c1: an invoice draft copied from a confirmation is correctable the same
// way - a finalized document is never edited, its draft is.
// BKP019.c2b: a correction draft is the same right: its copied position text is
// correctable until finalization fixes it.
// BKP019.c3.1: a deposit draft is editable too - reducing the copied positions
// to the agreed advance is exactly the operator decision this draft is for.
const editableDraftKinds = new Set<string>([
  'offer',
  'order_confirmation',
  'deposit_invoice',
  'invoice',
  'correction',
]);

// One off-shape row must never take the whole event file down with it.
async function validDocuments(reply: Response): Promise<DocumentRow[]> {
  const rows = (await reply.json()) as DocumentRow[];
  return Array.isArray(rows)
    ? rows.filter(
        (entry) =>
          entry &&
          stateLabels[entry.state] !== undefined &&
          Number.isFinite(Date.parse(entry.finalizedAt ?? entry.issuedAt)) &&
          Number.isFinite(entry.grossMinor),
      )
    : [];
}

// The event file is where an offer is born: it owns the contact and the date
// that the template placeholders need.
export function EventDocuments({
  eventId,
  contactId,
  timeZone,
  csrfToken,
}: {
  eventId: string;
  contactId: string | null;
  timeZone: string;
  csrfToken: string;
}) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]),
    [templates, setTemplates] = useState<TemplateRow[]>([]),
    [templateId, setTemplateId] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(''),
    [editorId, setEditorId] = useState(''),
    [editorDirty, setEditorDirty] = useState(false),
    [editorBusy, setEditorBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [initialLoadFailed, setInitialLoadFailed] = useState(false),
    [reloadWarning, setReloadWarning] = useState(false),
    [createUncertain, setCreateUncertain] = useState(false),
    [confirmWithdrawId, setConfirmWithdrawId] = useState(''),
    // BKP019.b: the accepted offer whose confirmation is being confirmed.
    [confirmConfirmationId, setConfirmConfirmationId] = useState(''),
    // BKP019.c1: the finalized confirmation whose invoice is being confirmed.
    [confirmInvoiceId, setConfirmInvoiceId] = useState(''),
    // BKP019.c3.1: the finalized confirmation whose deposit is being confirmed.
    // Its own state, so the two confirmation steps can never mix.
    [confirmDepositId, setConfirmDepositId] = useState(''),
    // BKP019.c3.2: the finalized confirmation whose final invoice is being
    // confirmed. A third own state - one step never confirms another.
    [confirmFinalInvoiceId, setConfirmFinalInvoiceId] = useState(''),
    // BKP019.c2: the finalized invoice whose correction is being prepared, and
    // the direction that correction will carry.
    [correctionId, setCorrectionId] = useState(''),
    [correctionDirection, setCorrectionDirection] =
      useState<CorrectionDirection>('credit'),
    // BKP019.a: the compact acceptance form of exactly one row.
    [acceptanceId, setAcceptanceId] = useState(''),
    [acceptanceChannel, setAcceptanceChannel] = useState<
      '' | AcceptanceChannel
    >(''),
    [acceptanceTime, setAcceptanceTime] = useState(''),
    [acceptanceNoteText, setAcceptanceNoteText] = useState(''),
    [acceptanceFileId, setAcceptanceFileId] = useState(''),
    // BKP019.d: the compact payment form of exactly one finalized invoice, the
    // payments already recorded for it and the state of that read.
    [paymentId, setPaymentId] = useState(''),
    [paymentDate, setPaymentDate] = useState(''),
    [paymentAmount, setPaymentAmount] = useState(''),
    [paymentMethodValue, setPaymentMethodValue] =
      useState<PaymentMethod>('bank_transfer'),
    [paymentNote, setPaymentNote] = useState(''),
    [payments, setPayments] = useState<PaymentRow[]>([]),
    [paymentListState, setPaymentListState] = useState<
      'idle' | 'loading' | 'ready' | 'failed'
    >('idle'),
    [libraryFiles, setLibraryFiles] = useState<LibraryFileRow[]>([]),
    [libraryState, setLibraryState] = useState<
      'idle' | 'loading' | 'ready' | 'failed'
    >('idle'),
    mutating = useRef(false),
    editorTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (editorId || !editorTrigger.current) return;
    editorTrigger.current.focus();
    editorTrigger.current = null;
  }, [editorId]);
  async function load() {
    const [documentReply, templateReply] = await Promise.all([
      fetch(
        '/api/v1/documents?eventId=' +
          encodeURIComponent(eventId) +
          '&include=offer',
      ),
      fetch('/api/v1/document-templates'),
    ]);
    if (!documentReply.ok || !templateReply.ok) throw new Error('load');
    const offers = ((await templateReply.json()) as TemplateRow[]).filter(
      (entry) => entry.kind === 'offer' && entry.state === 'active',
    );
    setDocuments(await validDocuments(documentReply));
    setTemplates(offers);
    setTemplateId((current) => current || offers[0]?.id || '');
    setInitialLoadFailed(false);
  }
  useEffect(() => {
    void load()
      .catch(() => setInitialLoadFailed(true))
      .finally(() => setLoading(false));
  }, [eventId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactId || createUncertain || mutating.current) return;
    const isBlank = templateId === '',
      expectedTemplateId = templateId || null;
    const createTrigger =
      event.currentTarget.querySelector<HTMLButtonElement>('button');
    mutating.current = true;
    setBusy('create');
    setMessage('');
    try {
      const reply = await fetch(
        templateId ? '/api/v1/documents' : '/api/v1/documents/blank-offer',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            ...(templateId ? { templateId } : {}),
            eventId,
            contactId,
          }),
        },
      );
      if (!reply.ok) {
        if (reply.status >= 500) throw new Error('uncertain-create');
        setMessage(
          'Entwurf konnte nicht angelegt werden. Vorlage, Kontakt und Anmeldung prüfen.',
        );
        return;
      }
      const created = (await reply.json()) as DocumentRow;
      if (
        typeof created.id !== 'string' ||
        created.id.length === 0 ||
        created.kind !== 'offer' ||
        created.state !== 'draft' ||
        created.eventId !== eventId ||
        created.contactId !== contactId ||
        created.templateId !== expectedTemplateId ||
        !Number.isSafeInteger(created.grossMinor) ||
        created.grossMinor < 0 ||
        !Number.isSafeInteger(created.version) ||
        created.version < 1
      )
        throw new Error('uncertain-create');
      if (isBlank) {
        editorTrigger.current = createTrigger;
      }
      // BKP013.2: a confirmed create is real stored data, so both paths show
      // the row at once instead of waiting for the list. A failed reload can
      // then never hide a draft that already exists, and the reload below
      // replaces this row with the server's version of the same id.
      setDocuments((current) => [
        created,
        ...current.filter((row) => row.id !== created.id),
      ]);
      // Confirmed write: report it before the list reload. A later GET failure
      // must never read as a reason to create the draft again.
      setMessage(
        isBlank ? 'Leerer Angebotsentwurf angelegt.' : 'Entwurf angelegt.',
      );
      if (isBlank) setEditorId(created.id);
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('');
      setCreateUncertain(true);
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  async function finalize(id: string, version: number) {
    if (mutating.current || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/finalize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ version }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'invalid_state'
            ? 'Bereits finalisiert. Die Liste wird aktualisiert.'
            : result.error === 'conflict'
              ? 'Der Entwurf wurde geändert. Bitte erneut laden und prüfen.'
              : result.error === 'artifact_failed'
                ? 'PDF konnte nicht erzeugt werden. Bitte Betreiber informieren.'
                : result.error === 'credit_exceeds_invoice'
                  ? 'Die Gutschrift übersteigt den Rechnungsbetrag. Bitte Betrag prüfen.'
                  : result.error === 'deposits_exceed_order'
                    ? 'Die Anzahlungen übersteigen den Auftrag. Bitte zuerst die Anzahlungen per Korrektur reduzieren.'
                    : 'Finalisieren nicht möglich: Nummernkreis und Pflichtangaben prüfen.',
        );
        if (result.error === 'conflict') setEditorId('');
        // Refresh a possibly stale row, but keep the explanatory message.
        try {
          await load();
        } catch {
          // The retry affordance for confirmed writes does not apply here.
        }
      } else {
        const result = (await reply.json()) as { number?: string };
        setEditorId('');
        setEditorDirty(false);
        setMessage(
          result.number
            ? 'Finalisiert als ' + result.number + '.'
            : 'Angebot finalisiert.',
        );
        try {
          await load();
          setReloadWarning(false);
        } catch {
          setReloadWarning(true);
        }
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  // BKP019.0: an explicit operator action. The content never changes here, so a
  // status switch can neither rewrite the PDF nor the number.
  async function changeStatus(
    id: string,
    status: OfferStatus,
    version: number,
  ) {
    if (mutating.current || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    setConfirmWithdrawId('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/offer-status', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ status, version }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(statusChangeMessage(result.error));
        if (
          result.error === 'conflict' ||
          result.error === 'invalid_transition'
        )
          try {
            await load();
          } catch {
            // The message above already says what to do.
          }
        return;
      }
      await reply.json();
      setMessage(
        'Angebotsstatus aktualisiert: ' + offerStatusLabels[status] + '.',
      );
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  // BKP019.b: an accepted offer is confirmed as one explicit step. Nothing is
  // retyped: the positions come from the offer, and the confirmation is a draft
  // that is finalised with its own number later.
  async function createConfirmation(id: string, version: number) {
    if (mutating.current || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    setConfirmConfirmationId('');
    try {
      const reply = await fetch(
        '/api/v1/documents/' + id + '/order-confirmation',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ version }),
        },
      );
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'duplicate'
            ? 'Für dieses Angebot gibt es bereits eine Auftragsbestätigung.'
            : result.error === 'offer_not_accepted'
              ? 'Nur ein angenommenes Angebot lässt sich bestätigen. Bitte Liste aktualisieren.'
              : result.error === 'conflict' || result.error === 'invalid_state'
                ? 'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.'
                : 'Auftragsbestätigung konnte nicht erstellt werden. Bitte Angaben prüfen.',
        );
        try {
          await load();
        } catch {
          // The message above already says what to do.
        }
        return;
      }
      const created = (await reply.json()) as DocumentRow;
      const confirmed =
        typeof created?.id === 'string' &&
        created.id.length > 0 &&
        created.kind === 'order_confirmation' &&
        created.state === 'draft' &&
        created.eventId === eventId;
      if (confirmed) {
        // A confirmed write is real stored data: show it at once, then replace it
        // with the server's row.
        setDocuments((current) => [
          created,
          ...current.filter((row) => row.id !== created.id),
        ]);
        setMessage('Auftragsbestätigung als Entwurf angelegt.');
      } else
        setMessage(
          'Auftragsbestätigung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
        );
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  // BKP019.c1: a finalized confirmation is invoiced as one explicit step.
  // Nothing is retyped: the positions come from the confirmation, and the
  // invoice is a draft that is finalised with its own number later.
  async function createInvoice(id: string, version: number) {
    if (mutating.current || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    setConfirmInvoiceId('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/invoice', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ version }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'duplicate'
            ? 'Für diese Auftragsbestätigung gibt es bereits eine Rechnung.'
            : result.error === 'order_withdrawn'
              ? 'Der Auftrag wurde zurückgezogen. Eine Rechnung ist nicht möglich.'
              : result.error === 'invalid_kind'
                ? 'Nur eine finalisierte Auftragsbestätigung lässt sich abrechnen.'
                : result.error === 'invalid_state' ||
                    result.error === 'conflict'
                  ? 'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.'
                  : 'Rechnung konnte nicht erstellt werden. Bitte Angaben prüfen.',
        );
        try {
          await load();
        } catch {
          // The message above already says what to do.
        }
        return;
      }
      const created = (await reply.json()) as DocumentRow;
      const confirmed =
        typeof created?.id === 'string' &&
        created.id.length > 0 &&
        created.kind === 'invoice' &&
        created.state === 'draft' &&
        created.eventId === eventId;
      if (confirmed) {
        setDocuments((current) => [
          created,
          ...current.filter((row) => row.id !== created.id),
        ]);
        setMessage('Rechnung als Entwurf angelegt.');
      } else
        setMessage(
          'Rechnung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
        );
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  // BKP019.c3.1: an advance payment is started from the finalized confirmation
  // as one explicit step. Nothing is retyped: the positions come from the
  // confirmation, and the operator reduces them to the agreed deposit in the
  // draft editor before it is finalized with its own AZ number.
  // Several deposits per order are allowed, so there is no "already exists"
  // answer here - the saving guard is what keeps a double click from writing two.
  async function createDepositInvoice(id: string, version: number) {
    if (mutating.current || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    setConfirmDepositId('');
    try {
      const reply = await fetch(
        '/api/v1/documents/' + id + '/deposit-invoice',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ version }),
        },
      );
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'order_withdrawn'
            ? 'Der Auftrag wurde zurückgezogen. Eine Anzahlungsrechnung ist nicht möglich.'
            : result.error === 'invalid_kind'
              ? 'Nur eine finalisierte Auftragsbestätigung lässt sich anzahlen.'
              : result.error === 'number_not_configured'
                ? 'Für Anzahlungsrechnungen ist kein Nummernkreis hinterlegt. Bitte in den Einstellungen anlegen.'
                : result.error === 'invalid_state' ||
                    result.error === 'conflict'
                  ? 'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.'
                  : 'Anzahlungsrechnung konnte nicht erstellt werden. Bitte Angaben prüfen.',
        );
        try {
          await load();
        } catch {
          // The message above already says what to do.
        }
        return;
      }
      const created = (await reply.json()) as DocumentRow;
      const confirmed =
        typeof created?.id === 'string' &&
        created.id.length > 0 &&
        created.kind === 'deposit_invoice' &&
        created.state === 'draft' &&
        created.eventId === eventId;
      if (confirmed) {
        setDocuments((current) => [
          created,
          ...current.filter((row) => row.id !== created.id),
        ]);
        setMessage('Anzahlungsrechnung als Entwurf angelegt.');
      } else
        setMessage(
          'Anzahlungsrechnung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
        );
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  // BKP019.c3.2: the same finalized confirmation can be billed as the final
  // invoice. One explicit step, no retyped amount: the deduction is derived from
  // the advances that are already billed, so the operator decides nothing here
  // except "yes". Because one confirmation carries exactly one invoice, the
  // screen offers this step only while no invoice of that confirmation exists.
  async function createFinalInvoice(id: string, version: number) {
    if (mutating.current || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    setConfirmFinalInvoiceId('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/final-invoice', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ version }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'duplicate'
            ? 'Für diese Auftragsbestätigung gibt es bereits eine Rechnung.'
            : result.error === 'order_withdrawn'
              ? 'Der Auftrag wurde zurückgezogen. Eine Schlussrechnung ist nicht möglich.'
              : result.error === 'invalid_kind'
                ? 'Nur eine finalisierte Auftragsbestätigung lässt sich als Schlussrechnung abrechnen.'
                : result.error === 'invalid_state' ||
                    result.error === 'conflict'
                  ? 'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.'
                  : 'Schlussrechnung konnte nicht erstellt werden. Bitte Angaben prüfen.',
        );
        try {
          await load();
        } catch {
          // The message above already says what to do.
        }
        return;
      }
      const created = (await reply.json()) as DocumentRow;
      const confirmed =
        typeof created?.id === 'string' &&
        created.id.length > 0 &&
        created.kind === 'invoice' &&
        created.state === 'draft' &&
        created.eventId === eventId;
      if (confirmed) {
        // The route answers the plain document row, so the role is attached
        // here - the next list read brings the real row anyway.
        const row: DocumentRow = { ...created, invoiceRole: 'final' };
        setDocuments((current) => [
          row,
          ...current.filter((entry) => entry.id !== row.id),
        ]);
        setMessage('Schlussrechnung als Entwurf angelegt.');
      } else
        setMessage(
          'Schlussrechnung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
        );
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  // BKP019.c2: a finalized invoice is corrected by its own follow-up document.
  // The direction is the one operator decision; the positions are copied and the
  // invoice itself keeps its number, its state and its bytes.
  function openCorrection(entry: DocumentRow) {
    if (mutating.current) return;
    setMessage('');
    setCorrectionDirection('credit');
    setCorrectionId(entry.id);
  }
  async function createCorrection(
    event: FormEvent<HTMLFormElement>,
    entry: DocumentRow,
  ) {
    event.preventDefault();
    if (mutating.current || busy !== '') return;
    mutating.current = true;
    setBusy(entry.id);
    setMessage('');
    try {
      const reply = await fetch(
        '/api/v1/documents/' + entry.id + '/correction',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            version: entry.version,
            direction: correctionDirection,
          }),
        },
      );
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'duplicate'
            ? 'Für diese Rechnung gibt es bereits einen offenen Korrektur-Entwurf.'
            : result.error === 'credit_exceeds_invoice'
              ? 'Die Gutschrift übersteigt den Rechnungsbetrag. Bitte Betrag prüfen.'
              : result.error === 'invalid_kind'
                ? 'Nur eine finalisierte Rechnung oder Auftragsbestätigung lässt sich korrigieren.'
                : result.error === 'invalid_state' ||
                    result.error === 'conflict'
                  ? 'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.'
                  : 'Rechnungskorrektur konnte nicht erstellt werden. Bitte Angaben prüfen.',
        );
        try {
          await load();
        } catch {
          // The message above already says what to do.
        }
        return;
      }
      const created = (await reply.json()) as DocumentRow;
      const confirmed =
        typeof created?.id === 'string' &&
        created.id.length > 0 &&
        created.kind === 'correction' &&
        created.state === 'draft' &&
        created.eventId === eventId;
      if (confirmed) {
        setDocuments((current) => [
          created,
          ...current.filter((row) => row.id !== created.id),
        ]);
        setMessage('Rechnungskorrektur als Entwurf angelegt.');
      } else
        setMessage(
          'Rechnungskorrektur angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
        );
      setCorrectionId('');
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  // BKP019.d: a payment is recorded explicitly and only against a finalized
  // invoice. The form opens with today's tenant-local day, and the list of what
  // was already recorded is read from the server, never reconstructed locally.
  function openPayments(entry: DocumentRow) {
    if (mutating.current) return;
    setMessage('');
    setPaymentId(entry.id);
    setPaymentDate(tenantToday(timeZone));
    setPaymentAmount('');
    setPaymentMethodValue('bank_transfer');
    setPaymentNote('');
    setPayments([]);
    void loadPayments(entry.id);
  }
  async function loadPayments(id: string) {
    setPaymentListState('loading');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/payments');
      if (!reply.ok) throw new Error('payments');
      const rows = (await reply.json()) as PaymentRow[];
      setPayments(
        Array.isArray(rows)
          ? rows.filter(
              (row) =>
                row &&
                typeof row.id === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(row.receivedOn ?? '') &&
                Number.isSafeInteger(row.amountMinor) &&
                paymentMethodLabels[row.method] !== undefined,
            )
          : [],
      );
      setPaymentListState('ready');
    } catch {
      // The form stays usable; only the list is unavailable.
      setPaymentListState('failed');
    }
  }
  async function recordPayment(
    event: FormEvent<HTMLFormElement>,
    entry: DocumentRow,
  ) {
    event.preventDefault();
    if (mutating.current || busy !== '') return;
    let amountMinor: number;
    try {
      amountMinor = parseHundredths(paymentAmount);
    } catch {
      setMessage('Bitte einen Betrag größer als 0 eingeben.');
      return;
    }
    if (amountMinor < 1) {
      setMessage('Bitte einen Betrag größer als 0 eingeben.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      setMessage('Bitte ein Zahlungsdatum wählen.');
      return;
    }
    mutating.current = true;
    setBusy(entry.id);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/' + entry.id + '/payments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          receivedOn: paymentDate,
          amountMinor,
          method: paymentMethodValue,
          ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
        }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(paymentFailureMessage(result.error));
        // A stale claim is re-read, so the next attempt sees the real balance.
        if (
          result.error === 'overpaid' ||
          result.error === 'invalid_state' ||
          result.error === 'not_found'
        ) {
          await loadPayments(entry.id);
          try {
            await load();
          } catch {
            setReloadWarning(true);
          }
        }
        return;
      }
      await reply.json();
      setPaymentAmount('');
      setPaymentNote('');
      setMessage('Zahlung erfasst.');
      await loadPayments(entry.id);
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  // BKP019.a: the library the acceptance may reference. Only an own, available
  // row is selectable; the "not scanned" fact stays visible instead of a scan
  // promise we cannot keep.
  async function loadLibraryFiles() {
    setLibraryState('loading');
    try {
      const reply = await fetch('/api/v1/library-files');
      if (!reply.ok) throw new Error('library');
      const rows = (await reply.json()) as LibraryFileRow[];
      setLibraryFiles(
        Array.isArray(rows)
          ? rows.filter(
              (row) => row && typeof row.id === 'string' && !!row.displayName,
            )
          : [],
      );
      setLibraryState('ready');
    } catch {
      // The typed input stays; only the optional picker is unavailable.
      setLibraryState('failed');
    }
  }
  function openAcceptance(id: string) {
    if (mutating.current) return;
    setMessage('');
    setAcceptanceId(id);
    setAcceptanceChannel('');
    setAcceptanceTime('');
    setAcceptanceNoteText('');
    setAcceptanceFileId('');
    void loadLibraryFiles();
  }
  function closeAcceptance() {
    setAcceptanceId('');
  }
  // The acceptance is a record of the customer's yes: the channel is required,
  // the instant defaults to the server clock, note and file are optional.
  async function accept(
    event: FormEvent<HTMLFormElement>,
    id: string,
    version: number,
  ) {
    event.preventDefault();
    if (mutating.current || busy !== '') return;
    if (!acceptanceChannel) {
      setMessage('Bitte einen Annahmekanal wählen.');
      return;
    }
    mutating.current = true;
    setBusy(id);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/offer-status', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          status: 'accepted',
          version,
          channel: acceptanceChannel,
          // A datetime-local value is a wall-clock time; the server reads it in
          // the tenant zone, so the browser's own zone never decides.
          ...(acceptanceTime ? { acceptedAt: acceptanceTime } : {}),
          ...(acceptanceNoteText.trim()
            ? { note: acceptanceNoteText.trim() }
            : {}),
          ...(acceptanceFileId ? { attachmentFileId: acceptanceFileId } : {}),
        }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(statusChangeMessage(result.error));
        if (
          result.error === 'conflict' ||
          result.error === 'invalid_transition' ||
          result.error === 'not_found'
        )
          try {
            await load();
          } catch {
            // The message above already says what to do.
          }
        return;
      }
      await reply.json();
      setAcceptanceId('');
      setMessage('Angebotsstatus aktualisiert: Angenommen.');
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  function retryLoad() {
    if (mutating.current) return;
    mutating.current = true;
    setBusy('reload');
    void load()
      .then(() => {
        setReloadWarning(false);
        setInitialLoadFailed(false);
        if (createUncertain) {
          setCreateUncertain(false);
          setMessage(
            'Liste aktualisiert. Bitte prüfen Sie vorhandene Angebote, bevor Sie erneut anlegen.',
          );
        }
      })
      .catch(() => {
        if (!createUncertain && !initialLoadFailed) setReloadWarning(true);
      })
      .finally(() => {
        mutating.current = false;
        setBusy('');
      });
  }
  function date(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeZone,
    }).format(new Date(value));
  }
  // A stored deadline is already a tenant-local calendar day. Parsing it as an
  // instant would shift it west of UTC, so it is formatted from its parts.
  function plainDate(value: string) {
    const [year, month, day] = value.split('-');
    return day + '.' + month + '.' + year;
  }
  // An acceptance instant is a real point in time, read in the tenant zone.
  function stamp(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));
  }
  // BKP019.c3.2: one confirmation carries exactly one invoice - the standard one
  // or the final one. That is a database rule (`documents_one_invoice`), so the
  // screen stops offering a second creation instead of letting it end in a 409.
  const invoicedConfirmations = new Set(
    documents
      .filter((entry) => entry.kind === 'invoice' && entry.sourceDocumentId)
      .map((entry) => entry.sourceDocumentId!),
  );
  // BKP019.c3.2b: the guard of the finalization, shown before the click. The
  // bound is the claim of the confirmation - `gross + debits - credits`, exactly
  // what the server reads - against the corrected claims of its finalized
  // advances. Both sums come from the list this screen already has, so the hint
  // costs no extra request and can never show an amount the server did not
  // derive.
  // BKP019.c3.2c: an advance is netted by its own corrections, so the hint and
  // the remedy it names ("per Korrektur reduzieren") finally move together: a
  // credit note on an advance lowers the figure the hint shows.
  function finalizedCorrectionsOf(sourceId: string) {
    return documents.filter(
      (entry) =>
        entry.kind === 'correction' &&
        entry.state === 'final' &&
        entry.sourceDocumentId === sourceId,
    );
  }
  function signedCorrectionMinor(entry: DocumentRow) {
    return entry.correctionDirection === 'credit'
      ? -entry.grossMinor
      : entry.correctionDirection === 'debit'
        ? entry.grossMinor
        : 0;
  }
  function settledDepositsMinor(confirmationId: string) {
    return documents
      .filter(
        (entry) =>
          entry.kind === 'deposit_invoice' &&
          entry.state === 'final' &&
          entry.sourceDocumentId === confirmationId,
      )
      .reduce(
        (sum, entry) =>
          sum +
          finalizedCorrectionsOf(entry.id).reduce(
            (claim, correction) => claim + signedCorrectionMinor(correction),
            entry.grossMinor,
          ),
        0,
      );
  }
  function claimOfConfirmation(confirmation: DocumentRow) {
    return finalizedCorrectionsOf(confirmation.id).reduce(
      (sum, entry) => sum + signedCorrectionMinor(entry),
      confirmation.grossMinor,
    );
  }
  // The overshoot itself, or 0 while the advances still fit: the hint is a
  // warning, never a second state the operator has to maintain.
  function depositOvershootMinor(confirmation: DocumentRow) {
    const settled = settledDepositsMinor(confirmation.id);
    return settled > claimOfConfirmation(confirmation) ? settled : 0;
  }
  // The warning itself, in the wording of the refusal the server gives later: it
  // names both amounts, tells the operator what to do first, and says honestly
  // that the draft may still be created - only the finalization is guarded.
  function depositExceededHint(confirmation: DocumentRow) {
    return (
      <p className="document-hint">
        <strong>Anzahlungen übersteigen den Auftrag.</strong>{' '}
        {(exactMinorUnits(settledDepositsMinor(confirmation.id)) ?? '—') +
          ' € gestellte Anzahlungen stehen ' +
          (exactMinorUnits(claimOfConfirmation(confirmation)) ?? '—') +
          ' € Auftragssumme gegenüber. Bitte die Anzahlungen vor dem Finalisieren per Korrektur reduzieren – der Entwurf lässt sich trotzdem anlegen.'}
      </p>
    );
  }
  function rows(entries: DocumentRow[]) {
    return (
      <ul className="document-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <div className="document-row">
              <strong>{entry.number ?? 'Entwurf'}</strong>
              <span>{stateLabels[entry.state]}</span>
            </div>
            <p className="document-meta">
              {entry.state === 'final' && entry.finalizedAt
                ? 'Finalisiert am '
                : 'Angelegt am '}
              <time
                dateTime={(entry.finalizedAt ?? entry.issuedAt).split('T')[0]}
              >
                {date(entry.finalizedAt ?? entry.issuedAt)}
              </time>
              {' · '}
              {exactMinorUnits(entry.grossMinor) ?? '—'} €
            </p>
            {/* BKP019.b: a confirmation names the offer it was copied from.
                BKP019.c1: an invoice names the confirmation in the same way.
                BKP019.c3.1: a deposit names the same confirmation, because that
                is what the advance was agreed on.
                BKP019.c2: a correction names the document it corrects, whose kind
                the projection deliberately does not carry - the wording stays
                neutral ("Korrektur zu"). The link opens that source PDF. */}
            {(entry.kind === 'order_confirmation' ||
              entry.kind === 'deposit_invoice' ||
              entry.kind === 'invoice' ||
              entry.kind === 'correction') &&
              entry.sourceNumber && (
                <p className="document-meta">
                  <span>
                    {entry.kind === 'invoice' ||
                    entry.kind === 'deposit_invoice'
                      ? 'Aus Auftragsbestätigung '
                      : entry.kind === 'correction'
                        ? 'Korrektur zu '
                        : 'Aus Angebot '}
                  </span>
                  {entry.sourceDocumentId ? (
                    <a
                      href={
                        '/api/v1/documents/' + entry.sourceDocumentId + '/pdf'
                      }
                      target="_blank"
                      rel="noreferrer"
                      aria-label={
                        (entry.kind === 'invoice' ||
                        entry.kind === 'deposit_invoice'
                          ? 'Auftragsbestätigung '
                          : entry.kind === 'correction'
                            ? 'Beleg '
                            : 'Angebot ') +
                        entry.sourceNumber +
                        ' als PDF öffnen'
                      }
                    >
                      {entry.sourceNumber}
                    </a>
                  ) : (
                    <span>{entry.sourceNumber}</span>
                  )}
                </p>
              )}
            {/* RG-07: the two dates of an invoice family document. The due day
                only exists once it is final - a draft names the agreed term and
                leaves the day to the finalization. Both are shown only when
                they are set, never as an empty placeholder. */}
            {(entry.kind === 'invoice' ||
              entry.kind === 'deposit_invoice' ||
              entry.kind === 'correction') &&
              (entry.serviceDate ||
                typeof entry.paymentTermDays === 'number') && (
                <p className="document-meta document-invoice-dates">
                  {entry.serviceDate && (
                    <span>
                      {'Leistungsdatum '}
                      <time dateTime={entry.serviceDate}>
                        {plainDate(entry.serviceDate)}
                      </time>
                    </span>
                  )}
                  {typeof entry.paymentTermDays === 'number' && (
                    <span>
                      {entry.serviceDate ? ' · ' : ''}
                      {'Zahlungsziel ' + entry.paymentTermDays + ' Tage'}
                      {entry.dueDate ? ', fällig ' : ''}
                      {entry.dueDate && (
                        <time dateTime={entry.dueDate}>
                          {plainDate(entry.dueDate)}
                        </time>
                      )}
                    </span>
                  )}
                </p>
              )}
            {/* RG-07b: the account under the two dates, only where it is set and
                only for the invoice family. A multi-line text keeps its line
                breaks on screen, exactly as the paper prints them. */}
            {(entry.kind === 'invoice' ||
              entry.kind === 'deposit_invoice' ||
              entry.kind === 'correction') &&
              entry.bankAccount && (
                <p className="document-meta document-invoice-bank">
                  <span>Bankverbindung </span>
                  {entry.bankAccount.split('\n').map((line, index) => (
                    <Fragment key={index}>
                      {index > 0 && <br />}
                      {line}
                    </Fragment>
                  ))}
                </p>
              )}
            {/* BKP019.c3.2: the role of this invoice and what it settles. A
                draft is not frozen yet, so it names the rule instead of an
                amount; a finalized one shows the frozen deduction and the money
                that arrived on the settled advances (a display value). The claim
                itself is the "Offener Betrag" below. */}
            {entry.kind === 'invoice' && entry.invoiceRole === 'final' && (
              <p className="document-meta document-invoice-role">
                <strong>Schlussrechnung</strong>
                {entry.state === 'final' ? (
                  <>
                    <span>
                      {' · Anzahlungen verrechnet: ' +
                        (exactMinorUnits(entry.depositAppliedMinor ?? 0) ??
                          '—') +
                        ' €'}
                    </span>
                    <span>
                      {' · davon geleistet: ' +
                        (exactMinorUnits(entry.depositPaidMinor ?? 0) ?? '—') +
                        ' €'}
                    </span>
                  </>
                ) : (
                  <span>
                    {
                      ' · Die bereits gestellten Anzahlungen werden beim Finalisieren brutto verrechnet.'
                    }
                  </span>
                )}
              </p>
            )}
            {/* BKP019.c2: the cancellation state is derived, not stored - the
                invoice keeps its number, its state and its bytes. */}
            {entry.kind === 'invoice' &&
              entry.state === 'final' &&
              entry.correctionState && (
                <p className="document-meta document-correction-state">
                  <span>{correctionStateLabels[entry.correctionState]}</span>
                  {typeof entry.remainingCredit === 'number' &&
                    Number.isSafeInteger(entry.remainingCredit) && (
                      <span>
                        {' · Noch kreditierbar: ' +
                          (exactMinorUnits(entry.remainingCredit) ?? '—') +
                          ' €'}
                      </span>
                    )}
                </p>
              )}
            {/* BKP019.d: what arrived and what is still open on this invoice.
                Both are derived from the recorded payments - the invoice keeps
                its number, its state and its bytes.
                BKP019.c3.1: a finalized deposit is a claim of its own and shows
                the same two derived values. */}
            {(entry.kind === 'invoice' || entry.kind === 'deposit_invoice') &&
              entry.state === 'final' &&
              entry.paymentState && (
                <p className="document-meta document-payment-state">
                  <span>{paymentStateLabels[entry.paymentState]}</span>
                  <span>
                    {' · Offener Betrag: ' +
                      (exactMinorUnits(entry.openMinor ?? 0) ?? '—') +
                      ' €'}
                  </span>
                </p>
              )}
            {entry.kind === 'offer' && entry.state === 'final' && (
              <p className="document-offer-status">
                <span>{offerStatusLabels[entry.offerStatus ?? 'unset']}</span>
                {entry.validUntil && (
                  <>
                    {' · Gültig bis '}
                    <time dateTime={entry.validUntil}>
                      {plainDate(entry.validUntil)}
                    </time>
                  </>
                )}
                {entry.offerExpired && (
                  <>
                    {' · '}
                    <strong className="document-offer-expired">
                      Abgelaufen
                    </strong>
                  </>
                )}
              </p>
            )}
            {/* BKP019.a: the recorded acceptance stays readable, also after a
                withdrawal - only the archived attachment loses its link. */}
            {entry.kind === 'offer' && entry.acceptedAt && (
              <p className="document-meta">
                <span>Angenommen am </span>
                <time dateTime={entry.acceptedAt}>
                  {stamp(entry.acceptedAt)}
                </time>
                {entry.acceptanceChannel && (
                  <span>
                    {' · '}
                    {acceptanceChannelLabels[entry.acceptanceChannel]}
                  </span>
                )}
                {entry.acceptanceNote && (
                  <span>{' · ' + entry.acceptanceNote}</span>
                )}
                {entry.acceptanceFileId && (
                  <>
                    {' · Anhang: '}
                    {entry.acceptanceFileState === 'available' ? (
                      <a
                        href={
                          '/api/v1/library-files/' +
                          entry.acceptanceFileId +
                          '/content'
                        }
                        target="_blank"
                        rel="noreferrer"
                        aria-label={
                          'Anhang ' +
                          (entry.acceptanceFileName ?? 'Datei') +
                          ' öffnen'
                        }
                      >
                        {entry.acceptanceFileName ?? 'Datei'}
                      </a>
                    ) : (
                      <span>
                        {(entry.acceptanceFileName ?? 'Datei') +
                          ' (nicht mehr verfügbar)'}
                      </span>
                    )}
                  </>
                )}
              </p>
            )}
            <div className="document-actions">
              {entry.state === 'draft' && (
                <>
                  {editableDraftKinds.has(entry.kind) && (
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy !== '' || editorBusy || editorId !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? 'Entwurf') +
                        ' bearbeiten'
                      }
                      aria-expanded={editorId === entry.id}
                      onClick={(event) => {
                        editorTrigger.current = event.currentTarget;
                        setEditorDirty(false);
                        setEditorId(entry.id);
                      }}
                    >
                      Bearbeiten
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== '' || editorBusy || editorDirty}
                    aria-label={
                      kindName(entry) +
                      ' ' +
                      (entry.number ?? 'Entwurf') +
                      ' finalisieren'
                    }
                    onClick={() => void finalize(entry.id, entry.version)}
                  >
                    Finalisieren
                  </button>
                </>
              )}
              {entry.state === 'final' && (
                <a
                  className="document-download"
                  href={'/api/v1/documents/' + entry.id + '/pdf'}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={
                    kindName(entry) +
                    ' ' +
                    (entry.number ?? '') +
                    ' als PDF öffnen'
                  }
                >
                  PDF öffnen
                </a>
              )}
              {/* BKP019.c2: only a finalized invoice is corrected, and only as an
                  explicit step - the correction starts as a draft with its own
                  number. The direction is the one decision the operator makes.
                  BKP019.c3.1: a finalized deposit is corrected the same way,
                  because a wrong advance must not be unfixable. */}
              {entry.state === 'final' &&
                (entry.kind === 'invoice' ||
                  entry.kind === 'deposit_invoice') && (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== ''}
                    aria-label={
                      kindName(entry) +
                      ' ' +
                      (entry.number ?? '') +
                      ' korrigieren'
                    }
                    aria-expanded={correctionId === entry.id}
                    onClick={() => openCorrection(entry)}
                  >
                    Korrigieren
                  </button>
                )}
              {/* BKP019.d: a finalized invoice accepts incoming money as an
                  explicit record. Manual only - no bank, card or PSP connection.
                  BKP019.c3.1: an advance payment is paid the same way. */}
              {entry.state === 'final' &&
                (entry.kind === 'invoice' ||
                  entry.kind === 'deposit_invoice') && (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== ''}
                    aria-label={
                      kindName(entry) +
                      ' ' +
                      (entry.number ?? '') +
                      ' Zahlung erfassen'
                    }
                    aria-expanded={paymentId === entry.id}
                    onClick={() => openPayments(entry)}
                  >
                    Zahlung erfassen
                  </button>
                )}
              {/* Only a legal next step is offered: no button invents a jump
                  such as final → accepted or a reopened withdrawn offer. */}
              {entry.state === 'final' &&
                entry.kind === 'offer' &&
                entry.offerStatus !== 'withdrawn' && (
                  <>
                    {(entry.offerStatus ?? null) === null && (
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy !== ''}
                        aria-label={
                          kindName(entry) +
                          ' ' +
                          (entry.number ?? '') +
                          ' versendet markieren'
                        }
                        onClick={() =>
                          void changeStatus(entry.id, 'sent', entry.version)
                        }
                      >
                        Versendet markieren
                      </button>
                    )}
                    {entry.offerStatus === 'sent' && (
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy !== ''}
                        aria-label={
                          kindName(entry) +
                          ' ' +
                          (entry.number ?? '') +
                          ' annehmen'
                        }
                        aria-expanded={acceptanceId === entry.id}
                        onClick={() => openAcceptance(entry.id)}
                      >
                        Angenommen
                      </button>
                    )}
                    {confirmWithdrawId === entry.id ? (
                      <>
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={busy !== ''}
                          aria-label={
                            kindName(entry) +
                            ' ' +
                            (entry.number ?? '') +
                            ' Rückzug bestätigen'
                          }
                          onClick={() =>
                            void changeStatus(
                              entry.id,
                              'withdrawn',
                              entry.version,
                            )
                          }
                        >
                          Ja, zurückziehen
                        </button>
                        <button
                          type="button"
                          className="tertiary-action"
                          disabled={busy !== ''}
                          aria-label={
                            kindName(entry) +
                            ' ' +
                            (entry.number ?? '') +
                            ' Rückzug abbrechen'
                          }
                          onClick={() => setConfirmWithdrawId('')}
                        >
                          Abbrechen
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy !== ''}
                        aria-label={
                          kindName(entry) +
                          ' ' +
                          (entry.number ?? '') +
                          ' zurückziehen'
                        }
                        onClick={() => setConfirmWithdrawId(entry.id)}
                      >
                        Zurückziehen
                      </button>
                    )}
                  </>
                )}
              {/* BKP019.b: only an accepted offer can be confirmed, and only as
                  an explicit step - the confirmation starts as a draft. */}
              {entry.state === 'final' &&
                entry.kind === 'offer' &&
                entry.offerStatus === 'accepted' &&
                (confirmConfirmationId === entry.id ? (
                  <>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' Auftragsbestätigung anlegen'
                      }
                      onClick={() =>
                        void createConfirmation(entry.id, entry.version)
                      }
                    >
                      Ja, Auftragsbestätigung anlegen
                    </button>
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' Auftragsbestätigung abbrechen'
                      }
                      onClick={() => setConfirmConfirmationId('')}
                    >
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== ''}
                    aria-label={
                      kindName(entry) +
                      ' ' +
                      (entry.number ?? '') +
                      ' Auftragsbestätigung erstellen'
                    }
                    onClick={() => setConfirmConfirmationId(entry.id)}
                  >
                    Auftragsbestätigung erstellen
                  </button>
                ))}
              {/* BKP019.c1: only a finalized confirmation can be invoiced, and
                  only as an explicit step - the invoice starts as a draft with
                  its own number range.
                  BKP019.c3.2: exactly one invoice per confirmation is possible,
                  so the step disappears once one exists (standard or final). */}
              {entry.state === 'final' &&
                entry.kind === 'order_confirmation' &&
                !invoicedConfirmations.has(entry.id) &&
                (confirmInvoiceId === entry.id ? (
                  <>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' Rechnung anlegen'
                      }
                      onClick={() =>
                        void createInvoice(entry.id, entry.version)
                      }
                    >
                      Ja, Rechnung anlegen
                    </button>
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' Rechnung abbrechen'
                      }
                      onClick={() => setConfirmInvoiceId('')}
                    >
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== ''}
                    aria-label={
                      kindName(entry) +
                      ' ' +
                      (entry.number ?? '') +
                      ' Rechnung erstellen'
                    }
                    onClick={() => setConfirmInvoiceId(entry.id)}
                  >
                    Rechnung erstellen
                  </button>
                ))}
              {/* BKP019.c3.1: the same finalized confirmation can be invoiced in
                  advance. Its own explicit step, so a deposit never appears as a
                  side effect of invoicing; several advances per order are legal. */}
              {entry.state === 'final' &&
                entry.kind === 'order_confirmation' &&
                (confirmDepositId === entry.id ? (
                  <>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' Anzahlung anlegen'
                      }
                      onClick={() =>
                        void createDepositInvoice(entry.id, entry.version)
                      }
                    >
                      Ja, Anzahlung anlegen
                    </button>
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' Anzahlung abbrechen'
                      }
                      onClick={() => setConfirmDepositId('')}
                    >
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== ''}
                    aria-label={
                      kindName(entry) +
                      ' ' +
                      (entry.number ?? '') +
                      ' Anzahlung erstellen'
                    }
                    onClick={() => setConfirmDepositId(entry.id)}
                  >
                    Anzahlung erstellen
                  </button>
                ))}
              {/* BKP019.c3.2: the same finalized confirmation can be billed as
                  the final invoice, which settles the advances already billed on
                  it. A third explicit step, offered only while the confirmation
                  carries no invoice at all - the two invoice roles are
                  alternatives, not a sequence. */}
              {entry.state === 'final' &&
                entry.kind === 'order_confirmation' &&
                !invoicedConfirmations.has(entry.id) &&
                (confirmFinalInvoiceId === entry.id ? (
                  <>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' Schlussrechnung anlegen'
                      }
                      onClick={() =>
                        void createFinalInvoice(entry.id, entry.version)
                      }
                    >
                      Ja, Schlussrechnung anlegen
                    </button>
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy !== ''}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' Schlussrechnung abbrechen'
                      }
                      onClick={() => setConfirmFinalInvoiceId('')}
                    >
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== ''}
                    aria-label={
                      kindName(entry) +
                      ' ' +
                      (entry.number ?? '') +
                      ' Schlussrechnung erstellen'
                    }
                    onClick={() => setConfirmFinalInvoiceId(entry.id)}
                  >
                    Schlussrechnung erstellen
                  </button>
                ))}
            </div>
            {/* BKP019.c3.2: the rule itself is explained where it bites, instead
                of an action that can only end in a conflict. */}
            {entry.state === 'final' &&
              entry.kind === 'order_confirmation' &&
              invoicedConfirmations.has(entry.id) && (
                <p className="document-hint">
                  Diese Auftragsbestätigung trägt bereits eine Rechnung. Je
                  Bestätigung ist genau eine Rechnung möglich – als
                  Standardrechnung oder als Schlussrechnung.
                </p>
              )}
            {/* BKP019.c3.2b: the same honesty one step earlier. The advances can
                already exceed the order before the final invoice exists; the
                finalization would be refused, so the row says it before the
                operator clicks - and never hides the step itself. */}
            {entry.state === 'final' &&
              entry.kind === 'order_confirmation' &&
              !invoicedConfirmations.has(entry.id) &&
              depositOvershootMinor(entry) > 0 &&
              depositExceededHint(entry)}
            {(entry.kind === 'invoice' || entry.kind === 'deposit_invoice') &&
              entry.state === 'final' &&
              correctionId === entry.id && (
                <form
                  className="offer-draft-editor"
                  aria-label="Rechnungskorrektur anlegen"
                  onSubmit={(event) => void createCorrection(event, entry)}
                >
                  <fieldset disabled={busy !== ''}>
                    <legend>Rechnungskorrektur anlegen</legend>
                    <p className="document-hint">
                      Eine Korrektur ist ein eigener Beleg mit eigener Nummer
                      und lässt die Rechnung unverändert. Die Positionen werden
                      zunächst übernommen.
                    </p>
                    <div className="offer-draft-fields">
                      <label>
                        Richtung
                        <select
                          value={correctionDirection}
                          onChange={(event) =>
                            setCorrectionDirection(
                              event.target.value as CorrectionDirection,
                            )
                          }
                        >
                          {(
                            Object.keys(
                              correctionDirectionLabels,
                            ) as CorrectionDirection[]
                          ).map((direction) => (
                            <option key={direction} value={direction}>
                              {correctionDirectionLabels[direction]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {correctionDirection === 'credit' &&
                      entry.remainingCredit === 0 && (
                        <p role="alert">
                          Diese Rechnung ist bereits vollständig gutgeschrieben.
                          Eine weitere Gutschrift wird beim Finalisieren
                          abgelehnt.
                        </p>
                      )}
                    <div className="document-actions">
                      <button className="primary-action" disabled={busy !== ''}>
                        Korrektur anlegen
                      </button>
                      <button
                        type="button"
                        className="tertiary-action"
                        disabled={busy !== ''}
                        onClick={() => setCorrectionId('')}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </fieldset>
                </form>
              )}
            {(entry.kind === 'invoice' || entry.kind === 'deposit_invoice') &&
              entry.state === 'final' &&
              paymentId === entry.id && (
                <form
                  className="offer-draft-editor"
                  aria-label="Zahlung erfassen"
                  onSubmit={(event) => void recordPayment(event, entry)}
                >
                  <fieldset disabled={busy !== ''}>
                    <legend>Zahlung erfassen</legend>
                    <p className="document-hint">
                      Eine Zahlung ist ein unveränderlicher Eingang: sie wird
                      nicht bearbeitet und nicht gelöscht. „Bezahlt“ entsteht
                      ausschließlich aus erfassten Zahlungen, nie aus einem
                      Ausdruck oder einer Erzeugung. Es gibt keine Bank- oder
                      Kartenschnittstelle – der Eingang wird manuell erfasst.
                    </p>
                    <div className="offer-draft-fields">
                      <label>
                        Zahlungsdatum
                        <input
                          type="date"
                          required
                          value={paymentDate}
                          onChange={(event) =>
                            setPaymentDate(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Betrag in €
                        <input
                          inputMode="decimal"
                          required
                          value={paymentAmount}
                          onChange={(event) =>
                            setPaymentAmount(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Zahlweg
                        <select
                          value={paymentMethodValue}
                          onChange={(event) =>
                            setPaymentMethodValue(
                              event.target.value as PaymentMethod,
                            )
                          }
                        >
                          {paymentMethods.map((method) => (
                            <option key={method} value={method}>
                              {paymentMethodLabels[method]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Notiz (optional)
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={paymentNote}
                          onChange={(event) =>
                            setPaymentNote(event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <div className="document-actions">
                      <button className="primary-action" disabled={busy !== ''}>
                        Zahlung speichern
                      </button>
                      <button
                        type="button"
                        className="tertiary-action"
                        disabled={busy !== ''}
                        onClick={() => setPaymentId('')}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </fieldset>
                  {paymentListState === 'loading' && (
                    <p role="status">Zahlungen werden geladen …</p>
                  )}
                  {paymentListState === 'failed' && (
                    <p role="alert">
                      Zahlungen konnten nicht geladen werden. Erfasste Zahlungen
                      bleiben gespeichert; bitte erneut öffnen.
                    </p>
                  )}
                  {paymentListState === 'ready' &&
                    (payments.length ? (
                      <ul
                        className="document-payments"
                        aria-label="Erfasste Zahlungen"
                      >
                        {payments.map((payment) => (
                          <li key={payment.id}>
                            <time dateTime={payment.receivedOn}>
                              {plainDate(payment.receivedOn)}
                            </time>
                            {' · '}
                            {exactMinorUnits(payment.amountMinor) ?? '—'} €
                            {' · '}
                            {paymentMethodLabels[payment.method]}
                            {payment.note ? ' · ' + payment.note : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Noch keine Zahlung erfasst.</p>
                    ))}
                </form>
              )}
            {entry.kind === 'offer' &&
              entry.state === 'final' &&
              entry.offerStatus === 'sent' &&
              acceptanceId === entry.id && (
                <form
                  className="offer-draft-editor"
                  aria-label="Annahme erfassen"
                  onSubmit={(event) =>
                    void accept(event, entry.id, entry.version)
                  }
                >
                  <fieldset disabled={busy !== ''}>
                    <legend>Annahme erfassen</legend>
                    <p className="document-hint">
                      Wie hat der Kunde zugesagt? Pflicht ist nur der Kanal;
                      Zeitpunkt, Notiz und Anhang sind freiwillig.
                    </p>
                    <div className="offer-draft-fields">
                      <label>
                        Kanal
                        <select
                          value={acceptanceChannel}
                          onChange={(event) =>
                            setAcceptanceChannel(
                              event.target.value as '' | AcceptanceChannel,
                            )
                          }
                        >
                          <option value="">Bitte wählen</option>
                          {acceptanceChannels.map((channel) => (
                            <option key={channel} value={channel}>
                              {acceptanceChannelLabels[channel]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Zeitpunkt (optional)
                        <input
                          type="datetime-local"
                          value={acceptanceTime}
                          onChange={(event) =>
                            setAcceptanceTime(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Notiz (optional)
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={acceptanceNoteText}
                          onChange={(event) =>
                            setAcceptanceNoteText(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Anhang (optional)
                        <select
                          value={acceptanceFileId}
                          onChange={(event) =>
                            setAcceptanceFileId(event.target.value)
                          }
                        >
                          <option value="">Kein Anhang</option>
                          {libraryFiles
                            .filter((file) => file.state === 'available')
                            .map((file) => (
                              <option key={file.id} value={file.id}>
                                {file.displayName}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    {libraryState === 'loading' && (
                      <p role="status">Anhänge werden geladen …</p>
                    )}
                    {libraryState === 'failed' && (
                      <p role="alert">
                        Anhänge konnten nicht geladen werden. Die Annahme ist
                        auch ohne Anhang möglich; Eingaben bleiben erhalten.
                      </p>
                    )}
                    <p className="document-hint">
                      Bibliotheksdateien sind hochgeladen und unverprüft: es
                      findet keine Prüfung auf Schadsoftware statt.
                    </p>
                    <div className="document-actions">
                      <button className="primary-action" disabled={busy !== ''}>
                        Annahme speichern
                      </button>
                      <button
                        type="button"
                        className="tertiary-action"
                        disabled={busy !== ''}
                        onClick={closeAcceptance}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </fieldset>
                </form>
              )}
            {editableDraftKinds.has(entry.kind) &&
              editorId === entry.id &&
              entry.state === 'draft' && (
                <OfferDraftEditor
                  documentId={entry.id}
                  csrfToken={csrfToken}
                  kind={entry.kind}
                  onClose={() => {
                    setEditorDirty(false);
                    setEditorId('');
                  }}
                  onDirtyChange={setEditorDirty}
                  onBusyChange={setEditorBusy}
                  onSavedMetadata={(metadata) =>
                    setDocuments((current) =>
                      current.map((row) =>
                        row.id === entry.id ? { ...row, ...metadata } : row,
                      ),
                    )
                  }
                />
              )}
          </li>
        ))}
      </ul>
    );
  }
  const offers = documents.filter((entry) => entry.kind === 'offer'),
    otherGroups = kindOrder
      .filter((kind) => kind !== 'offer')
      .map((kind) => ({
        kind,
        label: kindLabels[kind]!,
        rows: documents.filter((entry) => entry.kind === kind),
      }))
      .filter((group) => group.rows.length),
    unknownRows = documents.filter((entry) => !knownKinds.has(entry.kind));
  return (
    <div className="event-documents">
      <p role="status">{message}</p>
      {reloadWarning && (
        <div className="reload-warning">
          <p role="alert">
            Gespeichert, aber die Dateiliste konnte nicht neu geladen werden.
            Nichts erneut anlegen.
          </p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy !== ''}
            onClick={retryLoad}
          >
            Dateien erneut laden
          </button>
        </div>
      )}
      {createUncertain && (
        <div className="reload-warning">
          <p role="alert">
            Der Angebotsstatus ist unklar. Bitte Angebote aktualisieren und
            vorhandene Einträge prüfen, bevor Sie erneut anlegen.
          </p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy !== ''}
            onClick={retryLoad}
          >
            Angebote aktualisieren
          </button>
        </div>
      )}
      {initialLoadFailed && (
        <div className="reload-warning">
          <p role="alert">Dateien konnten nicht geladen werden.</p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy !== ''}
            onClick={retryLoad}
          >
            Dateien erneut laden
          </button>
        </div>
      )}
      {loading ? (
        <p>Dateien werden geladen …</p>
      ) : (
        <div className="document-cards">
          <section
            className="document-card"
            aria-labelledby="event-documents-heading"
          >
            <h4 id="event-documents-heading">Angebote</h4>
            <p className="document-card-hint">
              Ein Angebot entsteht als Entwurf aus einer Vorlage oder ohne
              Vorlage. Beim Finalisieren erhält es seine Nummer und eine
              unveränderliche PDF.
            </p>
            {offers.length ? (
              rows(offers)
            ) : (
              <p>Noch kein Angebot zu diesem Event.</p>
            )}
            {!templates.length && (
              <p className="document-hint">
                Keine aktive Angebotsvorlage. Sie können auch ohne Vorlage
                starten oder unter Einstellungen → Dokumentvorlagen eine Vorlage
                anlegen.
              </p>
            )}
            {!contactId && (
              <p className="document-hint">
                Für ein Angebot zuerst einen Hauptkontakt zuordnen.
              </p>
            )}
            <form onSubmit={create}>
              <fieldset
                disabled={
                  busy !== '' ||
                  !contactId ||
                  createUncertain ||
                  initialLoadFailed ||
                  reloadWarning
                }
              >
                <legend>Neues Angebot</legend>
                <label>
                  Vorlage
                  <select
                    value={templateId}
                    onChange={(event) => setTemplateId(event.target.value)}
                  >
                    <option value="">Ohne Vorlage</option>
                    {templates.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-action">Entwurf anlegen</button>
              </fieldset>
            </form>
          </section>
          {otherGroups.map((group) => (
            <section
              key={group.kind}
              className="document-card"
              aria-labelledby={'event-documents-kind-' + group.kind}
            >
              <h4 id={'event-documents-kind-' + group.kind}>{group.label}</h4>
              {/* BKP019.c1: an invoice is a real document, but invoicing is not
                  complete yet. The open paths are named here instead of letting
                  the card imply deposit, final and correction invoices exist.
                  BKP019.c2: corrections and cancellations do exist now - as
                  their own documents, never as an edit of the invoice.
                  BKP019.c3.2: the final invoice exists too, so the card names the
                  two roles of one invoice and the one-invoice rule. Still open
                  are the payment term and the refund, not the settlement. */}
              {group.kind === 'invoice' && (
                <p className="document-card-hint">
                  Eine Rechnung entsteht aus einer Auftragsbestätigung – als
                  Standardrechnung oder als Schlussrechnung, je Bestätigung
                  genau eine. Die Schlussrechnung verrechnet die bereits
                  gestellten Anzahlungen; eine finalisierte Rechnung wird nie
                  ersetzt, sondern nur durch eine Rechnungskorrektur ergänzt.
                  Zahlungseingänge werden manuell erfasst; Leistungsdatum und
                  Zahlungsziel lassen sich je Rechnung im Entwurf angeben, eine
                  Überfälligkeit gibt es noch nicht.
                </p>
              )}
              {/* BKP019.c3.2: a deposit stays its own claim with its own number.
                  The settlement takes the *billed* amount over, never the paid
                  one, and it is frozen on the final invoice. */}
              {group.kind === 'deposit_invoice' && (
                <p className="document-card-hint">
                  Eine Anzahlungsrechnung ist ein eigener Beleg mit eigener
                  Nummer. Der Entwurf übernimmt den Auftrag und wird dort auf
                  die vereinbarte Anzahlung gekürzt; Zahlungseingänge werden
                  manuell erfasst. Die Verrechnung übernimmt die
                  Schlussrechnung: sie zieht die gestellten Anzahlungen brutto
                  ab. Bis dahin bleibt jede Anzahlung ein eigener offener Beleg.
                </p>
              )}
              {group.kind === 'correction' && (
                <p className="document-card-hint">
                  Eine Rechnungskorrektur ist ein eigener Beleg mit eigener
                  Nummer: als Gutschrift mindert sie den Rechnungsbetrag, als
                  Nachberechnung erhöht sie ihn. Die korrigierte Rechnung bleibt
                  unverändert.
                </p>
              )}
              {rows(group.rows)}
            </section>
          ))}
          {unknownRows.length > 0 && (
            <section
              className="document-card"
              aria-labelledby="event-documents-kind-other"
            >
              <h4 id="event-documents-kind-other">{otherKindLabel}</h4>
              {rows(unknownRows)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
