export const applicationName: string = 'AuftragsKompass';
export {
  loadRuntimeConfig,
  createHealthServer,
  type RuntimeConfig,
  type Probes,
} from './runtime.js';
export { migrate, identityRepository } from './identity.js';
export {
  registerTelegramSettingsRoutes,
  telegramKeyFromSecret,
  startTelegramNotifications,
  encryptTelegramToken,
  decryptTelegramToken,
} from './telegram.js';
export { loadAuthConfig } from './auth-config.js';
export { googleProvider } from './oidc.js';
export { registerAuth } from './auth.js';
export { bootstrapAccess } from './access.js';
export { registerAccessRoutes } from './access-routes.js';
export { registerAuditRoutes } from './audit.js';
export { registerMasterDataRoutes } from './master-data.js';
export { registerResourceRoutes } from './resources.js';
export { registerProductRoutes } from './products.js';

export {
  documentKinds,
  templatePlaceholders,
  templateTokens,
  assertTemplateText,
  renderTemplate,
  documentTemplateRepository,
  registerDocumentTemplateRoutes,
  DocumentTemplateError,
  type DocumentKind,
  type TemplatePlaceholder,
  type TemplatePositionInput,
  type DocumentTemplateInput,
} from './document-templates.js';

export {
  assertNumberPattern,
  formatDocumentNumber,
  documentNumberRepository,
  allocateDocumentNumber,
  registerDocumentNumberRoutes,
  DocumentNumberError,
  type NumberSequenceInput,
} from './document-numbers.js';

export {
  documentTotals,
  assertTotalsConsistent,
  formatMinorUnits,
  formatDocumentDate,
  lineTotals,
  DocumentTotalsError,
  type TotalsLine,
  type LineTotals,
  type TaxGroup,
  type DocumentTotals,
} from './document-totals.js';

export {
  renderDocumentHtml,
  escapeHtml,
  documentLayoutRepository,
  registerDocumentLayoutRoutes,
  DocumentLayoutError,
  type DocumentLayoutInput,
  type DocumentLineInput,
  type DocumentRenderInput,
} from './document-layouts.js';

export {
  renderDocumentPdf,
  contentHash,
  chromiumPdfRenderer,
  DocumentPdfError,
  type PdfArtifact,
  type PdfRenderer,
  type ChromiumOptions,
} from './document-pdf.js';

export {
  buildDocumentSnapshot,
  assertTransition,
  DocumentSnapshotError,
  type DocumentState,
  type DocumentSnapshot,
  type SnapshotInput,
} from './document-snapshot.js';

export {
  localStorageAdapter,
  assertStorageKey,
  StorageError,
  type StorageAdapter,
} from './storage.js';

export {
  artifactKey,
  storeDocumentPdf,
  readDocumentPdf,
  hashPattern,
} from './document-artifacts.js';

export {
  documentRepository,
  registerDocumentRoutes,
  DocumentError,
  type DocumentLineDraft,
  type DocumentDraftInput,
  type DocumentDependencies,
} from './documents.js';

export {
  documentPaymentRepository,
  registerDocumentPaymentRoutes,
  paymentState,
  openMinorOf,
  paymentBalance,
  paidMinorOf,
  paymentMethods,
  paymentStates,
  paymentNoteMaxLength,
  maxPaymentMinor,
  DocumentPaymentError,
  type PaymentMethod,
  type PaymentState,
  type PaymentInput,
  type PaymentRow,
  type PaymentBalance,
} from './document-payments.js';

export { contactRepository, registerContactRoutes } from './contacts.js';

export { registerLocationRoutes } from './locations.js';

export { registerEventRoutes } from './events.js';
export { registerEventNoteRoutes } from './event-notes.js';

export {
  libraryFileMaxBytes,
  libraryMediaTypes,
  sniffLibraryMediaType,
  checkLibraryBytes,
  normalizeLibraryDisplayName,
  libraryFileExtension,
  libraryStorageKey,
  decodeLibraryBase64,
  contentDispositionHeader,
  libraryFileRepository,
  registerLibraryFileRoutes,
  LibraryFileError,
  type LibraryMediaType,
  type LibraryFileRow,
  type LibraryFileUploadInput,
} from './library-files.js';

export { startReservationExpiry } from './reservation-worker.js';

