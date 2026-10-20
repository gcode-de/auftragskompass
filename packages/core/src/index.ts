export const applicationName: string = 'AuftragsKompass';
export { loadRuntimeConfig, createHealthServer } from './runtime.js';
export { migrate, identityRepository } from './identity.js';
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

export { contactRepository, registerContactRoutes } from './contacts.js';

export { registerLocationRoutes } from './locations.js';

export { registerEventRoutes } from './events.js';

export { startReservationExpiry } from './reservation-worker.js';

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
  receiveWebsiteInquiry,
  isWebsiteInquiry,
  WebsiteInquiryError,
  type WebsiteInquiry,
} from './website-inquiries.js';

export { registerWebsiteInquiryRoutes } from './website-inquiry-routes.js';
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
