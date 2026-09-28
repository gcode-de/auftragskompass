export const applicationName: string = 'AuftragsKompass';
export { loadRuntimeConfig, createHealthServer } from './runtime.js';
export { migrate, identityRepository } from './identity.js';
export { loadAuthConfig } from './auth-config.js';
export { googleProvider } from './oidc.js';
export { registerAuth } from './auth.js';
