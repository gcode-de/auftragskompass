declare const __AK_REVISION__: string;

// Vite replaces the identifier at build time (apps/admin/vite.config.ts); the
// test config supplies the same define, so there is no runtime fallback branch.
export const appRevision: string = __AK_REVISION__;

export function versionLabel(revision: string): string {
  return revision === 'development' ? 'Entwicklung' : revision.slice(0, 7);
}

export const appVersionLabel = versionLabel(appRevision);
