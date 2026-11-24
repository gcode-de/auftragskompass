import { AuthPanel } from './AuthPanel.js';
import { useModalScrollLock } from './modalScrollLock.js';
export function App() {
  // UI-SCROLL-01: while any modal dialog is open, the page behind it stays.
  useModalScrollLock();
  return (
    <main className="app-shell">
      <AuthPanel />
    </main>
  );
}