export {
  mailDirections,
  mailFolders,
  mailEditStates,
  mailSendStates,
  mailOutboxStates,
  canTransitionMailOutbox,
  mailOutboxRetryDelaySeconds,
  mailAddressList,
  mailRepository,
  registerMailRoutes,
  claimMailOutboxJob,
  runMailOutboxPass,
  startMailOutbox,
  MailError,
  mailSmtpSecurities,
  type MailSmtpSecurity,
  type MailDirection,
  type MailFolder,
  type MailEditState,
  type MailSendState,
  type MailOutboxState,
  type MailErrorReason,
  type MailAccountInput,
  type MailAccountRow,
  type MailMessageInput,
  type MailMessageSummary,
  type MailMessageDetail,
  type MailOutboxRow,
  type ClaimedMailOutboxJob,
  type MailOutboxConfig,
  type MailOutboxFailure,
  // MAIL-DOC-01: the reference of a document attachment, never its bytes.
  type MailAttachmentSummary,
  type MailDocumentSendInput,
  type MailDocumentSendResult,
  // MAIL-EDITOR-01: the read-only twin of a document send.
  type MailDocumentPreviewInput,
  type MailDocumentPreview,
  type MailRepositoryOptions,
  maxMailAttachmentBytes,
} from './mail.js';

// MAIL-TPL-01a: reusable mail templates.
export {
  mailTemplateRepository,
  registerMailTemplateRoutes,
  mailTemplateFields,
  previewMailTemplate,
  mailTemplateExampleValues,
  mailTemplateStates,
  MailTemplateError,
  type MailTemplateInput,
  type MailTemplateSummary,
  type MailTemplateDetail,
  type MailTemplatePreview,
  type MailTemplateState,
} from './mail-templates.js';

// MAIL-021-B: the provider boundary of the outbox.
export {
  smtpMailSender,
  classifySmtpFailure,
  type MailSender,
  type MailSenderAccount,
  type MailSendEnvelope,
  type MailSendAttachment,
  type MailSendContent,
  type MailSendFailureCode,
  type MailSendResult,
  type SmtpAttemptPhase,
  type SmtpSenderOptions,
} from './mail-sender.js';

export { registerImportRoutes } from './import-routes.js';

export { bootstrapPassword, passwordAccess } from './password-access.js';

export { registerCalendarFeedRoutes } from './calendar-feeds.js';

export {
  inquiryFormV1,
  inquirySubmissionSchema,
  isInquirySubmission,
  type InquirySubmission,
} from './inquiry-form.js';

export {
  signGatewayMessage,
  verifyGatewayMessage,
  gatewayMessageLimit,
  type GatewayMessage,
  type GatewayKey,
  type GatewayDirection,
  type GatewayKind,
} from './gateway-message.js';

export {
  migrateGateway,
  processGatewayOperation,
  GatewayOperationError,
} from './gateway-operations.js';

export {
  inquiryInbox,
  InquiryInboxError,
  type InquiryInboxConfig,
} from './inquiry-inbox.js';

export {
  createInquiryGateway,
  registerInquiryPreviewRoute,
} from './inquiry-gateway.js';

export {
  loadInquiryConfig,
  loadInquirySyncConfig,
  type InquiryConfig,
  type InquirySyncConfig,
} from './inquiry-config.js';

export { startWebsiteInquirySync } from './inquiry-sync-worker.js';

export {
  loadWebsiteOptionConfig,
  loadWebsiteOptionDrainActivation,
  startWebsiteOptionDrain,
  websiteOptionDependencies,
  type WebsiteOptionConfig,
  type WebsiteOptionDrainDependencies,
} from './website-option-worker.js';

export {
  receiveWebsiteInquiry,
  isWebsiteInquiry,
  WebsiteInquiryError,
  type WebsiteInquiry,
} from './website-inquiries.js';

export { registerWebsiteInquiryRoutes } from './website-inquiry-routes.js';
export {
  inquiryEmailKey,
  inquiryEmailSubject,
  registerInquiryEmailSettingsRoutes,
  renderWebsiteInquiryEmail,
  type InquiryEmailSettings,
} from './inquiry-email.js';
export {
  registerMailForwardSettingsRoutes,
  readMailForwardSettings,
  type MailForwardSettings,
} from './mail-forward.js';
export {
  stageWebsiteInquiry,
  importStagedWebsiteInquiry,
} from './website-inquiry-deliveries.js';
export { receiveWebsiteInquiryBatch } from './website-inquiry-sync.js';

export { registerWebsiteInboxRoutes } from './website-inbox-routes.js';
export { pullWebsiteInquiries } from './website-inquiry-pull.js';
export {
  prepareWebsiteInquiryAcknowledgement,
  receiveWebsiteInquiryAcknowledgement,
} from './website-inquiry-ack.js';
export { acknowledgeWebsiteInquiries } from './website-inquiry-ack-send.js';
export {
  mailSignatureRepository,
  normalizeSignature,
  registerMailSignatureRoutes,
  signatureLogoToken,
  MailSignatureError,
  type MailSignature,
  type MailSignatureInput,
} from './mail-signatures.js';
