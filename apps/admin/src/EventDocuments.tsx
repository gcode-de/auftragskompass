import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Temporal } from '@js-temporal/polyfill';
import { OfferDraftEditor } from './OfferDraftEditor.js';
import { MailBodyEditor } from './MailBodyEditor.js';
import {
  maxBytes,
  mediaTypeOf,
  readFileBase64,
  uploadError,
} from './LibraryFiles.js';
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
  hasPricedLines?: boolean;
  // BKP019.0: the business axis of an offer, only present with include=offer.
  offerStatus?: OfferStatus | null;
  validUntil?: string | null;
  offerExpired?: boolean;
  predecessorDocumentId?: string | null;
  predecessorNumber?: string | null;
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
  // RG-08: derived on the server from the due day and the open claim. `null`
  // means "no claim at all", so only `true` ever shows the badge.
  overdue?: boolean | null;
  // RG-07b: the account the invoice prints, printed word for word.
  bankAccount?: string | null;
};
type CreateKind =
  | 'offer'
  | 'order_confirmation'
  | 'deposit_invoice'
  | 'invoice'
  | 'final_invoice'
  | 'correction'
  | 'blank_invoice';
type BlankInvoiceRequest = {
  eventId: string;
  contactId: string;
  requestId: string;
};
const documentUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readBlankInvoiceRequest(key: string, eventId: string) {
  const body = sessionStorage.getItem(key);
  if (body === null) return null;
  try {
    const input = JSON.parse(body) as Partial<BlankInvoiceRequest> | null;
    if (
      input?.eventId === eventId &&
      typeof input.contactId === 'string' &&
      documentUuid.test(input.contactId) &&
      typeof input.requestId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.requestId,
      )
    ) {
      return {
        eventId,
        contactId: input.contactId,
        requestId: input.requestId,
      };
    }
  } catch {
    // An unreadable request must be checked against the list before discarding.
  }
  return 'invalid' as const;
}
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
// MAIL-EDITOR-01: the answer of the read-only preview route - the actual
// resolved content plus the names of placeholders without a value.
type MailPreview = {
  subject: string;
  bodyHtml: string | null;
  bodyText: string;
  missing: string[];
};
type MailTemplateOption = { id: string; name: string };
// MAIL-TPL-01d: one standard attachment of the applied template, carried as
// a reference to a library file.
type MailFileAttachment = {
  libraryFileId: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
};
// ATTACH-01a: one named attachment list; every removal asks first - also the
// document the mail was started for.
type MailNamedAttachment = { id: string; label: string };

