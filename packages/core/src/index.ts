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
