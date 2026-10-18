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
  receiveWebsiteInquiry,
  isWebsiteInquiry,
  WebsiteInquiryError,
  type WebsiteInquiry,
} from './website-inquiries.js';
