import { ThemeToggle } from './ThemeToggle.js';
import { AuthPanel } from './AuthPanel.js';
export function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <ThemeToggle />
        <h1>AuftragsKompass</h1>
        <p>Anfragen, Kontakte und Stammdaten verwalten.</p>
      </header>
      <AuthPanel />
    </main>
  );
}