function TrashButton({
  label,
  disabled,
  onConfirm,
}: {
  label: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <button
      type="button"
      className="mail-editor-tool"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => {
        const name = label.replace(/ entfernen$/, '');
        if (!window.confirm(`„${name}“ wirklich aus dieser Mail entfernen?`))
          return;
        onConfirm();
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
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </button>
  );
}
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
// DOC-CREATE-02-Rest: the dialog names the two directions the way the operator
// speaks about them. `credit` is the existing correction direction, `debit` its
// counterpart; the request body still carries the stored values.
const correctionDirectionLabels: Record<CorrectionDirection, string> = {
  credit: 'Gutschrift (mindert den Betrag)',
  debit: 'Lastschrift (erhöht den Betrag)',
};
const acceptanceChannels = Object.keys(
  acceptanceChannelLabels,
) as AcceptanceChannel[];
// BKP019.d: money that arrived is a record, not a status. "Offen" is the absence
// of a payment; "bezahlt" only exists because payments were entered.
// RG-08: "Überfällig" is the third, independent fact of a claim (due day passed
// while money is still open) and is shown as its own element, never merged here.
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
// DOC-ACCEPT-FIX-01: a stored acceptance instant is a real point in time; the
// datetime-local field of the correction wants the tenant's wall clock. Both
// read the same zone, so the prefill is exactly what the record displays.
function acceptedInputValue(value: string, timeZone: string): string {
  const instant = Temporal.Instant.fromEpochMilliseconds(Date.parse(value)),
    local = instant.toZonedDateTimeISO(timeZone),
    pad = (part: number) => String(part).padStart(2, '0');
  return (
    local.toPlainDate().toString() +
    'T' +
    pad(local.hour) +
    ':' +
    pad(local.minute)
  );
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
// DOC-CREATE-02-Rest: one wording per creation kind for the two moments this
// screen has to speak instead of acting - the unclear answer that blocks every
// further creation, and the list read that lifts the block. Both wordings were
// inline switches for three kinds; the two new paths join the same contract.
function uncertainCreateMessage(kind: CreateKind) {
  switch (kind) {
    case 'offer':
      return 'Der Angebotsstatus ist unklar. Bitte Angebote aktualisieren und vorhandene Einträge prüfen, bevor Sie erneut anlegen.';
    case 'order_confirmation':
      return 'Der Status der Auftragsbestätigung ist unklar. Bitte Dateien aktualisieren und vorhandene Einträge prüfen, bevor Sie erneut anlegen.';
    case 'invoice':
      return 'Der Status der Rechnung ist unklar. Bitte Dateien aktualisieren und vorhandene Rechnungen prüfen, bevor Sie erneut anlegen.';
    case 'final_invoice':
      return 'Der Status der Schlussrechnung ist unklar. Bitte Dateien aktualisieren und vorhandene Rechnungen prüfen, bevor Sie erneut anlegen.';
    case 'correction':
      return 'Der Status der Rechnungskorrektur ist unklar. Bitte Dateien aktualisieren und vorhandene Korrekturen prüfen, bevor Sie erneut anlegen.';
    default:
      return 'Der Status der Anzahlungsrechnung ist unklar. Bitte Dateien aktualisieren und vorhandene Anzahlungen prüfen, bevor Sie erneut anlegen.';
  }
}
function reconciledCreateMessage(kind: CreateKind) {
  switch (kind) {
    case 'offer':
      return 'Liste aktualisiert. Bitte prüfen Sie vorhandene Angebote, bevor Sie erneut anlegen.';
    case 'order_confirmation':
      return 'Liste aktualisiert. Bitte prüfen Sie vorhandene Auftragsbestätigungen, bevor Sie erneut anlegen.';
    case 'invoice':
    case 'final_invoice':
      return 'Liste aktualisiert. Bitte prüfen Sie vorhandene Rechnungen, bevor Sie erneut anlegen.';
    case 'correction':
      return 'Liste aktualisiert. Bitte prüfen Sie vorhandene Korrekturen, bevor Sie erneut anlegen.';
    default:
      return 'Liste aktualisiert. Bitte vorhandene Anzahlungen prüfen; der unklare Versuch lässt sich nicht sicher einer einzelnen Anzahlung zuordnen.';
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
async function validDocuments(
  reply: Response,
  expectedEventId?: string,
): Promise<DocumentRow[]> {
  const rows = (await reply.json()) as DocumentRow[];
  if (!Array.isArray(rows)) {
    if (expectedEventId) throw new Error('invalid-document-list');
    return [];
  }
  const valid = rows.filter(
    (entry) =>
      entry &&
      stateLabels[entry.state] !== undefined &&
      Number.isFinite(Date.parse(entry.finalizedAt ?? entry.issuedAt)) &&
      Number.isFinite(entry.grossMinor) &&
      (!expectedEventId ||
        (entry.eventId === expectedEventId &&
          typeof entry.id === 'string' &&
          documentUuid.test(entry.id) &&
          knownKinds.has(entry.kind) &&
          typeof entry.issuedAt === 'string' &&
          (entry.finalizedAt === null ||
            typeof entry.finalizedAt === 'string'))),
  );
  if (expectedEventId && valid.length !== rows.length)
    throw new Error('invalid-document-list');
  return valid;
}

// MAIL-STATUS-01: the dialog only knows that the order exists - the outcome
// is decided later by the worker and shown in the event's mail list.
const queuedMessage =
  'Mail in der Warteschlange. Den Versandstatus zeigt der Bereich „E-Mails“.';

// The event file is where an offer is born: it owns the contact and the date
// that the template placeholders need.
export function EventDocuments({
  eventId,
  contactId,
  contactName,
  contactEmail = null,
  timeZone,
  csrfToken,
  recordRemoving = false,
  onEditingChange,
  onEditorProtectedChange,
  onMailScheduled,
  composeRequest = null,
}: {
  eventId: string;
  contactId: string | null;
  contactName?: string | null;
  // MAIL-DOC-01: the stored address of the event contact, if there is one. The
  // dialog prefills exactly this value and never an invented recipient.
  contactEmail?: string | null;
  timeZone: string;
  csrfToken: string;
  recordRemoving?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onEditorProtectedChange?: (protectedEditor: boolean) => void;
  // MAIL-STATUS-01: a send order exists; the mail list follows its outcome.
  onMailScheduled?: () => void;
  // UI-PARITY-02: the event's E-Mails area asks for a new free mail; the
  // trigger gets the focus back when the dialog closes.
  composeRequest?: { id: number; trigger: HTMLElement } | null;
}) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]),
    [templates, setTemplates] = useState<TemplateRow[]>([]),
    [templateId, setTemplateId] = useState(''),
    [createKind, setCreateKind] = useState<CreateKind>('offer'),
    [pendingBlankInvoice, setPendingBlankInvoice] = useState<
      BlankInvoiceRequest | 'invalid' | 'reviewed' | null
    >(null),
    [confirmationSourceId, setConfirmationSourceId] = useState(''),
    [depositSourceId, setDepositSourceId] = useState(''),
    [createDialogOpen, setCreateDialogOpen] = useState(false),
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
    // DOC-CREATE-02-Rest: the finalized confirmation whose final invoice is
    // preselected in the shared creation dialog, and the claim a correction is
    // preselected from. Both only carry the selection, never the write.
    [correctionSourceId, setCorrectionSourceId] = useState(''),
    [correctionDirection, setCorrectionDirection] =
      useState<CorrectionDirection>('credit'),
    // BKP019.a: the compact acceptance form of exactly one row.
    [acceptanceId, setAcceptanceId] = useState(''),
    // DOC-ACCEPT-FIX-01: the separate, explicit correction of a stored
    // acceptance. It never shares the capture trigger, so a wrong record can
    // only be replaced on purpose.
    [acceptanceCorrectionId, setAcceptanceCorrectionId] = useState(''),
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
    // MAIL-DOC-01: exactly one chosen finalized document, its recipient, an
    // optional cover text and the request id of this one gesture. The id is
    // generated when the dialog opens, so a repeat can only reach the same
    // order - never a second mail. MAIL-EDITOR-01: the cover text is
    // formatted HTML with placeholders; the preview shows the actual result.
    [mailSendId, setMailSendId] = useState(''),
    [mailTo, setMailTo] = useState(''),
    [mailBody, setMailBody] = useState(''),
    // MAIL-UX-02: bump to let the editor adopt an externally replaced body.
    [mailBodyReplace, setMailBodyReplace] = useState(0),
    // MAIL-EVENT-01: a free mail from the event - no document, one durable
    // order under one request id.
    [composeOpen, setComposeOpen] = useState(false),
    [composeTo, setComposeTo] = useState(''),
    [composeSubject, setComposeSubject] = useState(''),
    [composeBody, setComposeBody] = useState(''),
    // MAIL-EVENT-02: an applied template replaces the editor content once.
    [composeReplace, setComposeReplace] = useState(0),
    [composeRequestId, setComposeRequestId] = useState(''),
    // MAIL-FWD-01: forwarding switches per mail; the addresses are resolved
    // on the server from the setting and the tenant's own users.
    [forwardAccounting, setForwardAccounting] = useState(false),
    [forwardUserIds, setForwardUserIds] = useState<string[]>([]),
    [forwardUsers, setForwardUsers] = useState<
      Array<{ id: string; email: string }>
    >([]),
    [accountingRecipient, setAccountingRecipient] = useState(''),
    // UI-PARITY-03: the one finalized document whose delivery view is open.
    [deliverId, setDeliverId] = useState(''),
    [mailRequestId, setMailRequestId] = useState(''),
    [mailUncertain, setMailUncertain] = useState(false),
    [mailPreview, setMailPreview] = useState<MailPreview | null>(null),
    [mailPreviewState, setMailPreviewState] = useState<
      'idle' | 'loading' | 'ready' | 'error'
    >('idle'),
    [mailPreviewError, setMailPreviewError] = useState(''),
    // MAIL-TPL-01c: an editable subject and the active templates to apply.
    [mailSubject, setMailSubject] = useState(''),
    [mailTemplates, setMailTemplates] = useState<MailTemplateOption[]>([]),
    // MAIL-SIG-01b: the signatures offered by both mail dialogs and the one
    // chosen for this mail ('' = none chosen yet, 'none' = no signature).
    [mailSignatures, setMailSignatures] = useState<
      { id: string; name: string; isDefault: boolean }[]
    >([]),
    [mailSignatureId, setMailSignatureId] = useState(''),
    [mailTemplateId, setMailTemplateId] = useState(''),
    [mailTemplateBusy, setMailTemplateBusy] = useState(false),
    [templateNotice, setTemplateNotice] = useState(''),
    [mailFiles, setMailFiles] = useState<MailFileAttachment[]>([]),
    // ATTACH-01a: the chosen document travels on request only, and extra
    // documents or library files can join from the two pickers below.
    [mailAttachDocument, setMailAttachDocument] = useState(true),
    [mailDocs, setMailDocs] = useState<MailNamedAttachment[]>([]),
    [mailLibraryFiles, setMailLibraryFiles] = useState<MailNamedAttachment[]>(
      [],
    ),
    [mailDocId, setMailDocId] = useState(''),
    [mailFileId, setMailFileId] = useState(''),
    // ATTACH-01b: dropped or chosen files travel through the library upload.
    [uploading, setUploading] = useState(false),
    [uploadNotice, setUploadNotice] = useState(''),
    [uploadFail, setUploadFail] = useState(''),
    [dragging, setDragging] = useState(false),
    mutating = useRef(false),
    createSummary = useRef<HTMLButtonElement>(null),
    uncertainReload = useRef<HTMLButtonElement>(null),
    createDialog = useRef<HTMLDialogElement>(null),
    createDialogTrigger = useRef<HTMLElement | null>(null),
    createDialogWasOpen = useRef(false),
    editorWorkspace = useRef<HTMLDivElement>(null),
    editorTrigger = useRef<string | null>(null),
    blankInvoiceSubmit = useRef<HTMLButtonElement>(null),
    blankInvoiceContext = useRef<object | null>(null),
    // DOC-ACCEPT-FIX-01: the row action that opened the correction, so closing
    // it puts the keyboard user back where they were.
    acceptanceCorrectionTrigger = useRef<string | null>(null),
    // MAIL-DOC-01: the dialog, its trigger and its first field. Closing returns
    // the focus to the row action instead of the top of the page.
    mailDialog = useRef<HTMLDialogElement>(null),
    deliverDialog = useRef<HTMLDialogElement>(null),
    deliverTrigger = useRef<HTMLElement | null>(null),
    deliverWasOpen = useRef(false),
    deliverPreview = useRef<HTMLIFrameElement>(null),
    mailTrigger = useRef<HTMLElement | null>(null),
    mailDialogWasOpen = useRef(false),
    mailRecipient = useRef<HTMLInputElement>(null),
    // MAIL-EVENT-01: the compose dialog mirrors the mail dialog mechanics.
    composeDialog = useRef<HTMLDialogElement>(null),
    composeTrigger = useRef<HTMLElement | null>(null),
    composeWasOpen = useRef(false),
    composeToField = useRef<HTMLInputElement>(null);
  const blankInvoiceKey = 'ak:blank-invoice:' + eventId;
  const blankInvoiceInvalid = typeof pendingBlankInvoice === 'string';
  const blankInvoiceContextChanged =
    pendingBlankInvoice !== null &&
    typeof pendingBlankInvoice === 'object' &&
    pendingBlankInvoice.contactId !== contactId;
  useLayoutEffect(() => {
    blankInvoiceContext.current = {};
    return () => {
      blankInvoiceContext.current = null;
    };
  }, [eventId, contactId, csrfToken]);
  useEffect(() => {
    try {
      setPendingBlankInvoice(readBlankInvoiceRequest(blankInvoiceKey, eventId));
    } catch {
      // Saving the request is checked again before dispatch.
      setPendingBlankInvoice(null);
    }
  }, [blankInvoiceKey, eventId]);
  useEffect(() => {
    if (
      createKind === 'blank_invoice' &&
      createDialogOpen &&
      pendingBlankInvoice &&
      busy === '' &&
      !blankInvoiceContextChanged &&
      !blankInvoiceInvalid
    )
      blankInvoiceSubmit.current?.focus();
  }, [
    createKind,
    createDialogOpen,
    pendingBlankInvoice,
    busy,
    blankInvoiceContextChanged,
    blankInvoiceInvalid,
  ]);
  const editorEntry = documents.find(
    (entry) =>
      entry.id === editorId &&
      entry.state === 'draft' &&
      editableDraftKinds.has(entry.kind),
  );
  const editing = editorEntry !== undefined;
  const finalizing = editing && busy === editorId;
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  useEffect(() => {
    if (editing) editorWorkspace.current?.querySelector('button')?.focus();
  }, [editing]);
  useEffect(() => {
    if (editing || busy || editorTrigger.current === null) return;
    const trigger = document.getElementById(editorTrigger.current);
    (trigger ?? createSummary.current)?.focus();
    editorTrigger.current = null;
  }, [editing, busy]);
  // DOC-ACCEPT-FIX-01: closing the correction - by cancel, Escape or a saved
  // write - returns the keyboard to the action that opened it.
  useEffect(() => {
    if (
      acceptanceCorrectionId !== '' ||
      acceptanceCorrectionTrigger.current === null
    )
      return;
    document.getElementById(acceptanceCorrectionTrigger.current)?.focus();
    acceptanceCorrectionTrigger.current = null;
  }, [acceptanceCorrectionId]);
  useEffect(() => {
    if (!createDialogOpen) return;
    const dialog = createDialog.current;
    if (!dialog) return;
    if (typeof dialog.showModal !== 'function') {
      // jsdom has no showModal; browsers use the native modal focus behavior.
      dialog.setAttribute('open', '');
    } else if (!dialog.open) {
      dialog.showModal();
    }
    createDialogWasOpen.current = true;
    createDialog.current?.querySelector<HTMLElement>('select')?.focus();
  }, [createDialogOpen]);
  useEffect(() => {
    if (createDialogOpen || !createDialogWasOpen.current || busy !== '') return;
    if (!editorId) {
      const trigger = createDialogTrigger.current;
      (trigger?.isConnected && !trigger.matches(':disabled')
        ? trigger
        : (uncertainReload.current ?? createSummary.current)
      )?.focus();
    }
    createDialogTrigger.current = null;
    createDialogWasOpen.current = false;
  }, [createDialogOpen, busy, editorId]);
  useEffect(() => {
    if (!createDialogOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && busy === '') setCreateDialogOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createDialogOpen, busy]);
  // MAIL-DOC-01: the same native dialog mechanics as the creation dialog, for
  // exactly one row. Opening never sends; it only prefills the stored address.
  useEffect(() => {
    if (!mailSendId) return;
    const dialog = mailDialog.current;
    if (!dialog) return;
    if (typeof dialog.showModal !== 'function') {
      // jsdom has no showModal; browsers use the native modal focus behavior.
      dialog.setAttribute('open', '');
    } else if (!dialog.open) {
      dialog.showModal();
    }
    mailDialogWasOpen.current = true;
    mailRecipient.current?.focus();
  }, [mailSendId]);
  useEffect(() => {
    if (mailSendId || !mailDialogWasOpen.current) return;
    const trigger = mailTrigger.current;
    if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus();
    mailTrigger.current = null;
    mailDialogWasOpen.current = false;
  }, [mailSendId]);
  useEffect(() => {
    if (composeRequest) openCompose(composeRequest.trigger);
    // Only a new request opens the dialog, never a re-render.
  }, [composeRequest?.id]);
  // MAIL-EVENT-01: the compose dialog uses the same native dialog mechanics.
  useEffect(() => {
    if (!composeOpen) return;
    const dialog = composeDialog.current;
    if (!dialog) return;
    if (typeof dialog.showModal !== 'function') {
      // jsdom has no showModal; browsers use the native modal focus behavior.
      dialog.setAttribute('open', '');
    } else if (!dialog.open) {
      dialog.showModal();
    }
    composeWasOpen.current = true;
    composeToField.current?.focus();
  }, [composeOpen]);
  useEffect(() => {
    if (composeOpen || !composeWasOpen.current) return;
    const trigger = composeTrigger.current;
    if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus();
    composeTrigger.current = null;
    composeWasOpen.current = false;
  }, [composeOpen]);
  // MAIL-FWD-01: the forwarding switches need the app users and the stored
  // accounting address to name their targets honestly. A failure leaves the
  // switches usable - the server refuses an unfilled forwarding.
  useEffect(() => {
    if (!mailSendId && !composeOpen && !deliverId) return;
    let active = true;
    void fetch('/api/v1/access')
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => {
        if (!active) return;
        const users = (Array.isArray(rows) ? rows : []) as Array<{
          id: string;
          email: string;
          active: boolean;
        }>;
        setForwardUsers(
          users
            .filter((user) => user.active)
            .map((user) => ({ id: user.id, email: user.email })),
        );
      })
      .catch(() => undefined);
    void fetch('/api/v1/settings/mail-accounting')
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (!active || !value) return;
        setAccountingRecipient(
          (
            (value as { accountingRecipient?: string }).accountingRecipient ??
            ''
          ).trim(),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mailSendId, composeOpen, deliverId]);
  // UI-PARITY-03: the delivery view uses the same native dialog mechanics and
  // hands the focus back to its row action.
  useEffect(() => {
    if (deliverId) {
      const dialog = deliverDialog.current;
      if (!dialog) return;
      if (typeof dialog.showModal !== 'function')
        dialog.setAttribute('open', '');
      else if (!dialog.open) dialog.showModal();
      deliverWasOpen.current = true;
      return;
    }
    if (!deliverWasOpen.current) return;
    deliverWasOpen.current = false;
    const trigger = deliverTrigger.current;
    deliverTrigger.current = null;
    // A follow-up mail dialog takes the focus itself.
    if (!mailSendId && trigger?.isConnected) trigger.focus();
  }, [deliverId]);
  useEffect(() => {
    if (!mailSendId) return;
    function onKeyDown(event: KeyboardEvent) {
      // While the order is on its way, Escape cannot hide the state.
      if (event.key === 'Escape' && busy === '') {
        setMailSendId('');
        setMailRequestId('');
        setMailUncertain(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mailSendId, busy]);
  const existingConfirmationSources = new Set(
    documents
      .filter(
        (entry) =>
          entry.kind === 'order_confirmation' &&
          entry.eventId === eventId &&
          entry.sourceDocumentId,
      )
      .map((entry) => entry.sourceDocumentId!),
  );
  const eventOfferIds = new Set(
    documents
      .filter((entry) => entry.kind === 'offer' && entry.eventId === eventId)
      .map((entry) => entry.id),
  );
  const predecessorByOffer = new Map<string, string>();
  const successorByOffer = new Map<string, string>();
  for (const { id, predecessorDocumentId } of documents) {
    if (
      predecessorDocumentId &&
      eventOfferIds.has(id) &&
      eventOfferIds.has(predecessorDocumentId)
    ) {
      predecessorByOffer.set(id, predecessorDocumentId);
      successorByOffer.set(predecessorDocumentId, id);
    }
  }
  // The iterator visits IDs added during traversal and the set breaks cycles.
  for (const id of existingConfirmationSources) {
    const predecessor = predecessorByOffer.get(id);
    const successor = successorByOffer.get(id);
    if (predecessor) existingConfirmationSources.add(predecessor);
    if (successor) existingConfirmationSources.add(successor);
  }
  const confirmationSources = documents.filter(
    (entry) =>
      entry.kind === 'offer' &&
      entry.eventId === eventId &&
      entry.state === 'final' &&
      entry.offerStatus === 'accepted' &&
      !existingConfirmationSources.has(entry.id),
  );
  const depositSources = documents.filter((entry) => {
    if (
      entry.kind !== 'order_confirmation' ||
      entry.eventId !== eventId ||
      entry.state !== 'final'
    )
      return false;
    const sourceOffer = documents.find(
      (source) => source.id === entry.sourceDocumentId,
    );
    return sourceOffer?.offerStatus !== 'withdrawn';
  });
  const invoicedConfirmations = new Set(
    documents
      .filter((entry) => entry.kind === 'invoice' && entry.sourceDocumentId)
      .map((entry) => entry.sourceDocumentId!),
  );
  // BKP019.c3.2: the standard and the final invoice are alternatives of the same
  // confirmation, so both dialogs read the same list - finalized, not withdrawn
  // and not yet invoiced. The database keeps the exactly-one rule.
  const invoiceSources = depositSources.filter(
    (entry) => !invoicedConfirmations.has(entry.id),
  );
  // DOC-CREATE-02-Rest: only a finalized claim is corrected. A deposit stays in
  // the list because a wrong advance is reduced by a correction - exactly the
  // remedy the finalization hint names - and the endpoint accepts it too. A
  // draft, an offer, a withdrawal and a correction itself are no sources.
  const correctionSources = documents.filter(
    (entry) =>
      entry.eventId === eventId &&
      entry.state === 'final' &&
      (entry.kind === 'invoice' ||
        entry.kind === 'order_confirmation' ||
        entry.kind === 'deposit_invoice'),
  );
  const currentSources =
    createKind === 'invoice' || createKind === 'final_invoice'
      ? invoiceSources
      : depositSources;
  useEffect(() => {
    if (
      createKind === 'order_confirmation' &&
      !confirmationSources.some((entry) => entry.id === confirmationSourceId)
    )
      setConfirmationSourceId(confirmationSources[0]?.id ?? '');
  }, [createKind, confirmationSourceId, confirmationSources]);
  useEffect(() => {
    if (
      (createKind === 'deposit_invoice' ||
        createKind === 'invoice' ||
        createKind === 'final_invoice') &&
      !currentSources.some((entry) => entry.id === depositSourceId)
    )
      setDepositSourceId(currentSources[0]?.id ?? '');
  }, [createKind, depositSourceId, currentSources]);
  useEffect(() => {
    if (
      createKind === 'correction' &&
      !correctionSources.some((entry) => entry.id === correctionSourceId)
    )
      setCorrectionSourceId(correctionSources[0]?.id ?? '');
  }, [createKind, correctionSourceId, correctionSources]);
  async function load({
    requiredDocumentId,
    strict = false,
  }: { requiredDocumentId?: string; strict?: boolean } = {}) {
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
    const rows = await validDocuments(
      documentReply,
      strict ? eventId : undefined,
    );
    if (
      requiredDocumentId &&
      !rows.some((row) => row.id === requiredDocumentId)
    )
      throw new Error('created-document-missing');
    setDocuments(rows);
    setTemplates(offers);
    setTemplateId((current) => current || offers[0]?.id || '');
    setInitialLoadFailed(false);
    return rows;
  }
  useEffect(() => {
    void load()
      .catch(() => setInitialLoadFailed(true))
      .finally(() => setLoading(false));
  }, [eventId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactId || createUncertain || mutating.current || recordRemoving)
      return;
    const isBlank = templateId === '',
      expectedTemplateId = templateId || null;
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
      if (!isBlank) setCreateDialogOpen(false);
      let editorDraft: DocumentRow | undefined = created;
      try {
        const rows = await load(
          isBlank ? { requiredDocumentId: created.id } : undefined,
        );
        editorDraft = rows.find((row) => row.id === created.id);
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
      if (isBlank) {
        if (
          editorDraft?.state === 'draft' &&
          editableDraftKinds.has(editorDraft.kind)
        ) {
          editorTrigger.current = '';
          setEditorId(editorDraft.id);
        }
        setCreateDialogOpen(false);
      }
    } catch {
      setMessage('');
      setCreateUncertain(true);
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  async function createBlankInvoice() {
    if (
      !contactId ||
      mutating.current ||
      createUncertain ||
      initialLoadFailed ||
      reloadWarning ||
      blankInvoiceInvalid ||
      recordRemoving ||
      editorBusy ||
      editorDirty
    )
      return;

    let request: BlankInvoiceRequest;
    let retry: boolean;
    try {
      const saved = readBlankInvoiceRequest(blankInvoiceKey, eventId);
      if (saved === 'invalid') {
        setPendingBlankInvoice(saved);
        return;
      }
      retry = saved !== null;
      request = saved ?? { eventId, contactId, requestId: crypto.randomUUID() };
      if (request.eventId !== eventId || request.contactId !== contactId) {
        setPendingBlankInvoice(request);
        return;
      }
      sessionStorage.setItem(blankInvoiceKey, JSON.stringify(request));
    } catch {
      setMessage(
        'Der Auftrag konnte im Browser nicht gesichert werden. Bitte Browser-Einstellungen prüfen.',
      );
      return;
    }

    const context = blankInvoiceContext.current;
    mutating.current = true;
    setBusy('blank_invoice');
    setPendingBlankInvoice(request);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/blank-invoice', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(request),
      });
      if (blankInvoiceContext.current !== context) return;
      if (
        !retry &&
        reply.status >= 400 &&
        reply.status < 500 &&
        ![408, 429].includes(reply.status)
      ) {
        sessionStorage.removeItem(blankInvoiceKey);
        setPendingBlankInvoice(null);
        setMessage(
          'Rechnungsentwurf konnte nicht angelegt werden. Bitte Hauptkontakt und Anmeldung prüfen.',
        );
        return;
      }
      if (!reply.ok) throw new Error('uncertain-blank-invoice');
      const created = (await reply.json()) as DocumentRow;
      if (blankInvoiceContext.current !== context) return;
      if (
        !created?.id ||
        typeof created.id !== 'string' ||
        !documentUuid.test(created.id) ||
        created.kind !== 'invoice' ||
        (created.state !== 'draft' && created.state !== 'final') ||
        created.eventId !== eventId ||
        created.contactId !== contactId ||
        created.templateId !== null ||
        created.sourceDocumentId != null ||
        typeof created.issuedAt !== 'string' ||
        !Number.isFinite(Date.parse(created.issuedAt)) ||
        (created.state === 'draft'
          ? created.finalizedAt !== null || created.number !== null
          : typeof created.finalizedAt !== 'string' ||
            !Number.isFinite(Date.parse(created.finalizedAt)) ||
            typeof created.number !== 'string' ||
            !created.number) ||
        !Number.isSafeInteger(created.grossMinor) ||
        created.grossMinor < 0 ||
        !Number.isSafeInteger(created.version) ||
        created.version < 1
      )
        throw new Error('uncertain-blank-invoice');

      sessionStorage.removeItem(blankInvoiceKey);
      setPendingBlankInvoice(null);
      setDocuments((current) => [
        created,
        ...current.filter((row) => row.id !== created.id),
      ]);
      setMessage(
        created.state === 'draft'
          ? 'Rechnungsentwurf angelegt.'
          : 'Die Rechnung wurde bereits finalisiert.',
      );
      setCreateDialogOpen(false);
      if (created.state === 'draft') {
        editorTrigger.current = '';
        setEditorId(created.id);
      }
    } catch {
      // The request stays pending until the server confirms the document.
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  async function reviewInvalidInvoiceRequest() {
    if (mutating.current) return;
    mutating.current = true;
    setBusy('review_blank_invoice');
    setMessage('');
    try {
      await load({ strict: true });
      setPendingBlankInvoice('reviewed');
      setCreateDialogOpen(false);
      setMessage(
        'Dateien aktualisiert. Bitte prüfen Sie, ob die Rechnung bereits vorhanden ist.',
      );
    } catch {
      setMessage(
        'Dateien konnten nicht aktualisiert werden. Bitte erneut versuchen.',
      );
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  async function createSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createKind === 'offer') return create(event);
    if (createKind === 'blank_invoice') return createBlankInvoice();
    if (createKind === 'order_confirmation') {
      const source = confirmationSources.find(
        (entry) => entry.id === confirmationSourceId,
      );
      if (source) await createConfirmation(source.id, source.version);
      return;
    }
    if (createKind === 'correction') {
      const source = correctionSources.find(
        (entry) => entry.id === correctionSourceId,
      );
      if (source) await createCorrection(source);
      return;
    }
    const source = currentSources.find((entry) => entry.id === depositSourceId);
    if (source) {
      if (createKind === 'invoice')
        await createInvoice(source.id, source.version);
      else if (createKind === 'final_invoice')
        await createFinalInvoice(source.id, source.version);
      else await createDepositInvoice(source.id, source.version);
    }
  }
  async function reviseOffer(source: DocumentRow) {
    if (mutating.current || recordRemoving || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(source.id);
    setMessage('');
    try {
      let revision: DocumentRow | undefined;
      try {
        const reply = await fetch(
          '/api/v1/documents/' + source.id + '/revision',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify({ version: source.version }),
          },
        );
        if (
          !reply.ok &&
          reply.status < 500 &&
          ![408, 429].includes(reply.status)
        ) {
          const result = (await reply.json().catch(() => null)) as {
            error?: string;
          } | null;
          setMessage(
            reply.status === 409
              ? 'Das Angebot wurde inzwischen geändert. Bitte den aktuellen Stand prüfen.'
              : result?.error === 'missing_reference'
                ? 'Für dieses Angebot fehlen gespeicherte Angaben, die für eine Überarbeitung nötig sind.'
                : 'Das Angebot konnte nicht überarbeitet werden. Bitte Status und Anmeldung prüfen.',
          );
          await load().catch(() => setReloadWarning(true));
          return;
        }
        if (!reply.ok) throw new Error('revision-unconfirmed');
        const created = (await reply.json()) as DocumentRow;
        if (
          typeof created?.id !== 'string' ||
          !created.id ||
          created.id === source.id ||
          created.kind !== 'offer' ||
          created.eventId !== eventId ||
          created.contactId !== source.contactId ||
          created.predecessorDocumentId !== source.id ||
          created.predecessorNumber !== source.number ||
          (created.state !== 'draft' && created.state !== 'final') ||
          !Number.isSafeInteger(created.version) ||
          created.version < 1 ||
          !Number.isSafeInteger(created.grossMinor) ||
          created.grossMinor < 0 ||
          !Number.isFinite(Date.parse(created.issuedAt))
        )
          throw new Error('revision-unconfirmed');
        const refreshed =
          created.state === 'final' &&
          (await load({ requiredDocumentId: created.id }).catch(() => {
            setReloadWarning(true);
            return undefined;
          }));
        if (!refreshed)
          setDocuments((current) => [
            { ...current.find((row) => row.id === created.id), ...created },
            ...current.filter((row) => row.id !== created.id),
          ]);
        revision = created;
      } catch {
        // A lost reply can have committed. The list identifies the direct
        // successor, and repeating this endpoint returns the same successor.
        const rows = await load().catch(() => undefined);
        revision = rows?.find(
          (row) =>
            row.kind === 'offer' &&
            row.eventId === eventId &&
            row.predecessorDocumentId === source.id,
        );
      }
      if (!revision) {
        setMessage(
          'Der Status der Überarbeitung ist unklar. Bitte am selben Angebot erneut auf „Überarbeiten“ klicken.',
        );
      } else if (revision.state === 'draft') {
        setMessage('Überarbeitung als Entwurf geöffnet.');
        editorTrigger.current = 'revise-document-' + source.id;
        setEditorId(revision.id);
      } else {
        setMessage('Die Überarbeitung wurde bereits finalisiert.');
      }
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
                    ? 'Die Anzahlungen übersteigen den Auftrags- oder Rechnungsbetrag. Bitte Rechnungspositionen prüfen oder die Anzahlungen per Korrektur reduzieren.'
                    : result.error === 'empty_lines'
                      ? 'Zum Finalisieren ist mindestens eine Position erforderlich.'
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
      if (reply.status >= 500) throw new Error('uncertain-confirmation');
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'duplicate'
            ? 'Für dieses Angebot oder eine andere Fassung gibt es bereits eine Auftragsbestätigung.'
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
        setCreateDialogOpen(false);
      } else
        setMessage(
          'Auftragsbestätigung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
        );
      if (!confirmed) setCreateUncertain(true);
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
  // BKP019.c1: a finalized confirmation is invoiced as one explicit step.
  // Nothing is retyped: the positions come from the confirmation, and the
  // invoice is a draft that is finalised with its own number later.
  async function createInvoice(id: string, version: number) {
    if (
      mutating.current ||
      editorBusy ||
      editorDirty ||
      createUncertain ||
      reloadWarning ||
      initialLoadFailed
    )
      return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/invoice', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ version }),
      });
      if (reply.status >= 500) throw new Error('uncertain-invoice');
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
                  : result.error === 'number_not_configured'
                    ? 'Für Rechnungen ist kein Nummernkreis hinterlegt. Bitte in den Einstellungen anlegen.'
                    : 'Rechnung konnte nicht erstellt werden. Bitte Angaben prüfen.',
        );
        try {
          await load();
        } catch {
          setReloadWarning(true);
        }
        return;
      }
      const created = (await reply.json()) as DocumentRow;
      const confirmed =
        typeof created?.id === 'string' &&
        created.id.length > 0 &&
        created.kind === 'invoice' &&
        created.state === 'draft' &&
        created.eventId === eventId &&
        Number.isSafeInteger(created.version) &&
        created.version > 0;
      if (confirmed) {
        setDocuments((current) => [
          created,
          ...current.filter((row) => row.id !== created.id),
        ]);
        setMessage('Rechnung als Entwurf angelegt.');
        setCreateDialogOpen(false);
      } else {
        setCreateUncertain(true);
        setMessage(
          'Der Status der Rechnung ist unklar. Bitte Dateien aktualisieren und vorhandene Rechnungen prüfen, bevor Sie erneut anlegen.',
        );
      }
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
      if (reply.status >= 500) throw new Error('uncertain-deposit');
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
        setCreateDialogOpen(false);
      } else {
        setCreateUncertain(true);
        setMessage(
          'Anzahlungsrechnung angelegt, aber die Antwort war unklar. Bitte Dateien aktualisieren und vorhandene Anzahlungen prüfen.',
        );
      }
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
  // BKP019.c3.2: the same finalized confirmation can be billed as the final
  // invoice. One explicit step, no retyped amount: the deduction is derived from
  // the advances that are already billed, so the operator decides nothing here
  // except "yes". DOC-CREATE-02-Rest: the step now lives in the shared creation
  // dialog, which the row action opens with its confirmation preselected.
  async function createFinalInvoice(id: string, version: number) {
    if (
      mutating.current ||
      editorBusy ||
      editorDirty ||
      createUncertain ||
      reloadWarning ||
      initialLoadFailed
    )
      return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/final-invoice', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ version }),
      });
      // A server error is an unclear answer: the row may or may not exist, so
      // nothing is created again until the list was read.
      if (reply.status >= 500) throw new Error('uncertain-final-invoice');
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
        setCreateDialogOpen(false);
      } else {
        setCreateUncertain(true);
        setMessage(
          'Schlussrechnung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
        );
      }
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
  // BKP019.c2: a finalized claim is corrected by its own follow-up document.
  // The direction is the one operator decision; the positions are copied and the
  // source itself keeps its number, its state and its bytes. DOC-CREATE-02-Rest:
  // the write now comes from the shared creation dialog, which carries the
  // preselected claim and the direction.
  async function createCorrection(entry: DocumentRow) {
    if (
      mutating.current ||
      busy !== '' ||
      createUncertain ||
      reloadWarning ||
      initialLoadFailed
    )
      return;
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
      if (reply.status >= 500) throw new Error('uncertain-correction');
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'duplicate'
            ? 'Für diesen Beleg gibt es bereits einen offenen Korrektur-Entwurf.'
            : result.error === 'credit_exceeds_invoice'
              ? 'Die Gutschrift übersteigt den Rechnungsbetrag. Bitte Betrag prüfen.'
              : result.error === 'invalid_kind'
                ? 'Nur eine finalisierte Rechnung oder Auftragsbestätigung lässt sich korrigieren.'
                : result.error === 'invalid_state' ||
                    result.error === 'conflict'
                  ? 'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.'
                  : result.error === 'missing_reference'
                    ? 'Für diesen Beleg fehlen gespeicherte Angaben, die für eine Korrektur nötig sind.'
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
        setCreateDialogOpen(false);
      } else {
        setCreateUncertain(true);
        setMessage(
          'Rechnungskorrektur angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
        );
      }
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
  // DOC-ACCEPT-FIX-01: exactly one acceptance form can be open, and the
  // correction owns the same fields as the capture - this names its row.
  function correctingAcceptance(entry: DocumentRow) {
    return acceptanceCorrectionId === entry.id;
  }
  // DOC-ACCEPT-FIX-01: a correction starts from the stored record. The stored
  // instant is a real point in time; the datetime-local field wants the tenant's
  // wall clock, so the same zone that displays the record fills the field.
  function openAcceptanceCorrection(entry: DocumentRow) {
    if (mutating.current) return;
    setMessage('');
    setAcceptanceId('');
    setAcceptanceCorrectionId(entry.id);
    setAcceptanceChannel(entry.acceptanceChannel ?? '');
    setAcceptanceTime(
      entry.acceptedAt ? acceptedInputValue(entry.acceptedAt, timeZone) : '',
    );
    setAcceptanceNoteText(entry.acceptanceNote ?? '');
    setAcceptanceFileId(entry.acceptanceFileId ?? '');
    void loadLibraryFiles();
  }
  // Cancelling is data-free: the stored record stays readable and the form only
  // closes. The focus return is the effect above.
  function closeAcceptanceCorrection() {
    if (mutating.current) return;
    setAcceptanceCorrectionId('');
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
  // DOC-ACCEPT-FIX-01: an explicit correction replaces the stored record as one
  // decision. Only the chosen act writes; a 409 is shown and never repeated, and
  // the form stays open so the typed values are not lost.
  async function correctAcceptance(
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
      const reply = await fetch(
        '/api/v1/documents/' + id + '/acceptance-correction',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          // The whole record is replaced: an emptied note or picker clears the
          // stored value, and the stored instant was prefilled above.
          body: JSON.stringify({
            version,
            channel: acceptanceChannel,
            ...(acceptanceTime ? { acceptedAt: acceptanceTime } : {}),
            ...(acceptanceNoteText.trim()
              ? { note: acceptanceNoteText.trim() }
              : {}),
            ...(acceptanceFileId ? { attachmentFileId: acceptanceFileId } : {}),
          }),
        },
      );
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(statusChangeMessage(result.error));
        if (
          result.error === 'conflict' ||
          result.error === 'acceptance_conflict' ||
          result.error === 'offer_not_accepted' ||
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
      setAcceptanceCorrectionId('');
      setMessage('Annahmedaten korrigiert.');
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
  // MAIL-DOC-01: one explicit gesture. The recipient starts as the stored
  // contact address - an empty field when the contact has none - and stays
  // freely correctable; the server validates the final address again.
  // MAIL-TPL-01c: the default subject is the automatic document subject; an
  // empty subject at send time keeps exactly this behaviour on the server.
  // MAIL-FWD-01: the forwarding switches of both mail dialogs - one shared
  // rendering so the two paths can never grow apart.
  // MAIL-EVENT-02: template, upload and attachment list are one set of
  // controls shared by the document mail and the free event mail. Both
  // dialogs are never open together, so they share the attachment state.
  function mailAttachmentControls(
    main: DocumentRow | null,
    onApplyTemplate: () => void,
  ) {
    return (
      <>
        {/* Applying a template replaces the draft once - the
    selection alone changes nothing (BKP015.10 pattern). */}
        <div className="mail-template-row">
          <label>
            Aus Vorlage
            <select
              value={mailTemplateId}
              onChange={(event) => setMailTemplateId(event.target.value)}
            >
              <option value="">Keine Vorlage</option>
              {mailTemplates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-action"
            disabled={
              !mailTemplateId ||
              busy !== '' ||
              mailUncertain ||
              mailTemplateBusy
            }
            onClick={onApplyTemplate}
          >
            Übernehmen
          </button>
        </div>
        {templateNotice && <p role="status">{templateNotice}</p>}
        {/* ATTACH-01b: files can be dropped onto the text area
    above or chosen here; every upload is named, good or
    bad. */}
        <div className="mail-upload-row">
          <label>
            Datei zum Anhängen wählen
            <input
              type="file"
              multiple
              disabled={busy !== '' || mailUncertain || uploading}
              onChange={(event) => {
                const files = event.target.files;
                if (files?.length) void uploadFiles(files);
                event.target.value = '';
              }}
            />
          </label>
        </div>
        {uploading && <p role="status">Datei wird hochgeladen …</p>}
        {uploadNotice && <p role="status">{uploadNotice}</p>}
        {uploadFail && <p role="alert">{uploadFail}</p>}
        {/* ATTACH-01a: one named list for every attachment -
    the document itself, extra event documents and library
    files - and each removal asks before it happens. */}
        <ul className="mail-file-attachments">
          {main && mailAttachDocument && (
            <li>
              <span>
                {kindName(main)} {main.number}
              </span>
              <TrashButton
                label={`${kindName(main)} ${main.number} entfernen`}
                disabled={busy !== '' || mailUncertain}
                onConfirm={() => setMailAttachDocument(false)}
              />
            </li>
          )}
          {mailDocs.map((doc) => (
            <li key={doc.id}>
              <span>{doc.label}</span>
              <TrashButton
                label={`${doc.label} entfernen`}
                disabled={busy !== '' || mailUncertain}
                onConfirm={() =>
                  setMailDocs((current) =>
                    current.filter((item) => item.id !== doc.id),
                  )
                }
              />
            </li>
          ))}
          {mailFiles.map((file) => (
            <li key={file.libraryFileId}>
              <span>{file.name}</span>
              <TrashButton
                label={`${file.name} entfernen`}
                disabled={busy !== '' || mailUncertain}
                onConfirm={() =>
                  setMailFiles((current) =>
                    current.filter(
                      (item) => item.libraryFileId !== file.libraryFileId,
                    ),
                  )
                }
              />
            </li>
          ))}
        </ul>
        <div className="mail-template-row">
          <label>
            Aus Event-Dokumenten
            <select
              value={mailDocId}
              onChange={(event) => setMailDocId(event.target.value)}
            >
              <option value="">Dokument wählen</option>
              {documents
                .filter(
                  (doc) =>
                    doc.state === 'final' &&
                    doc.id !== main?.id &&
                    !mailDocs.some((item) => item.id === doc.id),
                )
                .map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {kindName(doc)} {doc.number}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-action"
            disabled={!mailDocId || busy !== '' || mailUncertain}
            onClick={() => {
              const doc = documents.find((item) => item.id === mailDocId);
              if (!doc) return;
              setMailDocs((current) =>
                current.concat({
                  id: doc.id,
                  label: `${kindName(doc)} ${doc.number}`,
                }),
              );
              setMailDocId('');
            }}
          >
            Dokument hinzufügen
          </button>
        </div>
        <div className="mail-template-row">
          <label>
            Aus Bibliothek
            <select
              value={mailFileId}
              onChange={(event) => setMailFileId(event.target.value)}
            >
              <option value="">Datei wählen</option>
              {mailLibraryFiles
                .filter(
                  (file) =>
                    !mailFiles.some((item) => item.libraryFileId === file.id),
                )
                .map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.label}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-action"
            disabled={!mailFileId || busy !== '' || mailUncertain}
            onClick={() => {
              const file = mailLibraryFiles.find(
                (item) => item.id === mailFileId,
              );
              if (!file) return;
              setMailFiles((current) =>
                current.concat({
                  libraryFileId: file.id,
                  name: file.label,
                  mediaType: 'application/pdf',
                  sizeBytes: 0,
                }),
              );
              setMailFileId('');
            }}
          >
            Datei hinzufügen
          </button>
        </div>
      </>
    );
  }
  // ATTACH-01b: the editor surface accepts dropped files. Capture phase: the
  // editor below swallows drop events on its own surface, and the browser
  // default for a dropped file would be navigation. Internal text drops carry
  // no files and stay untouched.
  function dropZoneProps() {
    return {
      'data-dragging': dragging ? 'true' : 'false',
      onDragOverCapture: (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave: () => setDragging(false),
      onDropCapture: (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) {
          event.stopPropagation();
          void uploadFiles(event.dataTransfer.files);
        }
      },
    };
  }
  // MAIL-SIG-01b: the standard signature is preselected and can be replaced
  // by another one or by none; without any signature the choice is hidden.
  function signatureControl() {
    if (!mailSignatures.length) return null;
    return (
      <label>
        Signatur
        <select
          value={mailSignatureId}
          onChange={(event) => setMailSignatureId(event.target.value)}
        >
          {mailSignatures.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
              {row.isDefault ? ' (Standard)' : ''}
            </option>
          ))}
          <option value="none">Keine Signatur</option>
        </select>
      </label>
    );
  }
  function forwardingControls() {
    return (
      <fieldset className="mail-forwarding">
        <legend>Weiterleitung</legend>
        <label>
          <input
            type="checkbox"
            checked={forwardAccounting}
            onChange={(event) =>
              setForwardAccounting(event.currentTarget.checked)
            }
          />
          Kopie an Buchhaltung
          {accountingRecipient ? ` – ${accountingRecipient}` : ''}
        </label>
        {forwardUsers.length > 0 && (
          <div role="group" aria-label="Kopie an App-User">
            {forwardUsers.map((user) => (
              <label key={user.id}>
                <input
                  type="checkbox"
                  checked={forwardUserIds.includes(user.id)}
                  onChange={(event) => {
                    // The updater runs later: capture the flag first.
                    const { checked } = event.currentTarget;
                    setForwardUserIds((current) =>
                      checked
                        ? [...current, user.id]
                        : current.filter((id) => id !== user.id),
                    );
                  }}
                />
                Kopie an {user.email}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    );
  }
  function defaultMailSubject(entry: DocumentRow) {
    return 'Dokument ' + (entry.number ?? '');
  }
  // The pickers of both mail dialogs: available library files and active
  // templates, read again whenever a dialog opens.
  function loadMailChoices() {
    // The standard signature is preselected; a failed list offers none.
    setMailSignatureId('');
    void fetch('/api/v1/mail-signatures')
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        const rows = (await response.json()) as {
          id: string;
          name: string;
          isDefault: boolean;
        }[];
        setMailSignatures(rows);
        setMailSignatureId(rows.find((row) => row.isDefault)?.id ?? 'none');
      })
      .catch(() => {
        setMailSignatures([]);
        setMailSignatureId('none');
      });
    // The library picker lists the available files; a failed list leaves the
    // picker empty and never invents an entry.
    void fetch('/api/v1/library-files')
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        const rows = (await response.json()) as {
          id: string;
          displayName: string;
          state: string;
        }[];
        setMailLibraryFiles(
          rows
            .filter((row) => row.state === 'available')
            .map((row) => ({ id: row.id, label: row.displayName })),
        );
      })
      .catch(() => setMailLibraryFiles([]));
    // Only active templates are offered; a failed list is a quiet notice.
    void fetch('/api/v1/mail-templates')
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        const rows = (await response.json()) as {
          id: string;
          name: string;
          state: string;
        }[];
        setMailTemplates(rows.filter((row) => row.state === 'active'));
      })
      .catch(() => {
        setMailTemplates([]);
        setTemplateNotice('Die Vorlagen konnten nicht geladen werden.');
      });
  }
  function openMailSend(entry: DocumentRow, trigger: HTMLElement) {
    setMessage('');
    setMailSendId(entry.id);
    setMailTo(contactEmail?.trim() ?? '');
    setMailBody('');
    setMailBodyReplace((count) => count + 1);
    setForwardAccounting(false);
    setForwardUserIds([]);
    setMailSubject(defaultMailSubject(entry));
    setMailTemplateId('');
    setTemplateNotice('');
    setMailFiles([]);
    setMailAttachDocument(true);
    setMailDocs([]);
    setMailDocId('');
    setMailFileId('');
    setMailUncertain(false);
    setMailPreview(null);
    setMailPreviewState('idle');
    setMailPreviewError('');
    setMailRequestId(crypto.randomUUID());
    mailTrigger.current = trigger;
    loadMailChoices();
  }
  function closeMailSend() {
    if (busy !== '') return;
    setMailSendId('');
    setMailRequestId('');
    setMailUncertain(false);
    setMailPreview(null);
    setMailPreviewState('idle');
    setMailPreviewError('');
  }
  // MAIL-EVENT-01: a free mail from the event. One gesture, one order - the
  // request id keeps a retry on the very same order.
  function openCompose(trigger: HTMLElement) {
    setMessage('');
    composeTrigger.current = trigger;
    setComposeTo(contactEmail?.trim() ?? '');
    setComposeSubject('');
    setComposeBody('');
    setComposeReplace((count) => count + 1);
    // MAIL-EVENT-02: the shared attachment state starts empty for this mail.
    setMailFiles([]);
    setMailDocs([]);
    setMailDocId('');
    setMailFileId('');
    setMailTemplateId('');
    setTemplateNotice('');
    setUploadNotice('');
    setUploadFail('');
    setMailUncertain(false);
    loadMailChoices();
    setForwardAccounting(false);
    setForwardUserIds([]);
    setComposeRequestId(crypto.randomUUID());
    setComposeOpen(true);
  }
  async function sendCompose() {
    if (!composeOpen || busy !== '') return;
    setBusy('compose');
    setMessage('');
    try {
      const reply = await fetch('/api/v1/mail/compose', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          requestId: composeRequestId,
          to: composeTo,
          subject: composeSubject,
          ...(composeBody.trim() ? { bodyHtml: composeBody } : {}),
          ...(contactId ? { contactId } : {}),
          ...(eventId ? { eventId } : {}),
          forwardAccounting,
          ...(forwardUserIds.length ? { forwardUserIds } : {}),
          ...(mailDocs.length
            ? { documentIds: mailDocs.map((doc) => doc.id) }
            : {}),
          ...(mailFiles.length
            ? { fileIds: mailFiles.map((file) => file.libraryFileId) }
            : {}),
          ...(mailSignatureId && mailSignatureId !== 'none'
            ? { signatureId: mailSignatureId }
            : {}),
        }),
      });
      if (!reply.ok) {
        setMessage(documentSendFailureMessage(await failureCode(reply)));
        return;
      }
      await reply.json();
      setComposeOpen(false);
      setMessage(queuedMessage);
      onMailScheduled?.();
    } catch {
      // The request id makes a retry safe: it can only reach the same order.
      setMessage(
        'Der Ausgang ist unklar. Bitte den Postausgang prüfen; ein erneuter Versuch kann nur denselben Auftrag erreichen.',
      );
    } finally {
      setBusy('');
    }
  }
  // MAIL-TPL-01c: applying a template replaces subject and body once; the
  // draft is afterwards fully editable and the template itself never changes.
  async function applyMailTemplate(
    dirty: boolean,
    apply: (subject: string, bodyHtml: string) => void,
  ) {
    if (!mailTemplateId || mailTemplateBusy) return;
    if (
      dirty &&
      !window.confirm('Ungespeicherte Änderungen durch die Vorlage ersetzen?')
    )
      return;
    setMailTemplateBusy(true);
    setTemplateNotice('');
    try {
      const response = await fetch('/api/v1/mail-templates/' + mailTemplateId);
      if (!response.ok) throw Error('load');
      const detail = (await response.json()) as {
        subject: string;
        bodyHtml: string;
        attachments: MailFileAttachment[];
      };
      apply(detail.subject, detail.bodyHtml);
      // The standard attachments are visible from the start and each one can
      // be removed before the send - nothing travels unseen.
      setMailFiles(detail.attachments ?? []);
      setTemplateNotice('Vorlage übernommen.');
    } catch {
      setTemplateNotice('Die Vorlage konnte nicht geladen werden.');
    } finally {
      setMailTemplateBusy(false);
    }
  }

  // ATTACH-01b: dropped or chosen files go through the same library upload as
  // the files area; each file is named in the outcome, good or bad.
  async function uploadFiles(files: FileList | File[]) {
    setUploadNotice('');
    setUploadFail('');
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const mediaType = mediaTypeOf(file);
        if (!mediaType) {
          setUploadFail(`${file.name}: Der Dateityp wird nicht unterstützt.`);
          continue;
        }
        if (file.size > maxBytes) {
          setUploadFail(`${file.name}: Die Datei ist größer als 10 MiB.`);
          continue;
        }
        try {
          const contentBase64 = await readFileBase64(file),
            reply = await fetch('/api/v1/library-files', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-csrf-token': csrfToken,
              },
              body: JSON.stringify({
                displayName: file.name,
                mediaType,
                contentBase64,
                requestId: crypto.randomUUID(),
              }),
            });
          if (reply.status !== 201) {
            setUploadFail(await uploadError(reply));
            continue;
          }
          const row = (await reply.json()) as {
            id: string;
            displayName: string;
            mediaType: string;
            sizeBytes: number;
          };
          setMailFiles((current) =>
            current.concat({
              libraryFileId: row.id,
              name: row.displayName,
              mediaType: row.mediaType,
              sizeBytes: row.sizeBytes,
            }),
          );
          setUploadNotice(
            `${file.name} wurde angehängt. Die Datei ist ungeprüft.`,
          );
        } catch {
          setUploadFail(
            'Der Uploadstand ist unklar. Bitte die Anhänge prüfen, bevor du es erneut versuchst.',
          );
        }
      }
    } finally {
      setUploading(false);
    }
  }
  // The refusal categories of the send route, worded as the operator's next
  // step. Nothing here repeats a document or a customer address. MAIL-UX-02:
  // every code the server can answer has its own line, and an unknown code is
  // quoted verbatim - the cause is never unclear again.
  function documentSendFailureMessage(error: string) {
    switch (error) {
      case 'not_found':
        return 'Das Dokument wurde nicht gefunden.';
      case 'not_final':
        return 'Nur ein finalisiertes Dokument kann per E-Mail gesendet werden.';
      case 'attachment_unavailable':
        return 'Ein Anhang ist derzeit nicht verfügbar. Bitte die Anhänge prüfen; es wurde kein Auftrag angelegt.';
      case 'forward_unavailable':
        return 'Die Weiterleitung ist nicht eingerichtet. Bitte in den Einstellungen eine Buchhaltungs-Mail hinterlegen oder die Auswahl prüfen; es wurde nichts gesendet.';
      case 'invalid_recipients':
        return 'Bitte eine gültige Empfängeradresse eingeben.';
      case 'invalid_account':
        return 'Es ist kein aktives E-Mail-Konto eingerichtet.';
      case 'missing_placeholder':
        return 'Ein Platzhalter hat für diese Mail keinen Wert. Betrag und Dokumentlink gibt es nur beim Dokumentversand, Kontakt- und Eventwerte nur mit zugeordnetem Kontakt bzw. Event. Bitte den Platzhalter entfernen; die Eingaben bleiben erhalten.';
      case 'invalid_content':
        return 'Unbekannter Platzhalter im Text. Nur die Platzhalter aus der Auswahl verwenden; die Eingaben bleiben erhalten.';
      case 'invalid_body':
        return 'Der Text konnte nicht übernommen werden. Bitte die Eingaben prüfen.';
      case 'invalid_subject':
        return 'Der Betreff ist zu lang oder enthält unerlaubte Zeichen. Bitte den Betreff prüfen; die Eingaben bleiben erhalten.';
      case 'invalid_link':
        return 'Eine Verknüpfung (Kontakt, Event, Weiterleitung oder Signatur) wurde nicht gefunden oder gehört zu einem anderen Mandanten. Bitte die Auswahl prüfen; es wurde nichts gesendet.';
      case 'invalid_sender':
      case 'invalid_security':
      case 'invalid_direction':
      case 'invalid_folder':
      case 'invalid_port':
      case 'secret_required':
        return 'Das E-Mail-Konto ist nicht vollständig eingerichtet. Bitte es in den Einstellungen prüfen; es wurde nichts gesendet.';
      case 'already_exists':
        return 'Der Eintrag besteht bereits. Bitte die Liste prüfen.';
      case 'not_sendable':
        return 'Der Auftrag kann aus diesem Zustand nicht gesendet werden. Bitte die Liste prüfen.';
      case 'not_retryable':
        return 'Der Auftrag kann nicht erneut versucht werden. Bitte die Liste prüfen.';
      case 'idempotency_conflict':
        return 'Dieselbe Anfrage wurde bereits mit anderem Inhalt verarbeitet. Bitte die Eingaben prüfen und nur einmal senden.';
      case 'encryption_unavailable':
        return 'Die Verschlüsselung ist derzeit nicht eingerichtet. Es wurde nichts gesendet.';
      case 'forbidden':
        return 'Ihr Konto hat dafür keine Berechtigung. Es wurde nichts gesendet.';
      case 'internal':
        return 'Interner Fehler. Es wurde nichts gesendet; bitte erneut versuchen und bei Wiederholung melden.';
      case 'unbekannt':
        return 'Die Anfrage konnte nicht beantwortet werden. Bitte die Verbindung prüfen und erneut versuchen.';
      default:
        return `Unbekannter Fehler (Code: ${String(error).slice(0, 60)}). Bitte die Eingaben prüfen und den Code beim Melden angeben.`;
    }
  }
  // MAIL-UX-02: a refusal body that is not JSON or carries no code is still
  // named honestly - by HTTP class, never silently as an input problem.
  async function failureCode(reply: Response): Promise<string> {
    const body = (await reply.json().catch(() => null)) as {
      error?: string;
    } | null;
    return body?.error ?? (reply.status >= 500 ? 'internal' : 'unbekannt');
  }
  // MAIL-EDITOR-01: the preview runs the same server assembly as the send and
  // stores nothing. It is a pure read with an honest loading and error state.
  async function loadMailPreview() {
    if (!mailSendId || mailPreviewState === 'loading') return;
    setMailPreviewState('loading');
    setMailPreview(null);
    setMailPreviewError('');
    try {
      const reply = await fetch('/api/v1/mail/document-send/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          documentId: mailSendId,
          subject: mailSubject,
          ...(mailBody.trim() ? { bodyHtml: mailBody } : {}),
          ...(mailSignatureId && mailSignatureId !== 'none'
            ? { signatureId: mailSignatureId }
            : {}),
        }),
      });
      if (!reply.ok) {
        setMailPreviewError(
          documentSendFailureMessage(await failureCode(reply)),
        );
        setMailPreviewState('error');
        return;
      }
      setMailPreview((await reply.json()) as MailPreview);
      setMailPreviewState('ready');
    } catch {
      setMailPreviewError(
        'Die Vorschau konnte nicht geladen werden. Bitte erneut versuchen.',
      );
      setMailPreviewState('error');
    }
  }
  async function sendDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !mailSendId ||
      !mailRequestId ||
      mutating.current ||
      busy !== '' ||
      mailUncertain ||
      recordRemoving ||
      createUncertain
    )
      return;
    const to = mailTo.trim();
    if (!to) {
      setMessage('Bitte eine Empfängeradresse eingeben.');
      return;
    }
    mutating.current = true;
    setBusy('mail');
    setMessage('');
    try {
      const reply = await fetch('/api/v1/mail/document-send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          documentId: mailSendId,
          requestId: mailRequestId,
          to,
          subject: mailSubject,
          ...(mailBody.trim() ? { bodyHtml: mailBody } : {}),
          attachDocument: mailAttachDocument,
          ...(mailDocs.length
            ? { documentIds: mailDocs.map((doc) => doc.id) }
            : {}),
          ...(mailFiles.length
            ? { fileIds: mailFiles.map((file) => file.libraryFileId) }
            : {}),
          ...(mailSignatureId && mailSignatureId !== 'none'
            ? { signatureId: mailSignatureId }
            : {}),
          forwardAccounting,
          ...(forwardUserIds.length ? { forwardUserIds } : {}),
        }),
      });
      if (!reply.ok) {
        setMessage(documentSendFailureMessage(await failureCode(reply)));
        return;
      }
      await reply.json();
      setMailSendId('');
      setMailRequestId('');
      setMessage(queuedMessage);
      onMailScheduled?.();
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      // The order may exist. Only the same request id may repeat it, so the
      // gesture stays locked until the list was read again and the operator
      // repeats it deliberately - with that very id.
      setMailUncertain(true);
      setMessage(
        'Der Ausgang ist unklar. Bitte die Liste prüfen; eine Wiederholung nutzt denselben Auftrag und kann keine zweite Mail erzeugen.',
      );
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
          setMessage(reconciledCreateMessage(createKind));
        }
        // MAIL-DOC-01: after the list was read again, the unclear gesture may be
        // repeated - with the same request id, so it can only reach one order.
        if (mailUncertain) {
          setMailUncertain(false);
          setMessage(
            'Liste aktualisiert. Eine Wiederholung nutzt denselben Auftrag und kann keine zweite Mail erzeugen.',
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
  function finalizeAction(entry: DocumentRow) {
    return (
      <button
        type="button"
        className="secondary-action"
        disabled={
          busy !== '' ||
          editorBusy ||
          editorDirty ||
          (entry.id === editorId && entry.hasPricedLines === false)
        }
        aria-label={
          kindName(entry) + ' ' + (entry.number ?? 'Entwurf') + ' finalisieren'
        }
        onClick={() => void finalize(entry.id, entry.version)}
      >
        Finalisieren
      </button>
    );
  }
  function revisionOrigin(entry: DocumentRow) {
    if (!entry.predecessorDocumentId || !entry.predecessorNumber) return null;
    return (
      <p className="document-meta">
        Überarbeitung von{' '}
        <a
          href={'/api/v1/documents/' + entry.predecessorDocumentId + '/pdf'}
          target="_blank"
          rel="noreferrer"
          aria-label={
            'Vorgängerangebot ' + entry.predecessorNumber + ' als PDF öffnen'
          }
        >
          {entry.predecessorNumber}
        </a>
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
            {revisionOrigin(entry)}
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
                the same two derived values.
                RG-08: the lateness is its own derived fact and therefore its own
                element next to the payment state - "offen" and "überfällig" are
                two axes, so neither replaces the other. */}
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
                  {entry.overdue === true && (
                    <>
                      {' · '}
                      <strong className="document-overdue">Überfällig</strong>
                    </>
                  )}
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
            {/* DOC-ACCEPT-FIX-01: the record above is corrected only by this
                explicit act - a repeat of the acceptance stays a 409. */}
            {entry.kind === 'offer' && entry.acceptedAt && (
              <div className="document-actions">
                <button
                  id={'correct-acceptance-' + entry.id}
                  type="button"
                  className="secondary-action"
                  disabled={busy !== '' || recordRemoving}
                  aria-label={
                    kindName(entry) +
                    ' ' +
                    (entry.number ?? '') +
                    ' Annahmedaten korrigieren'
                  }
                  aria-expanded={correctingAcceptance(entry)}
                  onClick={(event) => {
                    acceptanceCorrectionTrigger.current =
                      event.currentTarget.id;
                    openAcceptanceCorrection(entry);
                  }}
                >
                  Annahmedaten korrigieren
                </button>
              </div>
            )}
            <div className="document-actions">
              {entry.state === 'draft' && (
                <>
                  {editableDraftKinds.has(entry.kind) && (
                    <button
                      id={'edit-document-' + entry.id}
                      type="button"
                      className="secondary-action"
                      disabled={
                        busy !== '' ||
                        editorBusy ||
                        editorId !== '' ||
                        recordRemoving
                      }
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? 'Entwurf') +
                        ' bearbeiten'
                      }
                      onClick={(event) => {
                        if (recordRemoving) return;
                        editorTrigger.current = event.currentTarget.id;
                        setEditorDirty(false);
                        setEditorId(entry.id);
                      }}
                    >
                      Bearbeiten
                    </button>
                  )}
                  {finalizeAction(entry)}
                </>
              )}
              {/* UI-PARITY-03: Bookitup's "Dokument bereitstellen" - the
                  preview beside every way to hand the final document out. */}
              {entry.state === 'final' && (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy !== '' || recordRemoving}
                  aria-haspopup="dialog"
                  aria-label={
                    kindName(entry) +
                    ' ' +
                    (entry.number ?? '') +
                    ' bereitstellen'
                  }
                  onClick={(event) => {
                    setMessage('');
                    deliverTrigger.current = event.currentTarget;
                    setDeliverId(entry.id);
                  }}
                >
                  Bereitstellen
                </button>
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
              {/* MAIL-DOC-01: only a finalized document has the frozen artefact a
                  mail may carry. The action opens the dialog; it never sends from
                  the click alone. */}
              {entry.state === 'final' && (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    busy !== '' ||
                    recordRemoving ||
                    createUncertain ||
                    initialLoadFailed ||
                    reloadWarning
                  }
                  aria-haspopup="dialog"
                  aria-label={
                    kindName(entry) +
                    ' ' +
                    (entry.number ?? '') +
                    ' per E-Mail senden'
                  }
                  onClick={(event) => openMailSend(entry, event.currentTarget)}
                >
                  Per E-Mail senden
                </button>
              )}
              {/* BKP019.c2: only a finalized claim is corrected, and only as an
                  explicit step - the correction starts as a draft with its own
                  number. DOC-CREATE-02-Rest: the row action opens the same
                  creation dialog as every other source-bound kind, with this
                  claim and the direction preselected. */}
              {correctionSources.some((source) => source.id === entry.id) && (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    busy !== '' ||
                    createUncertain ||
                    reloadWarning ||
                    initialLoadFailed
                  }
                  aria-haspopup="dialog"
                  aria-label={
                    kindName(entry) +
                    ' ' +
                    (entry.number ?? '') +
                    ' korrigieren'
                  }
                  onClick={(event) => {
                    setMessage('');
                    setCreateKind('correction');
                    // The credit note stays the default direction; a fully
                    // credited source warns instead of hiding its one refusal.
                    setCorrectionDirection('credit');
                    setCorrectionSourceId(entry.id);
                    createDialogTrigger.current = event.currentTarget;
                    setCreateDialogOpen(true);
                  }}
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
                    <button
                      id={'revise-document-' + entry.id}
                      type="button"
                      className="secondary-action"
                      disabled={busy !== '' || recordRemoving}
                      aria-label={
                        kindName(entry) +
                        ' ' +
                        (entry.number ?? '') +
                        ' überarbeiten'
                      }
                      onClick={() => void reviseOffer(entry)}
                    >
                      Überarbeiten
                    </button>
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
              {entry.kind === 'offer' &&
                confirmationSources.some(
                  (source) => source.id === entry.id,
                ) && (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== '' || createUncertain}
                    aria-haspopup="dialog"
                    aria-label={
                      kindName(entry) +
                      ' ' +
                      (entry.number ?? '') +
                      ' Auftragsbestätigung erstellen'
                    }
                    onClick={(event) => {
                      setMessage('');
                      setCreateKind('order_confirmation');
                      setConfirmationSourceId(entry.id);
                      createDialogTrigger.current = event.currentTarget;
                      setCreateDialogOpen(true);
                    }}
                  >
                    Auftragsbestätigung erstellen
                  </button>
                )}
              {invoiceSources.some((source) => source.id === entry.id) && (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    busy !== '' ||
                    createUncertain ||
                    reloadWarning ||
                    initialLoadFailed
                  }
                  aria-haspopup="dialog"
                  aria-label={
                    kindName(entry) +
                    ' ' +
                    (entry.number ?? '') +
                    ' Rechnung erstellen'
                  }
                  onClick={(event) => {
                    setMessage('');
                    setCreateKind('invoice');
                    setDepositSourceId(entry.id);
                    createDialogTrigger.current = event.currentTarget;
                    setCreateDialogOpen(true);
                  }}
                >
                  Rechnung erstellen
                </button>
              )}
              {/* Multiple advances per order are valid; this action always opens
                  the shared picker and never suggests an existing one is deduped. */}
              {depositSources.some((source) => source.id === entry.id) && (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    busy !== '' ||
                    createUncertain ||
                    reloadWarning ||
                    initialLoadFailed
                  }
                  aria-haspopup="dialog"
                  aria-label={
                    kindName(entry) +
                    ' ' +
                    (entry.number ?? '') +
                    ' Anzahlung erstellen'
                  }
                  onClick={(event) => {
                    setMessage('');
                    setCreateKind('deposit_invoice');
                    setDepositSourceId(entry.id);
                    createDialogTrigger.current = event.currentTarget;
                    setCreateDialogOpen(true);
                  }}
                >
                  Anzahlung erstellen
                </button>
              )}
              {/* BKP019.c3.2: the same finalized confirmation can be billed as
                  the final invoice, which settles the advances already billed on
                  it. A third explicit step, offered only while the confirmation
                  carries no invoice at all - the two invoice roles are
                  alternatives, not a sequence. DOC-CREATE-02-Rest: the row action
                  opens the shared creation dialog with this confirmation
                  preselected, exactly like the standard invoice. */}
              {invoiceSources.some((source) => source.id === entry.id) && (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    busy !== '' ||
                    createUncertain ||
                    reloadWarning ||
                    initialLoadFailed
                  }
                  aria-haspopup="dialog"
                  aria-label={
                    kindName(entry) +
                    ' ' +
                    (entry.number ?? '') +
                    ' Schlussrechnung erstellen'
                  }
                  onClick={(event) => {
                    setMessage('');
                    setCreateKind('final_invoice');
                    setDepositSourceId(entry.id);
                    createDialogTrigger.current = event.currentTarget;
                    setCreateDialogOpen(true);
                  }}
                >
                  Schlussrechnung erstellen
                </button>
              )}
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
              ((entry.offerStatus === 'sent' && acceptanceId === entry.id) ||
                correctingAcceptance(entry)) && (
                <form
                  className="offer-draft-editor"
                  aria-label={
                    correctingAcceptance(entry)
                      ? 'Annahmedaten korrigieren'
                      : 'Annahme erfassen'
                  }
                  onKeyDown={(event) => {
                    // Escape closes without a write; the stored record stays.
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    closeAcceptanceCorrection();
                  }}
                  onSubmit={(event) =>
                    correctingAcceptance(entry)
                      ? void correctAcceptance(event, entry.id, entry.version)
                      : void accept(event, entry.id, entry.version)
                  }
                >
                  <fieldset disabled={busy !== ''}>
                    <legend>
                      {correctingAcceptance(entry)
                        ? 'Annahmedaten korrigieren'
                        : 'Annahme erfassen'}
                    </legend>
                    <p className="document-hint">
                      {correctingAcceptance(entry)
                        ? 'Ersetzt die gespeicherten Annahmedaten. Dokument, Nummer und PDF bleiben unverändert.'
                        : 'Wie hat der Kunde zugesagt? Pflicht ist nur der Kanal; Zeitpunkt, Notiz und Anhang sind freiwillig.'}
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
                          {correctingAcceptance(entry) &&
                            acceptanceFileId &&
                            !libraryFiles.some(
                              (file) =>
                                file.id === acceptanceFileId &&
                                file.state === 'available',
                            ) && (
                              <option value={acceptanceFileId}>
                                Bisheriger Anhang (nicht auswählbar)
                              </option>
                            )}
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
                        {correctingAcceptance(entry)
                          ? 'Korrektur speichern'
                          : 'Annahme speichern'}
                      </button>
                      <button
                        type="button"
                        className="tertiary-action"
                        disabled={busy !== ''}
                        onClick={
                          correctingAcceptance(entry)
                            ? closeAcceptanceCorrection
                            : closeAcceptance
                        }
                      >
                        Abbrechen
                      </button>
                    </div>
                  </fieldset>
                </form>
              )}
            {deliverId === entry.id && (
              <dialog
                ref={deliverDialog}
                className="form-dialog document-deliver-dialog"
                aria-labelledby={'deliver-heading-' + entry.id}
                aria-modal="true"
                onCancel={(event) => {
                  event.preventDefault();
                  setDeliverId('');
                }}
              >
                <h4 id={'deliver-heading-' + entry.id}>
                  Dokument bereitstellen
                </h4>
                <p>
                  {kindName(entry)} {entry.number}
                </p>
                <div className="document-deliver-layout">
                  <iframe
                    ref={deliverPreview}
                    className="document-deliver-preview"
                    title={'Vorschau ' + kindName(entry) + ' ' + entry.number}
                    src={'/api/v1/documents/' + entry.id + '/pdf'}
                  />
                  <ul className="document-deliver-actions">
                    <li>
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={!accountingRecipient}
                        onClick={() => {
                          const trigger = deliverTrigger.current;
                          setDeliverId('');
                          openMailSend(entry, trigger ?? document.body);
                          setMailTo(accountingRecipient);
                        }}
                      >
                        An Buchhaltung senden
                      </button>
                      {!accountingRecipient && (
                        <span className="document-card-hint">
                          Unter Einstellungen → E-Mail → Ein- &amp;
                          Ausgangsserver eine Buchhaltungs-Mail hinterlegen.
                        </span>
                      )}
                    </li>
                    <li>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => {
                          const trigger = deliverTrigger.current;
                          setDeliverId('');
                          openMailSend(entry, trigger ?? document.body);
                        }}
                      >
                        E-Mail an Kunden
                      </button>
                    </li>
                    <li>
                      <a
                        className="secondary-action"
                        href={'/api/v1/documents/' + entry.id + '/pdf'}
                        download
                      >
                        Herunterladen
                      </a>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() =>
                          deliverPreview.current?.contentWindow?.print()
                        }
                      >
                        Drucken
                      </button>
                    </li>
                    <li>
                      <span className="document-card-hint">
                        Online freigeben gibt es noch nicht: das Kundenportal
                        ist bewusst zurückgestellt.
                      </span>
                    </li>
                  </ul>
                </div>
                <div className="document-actions">
                  <button
                    type="button"
                    className="tertiary-action"
                    onClick={() => setDeliverId('')}
                  >
                    Schließen
                  </button>
                </div>
              </dialog>
            )}
            {/* MAIL-DOC-01: the compact dialog of exactly one finalized document.
                It carries a recipient, an optional cover text and the frozen PDF
                it names - no attachment picker and no second order per click. */}
            {mailSendId === entry.id && (
              <dialog
                ref={mailDialog}
                className="form-dialog mail-send-dialog"
                aria-labelledby={'mail-send-heading-' + entry.id}
                aria-modal="true"
                onCancel={(event) => {
                  event.preventDefault();
                  closeMailSend();
                }}
              >
                <h4 id={'mail-send-heading-' + entry.id}>
                  Dokument per E-Mail senden
                </h4>
                <p className="document-hint">
                  {'Angehängt wird das finalisierte PDF ' +
                    (entry.number ?? '') +
                    ' – unverändert und nicht neu erzeugt.'}
                </p>
                {message && !mailUncertain && <p role="alert">{message}</p>}
                <form onSubmit={(event) => void sendDocument(event)}>
                  <fieldset disabled={busy !== '' || mailUncertain}>
                    <label>
                      Empfänger
                      <input
                        ref={mailRecipient}
                        type="text"
                        inputMode="email"
                        maxLength={254}
                        autoComplete="off"
                        value={mailTo}
                        onChange={(event) => setMailTo(event.target.value)}
                      />
                    </label>
                    {/* MAIL-TPL-01c: the subject is plain text with the
                    documented placeholders; empty keeps the automatic
                    document subject. */}
                    <label>
                      Betreff
                      <input
                        type="text"
                        maxLength={998}
                        value={mailSubject}
                        onChange={(event) => setMailSubject(event.target.value)}
                      />
                    </label>
                    {mailAttachmentControls(
                      entry,
                      () =>
                        void applyMailTemplate(
                          mailBody.trim() !== '' ||
                            mailSubject !== defaultMailSubject(entry),
                          (subject, body) => {
                            setMailSubject(subject);
                            setMailBody(body);
                            setMailBodyReplace((count) => count + 1);
                          },
                        ),
                    )}
                    {/* MAIL-EDITOR-01: the formatted cover text with the
                    documented placeholders; an empty body keeps the server's
                    default text. */}
                    <div className="mail-editor-field" {...dropZoneProps()}>
                      <span className="mail-editor-label">
                        Begleittext (optional)
                      </span>
                      <MailBodyEditor
                        value={mailBody}
                        onChange={setMailBody}
                        replaceKey={mailBodyReplace}
                        disabled={busy !== '' || mailUncertain}
                        label="Begleittext (optional)"
                      />
                    </div>
                  </fieldset>
                  <div className="document-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy !== '' || mailUncertain}
                      onClick={() => void loadMailPreview()}
                    >
                      Vorschau anzeigen
                    </button>
                  </div>
                  {mailPreviewState === 'loading' && (
                    <p role="status">Vorschau wird geladen …</p>
                  )}
                  {mailPreviewState === 'error' && (
                    <p role="alert">{mailPreviewError}</p>
                  )}
                  {mailPreview && (
                    <div className="mail-preview">
                      <p className="document-hint">
                        {'Betreff: ' + mailPreview.subject}
                      </p>
                      {/* Formatted preview when there is HTML; a plain-text
                      body shows its text alternative instead of a blank
                      box. */}
                      <div className="mail-preview-body">
                        {mailPreview.bodyHtml ? (
                          <div
                            dangerouslySetInnerHTML={{
                              __html: mailPreview.bodyHtml,
                            }}
                          />
                        ) : (
                          <p>{mailPreview.bodyText}</p>
                        )}
                      </div>
                      {mailPreview.missing.length > 0 && (
                        <p role="status">
                          {'Ohne Wert bleiben sichtbar: ' +
                            mailPreview.missing
                              .map((name) => `{{${name}}}`)
                              .join(', ') +
                            '. Diese Stellen vor dem Versand entfernen oder ergänzen.'}
                        </p>
                      )}
                    </div>
                  )}
                  {mailUncertain && (
                    <p role="alert">
                      Der Ausgang ist unklar. Nichts erneut senden, bevor die
                      Liste geprüft wurde; eine Wiederholung nutzt denselben
                      Auftrag.
                    </p>
                  )}
                  {signatureControl()}
                  {forwardingControls()}
                  <div className="document-actions">
                    <button
                      className="primary-action"
                      disabled={busy !== '' || mailUncertain}
                    >
                      Senden
                    </button>
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy !== ''}
                      onClick={closeMailSend}
                    >
                      Abbrechen
                    </button>
                    {mailUncertain && (
                      <button
                        type="button"
                        className="tertiary-action"
                        disabled={busy !== ''}
                        onClick={retryLoad}
                      >
                        Dateien erneut laden
                      </button>
                    )}
                  </div>
                </form>
              </dialog>
            )}
          </li>
        ))}
      </ul>
    );
  }
  const reloadNotice = (
    <p role="alert">
      Gespeichert, aber die Dateiliste konnte nicht neu geladen werden. Nichts
      erneut anlegen.
    </p>
  );
  if (editorEntry) {
    return (
      <div className="event-document-editor" ref={editorWorkspace}>
        {message && <p role="status">{message}</p>}
        {reloadWarning && <div className="reload-warning">{reloadNotice}</div>}
        {revisionOrigin(editorEntry)}
        <OfferDraftEditor
          documentId={editorEntry.id}
          csrfToken={csrfToken}
          kind={editorEntry.kind}
          finalizing={finalizing}
          onClose={() => {
            setEditorDirty(false);
            setEditorId('');
          }}
          onDirtyChange={setEditorDirty}
          onBusyChange={setEditorBusy}
          onProtectedChange={onEditorProtectedChange}
          onSavedMetadata={(metadata) =>
            setDocuments((current) =>
              current.map((row) =>
                row.id === editorEntry.id ? { ...row, ...metadata } : row,
              ),
            )
          }
        />
        <div className="document-actions">{finalizeAction(editorEntry)}</div>
      </div>
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
      {!createDialogOpen && <p role="status">{message}</p>}
      {reloadWarning && (
        <div className="reload-warning">
          {reloadNotice}
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
      {createUncertain && !createDialogOpen && (
        <div className="reload-warning">
          <p role="alert">{uncertainCreateMessage(createKind)}</p>
          <button
            ref={uncertainReload}
            type="button"
            className="tertiary-action"
            disabled={busy !== ''}
            onClick={retryLoad}
          >
            Dateien aktualisieren
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
            <button
              ref={createSummary}
              type="button"
              className="secondary-action"
              aria-haspopup="dialog"
              disabled={busy !== '' || createUncertain || recordRemoving}
              onClick={() => {
                setMessage('');
                setCreateKind(pendingBlankInvoice ? 'blank_invoice' : 'offer');
                setConfirmationSourceId('');
                createDialogTrigger.current = createSummary.current;
                setCreateDialogOpen(true);
              }}
            >
              {pendingBlankInvoice ? 'Anlage fortsetzen' : 'Dokument anlegen'}
            </button>
            {/* MAIL-EVENT-01: a free mail from the event - the same dialog
            mechanics as the document mail, without document and placeholders. */}
            <button
              type="button"
              className="secondary-action"
              aria-haspopup="dialog"
              disabled={busy !== ''}
              onClick={(event) => openCompose(event.currentTarget)}
            >
              Neue Mail schreiben
            </button>
            {/* UI-PARITY-02: a portal, so the dialog also opens from the
            E-Mails area while the files area is hidden. */}
            {composeOpen &&
              createPortal(
                <dialog
                  ref={composeDialog}
                  className="form-dialog mail-compose-dialog"
                  aria-labelledby="mail-compose-heading"
                  aria-modal="true"
                  onCancel={(event) => {
                    event.preventDefault();
                    if (busy === '') setComposeOpen(false);
                  }}
                >
                  <h4 id="mail-compose-heading">Neue Mail schreiben</h4>
                  <p>
                    Eventkontakt:{' '}
                    {contactId
                      ? contactName?.trim() || 'Zugeordneter Kontakt'
                      : 'Kein Hauptkontakt zugeordnet'}
                  </p>
                  {message && <p role="alert">{message}</p>}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendCompose();
                    }}
                  >
                    <label>
                      An
                      <input
                        ref={composeToField}
                        value={composeTo}
                        onChange={(event) =>
                          setComposeTo(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label>
                      Betreff
                      <input
                        value={composeSubject}
                        onChange={(event) =>
                          setComposeSubject(event.currentTarget.value)
                        }
                      />
                    </label>
                    {mailAttachmentControls(
                      null,
                      () =>
                        void applyMailTemplate(
                          composeBody.trim() !== '' ||
                            composeSubject.trim() !== '',
                          (subject, body) => {
                            setComposeSubject(subject);
                            setComposeBody(body);
                            setComposeReplace((count) => count + 1);
                          },
                        ),
                    )}
                    <div className="mail-editor-field" {...dropZoneProps()}>
                      <span className="mail-editor-label">Text (optional)</span>
                      <MailBodyEditor
                        value={composeBody}
                        onChange={setComposeBody}
                        replaceKey={composeReplace}
                        disabled={busy !== ''}
                        label="Text (optional)"
                        withPlaceholderPicker={false}
                      />
                    </div>
                    {signatureControl()}
                    {forwardingControls()}
                    <div className="document-actions">
                      <button
                        className="primary-action"
                        disabled={busy !== '' || composeTo.trim() === ''}
                      >
                        Senden
                      </button>
                      <button
                        type="button"
                        className="tertiary-action"
                        disabled={busy !== ''}
                        onClick={() => setComposeOpen(false)}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </form>
                </dialog>,
                document.body,
              )}
            {createDialogOpen && (
              <dialog
                ref={createDialog}
                className="form-dialog offer-create-dialog"
                aria-labelledby="offer-create-heading"
                aria-modal="true"
                onCancel={(event) => {
                  event.preventDefault();
                  if (busy === '') setCreateDialogOpen(false);
                }}
              >
                <h4 id="offer-create-heading">
                  {createKind === 'offer'
                    ? 'Angebot anlegen'
                    : createKind === 'order_confirmation'
                      ? 'Auftragsbestätigung anlegen'
                      : createKind === 'invoice'
                        ? 'Rechnung anlegen'
                        : createKind === 'final_invoice'
                          ? 'Schlussrechnung anlegen'
                          : createKind === 'correction'
                            ? 'Rechnungskorrektur anlegen'
                            : createKind === 'blank_invoice'
                              ? 'Rechnung ohne Auftragsbestätigung anlegen'
                              : 'Anzahlungsrechnung anlegen'}
                </h4>
                {(createKind === 'offer' || createKind === 'blank_invoice') && (
                  <p>
                    Eventkontakt:{' '}
                    {contactId
                      ? contactName?.trim() || 'Zugeordneter Kontakt'
                      : 'Kein Hauptkontakt zugeordnet'}
                  </p>
                )}
                {(createUncertain || initialLoadFailed || reloadWarning) &&
                  !message && (
                    <p role="alert">
                      {createUncertain
                        ? uncertainCreateMessage(createKind)
                        : initialLoadFailed
                          ? 'Angebote und Vorlagen konnten nicht geladen werden. Bitte erneut laden, bevor Sie einen Entwurf anlegen.'
                          : 'Die Dateiliste konnte nach dem letzten Speichern nicht aktualisiert werden. Bitte erneut laden, bevor Sie einen weiteren Entwurf anlegen.'}
                    </p>
                  )}
                {(createUncertain || initialLoadFailed || reloadWarning) && (
                  <button
                    type="button"
                    className="tertiary-action"
                    disabled={busy !== ''}
                    onClick={retryLoad}
                  >
                    {createUncertain
                      ? createKind === 'offer'
                        ? 'Angebote aktualisieren'
                        : 'Dateien aktualisieren'
                      : 'Dateien erneut laden'}
                  </button>
                )}
                {message && <p role="alert">{message}</p>}
                {createKind === 'blank_invoice' && (
                  <>
                    {busy === 'blank_invoice' && (
                      <p role="status">Rechnungsentwurf wird angelegt …</p>
                    )}
                    {pendingBlankInvoice && busy === '' && (
                      <p role="alert">
                        {blankInvoiceInvalid
                          ? pendingBlankInvoice === 'reviewed'
                            ? 'Die ursprüngliche Rechnung kann bereits bestehen. Wenn Sie den gespeicherten Auftrag verwerfen und später erneut eine Rechnung anlegen, kann eine zweite Rechnung entstehen.'
                            : 'Der gespeicherte Auftrag ist beschädigt. Prüfen Sie die Dateiliste auf eine bereits angelegte Rechnung.'
                          : blankInvoiceContextChanged
                            ? 'Der Hauptkontakt wurde geändert. Ordnen Sie für die Wiederholung den ursprünglichen Hauptkontakt zu.'
                            : 'Der Ausgang der Anlage ist unklar. Sie können denselben Auftrag erneut versuchen.'}
                      </p>
                    )}
                  </>
                )}
                <form onSubmit={(event) => void createSelected(event)}>
                  <fieldset
                    disabled={
                      busy !== '' ||
                      createUncertain ||
                      initialLoadFailed ||
                      reloadWarning ||
                      recordRemoving
                    }
                  >
                    <label>
                      Dokumentenart
                      <select
                        value={createKind}
                        onChange={(event) => {
                          const kind = event.target.value as CreateKind;
                          setCreateKind(kind);
                          if (kind === 'order_confirmation')
                            setConfirmationSourceId(
                              confirmationSources[0]?.id ?? '',
                            );
                          if (
                            kind === 'deposit_invoice' ||
                            kind === 'invoice' ||
                            kind === 'final_invoice'
                          )
                            setDepositSourceId(
                              (kind === 'deposit_invoice'
                                ? depositSources
                                : invoiceSources)[0]?.id ?? '',
                            );
                          if (kind === 'correction') {
                            setCorrectionDirection('credit');
                            setCorrectionSourceId(
                              correctionSources[0]?.id ?? '',
                            );
                          }
                        }}
                      >
                        <option value="offer">Angebot</option>
                        <option value="order_confirmation">
                          Auftragsbestätigung
                        </option>
                        <option value="deposit_invoice">
                          Anzahlungsrechnung
                        </option>
                        <option value="invoice">Rechnung</option>
                        <option value="final_invoice">Schlussrechnung</option>
                        <option value="correction">Rechnungskorrektur</option>
                        <option value="blank_invoice">
                          Rechnung ohne Auftragsbestätigung
                        </option>
                      </select>
                    </label>
                    {createKind === 'offer' ? (
                      <>
                        <label>
                          Vorlage
                          <select
                            disabled={!contactId}
                            value={templateId}
                            onChange={(event) =>
                              setTemplateId(event.target.value)
                            }
                          >
                            <option value="">Ohne Vorlage</option>
                            {templates.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="primary-action"
                          disabled={!contactId}
                        >
                          Entwurf anlegen
                        </button>
                      </>
                    ) : createKind === 'blank_invoice' ? (
                      <>
                        {!contactId && (
                          <p className="document-hint">
                            Für eine Rechnung zuerst einen Hauptkontakt
                            zuordnen.
                          </p>
                        )}
                        {blankInvoiceInvalid ? (
                          pendingBlankInvoice === 'reviewed' ? (
                            <button
                              type="button"
                              className="primary-action"
                              onClick={() => {
                                try {
                                  sessionStorage.removeItem(blankInvoiceKey);
                                  setPendingBlankInvoice(null);
                                  setCreateDialogOpen(false);
                                  setMessage(
                                    'Gespeicherter Auftrag verworfen.',
                                  );
                                } catch {
                                  setMessage(
                                    'Der gespeicherte Auftrag lässt sich im Browser nicht entfernen.',
                                  );
                                }
                              }}
                            >
                              Dateiliste geprüft, Auftrag verwerfen
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="primary-action"
                              onClick={() => void reviewInvalidInvoiceRequest()}
                            >
                              Dateiliste aktualisieren und prüfen
                            </button>
                          )
                        ) : (
                          <button
                            ref={blankInvoiceSubmit}
                            className="primary-action"
                            disabled={
                              !contactId ||
                              blankInvoiceContextChanged ||
                              editorBusy ||
                              editorDirty
                            }
                          >
                            {pendingBlankInvoice
                              ? 'Anlage erneut versuchen'
                              : 'Rechnungsentwurf anlegen'}
                          </button>
                        )}
                      </>
                    ) : createKind === 'order_confirmation' ? (
                      <>
                        <label>
                          Angenommenes Angebot
                          <select
                            value={confirmationSourceId}
                            required
                            onChange={(event) =>
                              setConfirmationSourceId(event.target.value)
                            }
                          >
                            {confirmationSources.length ? (
                              confirmationSources.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {'Angebot ' + (entry.number ?? 'Entwurf')}
                                </option>
                              ))
                            ) : (
                              <option value="">
                                Kein geeignetes Angebot vorhanden
                              </option>
                            )}
                          </select>
                        </label>
                        <button
                          className="primary-action"
                          disabled={
                            !confirmationSources.some(
                              (entry) => entry.id === confirmationSourceId,
                            )
                          }
                        >
                          Auftragsbestätigung anlegen
                        </button>
                      </>
                    ) : createKind === 'final_invoice' ? (
                      <>
                        <label>
                          Auftragsbestätigung
                          <select
                            value={depositSourceId}
                            required
                            onChange={(event) =>
                              setDepositSourceId(event.target.value)
                            }
                          >
                            {invoiceSources.length ? (
                              invoiceSources.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {'Auftragsbestätigung ' +
                                    (entry.number ?? 'Entwurf')}
                                </option>
                              ))
                            ) : (
                              <option value="">
                                Keine geeignete Auftragsbestätigung ohne
                                Rechnung vorhanden
                              </option>
                            )}
                          </select>
                        </label>
                        <p className="document-hint">
                          Die Positionen werden in den Entwurf kopiert und
                          bleiben dort bearbeitbar. Die bereits gestellten
                          Anzahlungen werden erst beim Finalisieren brutto
                          verrechnet und dann eingefroren. Je
                          Auftragsbestätigung ist genau eine Rechnung möglich –
                          als Standardrechnung oder als Schlussrechnung.
                        </p>
                        <button
                          className="primary-action"
                          disabled={
                            !invoiceSources.some(
                              (entry) => entry.id === depositSourceId,
                            )
                          }
                        >
                          Schlussrechnung anlegen
                        </button>
                      </>
                    ) : createKind === 'correction' ? (
                      <>
                        <label>
                          Quellbeleg
                          <select
                            value={correctionSourceId}
                            required
                            onChange={(event) =>
                              setCorrectionSourceId(event.target.value)
                            }
                          >
                            {correctionSources.length ? (
                              correctionSources.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {kindName(entry) +
                                    ' ' +
                                    (entry.number ?? 'Entwurf')}
                                </option>
                              ))
                            ) : (
                              <option value="">
                                Keine geeignete Rechnung oder
                                Auftragsbestätigung vorhanden
                              </option>
                            )}
                          </select>
                        </label>
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
                        <p className="document-hint">
                          Eine Korrektur ist ein eigener Beleg mit eigener
                          Nummer und lässt den Quellbeleg unverändert. Die
                          Positionen werden zunächst übernommen. Als Gutschrift
                          mindert sie den Betrag, als Lastschrift erhöht sie
                          ihn.
                        </p>
                        {correctionDirection === 'credit' &&
                          correctionSources.find(
                            (entry) => entry.id === correctionSourceId,
                          )?.remainingCredit === 0 && (
                            <p role="alert">
                              Dieser Beleg ist bereits vollständig
                              gutgeschrieben. Eine weitere Gutschrift wird beim
                              Finalisieren abgelehnt.
                            </p>
                          )}
                        <button
                          className="primary-action"
                          disabled={
                            !correctionSources.some(
                              (entry) => entry.id === correctionSourceId,
                            )
                          }
                        >
                          Korrektur anlegen
                        </button>
                      </>
                    ) : (
                      <>
                        <label>
                          Auftragsbestätigung
                          <select
                            value={depositSourceId}
                            required
                            onChange={(event) =>
                              setDepositSourceId(event.target.value)
                            }
                          >
                            {currentSources.length ? (
                              currentSources.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {'Auftragsbestätigung ' +
                                    (entry.number ?? 'Entwurf')}
                                </option>
                              ))
                            ) : (
                              <option value="">
                                Keine geeignete Auftragsbestätigung vorhanden
                              </option>
                            )}
                          </select>
                        </label>
                        {createKind === 'deposit_invoice' && (
                          <p className="document-hint">
                            Die Positionen werden in den Entwurf kopiert. Kürzen
                            Sie sie dort auf den vereinbarten Anzahlungsbetrag.
                          </p>
                        )}
                        <button
                          className="primary-action"
                          disabled={
                            !currentSources.some(
                              (entry) => entry.id === depositSourceId,
                            )
                          }
                        >
                          {createKind === 'invoice'
                            ? 'Rechnung anlegen'
                            : 'Anzahlungsrechnung anlegen'}
                        </button>
                      </>
                    )}
                  </fieldset>
                </form>
                <button
                  type="button"
                  className="tertiary-action"
                  disabled={busy !== ''}
                  onClick={() => setCreateDialogOpen(false)}
                >
                  Schließen
                </button>
              </dialog>
            )}
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
                  is the refund, not the settlement.
                  RG-08: the lateness of a claim is derived and named in the row,
                  so the card no longer denies it. */}
              {group.kind === 'invoice' && (
                <p className="document-card-hint">
                  Eine reguläre Rechnung kann direkt zum Event angelegt werden.
                  Aus einer Auftragsbestätigung entsteht genau eine Rechnung als
                  Standardrechnung oder als Schlussrechnung. Die Schlussrechnung
                  verrechnet die bereits gestellten Anzahlungen; eine
                  finalisierte Rechnung wird nie ersetzt, sondern nur durch eine
                  Rechnungskorrektur ergänzt. Zahlungseingänge werden manuell
                  erfasst; Leistungsdatum und Zahlungsziel lassen sich je
                  Rechnung im Entwurf angeben, und nach Ablauf des Zahlungsziels
                  gilt ein offener Beleg als überfällig.
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
