type DirtyCheck = () => boolean;

const checks = new Set<DirtyCheck>();

export const discardForHomeMessage =
  'Ungespeicherte Eingaben verwerfen und zur Eventübersicht wechseln?';

export const discardForSearchMessage =
  'Ungespeicherte Eingaben verwerfen und zur Suche wechseln?';

export function registerUnsavedChanges(check: DirtyCheck): () => void {
  checks.add(check);
  return () => {
    checks.delete(check);
  };
}

export function hasUnsavedChanges(): boolean {
  for (const check of checks) {
    if (check()) return true;
  }
  return false;
}
