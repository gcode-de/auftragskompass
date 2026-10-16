import { AuthPanel } from './AuthPanel.js';
export function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>AuftragsKompass</h1>
        <p>Anfragen, Kontakte und Stammdaten verwalten.</p>
      </header>
      <AuthPanel />
    </main>
  );
}
